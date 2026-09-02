# Ülker Arena Indoor Navigation — از بلیط تا صندلی

مسیریابی داخلی برای **Ülker Spor ve Etkinlik Salonu** (استانبول) روی نقشهٔ صندلی واقعی سیستم بلیت‌فروشی. کاربر مشخصات بلیط (یا شناسهٔ صندلی) را می‌دهد و سیستم مسیر کامل را برمی‌گرداند:

```
📍 GPS کاربر → 🚶 مسیر پیاده از خیابان (مسیر ترسیم‌شدهٔ برگزارکننده) → 🚪 ورودی ۴۰۰ / ۱۰۰–۲۰۰ / VIP → 🛂 کنترل امنیتی → 🎫 کنترل بلیط
→ 🏟️ سالن ورودی → ⬆️ طبقه (پله/پله‌برقی/آسانسور) → 🚶 راهروی طبقه → 🚪 ورودی سکشن → 🪑 ردیف → 💺 صندلی (مختصات دقیق)
```

بدون هیچ وابستگی (Node ≥ 18، بدون `npm install`).

## اجرای سریع

```bash
npm run build      # ساخت گراف از نقشهٔ صندلی‌ها → data/ulker_arena_navigation_graph.json + web/graph.data.js
npm test           # ۱۶ تست: همهٔ ۸٬۷۲۶ صندلی، همهٔ ۴۴ سکشن از هر سه ورودی، سیاست ورودی، حالت بدون پله، مسیر بیرونی، API
npm start          # http://localhost:8080/  (نقشهٔ تعاملی + API)
npm run route -- section=414 row=L seat=1 gate=BATI lang=fa     # خط فرمان
```

رابط وب **موبایل‌محور** است (دو صفحه: بلیط → مسیر؛ نقشهٔ لمسی با pinch-zoom؛ نوار گام‌به‌گام چسبان پایین صفحه؛ تب «داخل سالن / خیابان تا ورودی») و روی دسکتاپ دو‌ستونه می‌شود. بدون سرور هم کار می‌کند: `web/index.html` را مستقیم در مرورگر باز کنید.
پارامترهای URL: `web/index.html?section=414&row=L&seat=1&gate=BATI&lat=40.99333&lon=29.10642&lang=fa`

## داده‌های ورودی

| فایل | منبع | نقش |
|---|---|---|
| `data/seatmap.json` | خروجی سیستم بلیت‌فروشی (TixConcert) | **مرجع اصلی**: ۸٬۷۲۶ صندلی با سکشن، ردیف، شماره، `x,y` روی بوم ۶۰۰۰×۵۰۰۰، قیمت و وضعیت فروش + مستطیل صحنه |
| `scripts/build_graph.js` → `GATES` | پین‌های GPS و مسیرهای دستی برگزارکننده روی تصویر ماهواره‌ای | سه ورودی واقعی + مسیر پیاده از خیابان تا هر ورودی |
| `data/events.json` | نمونه | نگاشت رویداد → ورودی (اولویت ۲ سیاست ورودی) |

### ورودی‌های سالن (داده برگزارکننده)

| ورودی | برای | موقعیت | مسیر پیاده از خیابان |
|---|---|---|---|
| `400` (روی بلیط: BATI) | سکشن‌های ۴۰۰ | شمال‌غرب ساختمان، `40.993405, 29.104291` | 🔴 از بلوار Ihlamur (ایستگاه اتوبوس سر Nilüfer Sk.)، دور ساختمان کناری از شمال، ≈۲۵۰ متر |
| `100-200` (روی بلیط: DOĞU) | سکشن‌های ۱۰۰ و ۲۰۰ | جنوب‌شرق، `40.992639, 29.105409` | 🔵 پیاده‌روی بلوار Ihlamur به جنوب، ورود به محوطه از انتهای جنوبی، ≈۱۴۰ متر |
| `VIP` | کف سالن (VIP) | شرق، `40.993036, 29.105473` | 🟡 از بلوار Ihlamur، جنوب میدان کوچک Nilüfer Sk. به غرب، ≈۷۵ متر |

