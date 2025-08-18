# mcp-web-calc — MCP server cho LM Studio (không cần API key)

**5 công cụ tích hợp**
- `search_web` — Tìm web hai tầng (Nhanh: DuckDuckGo HTML → Sâu: Playwright/Bing)
- `fetch_url` — Tải & trích xuất nội dung từ URL/HTML/PDF (Readability + pdf-parse)
- `summarize_url` — Lấy nội dung từ URL rồi tóm tắt ngắn gọn
- `math_eval` — Máy tính chính xác (Number / BigNumber / Fraction)
- `wiki_get` — Lấy tóm tắt 1 trang Wikipedia theo ngôn ngữ

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
USER_AGENT=mcp-web-calc/0.2 (https://local)
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
- **Ví dụ prompt trong chat LM Studio**
```
Dùng tool search_web với q="Node.js LTS release schedule", mode="fast", limit=5, lang="vi".
```
```
Tìm web (auto) về "hệ toạ độ barycentric trong đồ hoạ 3D", limit=5, lang="vi".
```

> Gặp CAPTCHA? Hãy giảm tần suất hoặc dùng `mode="fast"` tạm thời.

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
Dùng tool fetch_url với url="https://example.com"
```
```
fetch_url: url="https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
```
> Nếu URL bị chặn do SSRF (localhost/loopback), bạn sẽ thấy báo lỗi tương ứng.

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
Dùng tool summarize_url với url="https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API"
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
math_eval: expression="derivative(sin(x)*exp(x), x)", mode="number"
```
```
math_eval: expression="simplify((x^2 - 1)/(x - 1))", mode="number"
```
```
math_eval: expression="0.1 + 0.2", mode="BigNumber", precision=64
```

> Muốn xấp xỉ tích phân: dùng tổng Riemann, ví dụ  
> `sum(map(range(0, 10000), k -> sin(k*pi/10000)^2)) * (pi/10000)` với `mode="number"`.

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
wiki_get: title="Việt Nam", lang="vi"
```

---

## Mẹo kiểm thử nhanh
```text
search_web: q="site:developer.apple.com App Intents", mode="deep", limit=5, lang="vi"
fetch_url: url="https://example.com"
summarize_url: url="https://www.python.org/dev/peps/pep-0008/"
math_eval: expression="inv([[1,2],[3,4]])", mode="number"
wiki_get: title="Lambda calculus", lang="en"
```

---

## Khắc phục sự cố
- **CAPTCHA / chặn tạm thời**: giảm tần suất, ưu tiên `mode="fast"`, thử lại sau vài phút.
- **Playwright chưa cài**: `npx playwright install chromium`.
- **Timeout / treo khi tải**: tăng `HTTP_TIMEOUT`, hoặc nội dung vượt `MAX_BYTES`.
- **URL nội bộ bị chặn**: đây là chủ đích (SSRF guard).

## Giấy phép
MIT — xem tệp `LICENSE`.
