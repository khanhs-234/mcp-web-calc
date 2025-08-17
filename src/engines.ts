// src/engines.ts
// Search engine helpers for mcp-web-calc
// - Fix relative links from DuckDuckGo HTML by setting a base URL in JSDOM
// - Defensive URL parsing in mergeDedupe
// - Modes: fast (DDG HTML), deep (Bing via Playwright), auto (fast → escalate)

import { JSDOM } from "jsdom";

export type SearchMode = "fast" | "deep" | "auto";
export type EngineName = "ddg_html" | "bing_pw";

export interface SearchItem {
  title: string;
  url: string;
  snippet?: string;
  source: EngineName;
}

const UA =
  process.env.USER_AGENT ||
  "mcp-web-calc/0.1 (+https://github.com/khanhs-234/mcp-web-calc)";
const HTTP_TIMEOUT = Number(process.env.HTTP_TIMEOUT || 15000);
const FAST_TIME_BUDGET_MS = Number(process.env.FAST_TIME_BUDGET_MS || 1800);
const MAX_RESULTS = Number(process.env.MAX_RESULTS || 5);

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function makeAbortableTimeout(ms: number) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort("timeout"), ms);
  return { ctrl, cancel: () => clearTimeout(id) };
}
function langHeader(lang?: string) {
  if (!lang) return undefined;
  return `${lang};q=1.0, en;q=0.8`;
}
function ddgBaseURL(query: string, lang?: string) {
  const u = new URL("https://html.duckduckgo.com/html/");
  u.searchParams.set("q", query);
  if (lang) u.searchParams.set("kl", `${lang}-${lang}`);
  return u;
}