بدون ورودی روی بلیط، ورودی مخصوص طبقهٔ سکشن انتخاب می‌شود (بدون هشدار). اگر بلیط ورودی دیگری را نام ببرد، مسیر از همان ورودی رسم می‌شود ولی هشدار `GATE_NOT_FOR_LEVEL` برمی‌گردد. نگاشت برچسب‌های BATI/DOĞU به ورودی‌های ۴۰۰ و ۱۰۰–۲۰۰ استنتاج شده است (`compass_label_assumed: true`) — با برگزارکننده تأیید کنید.

## API

```
GET  /navigation/route?section=414&row=L&seat=1[&gate=BATI|400|100-200|VIP][&event_id=123][&lat=40.99&lon=29.10][&accessible=1]
GET  /navigation/route?seat_id=<id صندلی در سیستم بلیت>[&gate=..][&lat=..&lon=..]
POST /navigation/route   {"event_id":123,"section":"414","row":"L","seat":"1","gate":"BATI","origin":{"lat":40.99,"lon":29.10}}
GET  /navigation/seats?section=414[&row=L]       صندلی‌های یک سکشن با مختصات دقیق و وضعیت فروش
GET  /navigation/seats?id=<seat id>              یک صندلی با شناسهٔ سیستم بلیت
GET  /navigation/sections | /navigation/gates | /navigation/events | /navigation/graph | /health
```

### ورودی

| فیلد | توضیح |
|---|---|
| `section` | `102–115`, `202–215`, `402–416`, `VIP` (نام سکشن در سیستم بلیت) |
| `row`, `seat` | ردیف و شمارهٔ صندلی همان‌طور که در سیستم بلیت ثبت شده (`L`, `ZU`, …) |
| `seat_id` | به‌جای سه فیلد بالا: `id` صندلی در `seatmap.json` |
| `gate` | KAPI روی بلیط: `400`/`BATI`/`Batı`، `100-200`/`100`/`200`/`DOĞU`/`Dogu`، `VIP` (نرمال‌سازی ترکی انجام می‌شود) |
| `event_id` | برای نگاشت ورودی به‌ازای رویداد از `data/events.json` |
| `lat`, `lon` / `origin` | موقعیت GPS کاربر برای بخش پیاده‌روی بیرونی |
| `accessible` | فقط آسانسور (هسته‌های ورودی ۴۰۰ و ۱۰۰–۲۰۰) |

### اولویت انتخاب ورودی (`gate_policy`)

1. `gate` روی بلیط (با هشدار اگر ورودی طبقهٔ سکشن نباشد)
2. نگاشت رویداد (`events.json` → `section_gates` → `level_gates` → `default_gate`)
3. ورودی مخصوص طبقه (`level_entrances`: ۱ و ۲ → `100-200`، ۴ → `400`، VIP → `VIP`)
4. نزدیک‌ترین ورودی هندسی — فقط اگر طبقه‌ای ورودی نداشته باشد (با هشدار)

فیلد `gate.source` در خروجی می‌گوید کدام مورد اعمال شده است.

### خروجی (خلاصه)

```jsonc
{
  "ok": true,
  "ticket": { "event_id": 123, "section": "414", "row": "L", "seat": "1" },
  "gate": { "id": "400", "source": "ticket", "serves_levels": [4], "compass_label": "BATI",
            "lat": 40.993405, "lon": 29.104291, "map_xy": { "x": 6474.5, "y": -454.6 } },
  "destination": { "section": "414", "level": 4, "zone": "right", "zone_name": { "fa": "سمت راست (رو به صحنه)", ... },
                   "portal": { "node": "L4_SECTION_414_PORTAL", "x": 6079.1, "y": 1805.5 },
                   "seat": { "x": 5949.1, "y": 2073.8, "row": "L", "seat": "1",
                             "rows_total": 13, "rows_from_front": 10, "rows_from_portal": 2,
                             "seats_in_row": 20, "seat_index_from_left": 1, "seat_side_from_portal": "left",
                             "distance_from_portal_m": 5.4, "status": "sold", "price": 168, "confidence": "exact_seatmap" } },
  "summary": { "indoor_distance_m": 91, "total_duration_min": 4, "levels_visited": [1, 4], "level_change": true },
  "steps": [ { "n": 0, "type": "outdoor", "distance_m": 118, "directions_url": "https://www.google.com/maps/dir/?...&waypoints=..." },
             { "n": 1, "type": "gate" }, { "n": 2, "type": "security", "wait_min": 2 }, { "n": 3, "type": "ticket_control" },
             { "n": 4, "type": "lobby" }, { "n": 5, "type": "vertical", "level_from": 1, "level_to": 4, "modes": ["stairs","escalator","elevator"] },
             { "n": 6, "type": "concourse", "passed_sections": ["416","415"] },
             { "n": 7, "type": "portal" }, { "n": 8, "type": "row" }, { "n": 9, "type": "seat" } ],
  "path": { "nodes": [ ... ], "seat": { "x": 5949.1, "y": 2073.8, "level": 4 } },
  "outdoor": { "distance_m": 118, "straight_line_m": 114, "polyline": [[lat,lon], ...], "polyline_map_xy": [...],
               "approach": { "color": "blue", "joined_at_waypoint": 0, "description": { "fa": "...", "en": "...", "tr": "..." } } },
  "warnings": [],
  "confidence": { "seat": "exact_seatmap", "fa": "...", "en": "..." }
}
```

