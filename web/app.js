/* Ülker Arena wayfinding UI – mobile-first, vanilla JS, no build step. Map units are the ticketing-canvas units. */
(function () {
  'use strict';

  const G = window.ULKER_GRAPH;
  const router = window.UlkerRouter.createRouter(G);
  const ZONE_NAMES = window.UlkerRouter.ZONE_NAMES || {};
  const NS = 'http://www.w3.org/2000/svg';
  const LEVEL_COLORS = { 0: '#8d99ae', 1: '#2a9d8f', 2: '#e9c46a', 4: '#e76f51' };
  const PAD = 320;
  const B = G.bounds;
  const DEFAULT_VB = { x: B.minX - PAD, y: B.minY - PAD, w: B.maxX - B.minX + 2 * PAD, h: B.maxY - B.minY + 2 * PAD };
  const APPROACH_COLORS = { red: '#ff5c5c', yellow: '#ffd166', blue: '#4f8cff' };
  const STATUS_NAME = {
    sold: { fa: 'فروخته‌شده', en: 'sold', tr: 'satıldı' },
    reserved: { fa: 'رزرو', en: 'reserved', tr: 'rezerve' },
    free: { fa: 'آزاد', en: 'free', tr: 'boş' },
    payment_in_progress: { fa: 'در حال پرداخت', en: 'payment in progress', tr: 'ödeme sürüyor' }
  };
  const I18N = {
    fa: {
      ticketTitle: '🎫 بلیط شما', section: 'سکشن', row: 'ردیف', seat: 'صندلی', more: 'گزینه‌های بیشتر (ورودی روی بلیط، رویداد، مسیر بدون پله)',
      gate: 'ورودی (KAPI) روی بلیط', gateAuto: '— خودکار: ورودی مخصوص طبقهٔ سکشن —', event: 'شناسه رویداد', accessible: 'مسیر بدون پله (فقط آسانسور)',
      useGps: '📡 موقعیت من', demo: 'شبیه‌سازی', clear: 'پاک', gpsHint: 'برای مسیر پیاده از خیابان تا ورودی، موقعیت خود را بدهید (اختیاری).',
      manualCoords: 'وارد کردن مختصات دستی', go: '🧭 مسیر تا صندلی من', footer: '✅ صندلی‌ها دقیقاً از نقشهٔ سیستم بلیت. ⚠️ راهروها، پله‌ها و ورودی سکشن‌ها مدل‌سازی شده‌اند.',
      tabIndoor: '🏟️ داخل سالن', tabStreet: '🗺️ خیابان تا ورودی', allLevels: 'همه', sub: 'از بلیط تا صندلی', subRoute: 'مسیر شما',
      gateT: 'ورودی', level: 'طبقه', srs: 'سکشن / ردیف / صندلی', indoor: 'پیاده‌روی داخل سالن', total: 'زمان کل (با صف)', seatStatus: 'وضعیت صندلی', source: 'منبع: ',
      rows: 'ردیف', seats: 'صندلی', legendCorr: 'راهرو', legendStairs: 'پله/آسانسور', legendSeat: 'صندلی شما', legendPortal: 'ورودی سکشن',
      stepOf: (i, n) => `گام ${fmtN(i)} از ${fmtN(n)}`, min: 'دقیقه', walkTo: 'پیاده تا', straight: 'خط مستقیم', bearing: 'جهت اولیه', minWalk: 'دقیقه پیاده',
      openMaps: 'باز کردن در Google Maps ↗', offline: '(نقشه خیابانی در دسترس نیست – آفلاین)', you: 'شما', gpsNo: 'مرورگر شما از GPS پشتیبانی نمی‌کند.',
      gpsWait: '⏳ در حال دریافت موقعیت…', gpsOk: (a) => `✅ موقعیت دریافت شد (دقت ≈ ${a} m)`, gpsErr: '⛔ دسترسی به موقعیت ممکن نشد: ',
      demoMsg: 'موقعیت شبیه‌سازی‌شده: ایستگاه اتوبوس بلوار Ihlamur (شرق سالن).', elev: ' (آسانسور دارد)', stairsOnly: ' (فقط پله)', stairs: 'پله', elevator: 'آسانسور',
      corridorOf: (l) => `راهروی طبقه ${fmtN(l)}`, north: 'شمال (تخمینی)', edit: 'ویرایش بلیط', seatInfo: (r, f, b, n) => `${fmtN(r)} ردیف (${f} جلو … ${b} کنار ورودی)، ${fmtN(n)} صندلی`
    },
    en: {
      ticketTitle: '🎫 Your ticket', section: 'Section', row: 'Row', seat: 'Seat', more: 'More options (gate on the ticket, event, step-free route)',
      gate: 'Gate (KAPI) on the ticket', gateAuto: '— automatic: the entrance for this section’s level —', event: 'Event id', accessible: 'Step-free route (elevator only)',
      useGps: '📡 My location', demo: 'Demo', clear: 'Clear', gpsHint: 'Share your position for the walk from the street to the entrance (optional).',
      manualCoords: 'Enter coordinates manually', go: '🧭 Route to my seat', footer: '✅ Seats exactly from the ticketing seat map. ⚠️ Concourses, stairs and section portals are modelled.',
      tabIndoor: '🏟️ Inside the arena', tabStreet: '🗺️ Street to entrance', allLevels: 'All', sub: 'from ticket to seat', subRoute: 'Your route',
      gateT: 'Entrance', level: 'Level', srs: 'Section / Row / Seat', indoor: 'Indoor walk', total: 'Total time (incl. queues)', seatStatus: 'Seat status', source: 'source: ',
      rows: 'rows', seats: 'seats', legendCorr: 'concourse', legendStairs: 'stairs/elevator', legendSeat: 'your seat', legendPortal: 'section portal',
      stepOf: (i, n) => `Step ${i} of ${n}`, min: 'min', walkTo: 'Walk to', straight: 'straight line', bearing: 'Initial bearing', minWalk: 'min walk',
      openMaps: 'Open in Google Maps ↗', offline: '(street map unavailable – offline)', you: 'You', gpsNo: 'Your browser does not support geolocation.',
      gpsWait: '⏳ Getting your position…', gpsOk: (a) => `✅ Position acquired (accuracy ≈ ${a} m)`, gpsErr: '⛔ Could not get your position: ',
      demoMsg: 'Simulated position: Ihlamur Blv. bus stop (east of the arena).', elev: ' (elevator)', stairsOnly: ' (stairs only)', stairs: 'stairs', elevator: 'elevator',
      corridorOf: (l) => `Level ${l} concourse`, north: 'North (estimated)', edit: 'Edit ticket', seatInfo: (r, f, b, n) => `${r} rows (${f} front … ${b} at the portal), ${n} seats`
    },
    tr: {
      ticketTitle: '🎫 Biletiniz', section: 'Blok', row: 'Sıra', seat: 'Koltuk', more: 'Diğer seçenekler (biletteki kapı, etkinlik, merdivensiz rota)',
      gate: 'Biletteki kapı (KAPI)', gateAuto: '— otomatik: bloğun katına ait giriş —', event: 'Etkinlik no', accessible: 'Merdivensiz rota (sadece asansör)',
      useGps: '📡 Konumum', demo: 'Deneme', clear: 'Temizle', gpsHint: 'Sokaktan girişe yürüyüş için konumunuzu paylaşın (isteğe bağlı).',
      manualCoords: 'Koordinatları elle girin', go: '🧭 Koltuğuma git', footer: '✅ Koltuklar bilet sisteminin planından. ⚠️ Koridorlar, merdivenler ve blok girişleri modellenmiştir.',
      tabIndoor: '🏟️ Salon içi', tabStreet: '🗺️ Sokaktan girişe', allLevels: 'Tümü', sub: 'biletten koltuğa', subRoute: 'Rotanız',
      gateT: 'Giriş', level: 'Kat', srs: 'Blok / Sıra / Koltuk', indoor: 'Salon içi yürüyüş', total: 'Toplam süre', seatStatus: 'Koltuk durumu', source: 'kaynak: ',
      rows: 'sıra', seats: 'koltuk', legendCorr: 'koridor', legendStairs: 'merdiven/asansör', legendSeat: 'koltuğunuz', legendPortal: 'blok girişi',
      stepOf: (i, n) => `Adım ${i} / ${n}`, min: 'dk', walkTo: 'Yürüyüş:', straight: 'kuş uçuşu', bearing: 'İlk yön', minWalk: 'dk yürüyüş',
      openMaps: 'Google Maps’te aç ↗', offline: '(sokak haritası yok – çevrimdışı)', you: 'Siz', gpsNo: 'Tarayıcınız konum desteklemiyor.',
      gpsWait: '⏳ Konum alınıyor…', gpsOk: (a) => `✅ Konum alındı (doğruluk ≈ ${a} m)`, gpsErr: '⛔ Konum alınamadı: ',
      demoMsg: 'Simüle konum: Ihlamur Blv. durağı (salonun doğusu).', elev: ' (asansör)', stairsOnly: ' (sadece merdiven)', stairs: 'merdiven', elevator: 'asansör',
      corridorOf: (l) => `Kat ${l} koridoru`, north: 'Kuzey (tahmini)', edit: 'Bileti düzenle', seatInfo: (r, f, b, n) => `${r} sıra (${f} ön … ${b} girişte), ${n} koltuk`
    }
  };

  const $ = (id) => document.getElementById(id);
  const svg = $('map');
  let lang = 'fa';
  let lastResult = null;
  let currentStep = -1;
  let gpsAccuracy = null;
  let leafletMap = null, leafletLayer = null, leafletPromise = null;

  // ------------------------------------------------------------------ helpers
  function el(tag, attrs, parent, text) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function html(tag, cls, text, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  const fmtN = (v) => new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : lang === 'tr' ? 'tr-TR' : 'en-US').format(v);
  const T = (k, ...a) => { const v = (I18N[lang] || I18N.en)[k]; return typeof v === 'function' ? v(...a) : (v != null ? v : I18N.en[k]); };
  const zoneText = (zone) => (ZONE_NAMES[zone] ? ZONE_NAMES[zone][lang] || ZONE_NAMES[zone].en : zone);
  const nodeById = (id) => G.nodes.find((x) => x.id === id);
  const pts = (list) => list.map((p) => `${p.x},${p.y}`).join(' ');

  function applyI18n() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = T(e.dataset.i18n); });
    $('subTitle').textContent = lastResult ? T('subRoute') : T('sub');
    $('btnBack').title = T('edit');
    $('mapLegend').innerHTML = '';
    for (const [c, l] of [['#2a9d8f', '100'], ['#e9c46a', '200'], ['#e76f51', '400'], ['#9b5de5', 'VIP']]) { const s = html('span', null, l, $('mapLegend')); const i = document.createElement('i'); i.style.background = c; s.prepend(i); }
    for (const k of ['legendCorr', 'legendStairs', 'legendPortal', 'legendSeat']) {
      const s = html('span', null, (k === 'legendStairs' ? '⇅ ' : k === 'legendSeat' ? '★ ' : k === 'legendPortal' ? '● ' : '') + T(k), $('mapLegend'));
      if (k === 'legendCorr') { const i = document.createElement('i'); i.className = 'dash'; s.prepend(i); }
    }
  }

  // ------------------------------------------------------------------ viewBox + pan/zoom (touch friendly)
  let vb = { ...DEFAULT_VB };
  function setVB(x, y, w, h) {
    if (w != null) vb = { x, y, w: Math.max(w, 600), h: Math.max(h, 600) };
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  }
  function unitsPerPx() {
    const r = svg.getBoundingClientRect();
    return Math.max(vb.w / r.width, vb.h / r.height);
  }
  function fitBox(minX, minY, maxX, maxY, pad) {
    const r = svg.getBoundingClientRect();
    const aspect = r.height / Math.max(r.width, 1);
    let w = (maxX - minX) + 2 * pad, h = (maxY - minY) + 2 * pad;
    if (h < w * aspect) h = w * aspect; else w = h / aspect;
    setVB((minX + maxX) / 2 - w / 2, (minY + maxY) / 2 - h / 2, w, h);
  }
  const fitPoint = (p, span) => fitBox(p.x - span / 2, p.y - span / 2, p.x + span / 2, p.y + span / 2, 0);

  let dragged = false;
  (function enablePanZoom() {
    const pointers = new Map();
    let pinch = null;
    const mid = () => { const [a, b] = [...pointers.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; };
    svg.addEventListener('pointerdown', (e) => {
      svg.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dragged = false;
      if (pointers.size === 2) pinch = { ...mid(), vb: { ...vb }, s: unitsPerPx() };
    });
    svg.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const r = svg.getBoundingClientRect();
      if (pointers.size === 1) {
        const s = unitsPerPx();
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) dragged = true;
        setVB(vb.x - dx * s, vb.y - dy * s, vb.w, vb.h);
      } else if (pointers.size === 2 && pinch) {
        dragged = true;
        const m = mid();
        const k = pinch.d / Math.max(m.d, 1);
        const w = pinch.vb.w * k, h = pinch.vb.h * k;
        const s1 = Math.max(w / r.width, h / r.height);
        // keep the world point under the initial midpoint fixed
        const wx = pinch.vb.x + (pinch.x - r.left) * pinch.s, wy = pinch.vb.y + (pinch.y - r.top) * pinch.s;
        setVB(wx - (m.x - r.left) * s1, wy - (m.y - r.top) * s1, w, h);
      }
    });
    const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const s0 = unitsPerPx();
      const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      const wx = vb.x + (e.clientX - r.left) * s0, wy = vb.y + (e.clientY - r.top) * s0;
      const w = vb.w * k, h = vb.h * k;
      const s1 = Math.max(w / r.width, h / r.height);
      setVB(wx - (e.clientX - r.left) * s1, wy - (e.clientY - r.top) * s1, w, h);
    }, { passive: false });
  })();

  // ------------------------------------------------------------------ base map
  const layers = {};
  function drawBase() {
    svg.innerHTML = '';
    layers.base = el('g', { id: 'lBase' }, svg);
    layers.infra = el('g', { id: 'lInfra' }, svg);
    layers.seats = el('g', { id: 'lSeats' }, svg);
    layers.route = el('g', { id: 'lRoute' }, svg);
    layers.overlay = el('g', { id: 'lOverlay' }, svg);

    // stage (from the ticketing seat map)
    const st = G.coordinate_system.stage;
    el('rect', { x: st.x, y: st.y, width: st.width, height: st.height, rx: 40, class: 'stage' }, layers.base);
    el('text', { x: st.x + st.width / 2, y: st.y + st.height / 2, class: 'stageLabel' }, layers.base, 'SAHNE / STAGE');

    // concourse loops (labelled) + floor tunnel
    for (const l of Object.keys(G.levels)) {
      const loop = G.levels[l].corridor_loop.map(nodeById);
      el('polygon', { points: pts(loop), class: 'corridor', 'data-level': l }, layers.base);
      const bottom = loop.reduce((a, n) => (n.y > a.y ? n : a), loop[0]);
      el('text', { x: bottom.x, y: bottom.y + 95, class: 'corridorLabel', 'data-level': l }, layers.base, T('corridorOf', l));
    }
    for (const e of G.edges.filter((x) => x.type === 'tunnel')) {
      const a = nodeById(e.from), b = nodeById(e.to);
      el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'tunnel', 'data-level': a.level }, layers.base);
    }

    // sections: real outlines from the seat coordinates
    for (const s of G.sections) {
      const poly = el('polygon', { points: pts(s.outline), class: 'sec', 'data-level': s.level, 'data-section': s.section, 'data-floor': s.floor ? 1 : null }, layers.base);
      poly.addEventListener('click', () => { if (dragged) return; $('section').value = s.section; onSectionChange(); runRoute(); });
      el('title', {}, poly, `${s.section} – ${G.levels[s.level].name[lang]} – ${s.row_count} ${T('rows')}, ${s.seat_count} ${T('seats')}`);
      el('text', { x: s.centroid.x, y: s.centroid.y, class: 'secLabel', 'data-level': s.level }, layers.base, s.section);
    }

    // section portals (vomitories) with the sign above them
    for (const p of G.portals || []) {
      const g = el('g', { class: 'portalG', 'data-level': p.level }, layers.infra);
      el('circle', { cx: p.x, cy: p.y, r: 34, class: 'portalMark' }, g);
      el('text', { x: p.x, y: p.y + 2, class: 'portalLabel' }, g, p.sign);
      el('title', {}, g, `${T('legendPortal')} ${p.sign}`);
    }

    // vertical cores (stairs / elevators)
    for (const c of G.cores) {
      const g = el('g', { class: 'coreG' }, layers.infra);
      const elev = c.modes.includes('elevator');
      el('rect', { x: c.x - 85, y: c.y - 85, width: 170, height: 170, rx: 30, class: 'core' + (elev ? ' elev' : '') }, g);
      el('text', { x: c.x, y: c.y + 6, class: 'coreLabel' }, g, '⇅');
      el('text', { x: c.x, y: c.y + 150, class: 'coreText' }, g, elev ? `${T('stairs')} + ${T('elevator')}` : T('stairs'));
      el('title', {}, g, c.display[lang] + (elev ? T('elev') : T('stairsOnly')));
    }

    // entrances + checkpoint chains
    const icons = { gate: '🚪', security: '🛂', ticket_control: '🎫', lobby: '🏟️' };
    for (const gate of G.gates) {
      gate.chain.forEach((id, i) => {
        const n = nodeById(id);
        const g = el('g', { class: 'infraG' }, layers.infra);
        el('circle', { cx: n.x, cy: n.y, r: i === 0 ? 110 : 80, class: 'infraNode ' + (i === 0 ? 'gate' : '') }, g);
        el('text', { x: n.x, y: n.y + 6, class: 'infraIcon' }, g, icons[n.type]);
        el('title', {}, g, n.label[lang]);
      });
      const gn = nodeById(gate.node);
      const above = gn.y < G.coordinate_system.center.y;
      el('text', { x: gn.x, y: gn.y + (above ? -190 : 230), class: 'infraLabel', 'text-anchor': 'middle', 'font-weight': 700, 'font-size': 110 }, layers.infra, gate.short ? gate.short.tr : gate.display.tr);
    }

    // compass (orientation inferred from the entrance positions – see README)
    const cx = B.minX - PAD + 260, cy = B.minY - PAD + 260, brg = G.coordinate_system.map_north_bearing_deg || 0;
    const comp = el('g', { class: 'compassG', transform: `translate(${cx} ${cy})` }, layers.infra);
    el('circle', { cx: 0, cy: 0, r: 170, class: 'compassRing' }, comp);
    el('path', { d: 'M0,-150 L45,0 L0,-30 L-45,0 Z', class: 'compassArrow', transform: `rotate(${-brg})` }, comp);
    el('text', { x: 0, y: 0, class: 'compass', transform: `rotate(${-brg}) translate(0 -205)` }, comp, 'N');
    el('title', {}, comp, T('north'));

    applyLevelFilter(currentLevel);
  }

  // ------------------------------------------------------------------ level filter
  let currentLevel = 'all';
  function applyLevelFilter(level) {
    currentLevel = String(level);
    document.querySelectorAll('.levels button').forEach((b) => b.classList.toggle('active', b.dataset.level === currentLevel));
    svg.querySelectorAll('[data-level]').forEach((e) => {
      const l = e.getAttribute('data-level');
      e.classList.toggle('dim', currentLevel !== 'all' && l !== currentLevel);
    });
  }

  // ------------------------------------------------------------------ seats of the destination section
  function drawSeats(sectionName, level, target) {
    layers.seats.innerHTML = '';
    const idx = G.seat_index[sectionName];
    if (!idx) return;
    const statusName = G.seat_status_codes || {};
    for (const r of idx.rows) {
      for (const s of r.seats) {
        const isTarget = target && target.row === r.row && String(target.seat) === String(s[0]);
        const c = el('circle', { cx: s[1], cy: s[2], r: isTarget ? 16 : 11, class: 'seatDot', 'data-status': statusName[s[3]] || s[3], 'data-level': level }, layers.seats);
        el('title', {}, c, `${sectionName} / ${r.row} / ${s[0]} – ${(STATUS_NAME[statusName[s[3]]] || {})[lang] || s[3]}${s[4] != null ? ` – ${s[4]}` : ''}`);
        c.addEventListener('click', (ev) => { ev.stopPropagation(); if (dragged) return; $('row').value = r.row; $('seat').value = s[0]; runRoute(); });
      }
      if (r.seats.length) {
        const a = r.seats[0], b = r.seats[r.seats.length - 1];
        const dx = b[1] - a[1], dy = b[2] - a[2], len = Math.hypot(dx, dy) || 1;
        el('text', { x: a[1] - (dx / len) * 48, y: a[2] - (dy / len) * 48, class: 'rowLabel', 'data-level': level }, layers.seats, r.row);
      }
    }
  }

  // ------------------------------------------------------------------ route drawing
  function drawRoute(res) {
    layers.route.innerHTML = '';
    layers.overlay.innerHTML = '';
    svg.querySelectorAll('.sec.dest').forEach((e) => e.classList.remove('dest'));
    const destSec = svg.querySelector(`.sec[data-section="${res.destination.section}"]`);
    if (destSec) destSec.classList.add('dest');
    drawSeats(res.destination.section, res.destination.level, res.destination.seat.seat_found ? res.destination.seat : null);

    if (res.outdoor && res.outdoor.origin.map_xy) {
      const o = res.outdoor.origin.map_xy, g = res.gate.map_xy;
      const line = res.outdoor.polyline_map_xy ? [...res.outdoor.polyline_map_xy.slice(0, -1), g] : [o, g];
      el('polyline', { points: pts(line), class: 'outdoorPath', stroke: APPROACH_COLORS[(res.outdoor.approach || {}).color] || '#7bd389' }, layers.route);
      el('circle', { cx: o.x, cy: o.y, r: 70, class: 'youMarker' }, layers.overlay);
      el('text', { x: o.x, y: o.y - 120, class: 'markerLabel' }, layers.overlay, T('you'));
    }

    const nodes = res.path.nodes;
    let seg = [], segLevel = null;
    const flush = () => {
      if (seg.length < 2) { seg = []; return; }
      const p = pts(seg);
      el('polyline', { points: p, class: 'routeGlow' }, layers.route);
      el('polyline', { points: p, class: 'route', stroke: LEVEL_COLORS[segLevel] || LEVEL_COLORS[0] }, layers.route);
      el('polyline', { points: p, class: 'routeAnim' }, layers.route);
      seg = [];
    };
    nodes.forEach((n, i) => {
      if (n.via === 'vertical') {
        flush();
        el('circle', { cx: n.x, cy: n.y, r: 50, class: 'vert' }, layers.overlay);
        seg = [n]; segLevel = n.level; return;
      }
      const lvl = n.level === 0 ? (segLevel == null ? 0 : segLevel) : n.level;
      if (segLevel != null && lvl !== segLevel && n.level !== 0) { const prev = seg[seg.length - 1]; flush(); seg = [prev]; }
      segLevel = lvl;
      seg.push(n);
      if (i === nodes.length - 1) flush();
    });

    const portal = res.destination.portal, seat = res.destination.seat;
    el('line', { x1: portal.x, y1: portal.y, x2: seat.x, y2: seat.y, class: 'seatPath' }, layers.route);
    el('circle', { cx: portal.x, cy: portal.y, r: 50, class: 'marker', fill: LEVEL_COLORS[res.destination.level] }, layers.overlay);
    el('path', { d: starPath(seat.x, seat.y, 60, 26), class: 'seatMarker' }, layers.overlay);
    el('text', { x: seat.x, y: seat.y - 95, class: 'markerLabel' }, layers.overlay,
      `${res.ticket.row ? res.ticket.row : ''}${res.ticket.seat ? '-' + res.ticket.seat : ''}` || res.destination.section);
    el('circle', { cx: res.gate.map_xy.x, cy: res.gate.map_xy.y, r: 150, class: 'hl' }, layers.overlay);
  }

  function starPath(cx, cy, R, r) {
    let d = '';
    for (let i = 0; i < 10; i++) {
      const rad = (i % 2 === 0 ? R : r), a = -Math.PI / 2 + (i * Math.PI) / 5;
      d += (i ? 'L' : 'M') + (cx + Math.cos(a) * rad).toFixed(1) + ',' + (cy + Math.sin(a) * rad).toFixed(1);
    }
    return d + 'Z';
  }

  function fitToRoute(res) {
    const p = res.path.nodes.map((n) => [n.x, n.y]);
    p.push([res.destination.seat.x, res.destination.seat.y]);
    if (res.outdoor && res.outdoor.origin.map_xy) p.push([res.outdoor.origin.map_xy.x, res.outdoor.origin.map_xy.y]);
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    fitBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 450);
  }
  function fitToSection(res) {
    const s = G.sections.find((x) => x.section === res.destination.section);
    const xs = s.outline.map((q) => q.x).concat([res.destination.portal.x]), ys = s.outline.map((q) => q.y).concat([res.destination.portal.y]);
    fitBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 180);
  }

  // ------------------------------------------------------------------ step navigation
  function selectStep(i) {
    const res = lastResult;
    if (!res) return;
    currentStep = Math.max(0, Math.min(i, res.steps.length - 1));
    const step = res.steps[currentStep];
    document.querySelectorAll('#steps .step').forEach((li, k) => li.classList.toggle('active', k === currentStep));
    // keep the map (not the list) in view while stepping through the route
    const box = document.querySelector('.mapBox');
    if (box && box.getBoundingClientRect().top < 0 || (box && box.getBoundingClientRect().bottom > window.innerHeight)) box.scrollIntoView({ block: 'start', behavior: 'smooth' });

    $('navCount').textContent = T('stepOf', currentStep + 1, res.steps.length);
    $('navDist').textContent = step.distance_m ? `${fmtN(step.distance_m)} m` : (step.wait_min ? `~${fmtN(step.wait_min)} ${T('min')}` : '');
    $('navTitle').textContent = `${step.icon} ${step.title[lang] || step.title.en}`;
    $('navDetail').textContent = (step.detail && (step.detail[lang] || step.detail.en)) || '';
    $('btnPrev').disabled = currentStep === 0;
    $('btnNext').disabled = currentStep === res.steps.length - 1;

    // map focus
    layers.overlay.querySelectorAll('.stepHl').forEach((e) => e.remove());
    showTab('indoor');
    if (step.level > 0) applyLevelFilter(step.level); else applyLevelFilter('all');
    if (step.type === 'outdoor') {
      const line = res.outdoor.polyline_map_xy || [res.outdoor.origin.map_xy, res.gate.map_xy].filter(Boolean);
      if (line.length) { const xs = line.map((q) => q.x), ys = line.map((q) => q.y); fitBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 500); }
    } else if (step.type === 'concourse' || step.type === 'vertical') {
      const ns = step.node_ids.map(nodeById).filter(Boolean);
      if (step.from) ns.push(step.from);
      const xs = ns.map((q) => q.x), ys = ns.map((q) => q.y);
      fitBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 600);
    } else if (step.type === 'row' || step.type === 'seat') {
      fitToSection(res);
    } else if (step.to) {
      fitPoint(step.to, 1700);
    }
    const p = step.to || step.from;
    if (p && step.type !== 'outdoor') el('circle', { cx: p.x, cy: p.y, r: 180, class: 'hl stepHl' }, layers.overlay);
  }

  // ------------------------------------------------------------------ panel rendering
  function renderResult(res) {
    $('error').classList.add('hidden');
    const sum = $('summary');
    sum.innerHTML = '';
    const tile = (b, s, cls) => { const tl = html('div', 'tile' + (cls ? ' ' + cls : ''), null, sum); html('b', null, b, tl); html('span', null, s, tl); return tl; };
    const gateT = tile(`${res.gate.short ? res.gate.short[lang] || res.gate.short.tr : res.gate.id} · ${res.gate.display.tr}`, T('gateT'), 'gate');
    html('div', 'gateSrc', T('source') + (res.gate.source_label[lang] || res.gate.source_label.en), gateT);
    tile(`${res.destination.section} / ${res.ticket.row || '—'} / ${res.ticket.seat || '—'}`, T('srs'));
    tile(res.destination.level_name[lang], T('level'));
    tile(`≈ ${fmtN(res.summary.indoor_distance_m)} m`, T('indoor'));
    tile(`≈ ${fmtN(res.summary.total_duration_min)} ${T('min')}`, T('total'));
    const ds = res.destination.seat;
    if (ds.seat_found) tile(`${STATUS_NAME[ds.status] ? STATUS_NAME[ds.status][lang] : ds.status}${ds.price != null ? ` · ${fmtN(ds.price)}` : ''}`, T('seatStatus'));

    const w = $('warnings');
    w.innerHTML = '';
    for (const warn of res.warnings) html('div', 'warning', '⚠️ ' + (warn[lang] || warn.en), w);

    const ol = $('steps');
    ol.innerHTML = '';
    res.steps.forEach((s, i) => {
      const li = html('li', 'step', null, ol);
      li.dataset.level = s.level;
      html('div', 'ico', s.icon, li);
      const body = html('div', null, null, li);
      html('div', 't', `${s.n > 0 ? fmtN(s.n) + '. ' : ''}${s.title[lang] || s.title.en}`, body);
      if (s.detail && (s.detail[lang] || s.detail.en)) html('div', 'd', s.detail[lang] || s.detail.en, body);
      if (s.directions_url) { const a = html('a', null, T('openMaps'), body); a.href = s.directions_url; a.target = '_blank'; a.rel = 'noopener'; }
      html('div', 'm', s.distance_m ? `${fmtN(s.distance_m)} m` : (s.wait_min ? `~${fmtN(s.wait_min)} ${T('min')}` : ''), li);
      li.addEventListener('click', () => selectStep(i));
    });
    $('json').textContent = JSON.stringify(res, null, 2);
    $('tabStreet').disabled = !res.outdoor;
    renderOutdoorInfo(res);
  }

  function renderOutdoorInfo(res) {
    const info = $('outdoorInfo');
    info.innerHTML = '';
    if (!res.outdoor) return;
    const o = res.outdoor;
    html('span', null, `📍 ${T('walkTo')} ${res.gate.display.tr}: ≈ ${fmtN(o.distance_m)} m${o.straight_line_m !== o.distance_m ? ` (${T('straight')} ${fmtN(o.straight_line_m)} m)` : ''} · ⏱ ≈ ${fmtN(o.duration_min)} ${T('minWalk')}`, info);
    html('span', null, `🧭 ${T('bearing')}: ${o.bearing_deg}° (${lang === 'fa' ? o.compass_fa : o.compass})`, info);
    const a = html('a', null, T('openMaps'), info);
    a.href = o.directions_url; a.target = '_blank'; a.rel = 'noopener';
    html('span', 'muted', o.note[lang] || o.note.en, info);
  }

  function ensureLeaflet() {
    if (window.L) return Promise.resolve(true);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise((resolve) => {
      const done = (ok) => { clearTimeout(timer); resolve(ok); };
      const timer = setTimeout(() => done(false), 8000);
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
      document.head.appendChild(css);
      const js = document.createElement('script');
      js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      js.onload = () => done(!!window.L); js.onerror = () => done(false);
      document.head.appendChild(js);
    });
    return leafletPromise;
  }

  function drawLeaflet(res) {
    const div = $('leaflet');
    const o = res.outdoor;
    if (!leafletMap) {
      leafletMap = L.map(div, { zoomControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(leafletMap);
    }
    if (leafletLayer) leafletLayer.remove();
    leafletLayer = L.layerGroup().addTo(leafletMap);
    const origin = [o.origin.lat, o.origin.lon];
    L.circleMarker(origin, { radius: 8, color: '#fff', fillColor: '#7bd389', fillOpacity: 1 }).bindPopup(T('you')).addTo(leafletLayer);
    if (o.origin.accuracy_m) L.circle(origin, { radius: o.origin.accuracy_m, color: '#7bd389', weight: 1, fillOpacity: .08 }).addTo(leafletLayer);
    L.polyline(o.polyline, { color: APPROACH_COLORS[(o.approach || {}).color] || '#7bd389', weight: 5, opacity: .9 }).addTo(leafletLayer);
    for (const g of G.gates) {
      L.circleMarker([g.lat, g.lon], { radius: g.id === res.gate.id ? 9 : 6, color: '#fff', fillColor: APPROACH_COLORS[(g.approach || {}).color] || '#888', fillOpacity: .95 }).bindPopup(`${g.display.tr} (${g.id})`).addTo(leafletLayer);
      if (g.approach && g.id !== res.gate.id) L.polyline([...g.approach.waypoints, [g.lat, g.lon]], { color: APPROACH_COLORS[g.approach.color] || '#888', weight: 2, dashArray: '4 6', opacity: .6 }).addTo(leafletLayer);
    }
    leafletMap.fitBounds(L.latLngBounds(o.polyline).pad(0.3));
    setTimeout(() => leafletMap.invalidateSize(), 50);
  }

  function showTab(which) {
    const street = which === 'street' && lastResult && lastResult.outdoor;
    $('tabIndoor').classList.toggle('active', !street);
    $('tabStreet').classList.toggle('active', !!street);
    $('indoorPane').classList.toggle('hidden', !!street);
    $('outdoorPane').classList.toggle('hidden', !street);
    if (street) {
      const info = $('outdoorInfo');
      ensureLeaflet().then((ok) => {
        if (!ok) { if (!info.querySelector('.offline')) html('span', 'muted offline', T('offline'), info); return; }
        drawLeaflet(lastResult);
      });
    }
  }

  function showScreen(name) {
    const route = name === 'route';
    $('screenTicket').classList.toggle('hidden', route);
    $('screenRoute').classList.toggle('hidden', !route);
    $('screenRoute').classList.toggle('hasNav', route);
    $('stepNav').classList.toggle('hidden', !route);
    $('btnBack').classList.toggle('hidden', !route);
    $('subTitle').textContent = route ? T('subRoute') : T('sub');
    window.scrollTo({ top: 0 });
  }

  function showError(msg) {
    showScreen('ticket');
    const e = $('error');
    e.textContent = '⛔ ' + msg;
    e.classList.remove('hidden');
  }

  // ------------------------------------------------------------------ form
  function fillSectionOptions() {
    const sel = $('section');
    const keep = sel.value;
    sel.innerHTML = '';
    const byLevel = {};
    for (const s of G.sections) (byLevel[s.level] = byLevel[s.level] || []).push(s);
    for (const l of Object.keys(byLevel)) {
      const og = document.createElement('optgroup');
      og.label = G.levels[l].name[lang];
      for (const s of byLevel[l]) { const o = document.createElement('option'); o.value = s.section; o.textContent = `${s.section} – ${zoneText(s.zone)}`; og.appendChild(o); }
      sel.appendChild(og);
    }
    sel.value = keep || '414';
  }

  function onSectionChange() {
    const idx = G.seat_index[$('section').value];
    const rows = $('rows');
    rows.innerHTML = '';
    if (!idx) { $('seatInfo').textContent = ''; return; }
    for (const r of idx.rows) { const o = document.createElement('option'); o.value = r.row; rows.appendChild(o); }
    const sec = G.sections.find((s) => s.section === $('section').value);
    $('seatInfo').textContent = T('seatInfo', sec.row_count, idx.rows[0].row, idx.rows[idx.rows.length - 1].row, sec.seat_count);
    onRowChange();
  }

  function onRowChange() {
    const idx = G.seat_index[$('section').value];
    const seats = $('seats');
    seats.innerHTML = '';
    if (!idx) return;
    const row = idx.rows.find((r) => r.row === $('row').value.trim().toUpperCase());
    if (!row) return;
    for (const s of row.seats) { const o = document.createElement('option'); o.value = s[0]; seats.appendChild(o); }
  }

  function populateForm() {
    const q = new URLSearchParams(location.search);
    if (q.get('lang') && I18N[q.get('lang')]) { $('lang').value = q.get('lang'); lang = q.get('lang'); }
    fillSectionOptions();
    const gs = $('gate');
    for (const g of G.gates) { const o = document.createElement('option'); o.value = g.id; o.textContent = `${g.display.tr} – ${g.display[lang] || g.display.en}`; gs.appendChild(o); }
    for (const k of ['event_id', 'section', 'row', 'seat', 'gate', 'lat', 'lon']) if (q.get(k)) $(k).value = q.get(k);
    if (q.get('accessible')) $('accessible').checked = true;
    if (!q.get('row') && !q.get('section')) { $('row').value = 'L'; $('seat').value = '1'; }
    onSectionChange();
  }

  function readRequest() {
    const f = $('ticketForm');
    const req = {
      event_id: f.event_id.value.trim() || null,
      section: f.section.value,
      row: f.row.value.trim(),
      seat: f.seat.value.trim(),
      gate: f.gate.value,
      accessible: $('accessible').checked
    };
    const lat = parseFloat(f.lat.value), lon = parseFloat(f.lon.value);
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) req.origin = { lat, lon, accuracy_m: gpsAccuracy };
    return req;
  }

  function runRoute() {
    try {
      const req = readRequest();
      const res = router.route(req);
      lastResult = res;
      renderResult(res);
      showScreen('route');
      drawRoute(res);
      fitToRoute(res);
      selectStep(0);
      const q = new URLSearchParams();
      for (const k of ['event_id', 'section', 'row', 'seat', 'gate']) if (req[k]) q.set(k, req[k]);
      if (req.origin) { q.set('lat', req.origin.lat.toFixed(6)); q.set('lon', req.origin.lon.toFixed(6)); }
      if (req.accessible) q.set('accessible', '1');
      if (lang !== 'fa') q.set('lang', lang);
      history.replaceState(null, '', '?' + q.toString());
    } catch (e) {
      showError(e.message);
      console.error(e);
    }
  }

  function useGps() {
    const st = $('gpsStatus');
    if (!navigator.geolocation) { st.textContent = T('gpsNo'); return; }
    st.textContent = T('gpsWait');
    navigator.geolocation.getCurrentPosition((pos) => {
      $('lat').value = pos.coords.latitude.toFixed(6);
      $('lon').value = pos.coords.longitude.toFixed(6);
      gpsAccuracy = Math.round(pos.coords.accuracy);
      st.textContent = T('gpsOk', gpsAccuracy);
      runRoute();
    }, (err) => { st.textContent = T('gpsErr') + err.message; }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 });
  }

  // ------------------------------------------------------------------ wire up
  populateForm();
  applyI18n();
  drawBase();
  setVB(DEFAULT_VB.x, DEFAULT_VB.y, DEFAULT_VB.w, DEFAULT_VB.h);
  $('ticketForm').addEventListener('submit', (e) => { e.preventDefault(); runRoute(); });
  $('section').addEventListener('change', onSectionChange);
  $('row').addEventListener('input', onRowChange);
  $('btnGps').addEventListener('click', useGps);
  $('btnDemo').addEventListener('click', () => {
    $('lat').value = '40.993330'; $('lon').value = '29.106420'; gpsAccuracy = 20;
    $('gpsStatus').textContent = T('demoMsg');
    runRoute();
  });
  $('btnClearGps').addEventListener('click', () => { $('lat').value = ''; $('lon').value = ''; gpsAccuracy = null; $('gpsStatus').textContent = T('gpsHint'); });
  $('lang').addEventListener('change', (e) => {
    lang = e.target.value;
    applyI18n(); fillSectionOptions(); onSectionChange(); drawBase();
    if (lastResult) { const step = currentStep; runRoute(); selectStep(step); }
  });
  document.querySelectorAll('.levels button').forEach((b) => b.addEventListener('click', () => applyLevelFilter(b.dataset.level)));
  $('btnFit').addEventListener('click', () => lastResult && fitToRoute(lastResult));
  $('btnSeat').addEventListener('click', () => lastResult && fitToSection(lastResult));
  $('btnReset').addEventListener('click', () => { setVB(DEFAULT_VB.x, DEFAULT_VB.y, DEFAULT_VB.w, DEFAULT_VB.h); applyLevelFilter('all'); });
  $('btnPrev').addEventListener('click', () => selectStep(currentStep - 1));
  $('btnNext').addEventListener('click', () => selectStep(currentStep + 1));
  $('btnBack').addEventListener('click', () => showScreen('ticket'));
  $('tabIndoor').addEventListener('click', () => showTab('indoor'));
  $('tabStreet').addEventListener('click', () => showTab('street'));
  window.addEventListener('resize', () => { if (lastResult && currentStep >= 0) selectStep(currentStep); });

  const q = new URLSearchParams(location.search);
  if (q.get('section')) runRoute();
})();
