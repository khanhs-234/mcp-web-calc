import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runTwoTierSearch, type EngineName } from "./engines.js";
import { fetchAndExtract } from "./extract.js";
import { evaluateExpression } from "./math.js";

const toInt = (v: string | undefined, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
};
const DEFAULT_LIMIT = toInt(process.env.MAX_RESULTS, 10);
const server = new McpServer({ name: "mcp-web-calc", version: "0.3.0" });

// 1) search_web (two-tier: fast -> deep)
server.registerTool(
  "search_web",
  {
    title: "TĂ¬m web (Nhanh: DuckDuckGo, SĂ¢u: Playwright/Bing)",
    description: "Máº·c Ä‘á»‹nh cháº¡y nhanh báº±ng DuckDuckGo HTML; náº¿u káº¿t quáº£ chÆ°a Ä‘á»§ tá»‘t sáº½ chuyá»ƒn sang Playwright (Bing). KhĂ´ng dĂ¹ng API key.",
    inputSchema: {
      q: z.string(),
      limit: z.number().int().min(1).max(50).default(DEFAULT_LIMIT).optional(),
      lang: z.string().default("vi").optional(),
      mode: z.enum(["fast","deep","auto"]).default("auto").optional()
    }
  },
  async ({ q, limit = DEFAULT_LIMIT, lang = "vi", mode = "auto" }) => {
    const res = await runTwoTierSearch({ q, limit: Math.min(Math.max(1, limit), 50), lang, mode });
    const payload = { ...res, items: res.items.slice(0, limit) };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }
);

// 2) fetch_url
server.registerTool(
  "fetch_url",
  {
    title: "Táº£i & trĂ­ch xuáº¥t URL",
    description: "Táº£i ná»™i dung má»™t URL (HTML/PDF) vĂ  trĂ­ch xuáº¥t text báº±ng Readability/pdf-parse.",
    inputSchema: { url: z.string().url() }
  },
  async ({ url }) => {
    const doc = await fetchAndExtract(url);
    return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] };
  }
);

// 3) summarize_url â€” dĂ¹ng host LLM (qua MCP) náº¿u cĂ³, fallback tráº£ vÄƒn báº£n rĂºt gá»n
server.registerTool(
  "summarize_url",
  {
    title: "TĂ³m táº¯t URL",
    description: "Láº¥y ná»™i dung tá»« URL vĂ  tĂ³m táº¯t ngáº¯n gá»n.",
    inputSchema: { url: z.string().url() }
  },
  async ({ url }) => {
    const doc = await fetchAndExtract(url);
    // Thá»­ dĂ¹ng server-side model náº¿u cĂ³
    try {
      const prompt = `TĂ³m táº¯t ngáº¯n gá»n (tiáº¿ng Viá»‡t) ná»™i dung sau (<= 10 cĂ¢u):\n\nTiĂªu Ä‘á»: ${doc.title || "(khĂ´ng cĂ³)"}\nURL: ${doc.url}\n\n--- Ná»™i dung ---\n${doc.text.slice(0, 12000)}`;
      // @ts-ignore - McpServer has .server.createMessage in LM Studio environment
      const resp = await (server as any).server.createMessage({
        messages: [{ role: "user", content: { type: "text", text: prompt } }],
        maxTokens: 800
      });
      const text = resp.content && resp.content.type === "text" ? resp.content.text : "(khĂ´ng táº¡o Ä‘Æ°á»£c tĂ³m táº¯t)";
      return { content: [{ type: "text", text }] };
    } catch {
      // Fallback: tráº£ 2k kĂ½ tá»± Ä‘áº§u
      const fallback = (doc.text || "").slice(0, 2000);
      return { content: [{ type: "text", text: fallback || "(khĂ´ng cĂ³ ná»™i dung Ä‘á»ƒ tĂ³m táº¯t)" }] };
    }
  }
);

// 4) math_eval
server.registerTool(
  "math_eval",
  {
    title: "TĂ­nh toĂ¡n (Ä‘á»™ chĂ­nh xĂ¡c cao)",
    description: "ÄĂ¡nh giĂ¡ biá»ƒu thá»©c vá»›i BigNumber hoáº·c Fraction Ä‘á»ƒ trĂ¡nh lá»—i sá»‘ cháº¥m Ä‘á»™ng.",
    inputSchema: {
      expression: z.string(),
      mode: z.enum(["number","BigNumber","Fraction"]).default("BigNumber").optional(),
      precision: z.number().int().min(16).max(256).default(64).optional()
    }
  },
  async ({ expression, mode = "BigNumber", precision = 64 }) => {
    const out = evaluateExpression(expression, mode, precision);
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  }
);

// 5) wiki_get
server.registerTool(
  "wiki_get",
  {
    title: "Wikipedia: láº¥y tĂ³m táº¯t",
    description: "Láº¥y tĂ³m táº¯t cho má»™t tiĂªu Ä‘á» Wikipedia. Há»— trá»£ lang (máº·c Ä‘á»‹nh: vi).",
    inputSchema: { title: z.string(), lang: z.string().default("vi").optional() }
  },
  async ({ title, lang = "vi" }) => {
    const { wikiGetSummary } = await import("./wikipedia.js");
    const summary = await wikiGetSummary(title, lang);
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }

// 6) wiki_multi â€” láº¥y nhiá»u ngĂ´n ngá»¯ & tá»•ng há»£p
server.registerTool(
  "wiki_multi",
  {
    title: "Wikipedia: Ä‘a ngĂ´n ngá»¯ (nhiá»u lang)",
    description: "Nháº­p term, baseLang (máº·c Ä‘á»‹nh 'vi') vĂ  danh sĂ¡ch langs cáº§n láº¥y tĂ³m táº¯t. Æ¯u tiĂªn langlinks Ä‘á»ƒ map tiĂªu Ä‘á» chĂ­nh xĂ¡c.",
    inputSchema: {
      term: z.string(),
      baseLang: z.string().default("vi").optional(),
      langs: z.array(z.string()).default(["vi","en"]).optional()
    }
  },
  async ({ term, baseLang = "vi", langs = ["vi","en"] }) => {
    const { wikiGetMultiSummary } = await import("./wikipedia.js");
    const out = await wikiGetMultiSummary(term, baseLang, langs);
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  }
);

);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-web-calc ready (stdio)â€¦");
}

main().catch(err => { console.error(err); process.exit(1); });

