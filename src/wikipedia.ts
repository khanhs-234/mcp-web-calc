export interface WikiSummary {
  lang: string;
  title: string;
  url: string;
  description?: string;
  extract?: string;
  thumbnailUrl?: string;
}

// Single entry point: get summary for a Wikipedia title
function uaHeaders(lang = process.env.LANG_DEFAULT || "vi") {
  const ua = process.env.USER_AGENT || "mcp-web-calc/0.2";
  const accept = lang === "vi" ? "vi-VN,vi;q=0.9,en;q=0.8" : "en-US,en;q=0.9";
  return { "User-Agent": ua, "Accept-Language": accept } as Record<string, string>;
}

function toMs(env: string | undefined, def: number) {
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? n : def;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function wikiGetSummary(title: string, lang: string = "vi"): Promise<WikiSummary> {
  const base = `https://${lang}.wikipedia.org`;
  const sumUrl = new URL(`${base}/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  try {
    const sres = await fetchWithTimeout(sumUrl, { headers: uaHeaders(lang) }, toMs(process.env.HTTP_TIMEOUT, 15000));
    if (!sres.ok) {
      return { lang, title, url: `${base}/wiki/${encodeURIComponent(title)}` };
    }
    const s = await sres.json() as any;
    return {
      lang,
      title: s.title ?? title,
      url: s.content_urls?.desktop?.page ?? `${base}/wiki/${encodeURIComponent(title)}`,
      description: s.description,
      extract: s.extract,
      thumbnailUrl: s.thumbnail?.source
    };
  } catch {
    return { lang, title, url: `${base}/wiki/${encodeURIComponent(title)}` };
  }
}

// === wiki_multi helpers (append to end of src/wikipedia.ts) ===

async function wikiGetLanglinks(baseTitle: string, baseLang: string): Promise<Record<string, string>> {
  const base = `https://${baseLang}.wikipedia.org/w/api.php`;
  const url = new URL(base);
  url.searchParams.set("action", "query");
  url.searchParams.set("titles", baseTitle);
  url.searchParams.set("prop", "langlinks");
  url.searchParams.set("lllimit", "max");
  url.searchParams.set("format", "json");
  try {
    const res = await fetchWithTimeout(url, { headers: uaHeaders(baseLang) }, toMs(process.env.HTTP_TIMEOUT, 15000));
    if (!res.ok) return {};
    const data = await res.json() as any;
    const pages = data?.query?.pages;
    const first = pages && Object.values(pages)[0] as any;
    const ll: Array<{ lang: string; ["*"]: string }> = first?.langlinks || [];
    const map: Record<string, string> = {};
    for (const item of ll) map[item.lang] = item["*"];
    return map;
  } catch {
    return {};
  }
}

export interface WikiMultiSummary {
  baseLang: string;
  base: WikiSummary;
  items: Record<string, WikiSummary | null>;
  resolved: Record<string, { title?: string; source: "base" | "langlinks" | "direct" | "none" }>;
}

export async function wikiGetMultiSummary(term: string, baseLang: string = "vi", langs: string[] = ["vi","en"]): Promise<WikiMultiSummary> {
  const want = Array.from(new Set(langs.map(s => s.trim().toLowerCase()).filter(Boolean)));
  if (!want.includes(baseLang)) want.unshift(baseLang);

  const base = await wikiGetSummary(term, baseLang);
  const langlinks = await wikiGetLanglinks(base.title, baseLang);

  const items: Record<string, WikiSummary | null> = {};
  const resolved: WikiMultiSummary["resolved"] = {};
  items[baseLang] = base;
  resolved[baseLang] = { title: base.title, source: "base" };

  const tasks = want.filter(l => l !== baseLang).map(async (l) => {
    let title: string | undefined;
    let source: "base" | "langlinks" | "direct" | "none" = "none";
    if (langlinks[l]) { title = langlinks[l]; source = "langlinks"; }
    else { title = term; source = "direct"; }
    try {
      const sum = await wikiGetSummary(title!, l);
      items[l] = sum;
      resolved[l] = { title: sum.title, source };
    } catch {
      items[l] = null;
      resolved[l] = { title, source: "none" };
    }
  });

  await Promise.all(tasks);
  return { baseLang, base, items, resolved };
}

// === end wiki_multi helpers ===


