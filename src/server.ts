import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runTwoTierSearch, type EngineName } from "./engines.js";
import { fetchAndExtract } from "./extract.js";
import { evaluateExpression } from "./math.js";

const server = new McpServer({ name: "mcp-web-calc", version: "0.2.0" });

// 1) search_web (two-tier: fast -> deep)
server.registerTool(
  "search_web",
  {
    title: "Tìm web (Nhanh: DuckDuckGo, Sâu: Playwright/Bing)",
    description: "Mặc định chạy nhanh bằng DuckDuckGo HTML; nếu kết quả chưa đủ tốt sẽ chuyển sang Playwright (Bing). Không dùng API key.",
    inputSchema: {
      q: z.string(),
      limit: z.number().int().min(1).max(50).default(10).optional(),
      lang: z.string().default("vi").optional(),
      mode: z.enum(["fast","deep","auto"]).default("auto").optional()
    }
  },
  async ({ q, limit = 10, lang = "vi", mode = "auto" }) => {
    const res = await runTwoTierSearch({ q, limit, lang, mode });
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

// 3) summarize_url — dùng host LLM (qua MCP) nếu có, fallback trả văn bản rút gọn
server.registerTool(
  "summarize_url",
  {
    title: "Tóm tắt URL",
    description: "Lấy nội dung từ URL và tóm tắt ngắn gọn.",
    inputSchema: { url: z.string().url() }
  },
  async ({ url }) => {
    const doc = await fetchAndExtract(url);
    // Thử dùng server-side model nếu có
    try {
      const prompt = `Tóm tắt ngắn gọn (tiếng Việt) nội dung sau (<= 10 câu):\n\nTiêu đề: ${doc.title || "(không có)"}\nURL: ${doc.url}\n\n--- Nội dung ---\n${doc.text.slice(0, 12000)}`;
      // @ts-ignore - McpServer has .server.createMessage in LM Studio environment
      const resp = await (server as any).server.createMessage({
        messages: [{ role: "user", content: { type: "text", text: prompt } }],
        maxTokens: 800
      });
      const text = resp.content && resp.content.type === "text" ? resp.content.text : "(không tạo được tóm tắt)";
      return { content: [{ type: "text", text }] };
    } catch {
      // Fallback: trả 2k ký tự đầu
      const fallback = (doc.text || "").slice(0, 2000);
      return { content: [{ type: "text", text: fallback || "(không có nội dung để tóm tắt)" }] };
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-web-calc ready (stdio)…");
}

main().catch(err => { console.error(err); process.exit(1); });
