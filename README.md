# mcp-web-calc (không dùng API, tìm nhanh → đào sâu)

## Tools

- `search_web` — Tìm web (nhanh/sâu, không cần API key)
- `fetch_url` — Tải & trích xuất nội dung URL / PDF
- `summarize_url` — Tóm tắt nội dung bằng Readability
- `math_eval` — Tính toán (BigNumber/Fraction chính xác cao)
- `wiki_get` — Lấy tóm tắt 1 trang Wikipedia: `{"title":"...", "lang":"vi"}`


MCP server cho LM Studio với 5 công cụ — **tìm web** + **Wikipedia** + **trích xuất URL** + **tóm tắt** + **máy tính chính xác**.
- **Tìm web hai tầng**: Nhanh bằng **DuckDuckGo HTML**, nếu cần sẽ chuyển sang **Playwright (Bing)**. Không cần API key.

> Không dùng API key. Không cần Docker.

## Cài đặt

```bash
# Cài phụ thuộc
npm i   # hoặc: pnpm i / yarn

npx 

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
- **Mục đích:** tìm web một tầng (nhanh → sâu).  
- **Chế độ:**
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
- Nếu gặp CAPTCHA, giảm tần suất hoặc thử lại sau vài phút.

## Khắc phục sự cố
- **CAPTCHA / chặn tạm thời**: giảm tần suất tìm, dùng `mode="fast"` hoặc thử lại sau vài phút.
- **Linux thiếu lib**: dùng `npx 
- **Timeout khi tóm tắt URL**: trang quá nặng hoặc chặn; thử `fetch_url` trước, hoặc tăng `HTTP_TIMEOUT`.

## Giấy phép
Phát hành theo giấy phép MIT. Xem tệp `LICENSE`.

## Ủng hộ
Nếu bạn thấy dự án hữu ích, bạn có thể ủng hộ mình qua PayPal:

[![Donate PayPal](https://img.shields.io/badge/Donate-PayPal-00457C?logo=paypal&logoColor=white)](https://www.paypal.com/paypalme/pooseart)