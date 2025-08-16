import { JSDOM } from "jsdom";
import { chromium, Browser, BrowserContext, Page } from "playwright";

const DEFAULT_TIMEOUT = Number(process.env.HTTP_TIMEOUT ?? 15000);
const DEFAULT_LANG = process.env.LANG_DEFAULT ?? "vi";
const FAST_TIME_BUDGET = Number(process.env.FAST_TIME_BUDGET_MS ?? 1800);

export type EngineName = "ddg_html" | "bing_playwright" | "brave_playwright" | "google_playwright";

export interface SearchItem {
  title: string;
  url: string;
  snippet?: string;
  source: EngineName;
}

export interface SearchDiagnostics {
  elapsedMs: number;
  engine: EngineName;
  note?: string;
}

export function uaHeaders() {
  const ua = process.env.USER_AGENT || "mcp-universal-tools/0.1";
  const lang = DEFAULT_LANG;
  return { "User-Agent": ua, "Accept-Language": lang === "vi" ? "vi-VN,vi;q=0.9,en;q=0.8" : "en-US,en;q=0.9" } as Record<string, string>;
}

async function getText(url: string, abort: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal: abort, headers: uaHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

// -------------------- FAST: DuckDuckGo HTML (no playwright) --------------------
export async function ddgHtmlSearch(q: string, num = 5, abort: AbortSignal): Promise<{ items: SearchItem[]; diag: SearchDiagnostics; }> {
  const start = Date.now();
  const u = new URL("https://html.duckduckgo.com/html/");
  u.searchParams.set("q", q);
  const html = await getText(u.toString(), abort);
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const items: SearchItem[] = [];
  for (const res of Array.from(doc.querySelectorAll("div.result")).slice(0, num)) {
    const a = res.querySelector("a.result__a") as HTMLAnchorElement | null;
    const snippet = res.querySelector(".result__snippet")?.textContent?.trim();
    if (a && a.href) items.push({ title: (a.textContent || a.href).trim(), url: a.href, snippet, source: "ddg_html" });
  }
  return { items, diag: { elapsedMs: Date.now() - start, engine: "ddg_html" } };
}

// -------------------- DEEP: Playwright engines (Bing primary) --------------------
class BrowserManager {
  private static _instance: BrowserManager | null = null;
  private browser?: Browser;
  private context?: BrowserContext;
  private readyPromise?: Promise<void>;

  static instance() {
    if (!this._instance) this._instance = new BrowserManager();
    return this._instance;
  }

  async ensureLaunched() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = (async () => {
      if (!this.browser) {
        this.browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
        this.context = await this.browser.newContext({
          viewport: { width: 1280, height: 900 },
          locale: DEFAULT_LANG === "vi" ? "vi-VN" : "en-US",
          timezoneId: "Asia/Ho_Chi_Minh",
          userAgent: uaHeaders()["User-Agent"]
        });
        this.context.setDefaultTimeout(DEFAULT_TIMEOUT);
        // Block heavy resources
        await this.context.route("**/*", (route) => {
          const type = route.request().resourceType();
          if (type === "image" || type === "media" || type === "font" || type === "websocket") {
            return route.abort();
          }
          return route.continue();
        });
      }
    })();
    return this.readyPromise;
  }

  async newPage(): Promise<Page> {
    await this.ensureLaunched();
    if (!this.context) throw new Error("Context not ready");
    const page = await this.context.newPage();
    await page.setExtraHTTPHeaders(uaHeaders());
    return page;
  }
}

