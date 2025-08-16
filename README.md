# mcp-web-calc (không dùng API, tìm nhanh → đào sâu)

MCP server cho LM Studio với 5 công cụ — **tìm web** + **Wikipedia** + **trích xuất URL** + **tóm tắt** + **máy tính chính xác**.
- **Tìm web hai tầng**: Nhanh bằng **DuckDuckGo HTML**, cần sâu sẽ chuyển sang **Playwright (Bing)**.  
- **Wikipedia đa ngôn ngữ**: Lấy kết quả và phần tóm tắt theo nhiều ngôn ngữ.  
- **Trích xuất URL**: Lấy nội dung đã làm sạch từ HTML/PDF.  
- **Tóm tắt URL**: Nhờ model cục bộ trong LM Studio tóm tắt.  
- **Tính toán chính xác**: BigNumber/Fraction để tránh lỗi số chấm động.

> Không dùng API key. Không cần Docker.

## Cài đặt

```bash
# Cài phụ thuộc
npm i   # hoặc: pnpm i / yarn

# Cài Chromium cho Playwright (Windows/Mac/Linux)
npx playwright install chromium

# Dev
npm run dev

# Build rồi chạy
npm run build
npm start
```

## Thêm vào LM Studio

Tạo/chỉnh file cấu hình MCP của LM Studio:

- **Windows**: `%USERPROFILE%\AppData\Roaming\LM Studio\mcp.json`  
- **macOS/Linux**: `~/.lmstudio/mcp.json`

```json
{
  "mcpServers": {
    "mcp-web-calc": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/mcp-web-calc/dist/src/server.js"],
      "env": {
        "USER_AGENT": "mcp-universal-tools/0.1",
        "HTTP_TIMEOUT": "15000",
        "MAX_RESULTS": "5",
        "LANG_DEFAULT": "vi",
        "FAST_TIME_BUDGET_MS": "1800"
      }
    }
  }
}
```

Mở LM Studio → **Tools** → bật **mcp-web-calc**.

## Công cụ & cách dùng

### 1) `search_web`
- **Mục đích:** tìm web hai tầng (nhanh → sâu).  
- **Chế độ:**
  - `mode="auto"` (mặc định): thử **nhanh (DDG HTML)**; nếu chưa đủ tốt thì **đào sâu (Playwright Bing)**.
  - `mode="fast"`: chỉ DDG HTML (không dùng Playwright).
  - `mode="deep"`: vào Playwright ngay.
- **Input:** `{ query, mode?, limit?, language?, timeBudgetMs? }`
- **Output:** `{ items[], modeUsed, enginesUsed[], escalated, diagnostics[] }`
- **Gợi ý:** để `auto` cho đa số trường hợp; dùng `deep` khi bạn cần kết quả phong phú hơn ngay từ đầu.

### 2) `wikipedia_search`
- **Mục đích:** tìm bài & lấy phần tóm tắt theo nhiều ngôn ngữ (không cần key).  
- **Ví dụ:**
```json
{ "query": "cá", "languages": ["vi","en"], "limit": 3 }
```

### 3) `fetch_url`
- **Mục đích:** tải trang và **trích nội dung sạch** (HTML/PDF).  
- **Ví dụ:**
```json
{ "url": "https://vnexpress.net/..." }
```

### 4) `summarize_url`
- **Mục đích:** tóm tắt nội dung URL bằng model cục bộ trong LM Studio (không gọi dịch vụ ngoài).  
- **Ví dụ:**
```json
{ "url": "https://en.wikipedia.org/wiki/Fish", "bullets": 5, "language": "vi" }
```

### 5) `math_eval`
- **Mục đích:** tính toán chính xác (tránh lỗi số chấm động).  
- **Ví dụ:**
```json
{ "expression": "(0.1 + 0.2) * 10", "mode": "BigNumber" }
```

## Lưu ý vận hành
- Tôn trọng robots/TOS; không gửi quá nhiều truy vấn trong thời gian ngắn.  
- Playwright được tối ưu để nhẹ: chặn ảnh/phông/media; chỉ bật khi cần.  
- Nếu gặp CAPTCHA, giảm tần suất hoặc thử lại sau vài phút.

## Khắc phục sự cố
- **Playwright báo thiếu Chromium**: chạy `npx playwright install chromium`.
- **CAPTCHA / chặn tạm thời**: giảm tần suất tìm, dùng `mode="fast"` hoặc thử lại sau vài phút.
- **Linux thiếu lib**: dùng `npx playwright install --with-deps chromium`.
- **Timeout khi tóm tắt URL**: trang quá nặng hoặc chặn; thử `fetch_url` trước, hoặc tăng `HTTP_TIMEOUT`.

## Giấy phép
Phát hành theo giấy phép MIT. Xem tệp `LICENSE`.

## Ủng hộ
Nếu bạn thấy dự án hữu ích, bạn có thể ủng hộ mình qua PayPal:

[![Donate PayPal](https://img.shields.io/badge/Donate-PayPal-00457C?logo=paypal&logoColor=white)](https://www.paypal.com/paypalme/pooseart)
