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
    title: "Tìm web (Nhanh: DuckDuckGo, Sâu: Playwright/Bing)",
    description: "Mặc định chạy nhanh bằng DuckDuckGo HTML; nếu kết quả chưa đủ tốt sẽ chuyển sang Playwright (Bing). Không dùng API key.",
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
    title: "Tải & trích xuất URL",
    description: "Tải nội dung một URL (HTML/PDF) và trích xuất text bằng Readability/pdf-parse.",
    inputSchema: { url: z.string().url() }
  },
  async ({ url }) => {
    const doc = await fetchAndExtract(url);
    return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] };
  }
);

// 3) summarize_url — dùng host LLM (qua MCP) nếu có, fallback trả văn bản rút gọn.
server.registerTool(
  "summarize_url",
  {
    title: "Tóm tắt URL",
    description: "Lấy nội dung từ URL và tóm tắt ngắn gọn.",
    inputSchema: { url: z.string().url() }
  },
  async ({ url }) => {
    const doc = await fetchAndExtract(url);
    // Thử dùng server-side model nếu có.
    try {
      const prompt = `Tóm tắt ngắn gọn (tiếng Việt) nội dung sau (<= 10 câu):\n\nTiêu đề: ${doc.title || "(không có)"}\nURL: ${doc.url}\n\n--- Nội dung ---\n${doc.text.slice(0, 12000)}`;
      // @ts-ignore - McpServer has .server.createMessage in LM Studio environment
      const resp = await (server as any).server.createMessage({
        messages: [{ role: "user", content: { type: "text", text: prompt } }],
        maxTokens: 800
      });
      const text = resp.content && resp.content.type === "text" ? resp.content.text : "(khĂ´ng táº¡o Ä‘Æ°á»£c tĂ³m táº¯t)";
      return { content: [{ type: "text", text }] };
    } catch {
      // Fallback: trả 2k ký tự đầu
      const fallback = (doc.text || "").slice(0, 2000);
      return { content: [{ type: "text", text: fallback || "(khĂ´ng cĂ³ ná»™i dung Ä‘á»ƒ tĂ³m táº¯t)" }] };
    }
  }
);

// 4) math_eval
server.registerTool(
  "math_eval",
  {
    title: "Tính toán (độ chính xác cao)",
    description: "Đánh giá biểu thức với BigNumber hoặc Fraction để tránh lỗi số chấm động.",
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
    title: "Wikipedia: lấy tóm tắt",
    description: "Lấy tóm tắt cho một tiêu đề Wikipedia. Hỗ trợ lang (mặc định: vi).",
    inputSchema: { title: z.string(), lang: z.string().default("vi").optional() }
  },
  async ({ title, lang = "vi" }) => {
    const { wikiGetSummary } = await import("./wikipedia.js");
    const summary = await wikiGetSummary(title, lang);
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }
);

// 6) wiki_multi — lấy nhiều ngôn ngữ & tổng hợp
server.registerTool(
  "wiki_multi",
  {
    title: "Wikipedia: đa ngôn ngữ (nhiều lang)",
    description: "Nhập term, baseLang (mặc định 'vi') và danh sách langs cần lấy tóm tắt. Ưu tiên langlinks để map tiêu đề chính xác.",
    inputSchema: {
      term: z.string(),
      baseLang: z.string().default("vi").optional(),
      langs: z.array(z.string()).default(["vi","en"]).optional()
    },
  },
  async ({ term, baseLang = "vi", langs = ["vi","en"] }) => {
    const { wikiGetMultiSummary } = await import("./wikipedia.js");
    const out = await wikiGetMultiSummary(term, baseLang, langs);
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-web-calc ready (stdio)â€¦");
}

main().catch(err => { console.error(err); process.exit(1); });

