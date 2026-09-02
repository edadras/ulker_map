# Ülker Arena Indoor Navigation — از بلیط تا صندلی

نمونه اولیهٔ مسیریابی داخلی برای **Ülker Spor ve Etkinlik Salonu** (استانبول). کاربر مشخصات بلیط را می‌دهد و سیستم مسیر کامل را برمی‌گرداند:

```
📍 GPS کاربر → 🚶 پیاده‌روی تا ورودی → 🚪 BATI GİRİŞİ → 🛂 کنترل امنیتی → 🎫 کنترل بلیط
→ 🏟️ سالن ورودی → ⬆️ طبقه ۴ (پله/پله‌برقی/آسانسور) → 🚶 راهروی طبقه → 🚪 ورودی سکشن ۴۱۴ → 🪑 ردیف L → 💺 صندلی ۱
```

بدون هیچ وابستگی (Node ≥ 18، بدون `npm install`).

## اجرای سریع

```bash
npm run build      # ساخت گراف از دیتاست  → data/ulker_arena_navigation_graph.json + web/graph.data.js
npm test           # ۱۲ تست: همهٔ ۶۲ سکشن از هر دو ورودی، fallback ورودی، حالت بدون پله، API
npm start          # http://localhost:8080/  (نقشهٔ تعاملی + API)
npm run route -- section=414 row=L seat=1 gate=BATI lang=fa     # خط فرمان
```

رابط وب حتی بدون سرور هم کار می‌کند: `web/index.html` را مستقیم در مرورگر باز کنید.
پارامترهای URL هم پشتیبانی می‌شود: `web/index.html?section=414&row=L&seat=1&gate=BATI&lat=40.9905&lon=29.1`

## API

```
GET  /navigation/route?section=414&row=L&seat=1&gate=BATI[&event_id=123][&lat=40.99&lon=29.10][&accessible=1]
POST /navigation/route   {"event_id":123,"section":"414","row":"L","seat":"1","gate":"BATI","origin":{"lat":40.99,"lon":29.10}}
GET  /navigation/sections | /navigation/gates | /navigation/events | /navigation/graph | /health
```

### ورودی

| فیلد | توضیح |
|---|---|
| `section` | الزامی. `101–120`, `201–220`, `401–422` |
| `row`, `seat` | اختیاری. ردیف حرفی (`L`, `AA`) یا عددی؛ صندلی عددی |
| `gate` | KAPI روی بلیط. `BATI`/`Batı`/`WEST` یا `DOĞU`/`Dogu`/`EAST` (نرمال‌سازی ترکی انجام می‌شود) |
| `event_id` | برای نگاشت ورودی به‌ازای رویداد از `data/events.json` |
| `lat`, `lon` / `origin` | موقعیت GPS کاربر برای بخش پیاده‌روی بیرونی |
| `accessible` | فقط آسانسور (هسته‌های شرقی/غربی) |

### اولویت انتخاب ورودی (مطابق `gate_policy` دیتاست)

1. `gate` روی بلیط
2. نگاشت رویداد (`events.json` → `section_gates` → `level_gates` → `default_gate`)
3. برچسب قبلاً دیده‌شدهٔ سکشن (`known_ticket_gate_label`) — با هشدار
4. نزدیک‌ترین ورودی هندسی — با هشدار صریح «رسمی نیست»

فیلد `gate.source` در خروجی می‌گوید کدام مورد اعمال شده است.

### خروجی (خلاصه)

```jsonc
{
  "ok": true,
  "ticket": { "event_id": 123, "section": "414", "row": "L", "seat": "1" },
  "gate": { "id": "BATI", "source": "ticket", "lat": 40.99306, "lon": 29.103485, "map_xy": { "x": -117.1, "y": 500 } },
  "destination": { "section": "414", "level": 4, "zone": "north",
                   "portal": { "node": "L4_SECTION_414_PORTAL", "x": 478.4, "y": 150.4 },
                   "seat": { "x": 479.5, "y": 79.8, "rows_from_portal": 8, "seat_side_from_portal": "right", "confidence": "heuristic_interpolation" } },
  "summary": { "indoor_distance_m": 156, "total_duration_min": 11, "levels_visited": [1, 2, 4], "level_change": true },
  "steps": [ { "n": 0, "type": "outdoor", "icon": "📍", "title": { "fa": "...", "en": "...", "tr": "..." }, "distance_m": 408, "directions_url": "https://www.google.com/maps/dir/?..." },
             { "n": 1, "type": "gate", ... }, { "n": 2, "type": "security", "wait_min": 2 }, { "n": 3, "type": "ticket_control" },
             { "n": 4, "type": "lobby" }, { "n": 5, "type": "vertical", "level_from": 1, "level_to": 4, "modes": ["stairs","escalator","elevator"] },
             { "n": 6, "type": "concourse", "passed_sections": ["418","417","416","415"] },
             { "n": 7, "type": "portal" }, { "n": 8, "type": "row" }, { "n": 9, "type": "seat" } ],
  "path": { "nodes": [ { "id": "GATE_BATI", "x": -117.1, "y": 500, "level": 0 }, ... ] },
  "outdoor": { "distance_m": 408, "bearing_deg": 44, "compass": "NE", "polyline": [[lat,lon],[lat,lon]], "directions_url": "..." },
  "warnings": []
}
```

