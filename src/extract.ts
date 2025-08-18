import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

/** Build UA + language headers */
function uaHeaders() {
  const ua = process.env.USER_AGENT || "mcp-web-calc/0.2";
  const lang = process.env.LANG_DEFAULT || "vi";
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

const HTTP_TIMEOUT = toMs(process.env.HTTP_TIMEOUT, 15000);
const MAX_BYTES = toMs(process.env.MAX_BYTES, 20 * 1024 * 1024); // allow override via env

export interface ExtractedDoc {
  title?: string;
  byline?: string;
  siteName?: string;
  lang?: string;
  text: string;
  url: string;
  length?: number;
}

function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower === "127.0.0.1" || lower === "::1") return true;
  // also block common local dev TLDs
  if (lower.endsWith(".local") || lower.endsWith(".localhost")) return true;
  return false;
}

export async function fetchAndExtract(url: string): Promise<ExtractedDoc> {
  const u = new URL(url);
  if (isBlockedHost(u.hostname)) {
    throw new Error("Blocked localhost/private URL");
  }

  const res = await fetchWithTimeout(u.toString(), { redirect: "follow", headers: uaHeaders() }, HTTP_TIMEOUT);
  if (!res.ok) throw new Error(`Fetch ${res.status} for ${url}`);

  const lenHeader = res.headers.get("content-length");
  const len = Number(lenHeader || "0");
  if (len > 0 && len > MAX_BYTES) throw new Error(`Content too large: ${len} bytes`);

  const ct = res.headers.get("content-type") || "";
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new Error(`Content too large (downloaded)`);

  if (ct.includes("application/pdf") || u.pathname.toLowerCase().endsWith(".pdf")) {
    const pdfParse: any = (await import("pdf-parse")).default;
    const data = await pdfParse(buf);
    return { text: data.text || "", url, title: data.info?.Title, length: data.numpages };
  }

  const html = buf.toString("utf8");
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (article) {
    return {
      title: article.title ?? undefined,
      byline: (article as any).byline ?? undefined,
      siteName: (article as any).siteName ?? undefined,
      text: (article as any).textContent ?? "",
      url,
      length: typeof (article as any).length === "number" ? (article as any).length : undefined
    };
  }
  const text = dom.window.document.body.textContent || "";
  return { text, url, title: dom.window.document.title };
}
