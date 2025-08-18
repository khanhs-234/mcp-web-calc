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