همهٔ متن‌ها سه‌زبانه‌اند (`fa` / `en` / `tr`).

## ساختار گراف ناوبری

`scripts/build_graph.js` از `data/ulker_arena_navigation_dataset.json` این گراف را می‌سازد (۱۴۴ گره، ۱۶۸ یال):

```
GATE_BATI ── SECURITY_BATI ── TICKET_BATI ── LOBBY_BATI (طبقه ۱)
                                                 ├── L1_CORRIDOR_117 / 118  (حلقهٔ راهروی طبقه ۱ → ۲۰ پورتال)
                                                 └── CORE_W_L1 ⇅ CORE_W_L2 ⇅ CORE_W_L4
                                                        │            │            └── L4_CORRIDOR_418/417 … (حلقهٔ ۲۲ پورتال)
                                                        │            └── L2_CORRIDOR_216/217 … (حلقهٔ ۲۰ پورتال)
هسته‌های عمودی: W, E (پله + پله‌برقی + آسانسور)، N, S (فقط پله)
هر پورتال: Lx_CORRIDOR_nnn ── Lx_SECTION_nnn_PORTAL
```

- **گره‌ها:** `gate`, `security`, `ticket_control`, `lobby`, `core`, `corridor`, `portal` با `x,y` (سیستم ۱۰۰۰×۱۰۰۰ دیتاست) و `level` (۰ = بیرون).
- **یال‌ها:** `type` (`checkpoint`, `door`, `walk`, `vertical`, `concourse`, `portal_door`)، `length_units`، `cost` (طول + جریمهٔ صف)، `modes` برای یال‌های عمودی.
- **مسیریابی:** Dijkstra روی `cost`؛ حالت `accessible` فقط یال‌های عمودی دارای `elevator` را مجاز می‌داند.
- **ردیف/صندلی:** گره گراف نیستند؛ داخل گوهٔ سکشن درون‌یابی می‌شوند (ردیف A نزدیک زمین، صندلی ۱ در لبهٔ ساعت‌گرد). پارامترها در `levels.*` گراف.
- **GPS:** مرکز سالن از منابع عمومی (۴۰.۹۹۳۰۶، ۲۹.۱۰۴۴۴). مختصات ورودی‌ها با تبدیل آفین از نقشهٔ داخلی (مقیاس ۰٫۱۳ m/unit، شمال = بالا) تخمین زده شده است. مسیر بیرونی خط مستقیم + لینک مسیریابی پیاده Google Maps است.

## فایل‌ها

```
data/ulker_arena_sections.csv              دیتاست ورودی (CSV)
data/ulker_arena_navigation_dataset.json   دیتاست ورودی (JSON، منبع ساخت گراف)
data/ulker_arena_navigation_graph.json     گراف تولیدشده
data/events.json                           نمونهٔ نگاشت ورودی به‌ازای رویداد
scripts/build_graph.js                     سازندهٔ گراف
scripts/route_cli.js                       مسیریابی از خط فرمان
src/router.js                              موتور مسیریابی (Node + مرورگر)
server/index.js                            HTTP API + سرو فایل‌های وب
web/index.html, app.js, style.css          نقشهٔ تعاملی (SVG) + نقشهٔ بیرونی (Leaflet/OSM)
web/graph.data.js                          گراف به‌صورت global برای کار بدون سرور (تولیدشده)
test/                                      تست‌ها (node --test)
```

## میزان اطمینان داده‌ها (مهم)

| مورد | وضعیت |
|---|---|
| وجود و ترتیب سکشن‌ها، شماره طبقه | از نقشهٔ عمومی صندلی‌ها ✅ |
| برچسب‌های ورودی BATI/DOĞU | از بلیط‌های عمومی ✅ (نگاشت سکشن→ورودی رویداد به رویداد فرق می‌کند) |
| مختصات پورتال‌ها | تخمینی از هندسهٔ نقشه ⚠️ |
| راهروها، هسته‌های پله، سالن ورودی، کنترل‌ها | **مدل‌سازی‌شده**، نه نقشه‌برداری‌شده ⚠️ |
| تعداد ردیف/صندلی هر سکشن، جهت شماره‌گذاری | **فرض** ⚠️ |
| مختصات جغرافیایی ورودی‌ها، مقیاس و جهت نقشه | تقریبی ⚠️ |

برای نسخهٔ عملیاتی: نقشهٔ معماری یا بازدید میدانی → اصلاح `x,y` گره‌ها در `build_graph.js` (بخش `GATES`, `CORES`, `LEVEL_MODEL`) و اضافه کردن ورودی‌های تأییدشده به `GATES`. ساختار خروجی API تغییری نمی‌کند.

## اتصال به TixConcert

- بک‌اند: `POST /navigation/route` با همان JSON بلیط (`event_id, section, row, seat, gate`) + `origin` از GPS کاربر.
- موبایل/وب: `src/router.js` + `web/graph.data.js` را مستقیم در کلاینت بارگذاری کنید و `createRouter(graph).route(...)` را آفلاین صدا بزنید (بدون سرور).
- `steps[*].to` / `path.nodes` مختصات ۲بعدی روی همان سیستم ۱۰۰۰×۱۰۰۰ دیتاست است؛ برای رندر روی هر نقشهٔ دیگری کافی است همان تبدیل را اعمال کنید.
