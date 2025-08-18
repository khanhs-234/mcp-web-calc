import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runTwoTierSearch, type EngineName } from "./engines.js";
import { wikiSearchWithSummaries } from "./wikipedia.js";
import { fetchAndExtract } from "./extract.js";
import { evaluateExpression } from "./math.js";

const server = new McpServer({ name: "mcp-web-calc", version: "0.1.0" });

// 1) search_web (two-tier: fast -> deep)
server.registerTool(
  "search_web",
  {
    title: "Tìm web (Nhanh với DuckDuckGo, sâu với Playwright)",
    description: "Mặc định chạy nhanh bằng DuckDuckGo HTML; nếu chưa đủ tốt sẽ chuyển sang Playwright (Bing). Không dùng API key.",
    inputSchema: {
      query: z.string(),
      mode: z.enum(["auto","fast","deep"]).default("auto").optional(),
      limit: z.number().int().min(1).max(20).default(Number(process.env.MAX_RESULTS || 5)).optional(),
      language: z.string().default(process.env.LANG_DEFAULT || "vi").optional(),
      timeBudgetMs: z.number().int().min(500).max(10000).default(Number(process.env.FAST_TIME_BUDGET_MS || 1800)).optional()
    }
  },
  async ({ query, mode = "auto", limit = Number(process.env.MAX_RESULTS || 5) }) => {
    const res = await runTwoTierSearch(query, mode, limit);
    const payload = {
      items: res.items,
      modeUsed: res.modeUsed,
      enginesUsed: res.enginesUsed,
      escalated: res.escalated,
      diagnostics: res.diagnostics
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }
);

// 2) wikipedia_search
server.registerTool(
  "wikipedia_search",
  {
    title: "Wikipedia đa ngôn ngữ",
    description: "Tìm bài và lấy phần tóm tắt theo nhiều ngôn ngữ. Không cần API key.",
    inputSchema: { query: z.string(), languages: z.array(z.string()).default(["vi","en"]).optional(), limit: z.number().int().min(1).max(10).default(3).optional() }
  },
  async ({ query, languages = ["vi","en"], limit = 3 }) => {
    const results = await wikiSearchWithSummaries(query, languages, limit);
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

// 3) fetch_url
server.registerTool(
  "fetch_url",
  { title: "Lấy & trích nội dung URL", description: "Tải trang HTML/PDF và trả về nội dung đã làm sạch + thông tin cơ bản.", inputSchema: { url: z.string().url() } },
  async ({ url }) => {
    const doc = await fetchAndExtract(url);
    return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] };
  }
);

// 4) summarize_url — dùng host LLM (qua MCP sampling)
server.registerTool(
  "summarize_url",
  {
    title: "Tóm tắt URL (dùng LLM cục bộ)",
    description: "Lấy nội dung từ URL và nhờ model trong LM Studio tóm tắt. Không gọi dịch vụ bên ngoài.",
    inputSchema: { url: z.string().url(), bullets: z.number().int().min(3).max(10).default(5).optional(), language: z.string().default("auto").optional() }
  },
  async ({ url, bullets = 5, language = "auto" }) => {
    const doc = await fetchAndExtract(url, language === "auto" ? undefined : language);
    const prompt = `Hãy tóm tắt nội dung dưới đây thành ${bullets} gạch đầu dòng.
- Ngôn ngữ đầu ra: ${language}
- Giữ các ý chính, con số quan trọng, loại bỏ rườm rà.

Tiêu đề: ${doc.title || "(không có)"}
URL: ${doc.url}

--- Nội dung ---
${doc.text.slice(0, 12000)}`;
    const resp = await server.server.createMessage({
      messages: [{ role: "user", content: { type: "text", text: prompt } }],
      maxTokens: 800
    });
    const text = resp.content.type === "text" ? resp.content.text : "(không tạo được tóm tắt)";
    return { content: [{ type: "text", text }] };
  }
);

// 5) math_eval
server.registerTool(
  "math_eval",
  {
    title: "Tính toán (độ chính xác cao)",
    description: "Đánh giá biểu thức với BigNumber hoặc Fraction để tránh lỗi số chấm động.",
    inputSchema: { expression: z.string(), mode: z.enum(["number","BigNumber","Fraction"]).default("BigNumber").optional(), precision: z.number().int().min(16).max(256).default(64).optional() }
  },
  async ({ expression, mode = "BigNumber", precision = 64 }) => {
    const out = evaluateExpression(expression, mode, precision);
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-web-calc ready (stdio)…");
}

main().catch(err => { console.error(err); process.exit(1); });