/** FAST: HTML DuckDuckGo (không Playwright) */
export async function ddgHtmlSearch(
  query: string,
  num = MAX_RESULTS,
  lang?: string,
  timeBudgetMs = FAST_TIME_BUDGET_MS
): Promise<SearchItem[]> {
  const base = ddgBaseURL(query, lang);
  const { ctrl, cancel } = makeAbortableTimeout(
    Math.min(timeBudgetMs, HTTP_TIMEOUT)
  );

  try {
    const res = await fetch(base.toString(), {
      method: "GET",
      signal: ctrl.signal,
      headers: {
        "User-Agent": UA,
        "Accept-Language": langHeader(lang) || "",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const html = await res.text();

    // Set base URL để href tương đối → tuyệt đối
    const dom = new JSDOM(html, { url: base.toString() });
    const doc = dom.window.document;

    const items: SearchItem[] = [];
    const nodes = Array.from(doc.querySelectorAll("div.result, .web-result"));

    for (const node of nodes.slice(0, num * 2)) {
      const a =
        (node.querySelector("a.result__a") as HTMLAnchorElement | null) ||
        (node.querySelector("a[href]") as HTMLAnchorElement | null);
      if (!a) continue;

      let abs: string;
      try {
        const href = a.getAttribute("href") || "";
        abs = new URL(href, base).toString();
      } catch { continue; }

      const title = (a.textContent || abs).trim();
      const snippet =
        node.querySelector(".result__snippet")?.textContent?.trim() ||
        node.querySelector(".result__snippet.js-result-snippet")
          ?.textContent?.trim() ||
        node.textContent?.trim();

      items.push({ title, url: abs, snippet, source: "ddg_html" });
      if (items.length >= num) break;
    }

    return items;
  } finally {
    cancel();
  }
}

/** DEEP: Bing qua Playwright (Chromium) */
export async function deepSearchWithPlaywright(
  query: string,
  num = MAX_RESULTS,
  lang?: string
): Promise<SearchItem[]> {
  let chromium: any;
  try {
    chromium = (await import("playwright")).chromium;
  } catch {
    throw new Error("Playwright is not installed. Run: npx playwright install chromium");
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ userAgent: UA, locale: lang || "en-US" });
    const page = await ctx.newPage();

    const u = new URL("https://www.bing.com/search");
    u.searchParams.set("q", query);
    if (lang) u.searchParams.set("setLang", lang);
    await page.goto(u.toString(), { waitUntil: "domcontentloaded", timeout: HTTP_TIMEOUT });
    await sleep(200);

    const items: SearchItem[] = await page.evaluate((limit: number) => {
      const out: { title: string; url: string; snippet?: string; source: "bing_pw" }[] = [];
      const cards = Array.from(document.querySelectorAll("li.b_algo"));
      for (const c of cards) {
        const a = c.querySelector<HTMLAnchorElement>("h2 a, a[href]");
        if (!a) continue;
        const url = a.getAttribute("href") || "";
        const title = (a.textContent || url).trim();
        const snippet =
          c.querySelector(".b_caption p")?.textContent?.trim() ||
          c.textContent?.trim();
        if (url) out.push({ title, url, snippet, source: "bing_pw" });
        if (out.length >= limit) break;
      }
      return out;
    }, num);

    return items;
  } finally {
    await browser.close();
  }
}

/** Gộp & khử trùng lặp theo origin+pathname (parse URL an toàn) */
export function mergeDedupe(lists: SearchItem[][], limit: number): SearchItem[] {
  const seen = new Set<string>();
  const out: SearchItem[] = [];

  for (const list of lists) {
    for (const it of list) {
      let key = it.url;
      try {
        const u = new URL(it.url);
        key = `${u.origin}${u.pathname}`;
      } catch { /* giữ nguyên */ }

      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Heuristic quyết định có escalate hay không */
export function shouldEscalate(items: SearchItem[], desired: number): boolean {
  const min = Math.min(desired, 3);
  if (items.length < min) return true;
  const weak = items.every((x) => (x.title || "").length < 4);
  if (weak) return true;
  const domains = items.map((x) => { try { return new URL(x.url).host; } catch { return x.url; }});
  const uniq = new Set(domains);
  if (uniq.size <= Math.ceil(items.length / 3)) return true;
  return false;
}

/** Report trả về đúng như server.ts đang dùng */
export interface SearchReport {
  items: SearchItem[];
  modeUsed: SearchMode;
  enginesUsed: EngineName[];
  escalated: boolean;
  diagnostics: {
    fastCount?: number;
    deepCount?: number;
    timeBudgetMs?: number;
  };
}

/** Hàm được server.ts gọi: runTwoTierSearch(query, mode?, limit?) */
export async function runTwoTierSearch(
  query: string,
  mode: SearchMode = "auto",
  limit: number = MAX_RESULTS
): Promise<SearchReport> {
  let enginesUsed: EngineName[] = [];
  let items: SearchItem[] = [];
  let escalated = false;

  if (!query || !query.trim()) {
    return { items: [], modeUsed: mode, enginesUsed: [], escalated: false, diagnostics: {} };
  }

  if (mode === "fast") {
    items = await ddgHtmlSearch(query, limit, process.env.LANG_DEFAULT);
    enginesUsed = ["ddg_html"];
    return {
      items,
      modeUsed: "fast",
      enginesUsed,
      escalated: false,
      diagnostics: { fastCount: items.length, timeBudgetMs: FAST_TIME_BUDGET_MS }
    };
  }

  if (mode === "deep") {
    items = await deepSearchWithPlaywright(query, limit, process.env.LANG_DEFAULT);
    enginesUsed = ["bing_pw"];
    return {
      items,
      modeUsed: "deep",
      enginesUsed,
      escalated: false,
      diagnostics: { deepCount: items.length }
    };
  }

  // AUTO: fast → (nếu cần) deep, rồi merge
  const fast = await ddgHtmlSearch(query, limit, process.env.LANG_DEFAULT);
  enginesUsed.push("ddg_html");

  if (shouldEscalate(fast, limit)) {
    escalated = true;
    let deep: SearchItem[] = [];
    try {
      deep = await deepSearchWithPlaywright(query, limit, process.env.LANG_DEFAULT);
      enginesUsed.push("bing_pw");
    } catch {
      // deep unavailable → trả fast
      return {
        items: fast,
        modeUsed: "auto",
        enginesUsed,
        escalated,
        diagnostics: { fastCount: fast.length, timeBudgetMs: FAST_TIME_BUDGET_MS }
      };
    }

    const merged = mergeDedupe([fast, deep], limit);
    return {
      items: merged,
      modeUsed: "auto",
      enginesUsed,
      escalated,
      diagnostics: { fastCount: fast.length, deepCount: deep.length, timeBudgetMs: FAST_TIME_BUDGET_MS }
    };
  }

  // fast đủ tốt → dùng luôn
  return {
    items: fast,
    modeUsed: "auto",
    enginesUsed,
    escalated: false,
    diagnostics: { fastCount: fast.length, timeBudgetMs: FAST_TIME_BUDGET_MS }
  };
}
