import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const LANG_DEFAULT = process.env.LANG_DEFAULT || "vi";

function uaHeaders(lang: string = LANG_DEFAULT) {
  const ua = process.env.USER_AGENT || "mcp-universal-tools/0.1";
  // Accept-Language communicates preferred languages to servers,
  // using a weighted list that falls back to English.
  const accept = `${lang}-${lang.toUpperCase()},${lang};q=0.9,en;q=0.8`;
  return { "User-Agent": ua, "Accept-Language": accept } as Record<string, string>;
}

export interface ExtractedDoc {
  title?: string; byline?: string; siteName?: string; lang?: string; text: string; url: string; length?: number;
}

export async function fetchAndExtract(url: string, lang: string = LANG_DEFAULT): Promise<ExtractedDoc> {
  const res = await fetch(url, { redirect: "follow", headers: uaHeaders(lang) });
  if (!res.ok) throw new Error(`Fetch ${res.status} for ${url}`);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("pdf")) {
    const buf = Buffer.from(await res.arrayBuffer());
    const pdfParse: any = (await import("pdf-parse")).default;
    const data = await pdfParse(buf);
    return { text: data.text || "", url, title: data.info?.Title, length: data.numpages };
  }
  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (article) {
    return { title: article.title ?? undefined, byline: article.byline || undefined, siteName: article.siteName || undefined, lang: (dom.window.document.documentElement.lang || undefined) as string | undefined, text: (article.textContent || ""), url, length: (typeof article.length === "number" ? article.length : undefined) };
  }
  const text = dom.window.document.body.textContent || "";
  return { text, url, title: dom.window.document.title };
}
