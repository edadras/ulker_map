/* Ülker Arena wayfinding UI – vanilla JS, no build step. Map units are the ticketing-canvas units. */
(function () {
  'use strict';

  const G = window.ULKER_GRAPH;
  const router = window.UlkerRouter.createRouter(G);
  const ZONE_NAMES = window.UlkerRouter.ZONE_NAMES || {};
  const NS = 'http://www.w3.org/2000/svg';
  const LEVEL_COLORS = { 0: '#8d99ae', 1: '#2a9d8f', 2: '#e9c46a', 4: '#e76f51' };
  const PAD = 320;
  const B = G.bounds;
  const DEFAULT_VIEWBOX = `${B.minX - PAD} ${B.minY - PAD} ${B.maxX - B.minX + 2 * PAD} ${B.maxY - B.minY + 2 * PAD}`;
  const APPROACH_COLORS = { red: '#ff5c5c', yellow: '#ffd166', blue: '#4f8cff' };
  const STATUS_NAME = {
    sold: { fa: 'فروخته‌شده', en: 'sold', tr: 'satıldı' },
    reserved: { fa: 'رزرو', en: 'reserved', tr: 'rezerve' },
    free: { fa: 'آزاد', en: 'free', tr: 'boş' },
    payment_in_progress: { fa: 'در حال پرداخت', en: 'payment in progress', tr: 'ödeme sürüyor' }
  };

  const $ = (id) => document.getElementById(id);
  const svg = $('map');
  let lang = 'fa';
  let lastResult = null;
  let leafletMap = null;
  let leafletLayer = null;
  let leafletPromise = null;
  let gpsAccuracy = null;

  /** Lazily load Leaflet from the CDN; resolves false when offline so the indoor map never depends on it. */
  function ensureLeaflet() {
    if (window.L) return Promise.resolve(true);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise((resolve) => {
      const done = (ok) => { clearTimeout(timer); resolve(ok); };
      const timer = setTimeout(() => done(false), 8000);
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
      document.head.appendChild(css);
      const js = document.createElement('script');
      js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      js.onload = () => done(!!window.L);
      js.onerror = () => done(false);
      document.head.appendChild(js);
    });
    return leafletPromise;
  }

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
  const fmt = (v) => new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : lang === 'tr' ? 'tr-TR' : 'en-US').format(v);
  const zoneText = (zone) => (ZONE_NAMES[zone] ? ZONE_NAMES[zone][lang] || ZONE_NAMES[zone].en : zone);
  const nodeById = (id) => G.nodes.find((x) => x.id === id);
  const pts = (list) => list.map((p) => `${p.x},${p.y}`).join(' ');
  const t = (fa, en, tr) => (lang === 'fa' ? fa : lang === 'tr' ? tr : en);

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

    // concourse loops + floor tunnel
    for (const l of Object.keys(G.levels)) {
      const loop = G.levels[l].corridor_loop.map(nodeById);
      el('polygon', { points: pts(loop), class: 'corridor', 'data-level': l }, layers.base);
    }
    for (const e of G.edges.filter((x) => x.type === 'tunnel')) {
      const a = nodeById(e.from), b = nodeById(e.to);
      el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'tunnel', 'data-level': a.level }, layers.base);
    }

    // sections: real outlines from the seat coordinates
    for (const s of G.sections) {
      const poly = el('polygon', { points: pts(s.outline), class: 'sec', 'data-level': s.level, 'data-section': s.section, 'data-floor': s.floor ? 1 : null }, layers.base);
      poly.addEventListener('click', () => { $('section').value = s.section; onSectionChange(); $('ticketForm').requestSubmit(); });
      el('title', {}, poly, `${s.section} – ${G.levels[s.level].name[lang]} – ${s.row_count} ${t('ردیف', 'rows', 'sıra')}, ${s.seat_count} ${t('صندلی', 'seats', 'koltuk')}`);
      el('text', { x: s.centroid.x, y: s.centroid.y, class: 'secLabel', 'data-level': s.level }, layers.base, s.section);
    }

    // vertical cores
    for (const c of G.cores) {
      const g = el('g', { class: 'coreG' }, layers.infra);
      el('rect', { x: c.x - 85, y: c.y - 85, width: 170, height: 170, rx: 30, class: 'core' }, g);
      el('text', { x: c.x, y: c.y + 6, class: 'coreLabel' }, g, '⇅');
      el('title', {}, g, c.display[lang] + (c.modes.includes('elevator') ? t(' (آسانسور دارد)', ' (elevator)', ' (asansör)') : t(' (فقط پله)', ' (stairs only)', ' (sadece merdiven)')));
    }

    // gates + checkpoint chains
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
      el('text', { x: gn.x, y: gn.y - 190, class: 'infraLabel', 'text-anchor': 'middle', 'font-weight': 700, 'font-size': 110 }, layers.infra, gate.display.tr);
      el('text', { x: gn.x, y: gn.y + 210, class: 'infraLabel', 'text-anchor': 'middle' }, layers.infra, gate.display[lang]);
    }

    // compass (orientation is an assumption – see README)
    const cx = B.minX - PAD + 260, cy = B.minY - PAD + 260, brg = G.coordinate_system.map_north_bearing_deg || 0;
    const comp = el('g', { class: 'compassG', transform: `translate(${cx} ${cy})` }, layers.infra);
    el('circle', { cx: 0, cy: 0, r: 170, class: 'compassRing' }, comp);
    el('path', { d: 'M0,-150 L45,0 L0,-30 L-45,0 Z', class: 'compassArrow', transform: `rotate(${-brg})` }, comp);
    el('text', { x: 0, y: 0, class: 'compass', transform: `rotate(${-brg}) translate(0 -205)` }, comp, 'N');
    el('title', {}, comp, t('جهت شمال (از موقعیت ورودی‌های سالن استنتاج شده)', 'North (inferred from the entrance positions)', 'Kuzey (giriş konumlarından çıkarıldı)'));

    applyLevelFilter(currentLevel);
  }

  // ------------------------------------------------------------------ level filter
  let currentLevel = 'all';
  function applyLevelFilter(level) {
    currentLevel = level;
    document.querySelectorAll('.levels button').forEach((b) => b.classList.toggle('active', b.dataset.level === String(level)));
    svg.querySelectorAll('[data-level]').forEach((e) => {
      const l = e.getAttribute('data-level');
      e.classList.toggle('dim', level !== 'all' && l !== String(level));
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
        c.addEventListener('click', (ev) => { ev.stopPropagation(); $('row').value = r.row; $('seat').value = s[0]; $('ticketForm').requestSubmit(); });
      }
      // row label just before the first seat of the row
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

    // outdoor leg (if origin known and close enough): follows the organiser's approach path
    if (res.outdoor && res.outdoor.origin.map_xy) {
      const o = res.outdoor.origin.map_xy, g = res.gate.map_xy;
      const line = res.outdoor.polyline_map_xy ? [...res.outdoor.polyline_map_xy.slice(0, -1), g] : [o, g];
      el('polyline', { points: pts(line), class: 'outdoorPath', stroke: APPROACH_COLORS[(res.outdoor.approach || {}).color] || '#7bd389' }, layers.route);
      el('circle', { cx: o.x, cy: o.y, r: 70, class: 'youMarker' }, layers.overlay);
      el('text', { x: o.x, y: o.y - 120, class: 'markerLabel' }, layers.overlay, t('شما', 'You', 'Siz'));
    }

    // indoor path: group consecutive nodes into polylines by level; vertical hops become pulses
    const nodes = res.path.nodes;
    let seg = [];
    let segLevel = null;
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
        el('circle', { cx: n.x, cy: n.y, r: 50, class: 'vert', 'data-anim': 1 }, layers.overlay);
        seg = [n]; segLevel = n.level; return;
      }
      const lvl = n.level === 0 ? (segLevel == null ? 0 : segLevel) : n.level;
      if (segLevel != null && lvl !== segLevel && n.level !== 0) { const prev = seg[seg.length - 1]; flush(); seg = [prev]; }
      segLevel = lvl;
      seg.push(n);
      if (i === nodes.length - 1) flush();
    });

    // portal → seat
    const portal = res.destination.portal, seat = res.destination.seat;
    el('line', { x1: portal.x, y1: portal.y, x2: seat.x, y2: seat.y, class: 'seatPath' }, layers.route);
    el('circle', { cx: portal.x, cy: portal.y, r: 50, class: 'marker', fill: LEVEL_COLORS[res.destination.level] }, layers.overlay);
    el('path', { d: starPath(seat.x, seat.y, 60, 26), class: 'seatMarker' }, layers.overlay);
    el('text', { x: seat.x, y: seat.y - 95, class: 'markerLabel' }, layers.overlay,
      `${res.ticket.row ? res.ticket.row : ''}${res.ticket.seat ? '-' + res.ticket.seat : ''}` || res.destination.section);

    // gate marker emphasis
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

  function setViewBox(minX, minY, w, h) {
    svg.setAttribute('viewBox', `${minX} ${minY} ${Math.max(w, 1500)} ${Math.max(h, 1500)}`);
  }

  function fitToRoute(res) {
    const p = res.path.nodes.map((n) => [n.x, n.y]);
    p.push([res.destination.seat.x, res.destination.seat.y]);
    if (res.outdoor && res.outdoor.origin.map_xy) p.push([res.outdoor.origin.map_xy.x, res.outdoor.origin.map_xy.y]);
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    const pad = 450;
    setViewBox(Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + 2 * pad, Math.max(...ys) - Math.min(...ys) + 2 * pad);
  }

  function fitToSection(res) {
    const s = G.sections.find((x) => x.section === res.destination.section);
    const xs = s.outline.map((q) => q.x).concat([res.destination.portal.x]), ys = s.outline.map((q) => q.y).concat([res.destination.portal.y]);
    const pad = 180;
    setViewBox(Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + 2 * pad, Math.max(...ys) - Math.min(...ys) + 2 * pad);
  }

  function highlightStep(step) {
    layers.overlay.querySelectorAll('.stepHl').forEach((e) => e.remove());
    const p = step.to || step.from;
    if (!p) return;
    el('circle', { cx: p.x, cy: p.y, r: 180, class: 'hl stepHl' }, layers.overlay);
    if (step.level && step.level > 0) applyLevelFilter(currentLevel === 'all' ? 'all' : step.level);
    if (step.type === 'row' || step.type === 'seat') fitToSection(lastResult);
  }

  // ------------------------------------------------------------------ panel rendering
  function renderResult(res) {
    $('error').classList.add('hidden');
    $('result').classList.remove('hidden');
    const sum = $('summary');
    sum.innerHTML = '';
    const tile = (b, s, wide) => { const tl = html('div', 'tile' + (wide ? ' wide' : ''), null, sum); html('b', null, b, tl); html('span', null, s, tl); return tl; };
    const gateT = tile(`${res.gate.display.tr} · ${res.gate.id}`, t('ورودی', 'Gate', 'Kapı'), true);
    html('div', 'gateSrc', t('منبع: ', 'source: ', 'kaynak: ') + (res.gate.source_label[lang] || res.gate.source_label.en), gateT);
    tile(res.destination.level_name[lang], t('طبقه', 'Level', 'Kat'));
    tile(`${res.destination.section} / ${res.ticket.row || '—'} / ${res.ticket.seat || '—'}`, t('سکشن / ردیف / صندلی', 'Section / Row / Seat', 'Blok / Sıra / Koltuk'));
    tile(`≈ ${fmt(res.summary.indoor_distance_m)} m`, t('پیاده‌روی داخل سالن', 'Indoor walk', 'Salon içi yürüyüş'));
    tile(`≈ ${fmt(res.summary.total_duration_min)} ${t('دقیقه', 'min', 'dk')}`, t('زمان کل (با صف)', 'Total time (incl. queues)', 'Toplam süre'));
    const ds = res.destination.seat;
    if (ds.seat_found) {
      const st = STATUS_NAME[ds.status] ? STATUS_NAME[ds.status][lang] : ds.status;
      tile(`${st}${ds.price != null ? ` · ${fmt(ds.price)}` : ''}`, t('وضعیت صندلی در سیستم بلیت', 'Seat status in the ticketing system', 'Bilet sistemindeki koltuk durumu'), true);
    }

    const w = $('warnings');
    w.innerHTML = '';
    for (const warn of res.warnings) html('div', 'warning', '⚠️ ' + (warn[lang] || warn.en), w);

    const ol = $('steps');
    ol.innerHTML = '';
    for (const s of res.steps) {
      const li = html('li', 'step', null, ol);
      li.dataset.level = s.level;
      html('div', 'ico', s.icon, li);
      const body = html('div', null, null, li);
      html('div', 't', `${s.n > 0 ? s.n + '. ' : ''}${s.title[lang] || s.title.en}`, body);
      if (s.detail && (s.detail[lang] || s.detail.en)) html('div', 'd', s.detail[lang] || s.detail.en, body);
      if (s.directions_url) {
        const a = html('a', null, t('🗺️ مسیریابی خیابانی (Google Maps)', '🗺️ Street directions (Google Maps)', '🗺️ Sokak yol tarifi (Google Maps)'), body);
        a.href = s.directions_url; a.target = '_blank'; a.rel = 'noopener';
      }
      html('div', 'm', s.distance_m ? `${fmt(s.distance_m)} m` : (s.wait_min ? `~${s.wait_min} min` : ''), li);
      li.addEventListener('click', () => {
        ol.querySelectorAll('.step').forEach((x) => x.classList.remove('active'));
        li.classList.add('active');
        highlightStep(s);
      });
    }
    $('json').textContent = JSON.stringify(res, null, 2);
    renderOutdoor(res);
  }

  function renderOutdoor(res) {
    const box = $('outdoor'), info = $('outdoorInfo');
    if (!res.outdoor) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const o = res.outdoor;
    info.innerHTML = '';
    html('span', null, `📍 ${t('پیاده تا', 'Walk to', 'Yürüyüş:')} ${res.gate.display.tr}: ≈ ${fmt(o.distance_m)} m${o.straight_line_m !== o.distance_m ? ` (${t('خط مستقیم', 'straight line', 'kuş uçuşu')} ${fmt(o.straight_line_m)} m)` : ''}`, info);
    html('span', null, `🧭 ${t('جهت اولیه', 'Initial bearing', 'İlk yön')}: ${o.bearing_deg}° (${lang === 'fa' ? o.compass_fa : o.compass})`, info);
    html('span', null, `⏱ ≈ ${fmt(o.duration_min)} ${t('دقیقه پیاده', 'min walk', 'dk yürüyüş')}`, info);
    const a = html('a', null, t('باز کردن در Google Maps ↗', 'Open in Google Maps ↗', 'Google Maps’te aç ↗'), info);
    a.href = o.directions_url; a.target = '_blank'; a.rel = 'noopener';
    html('span', 'muted', o.note[lang] || o.note.en, info);

    const div = $('leaflet');
    div.classList.add('hidden');
    ensureLeaflet().then((ok) => {
      if (!ok || lastResult !== res) {
        if (!ok) html('span', 'muted', t('(نقشه خیابانی در دسترس نیست – آفلاین)', '(street map unavailable – offline)', '(sokak haritası yok – çevrimdışı)'), info);
        return;
      }
      div.classList.remove('hidden');
      drawLeaflet(res, div);
    });
  }

  function drawLeaflet(res, div) {
    const o = res.outdoor;
    if (!leafletMap) {
      leafletMap = L.map(div, { zoomControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(leafletMap);
    }
    if (leafletLayer) leafletLayer.remove();
    leafletLayer = L.layerGroup().addTo(leafletMap);
    const origin = [o.origin.lat, o.origin.lon], gate = [o.gate.lat, o.gate.lon];
    L.circleMarker(origin, { radius: 8, color: '#fff', fillColor: '#7bd389', fillOpacity: 1 }).bindPopup(t('موقعیت شما', 'You', 'Siz')).addTo(leafletLayer);
    if (o.origin.accuracy_m) L.circle(origin, { radius: o.origin.accuracy_m, color: '#7bd389', weight: 1, fillOpacity: .08 }).addTo(leafletLayer);
    L.circleMarker(gate, { radius: 9, color: '#fff', fillColor: '#4f8cff', fillOpacity: 1 }).bindPopup(`${res.gate.display.tr} (${res.gate.id})`).addTo(leafletLayer);
    L.circleMarker([G.venue.lat, G.venue.lon], { radius: 5, color: '#e76f51', fillColor: '#e76f51', fillOpacity: .9 }).bindPopup(G.venue.name).addTo(leafletLayer);
    const color = APPROACH_COLORS[(o.approach || {}).color] || '#7bd389';
    L.polyline(o.polyline, { color, weight: 5, opacity: .9 }).addTo(leafletLayer);
    // all three entrances with their approach paths, for orientation
    for (const g of G.gates) {
      L.circleMarker([g.lat, g.lon], { radius: 6, color: '#fff', fillColor: APPROACH_COLORS[(g.approach || {}).color] || '#888', fillOpacity: .9 }).bindPopup(`${g.display.tr} (${g.id})`).addTo(leafletLayer);
      if (g.approach && g.id !== res.gate.id) L.polyline([...g.approach.waypoints, [g.lat, g.lon]], { color: APPROACH_COLORS[g.approach.color] || '#888', weight: 2, dashArray: '4 6', opacity: .6 }).addTo(leafletLayer);
    }
    leafletMap.fitBounds(L.latLngBounds(o.polyline).pad(0.3));
    setTimeout(() => leafletMap.invalidateSize(), 50);
  }

  function showError(msg) {
    $('result').classList.add('hidden');
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
      for (const s of byLevel[l]) {
        const o = document.createElement('option');
        o.value = s.section;
        o.textContent = `${s.section} – ${zoneText(s.zone)}`;
        og.appendChild(o);
      }
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
    $('seatInfo').textContent = t(
      `${sec.row_count} ردیف (${idx.rows[0].row} جلو … ${idx.rows[idx.rows.length - 1].row} کنار ورودی)، ${sec.seat_count} صندلی`,
      `${sec.row_count} rows (${idx.rows[0].row} front … ${idx.rows[idx.rows.length - 1].row} at the portal), ${sec.seat_count} seats`,
      `${sec.row_count} sıra (${idx.rows[0].row} ön … ${idx.rows[idx.rows.length - 1].row} girişte), ${sec.seat_count} koltuk`
    );
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
    fillSectionOptions();
    const gs = $('gate');
    for (const g of G.gates) { const o = document.createElement('option'); o.value = g.id; o.textContent = `${g.display.tr} – ${g.display.fa}`; gs.appendChild(o); }

    const q = new URLSearchParams(location.search);
    for (const k of ['event_id', 'section', 'row', 'seat', 'gate', 'lat', 'lon']) if (q.get(k)) $(k).value = q.get(k);
    if (q.get('accessible')) $('accessible').checked = true;
    if (q.get('lang') && ['fa', 'en', 'tr'].includes(q.get('lang'))) { $('lang').value = q.get('lang'); lang = q.get('lang'); fillSectionOptions(); }
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
      drawRoute(res);
      fitToRoute(res);
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
    if (!navigator.geolocation) { st.textContent = t('مرورگر شما از GPS پشتیبانی نمی‌کند.', 'Your browser does not support geolocation.', 'Tarayıcınız konum desteklemiyor.'); return; }
    st.textContent = t('⏳ در حال دریافت موقعیت…', '⏳ Getting your position…', '⏳ Konum alınıyor…');
    navigator.geolocation.getCurrentPosition((pos) => {
      $('lat').value = pos.coords.latitude.toFixed(6);
      $('lon').value = pos.coords.longitude.toFixed(6);
      gpsAccuracy = Math.round(pos.coords.accuracy);
      st.textContent = t(`✅ موقعیت دریافت شد (دقت ≈ ${gpsAccuracy} m)`, `✅ Position acquired (accuracy ≈ ${gpsAccuracy} m)`, `✅ Konum alındı (doğruluk ≈ ${gpsAccuracy} m)`);
      runRoute();
    }, (err) => {
      st.textContent = t('⛔ دسترسی به موقعیت ممکن نشد: ', '⛔ Could not get your position: ', '⛔ Konum alınamadı: ') + err.message;
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 });
  }

  // ------------------------------------------------------------------ wire up
  populateForm();
  drawBase();
  svg.setAttribute('viewBox', DEFAULT_VIEWBOX);
  $('ticketForm').addEventListener('submit', (e) => { e.preventDefault(); runRoute(); });
  $('section').addEventListener('change', onSectionChange);
  $('row').addEventListener('input', onRowChange);
  $('btnGps').addEventListener('click', useGps);
  $('btnDemo').addEventListener('click', () => {
    // Ihlamur Blv. / Nilüfer Sk. bus stop – where the organiser's approach paths start
    $('lat').value = '40.993330';
    $('lon').value = '29.106420';
    gpsAccuracy = 20;
    $('gpsStatus').textContent = t('موقعیت شبیه‌سازی‌شده: ایستگاه اتوبوس بلوار Ihlamur (شرق سالن).', 'Simulated position: Ihlamur Blv. bus stop (east of the arena).', 'Simüle konum: Ihlamur Blv. durağı (salonun doğusu).');
    runRoute();
  });
  $('btnClearGps').addEventListener('click', () => { $('lat').value = ''; $('lon').value = ''; gpsAccuracy = null; $('gpsStatus').textContent = ''; if (lastResult) runRoute(); });
  $('lang').addEventListener('change', (e) => { lang = e.target.value; fillSectionOptions(); onSectionChange(); drawBase(); if (lastResult) runRoute(); });
  document.querySelectorAll('.levels button').forEach((b) => b.addEventListener('click', () => applyLevelFilter(b.dataset.level)));
  $('btnFit').addEventListener('click', () => lastResult && fitToRoute(lastResult));
  $('btnSeat').addEventListener('click', () => lastResult && fitToSection(lastResult));
  $('btnReset').addEventListener('click', () => svg.setAttribute('viewBox', DEFAULT_VIEWBOX));

  const q = new URLSearchParams(location.search);
  if (q.get('section')) runRoute();
})();
