// src/engines.ts — two-tier search: fast (DuckDuckGo HTML) -> deep (Bing via Playwright)
import { JSDOM } from "jsdom";

export type SearchMode = "fast" | "deep" | "auto";
export type EngineName = "ddg_html" | "bing_pw";

export interface SearchItem {
  title: string;
  url: string;
  snippet?: string;
  source: EngineName;
}

export interface SearchResponse {
  items: SearchItem[];
  modeUsed: SearchMode;
  enginesUsed: EngineName[];
  escalated: boolean;
  diagnostics?: Record<string, unknown>;
}

function uaHeaders(lang = process.env.LANG_DEFAULT || "vi") {
  const ua = process.env.USER_AGENT || "mcp-web-calc/0.2";
  const acceptLang = lang === "vi" ? "vi-VN,vi;q=0.9,en;q=0.8" : "en-US,en;q=0.9";
  return { "User-Agent": ua, "Accept-Language": acceptLang } as Record<string, string>;
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

const HTTP_TIMEOUT = toMs(process.env.HTTP_TIMEOUT, 15000);

function decodeDuckDuckGoRedirect(href: string): string {
  try {
    const u = new URL(href, "https://duckduckgo.com/");
    if (u.hostname === "duckduckgo.com" && u.pathname.startsWith("/l/")) {
      const real = u.searchParams.get("uddg");
      if (real) return decodeURIComponent(real);
    }
    return u.toString();
  } catch {
    return href;
  }
}

async function ddgHtmlSearch(q: string, limit: number, lang: string): Promise<SearchItem[]> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", q);
  const res = await fetchWithTimeout(url, { headers: uaHeaders(lang) }, HTTP_TIMEOUT);
  if (!res.ok) throw new Error(`DuckDuckGo HTML ${res.status}`);
  const html = await res.text();
  const dom = new JSDOM(html, { url: "https://duckduckgo.com/?q=" + encodeURIComponent(q) });
  const doc = dom.window.document;
  const anchors = Array.from(doc.querySelectorAll("a.result__a"));
  const snippets = Array.from(doc.querySelectorAll(".result__snippet"));
  const items: SearchItem[] = [];
  for (let i = 0; i < anchors.length && items.length < limit; i++) {
    const a = anchors[i] as HTMLAnchorElement;
    const title = (a.textContent || "").trim();
    const href = decodeDuckDuckGoRedirect(a.getAttribute("href") || "");
    if (!title || !href) continue;
    const sn = (snippets[i]?.textContent || "").trim() || undefined;
    try {
      const u = new URL(href);
      items.push({ title, url: u.toString(), snippet: sn, source: "ddg_html" });
    } catch {}
  }
  return items;
}

async function bingPlaywrightSearch(q: string, limit: number, lang: string): Promise<SearchItem[]> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: lang === "vi" ? "vi-VN" : "en-US",
    userAgent: (process.env.USER_AGENT || "mcp-web-calc/0.2") + " Playwright",
  });
  try {
    const page = await context.newPage();
    const url = new URL("https://www.bing.com/search");
    url.searchParams.set("q", q);
    if (lang) url.searchParams.set("setlang", lang === "vi" ? "vi" : "en");
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 30000 });
    const results: SearchItem[] = [];
    const cards = await page.$$("li.b_algo");
    for (const card of cards) {
      const a = await card.$("h2 a");
      if (!a) continue;
      const title = (await a.textContent())?.trim() || "";
      const href = await a.getAttribute("href");
      if (!href || !title) continue;
      let snippet = (await card.$eval("div.b_caption p", el => (el as HTMLElement).textContent || "").catch(() => "")) as string;
      if (!snippet) {
        snippet = await card.$eval("div.b_snippet", el => (el as HTMLElement).textContent || "").catch(() => "") as string;
      }
      try {
        const u = new URL(href);
        results.push({ title, url: u.toString(), snippet: snippet?.trim() || undefined, source: "bing_pw" });
      } catch {}
      if (results.length >= limit) break;
    }
    return results;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export async function runTwoTierSearch(opts: { q: string; limit?: number; lang?: string; mode?: SearchMode; timeoutMs?: number }): Promise<SearchResponse> {
  const { q } = opts;
  const limit = Math.max(1, Math.min(Number(opts.limit ?? Number(process.env.MAX_RESULTS) || 10), 50));
  const lang = opts.lang ?? (process.env.LANG_DEFAULT || "vi");
  const mode = opts.mode ?? "auto";

  const enginesUsed: EngineName[] = [];
  const diagnostics: Record<string, unknown> = {};

  if (mode === "fast") {
    const fast = await ddgHtmlSearch(q, limit, lang);
    enginesUsed.push("ddg_html");
    diagnostics["fastCount"] = fast.length;
    return { items: fast, modeUsed: "fast", enginesUsed, escalated: false, diagnostics };
  }

  if (mode === "deep") {
    const deep = await bingPlaywrightSearch(q, limit, lang);
    enginesUsed.push("bing_pw");
    diagnostics["deepCount"] = deep.length;
    return { items: deep, modeUsed: "deep", enginesUsed, escalated: false, diagnostics };
  }

  // auto: run fast first, then escalate to deep if too few
  const fast = await ddgHtmlSearch(q, limit, lang);
  enginesUsed.push("ddg_html");
  diagnostics["fastCount"] = fast.length;
  if (fast.length < Math.min(3, limit)) {
    const deep = await bingPlaywrightSearch(q, limit, lang);
    enginesUsed.push("bing_pw");
    diagnostics["deepCount"] = deep.length;
    return { items: [...fast, ...deep].slice(0, limit), modeUsed: "auto", enginesUsed, escalated: true, diagnostics };
  }
  return { items: fast, modeUsed: "auto", enginesUsed, escalated: false, diagnostics };
}
