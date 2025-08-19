# mcp-web-calc — MCP server cho LM Studio (không cần API key)

**Phiên bản:** 0.3.0

**6 công cụ tích hợp**
- `search_web` — Tìm web hai tầng (Nhanh: DuckDuckGo HTML → Sâu: Playwright/Bing)
- `fetch_url` — Tải & trích xuất nội dung từ URL/HTML/PDF (Readability + pdf-parse)
- `summarize_url` — Lấy nội dung từ URL rồi tóm tắt ngắn gọn
- `math_eval` — Máy tính chính xác (Number / BigNumber / Fraction)
- `wiki_get` — Lấy tóm tắt 1 trang Wikipedia theo ngôn ngữ
- `wiki_multi` — Lấy tóm tắt Wikipedia theo **nhiều ngôn ngữ** trong một lần gọi

> Không dùng API key. Hoạt động hoàn toàn qua MCP/stdio.

---

## Yêu cầu
- Node.js 18+
- Windows/macOS/Linux
- (Tìm kiếm sâu) **Playwright Chromium**

## Cài đặt
```bash
npm i
npx playwright install chromium   # cần cho 'deep' (Bing/Playwright)
# Dev:
npm run dev
# hoặc build & chạy prod:
npm run build && npm run start
```

## Biến môi trường (khuyến nghị)
Đặt trong LM Studio hoặc `.env`:
```env
USER_AGENT=mcp-web-calc/0.3 (https://local)
HTTP_TIMEOUT=15000       # ms cho mọi yêu cầu mạng
MAX_RESULTS=10           # mặc định cho search_web
LANG_DEFAULT=vi          # ngôn ngữ mặc định
MAX_BYTES=20971520       # giới hạn tải 20MB cho fetch_url
```

> **Bảo vệ SSRF**: `fetch_url` sẽ **chặn** `localhost/127.0.0.1/::1/.local/.localhost`.

---

## Thêm MCP server trong LM Studio
**Settings → Developer → Model Context Protocol (MCP) Servers → Add**

- **Name**: `mcp-web-calc`
- **Command**: `npm`
- **Args**: `run`, `dev`  *(hoặc `start` nếu đã build)*
- **Working directory**: đường dẫn tới thư mục dự án
- **Environment variables**: như ở phần trên

Khi chạy thành công, log sẽ hiện: `mcp-web-calc ready (stdio)…`

---

## Công cụ & cú pháp (tool schema)

### 1) `search_web`
- **Input**
```ts
{ 
  q: string;
  limit?: number;          // default: MAX_RESULTS (env), clamp 1..50
  lang?: string;           // "vi" | "en" | ...
  mode?: "fast"|"deep"|"auto"; // default: "auto"
}
```
- **Output (rút gọn)**
```ts
{
  items: { title: string; url: string; snippet?: string; source: "ddg_html"|"bing_pw" }[];
  modeUsed: "fast"|"deep"|"auto";
  enginesUsed: ("ddg_html"|"bing_pw")[];
  escalated: boolean;      // auto có leo sang deep hay không
  diagnostics?: Record<string, unknown>;
}
```
- **Ví dụ**
```
search_web: { "q": "Node.js LTS release schedule", "mode": "fast", "limit": 5, "lang": "vi" }
```

---

### 2) `fetch_url`
- **Input**
```ts
{ url: string }  // hỗ trợ HTML & PDF
```
- **Output (rút gọn)**
```ts
{
  text: string;
  url: string;
  title?: string;
  byline?: string;
  siteName?: string;
  lang?: string;
  length?: number; // nếu có
}
```
- **Ví dụ**
```
fetch_url: { "url": "https://example.com" }
```

---

### 3) `summarize_url`
- **Input**
```ts
{ url: string }
```
- **Hành vi**
  - Lấy nội dung bằng `fetch_url`, sau đó *thử* gọi model phía server (nếu được LM Studio cấp) để tóm tắt ngắn gọn tiếng Việt.
  - **Fallback**: nếu không gọi được model, trả về tối đa ~2000 ký tự đầu của bài.
- **Ví dụ**
```
summarize_url: { "url": "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API" }
```

---

### 4) `math_eval`
- **Input**
```ts
{
  expression: string;                      // cú pháp mathjs
  mode?: "number"|"BigNumber"|"Fraction";  // default: "BigNumber"
  precision?: number;                      // default: 64 (khi BigNumber)
}
```
- **Lưu ý**
  - `mathjs` **không có** hàm `integrate`. Dùng `derivative`, `simplify`, ma trận, đơn vị, v.v.
  - Cần lượng giác? Dùng `mode="number"` để có sin/cos… chính xác kiểu số JS.
- **Ví dụ**
```
math_eval: { "expression": "derivative(sin(x)*exp(x), x)", "mode": "number" }
```

---

### 5) `wiki_get`
- **Input**
```ts
{ title: string; lang?: string /* default "vi" */ }
```
- **Output (rút gọn)**
```ts
{ lang: string; title: string; url: string; description?: string; extract?: string; thumbnailUrl?: string }
```
- **Ví dụ**
```
wiki_get: { "title": "Việt Nam", "lang": "vi" }
```

---

### 6) `wiki_multi`
- **Input**
```ts
{
  term: string,                 // thuật ngữ gốc, ví dụ "Cá"
  baseLang?: string,            // mặc định "vi"
  langs?: string[]              // mặc định ["vi","en"]
}
```
- **Output (rút gọn)**
```ts
{
  baseLang: string;
  base: { /* WikiSummary của baseLang */ };
  items: Record<string, WikiSummary | null>; // null nếu không tìm thấy
  resolved: Record<string, { title?: string; source: "base"|"langlinks"|"direct"|"none" }>
}
```
- **Ví dụ**
```
wiki_multi: { "term": "Cá", "baseLang": "vi", "langs": ["vi","en","ja","fr"] }
```

---

## Mẹo kiểm thử nhanh
```text
search_web: { "q": "site:developer.apple.com App Intents", "mode": "deep", "limit": 5, "lang": "vi" }
fetch_url: { "url": "https://example.com" }
summarize_url: { "url": "https://www.python.org/dev/peps/pep-0008/" }
math_eval: { "expression": "inv([[1,2],[3,4]])", "mode": "number" }
wiki_get: { "title": "Lambda calculus", "lang": "en" }
wiki_multi: { "term": "Cá", "baseLang": "vi", "langs": ["vi","en","ja","fr"] }
```

---

## Khắc phục sự cố
- **CAPTCHA / chặn tạm thời**: giảm tần suất, ưu tiên `mode="fast"`, thử lại sau vài phút.
- **Playwright chưa cài**: `npx playwright install chromium`.
- **Timeout / treo khi tải**: tăng `HTTP_TIMEOUT`, hoặc nội dung vượt `MAX_BYTES`.
- **URL nội bộ bị chặn**: đây là chủ đích (SSRF guard).

## Giấy phép
MIT — xem tệp `LICENSE`.