export async function bingPlaywrightSearch(q: string, num = 5): Promise<{ items: SearchItem[]; diag: SearchDiagnostics; }> {
  const start = Date.now();
  const mgr = BrowserManager.instance();
  await mgr.ensureLaunched();
  const page = await mgr.newPage();
  try {
    const url = "https://www.bing.com/search?q=" + encodeURIComponent(q);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT });
    const items = await page.evaluate((max: number) => {
      function sel<T extends Element>(root: ParentNode, s: string): T | null { return root.querySelector(s) as any; }
      const out: { title: string; url: string; snippet?: string; source: string; }[] = [];
      const blocks = Array.from(document.querySelectorAll("#b_results > li.b_algo"));
      for (const b of blocks) {
        const a = sel<HTMLAnchorElement>(b, "h2 a");
        if (!a || !a.href) continue;
        const t = a.textContent?.trim() || a.href;
        const sn = sel<HTMLElement>(b, "p")?.textContent?.trim();
        out.push({ title: t, url: a.href, snippet: sn, source: "bing_playwright" });
        if (out.length >= max) break;
      }
      return out;
    }, num);
    return { items: items as SearchItem[], diag: { elapsedMs: Date.now() - start, engine: "bing_playwright" } };
  } finally {
    await page.close();
  }
}

// (Optional) Brave / Google could be added similarly; default to Bing for stability.
// Simple merge & dedupe
export function mergeDedupe(lists: SearchItem[][], limit: number): SearchItem[] {
  const seen = new Set<string>();
  const out: SearchItem[] = [];
  for (const list of lists) {
    for (const it of list) {
      const key = new URL(it.url).origin + new URL(it.url).pathname;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// Heuristics to decide if fast results are "good enough"
export function shouldEscalate(query: string, fastItems: SearchItem[], minResults = 5): boolean {
  const q = query.toLowerCase();
  const timeSignals = ["mới", "hôm nay", "latest", "breaking", "update", "cập nhật", String(new Date().getFullYear())];
  if (timeSignals.some(s => q.includes(s))) return true;
  if (fastItems.length < minResults) return true;
  // domain diversity
  const domains = new Set<string>();
  let withSnippet = 0;
  for (const it of fastItems) {
    try {
      const u = new URL(it.url);
      domains.add(u.hostname.replace(/^www\./, ""));
    } catch {}
    if (it.snippet && it.snippet.length > 30) withSnippet++;
  }
  if (domains.size < 3) return true;
  if (withSnippet < 3) return true;
  return false;
}

// Orchestrator
export async function runTwoTierSearch(query: string, mode: "auto" | "fast" | "deep", limit = 5): Promise<{ items: SearchItem[]; modeUsed: string; enginesUsed: EngineName[]; escalated: boolean; diagnostics: SearchDiagnostics[]; }> {
  const diagnostics: SearchDiagnostics[] = [];
  const enginesUsed: EngineName[] = [];
  const controller = new AbortController();
  let fastItems: SearchItem[] = [];
  let escalated = false;

  if (mode === "fast" || mode === "auto") {
    // time budget for fast
    const t = setTimeout(() => controller.abort(), FAST_TIME_BUDGET).unref();
    try {
      const { items, diag } = await ddgHtmlSearch(query, Math.min(10, Math.max(limit, 5)), controller.signal);
      diagnostics.push(diag);
      enginesUsed.push("ddg_html");
      fastItems = items;
    } catch (e) {
      diagnostics.push({ elapsedMs: FAST_TIME_BUDGET, engine: "ddg_html", note: "timeout/error" });
      fastItems = [];
    } finally {
      clearTimeout(t);
    }
  }

  if (mode === "fast") {
    return { items: fastItems.slice(0, limit), modeUsed: "fast", enginesUsed, escalated: false, diagnostics };
  }

  let finalItems: SearchItem[] = fastItems.slice(0, limit);
  if (mode === "deep" || (mode === "auto" && shouldEscalate(query, fastItems, Math.min(5, limit)) )) {
    escalated = mode === "auto";
    const { items: deepItems, diag } = await bingPlaywrightSearch(query, Math.max(limit, 5));
    diagnostics.push(diag);
    enginesUsed.push("bing_playwright");
    finalItems = mergeDedupe([deepItems, fastItems], limit);
    return { items: finalItems, modeUsed: mode === "deep" ? "deep" : "auto", enginesUsed, escalated, diagnostics };
  }

  return { items: finalItems, modeUsed: "auto", enginesUsed, escalated, diagnostics };
}

// Graceful close when process exits (optional)
process.on("exit", async () => {
  // no-op; Playwright contexts auto-close with process
});