همهٔ متن‌ها سه‌زبانه‌اند (`fa` / `en` / `tr`). مسیر VIP یک گام `tunnel` (تونل زیر جایگاه به کف سالن) دارد. وقتی ردیف/صندلی در نقشه نباشد، هشدار `ROW_NOT_FOUND` / `SEAT_NOT_FOUND` برمی‌گردد و `confidence` به `row_unknown_back_row` / `row_centroid` تغییر می‌کند.

## ساختار گراف ناوبری

`scripts/build_graph.js` از `data/seatmap.json` این گراف را می‌سازد (۱۲۱ گره، ۱۳۵ یال، همه در **مختصات بوم سیستم بلیت**):

```
GATE_400 ── SECURITY_400 ── TICKET_400 ── LOBBY_400 ──┬── CORE_E400_L1 ⇅ CORE_E400_L2 ⇅ CORE_E400_L4 ── L4_CORRIDOR_…
   (پین GPS برگزارکننده، شمال‌غرب)                    └── L1_CORRIDOR_115 / STAGE_END_B
GATE_100-200 ── … ── LOBBY_100-200 ──┬── CORE_E100_L1 ⇅ L2 ⇅ L4        (جنوب‌شرق)
                                     └── L1_CORRIDOR_107 / 108
GATE_VIP ── … ── LOBBY_VIP ── L1_CORRIDOR_109 / 108 ── L1_FLOOR_TUNNEL_VIP ── L1_SECTION_VIP_PORTAL   (شرق)

هر طبقه: حلقهٔ راهرو Lx_CORRIDOR_nnn (دقیقاً پشت هر جایگاه) + سه گرهٔ پشت صحنه (STAGE_END_A/MID/B، با جریمهٔ کوچک)
هر سکشن: Lx_CORRIDOR_nnn ── Lx_SECTION_nnn_PORTAL   (پورتال ۰٫۹ متر پشت آخرین ردیف، روی محور ردیف‌ها)
ورودی‌های مشترک: SHARED_PORTALS در build_graph.js (مثلاً تابلوی «103 – 104» بالای یک ورودی) → یک پورتال مشترک بین آن سکشن‌ها
هسته‌های پله: E400 و E100 (پله + پله‌برقی + آسانسور، کنار ورودی‌ها)، S و W (فقط پله)
```

- **مرکز مختصات:** `coordinate_system.center` مرکز جایگاه‌ها (برای جهت‌ها و مناطق)، `geo_center` مرکز ساختمان (برای تبدیل GPS ↔ بوم).
- **جهت:** بالای بوم (صحنه) رو به **غرب** است (`map_north_bearing_deg: 270`)؛ راست بوم = شمال، پایین بوم = شرق. از موقعیت سه ورودی استنتاج شده.
- **مقیاس:** ۰٫۰۱۸ متر بر واحد بوم (از فاصلهٔ ۳۰/۴۰ واحدی صندلی‌ها/ردیف‌ها). بوم بلیت‌فروشی شماتیک است، پس مسافت‌ها تقریبی‌اند.
- **مناطق (`zone`):** نسبت به صحنه و از دید تماشاگر: `front_left, left, rear_left, rear, rear_right, right, front_right, floor`.
- **ردیف/صندلی:** از `seat_index` گراف (فشرده: `[شماره, x, y, وضعیت, قیمت]`) با مختصات دقیق؛ ترتیب ردیف‌ها از هندسه (ردیف جلو نزدیک زمین/صحنه، ردیف آخر کنار پورتال). «چپ/راست» یعنی از پورتال رو به صحنه.
- **مسیر بیرونی:** از موقعیت کاربر تا نزدیک‌ترین نقطهٔ مسیر ترسیم‌شدهٔ ورودی، سپس دنبال همان مسیر تا در ورودی (هرگز از وسط ساختمان کناری میان‌بر نمی‌زند). لینک Google Maps با `waypoints` همان مسیر.
- **مسیریابی:** Dijkstra روی `cost`؛ هسته‌های پله شاخهٔ بن‌بست از راهرو هستند تا هرگز میان‌بر نشوند؛ حالت `accessible` فقط یال‌های عمودی دارای `elevator`.

## فایل‌ها

```
data/seatmap.json                          نقشهٔ صندلی‌ها از سیستم بلیت (مرجع اصلی؛ ۸٬۷۲۶ صندلی)
data/ulker_arena_navigation_graph.json     گراف تولیدشده (+ seat_index فشرده)
data/events.json                           نمونهٔ نگاشت ورودی به‌ازای رویداد
scripts/build_graph.js                     سازندهٔ گراف (همهٔ فرض‌ها و ورودی‌های واقعی در بالای فایل)
scripts/route_cli.js                       مسیریابی از خط فرمان
src/router.js                              موتور مسیریابی (Node + مرورگر)
server/index.js                            HTTP API + سرو فایل‌های وب
web/index.html, app.js, style.css          نقشهٔ تعاملی (SVG روی بوم بلیت، صندلی‌های واقعی) + نقشهٔ بیرونی (Leaflet/OSM)
web/graph.data.js                          گراف به‌صورت global برای کار بدون سرور (تولیدشده)
test/                                      تست‌ها (node --test)
```

## میزان اطمینان داده‌ها (مهم)

| مورد | وضعیت |
|---|---|
| سکشن‌ها، ردیف‌ها، شمارهٔ صندلی‌ها، مختصات صندلی‌ها، صحنه | **دقیق** — از نقشهٔ سیستم بلیت ✅ |
| موقعیت GPS سه ورودی و مسیر پیاده از خیابان | **داده برگزارکننده** (پین ± ۵ متر؛ مسیرها از روی تصویر ± ۱۰ متر) ✅ |
| نگاشت BATI/DOĞU به ورودی‌های ۴۰۰ / ۱۰۰–۲۰۰ | استنتاج‌شده ⚠️ |
| پورتال سکشن‌ها (پشت آخرین ردیف)، راهروها، هسته‌های پله، تونل VIP، کنترل‌ها | **مدل‌سازی‌شده**، نه نقشه‌برداری‌شده ⚠️ |
| تابلوی ورودی‌های داخل سالن (کدام ورودی برای کدام سکشن‌ها) | فعلاً یک ورودی به‌ازای هر سکشن؛ لیست تابلوها را در `SHARED_PORTALS` وارد کنید ⚠️ |
| مقیاس متری و جهت شمالِ بوم | تخمینی ⚠️ |

برای نسخهٔ عملیاتی: بازدید میدانی یا نقشهٔ معماری → اصلاح ثابت‌های بالای `build_graph.js` (`GATES`, `CORES`, `MODEL_M`, `MAP_NORTH_BEARING_DEG`, `METERS_PER_UNIT`). ساختار خروجی API تغییری نمی‌کند. با تغییر نقشهٔ صندلی‌ها فقط `data/seatmap.json` را جایگزین و `npm run build` کنید.

## اتصال به TixConcert

- بک‌اند: `POST /navigation/route` با همان JSON بلیط (`event_id, section, row, seat, gate`) یا فقط `seat_id` + `origin` از GPS کاربر.
- موبایل/وب: `src/router.js` + `web/graph.data.js` را مستقیم در کلاینت بارگذاری کنید و `createRouter(graph).route(...)` را آفلاین صدا بزنید (بدون سرور).
- `steps[*].to`, `path.nodes`, `destination.seat` و `seat_index` همگی روی همان بوم ۶۰۰۰×۵۰۰۰ سیستم بلیت هستند؛ روی نقشهٔ صندلی موجود اپ مستقیم قابل رسم‌اند.
