/* Ülker Arena wayfinding UI – vanilla JS, no build step. */
(function () {
  'use strict';

  const G = window.ULKER_GRAPH;
  const router = window.UlkerRouter.createRouter(G);
  const NS = 'http://www.w3.org/2000/svg';
  const LEVEL_COLORS = { 0: '#8d99ae', 1: '#2a9d8f', 2: '#e9c46a', 4: '#e76f51' };
  const DEFAULT_VIEWBOX = '-190 -70 1380 1140';
  const CENTER = G.coordinate_system.center;

  const $ = (id) => document.getElementById(id);
  const svg = $('map');
  let lang = 'fa';
  let lastResult = null;
  let leafletMap = null;
  let leafletLayer = null;
  let leafletPromise = null;

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
  const d2r = (d) => (d * Math.PI) / 180;
  const pt = (angle, r) => ({ x: CENTER.x + Math.cos(d2r(angle)) * r, y: CENTER.y + Math.sin(d2r(angle)) * r });
  const fmt = (v) => new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : lang === 'tr' ? 'tr-TR' : 'en-US').format(v);

  // ------------------------------------------------------------------ base map
  const layers = {};
  function drawBase() {
    svg.innerHTML = '';
    layers.base = el('g', { id: 'lBase' }, svg);
    layers.infra = el('g', { id: 'lInfra' }, svg);
    layers.route = el('g', { id: 'lRoute' }, svg);
    layers.overlay = el('g', { id: 'lOverlay' }, svg);

    // court / stage
    el('rect', { x: 385, y: 440, width: 230, height: 120, rx: 16, class: 'court' }, layers.base);
    el('text', { x: 500, y: 500, class: 'courtLabel' }, layers.base, 'SAHNE / ZEMİN');

    // sections as wedges
    for (const s of G.sections) {
      const lvl = G.levels[s.level];
      const r1 = lvl.row_inner_r, r2 = lvl.corridor_radius - 10;
      const a0 = s.angle_deg - s.half_wedge_deg, a1 = s.angle_deg + s.half_wedge_deg;
      const p1 = pt(a0, r1), p2 = pt(a1, r1), p3 = pt(a1, r2), p4 = pt(a0, r2);
      const d = `M${p1.x},${p1.y} A${r1},${r1} 0 0 1 ${p2.x},${p2.y} L${p3.x},${p3.y} A${r2},${r2} 0 0 0 ${p4.x},${p4.y} Z`;
      const path = el('path', { d, class: 'sec', 'data-level': s.level, 'data-section': s.section }, layers.base);
      path.addEventListener('click', () => { $('section').value = s.section; $('ticketForm').requestSubmit(); });
      el('title', {}, path, `Section ${s.section} – level ${s.level}`);
      el('text', { x: s.map_center.x, y: s.map_center.y, class: 'secLabel', 'data-level': s.level }, layers.base, s.section);
    }
    // corridor rings
    for (const l of Object.keys(G.levels)) {
      el('circle', { cx: CENTER.x, cy: CENTER.y, r: G.levels[l].corridor_radius, class: 'corridor', 'data-level': l }, layers.base);
    }
    // vertical cores
    for (const c of G.cores) {
      const g = el('g', { class: 'coreG' }, layers.infra);
      el('rect', { x: c.x - 14, y: c.y - 14, width: 28, height: 28, rx: 6, class: 'core' }, g);
      el('text', { x: c.x, y: c.y + 1, class: 'coreLabel' }, g, '⇅');
      el('title', {}, g, c.display[lang] + (c.modes.includes('elevator') ? ' (elevator)' : ' (stairs only)'));
    }
    // gates + checkpoint chains
    const icons = { gate: '🚪', security: '🛂', ticket_control: '🎫', lobby: '🏟️' };
    for (const gate of G.gates) {
      const labelSide = gate.side === 'west' ? -1 : 1;
      gate.chain.forEach((id, i) => {
        const n = G.nodes.find((x) => x.id === id);
        const g = el('g', { class: 'infraG' }, layers.infra);
        el('circle', { cx: n.x, cy: n.y, r: i === 0 ? 18 : 13, class: 'infraNode ' + (i === 0 ? 'gate' : '') }, g);
        el('text', { x: n.x, y: n.y + 1, class: 'infraIcon' }, g, icons[n.type]);
        el('title', {}, g, n.label[lang]);
      });
      const gn = G.nodes.find((x) => x.id === gate.node);
      el('text', { x: gn.x, y: gn.y - 30, class: 'infraLabel', 'text-anchor': 'middle', 'font-weight': 700, 'font-size': 18 }, layers.infra, gate.display.tr);
      el('text', { x: gn.x, y: gn.y + 34, class: 'infraLabel', 'text-anchor': 'middle' }, layers.infra, gate.display[lang]);
      void labelSide;
    }
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

  // ------------------------------------------------------------------ route drawing
  function drawRoute(res) {
    layers.route.innerHTML = '';
    layers.overlay.innerHTML = '';
    svg.querySelectorAll('.sec.dest').forEach((e) => e.classList.remove('dest'));
    const destSec = svg.querySelector(`.sec[data-section="${res.destination.section}"]`);
    if (destSec) destSec.classList.add('dest');

    // outdoor leg (if origin known and close enough)
    if (res.outdoor && res.outdoor.origin.map_xy) {
      const o = res.outdoor.origin.map_xy, g = res.gate.map_xy;
      el('line', { x1: o.x, y1: o.y, x2: g.x, y2: g.y, class: 'outdoorPath' }, layers.route);
      el('circle', { cx: o.x, cy: o.y, r: 12, class: 'youMarker' }, layers.overlay);
      el('text', { x: o.x, y: o.y - 20, class: 'markerLabel' }, layers.overlay, lang === 'fa' ? 'شما' : lang === 'tr' ? 'Siz' : 'You');
    }

    // indoor path: group consecutive nodes into polylines by level; vertical hops become pulses
    const nodes = res.path.nodes;
    let seg = [];
    let segLevel = null;
    const flush = () => {
      if (seg.length < 2) { seg = []; return; }
      const pts = seg.map((p) => `${p.x},${p.y}`).join(' ');
      el('polyline', { points: pts, class: 'routeGlow' }, layers.route);
      el('polyline', { points: pts, class: 'route', stroke: LEVEL_COLORS[segLevel] || LEVEL_COLORS[0] }, layers.route);
      el('polyline', { points: pts, class: 'routeAnim' }, layers.route);
      seg = [];
    };
    nodes.forEach((n, i) => {
      if (n.via === 'vertical') {
        flush();
        el('circle', { cx: n.x, cy: n.y, r: 8, class: 'vert', 'data-anim': 1 }, layers.overlay);
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
    el('circle', { cx: portal.x, cy: portal.y, r: 9, class: 'marker', fill: LEVEL_COLORS[res.destination.level] }, layers.overlay);
    const star = starPath(seat.x, seat.y, 14, 6);
    el('path', { d: star, class: 'seatMarker' }, layers.overlay);
    el('text', { x: seat.x, y: seat.y - 22, class: 'markerLabel' }, layers.overlay,
      `${res.ticket.row ? res.ticket.row : ''}${res.ticket.seat ? '-' + res.ticket.seat : ''}` || res.destination.section);

    // gate marker emphasis
    el('circle', { cx: res.gate.map_xy.x, cy: res.gate.map_xy.y, r: 24, class: 'hl' }, layers.overlay);
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
    const pts = res.path.nodes.map((n) => [n.x, n.y]);
    pts.push([res.destination.seat.x, res.destination.seat.y]);
    if (res.outdoor && res.outdoor.origin.map_xy) pts.push([res.outdoor.origin.map_xy.x, res.outdoor.origin.map_xy.y]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const pad = 90;
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    svg.setAttribute('viewBox', `${minX} ${minY} ${Math.max(maxX - minX, 300)} ${Math.max(maxY - minY, 300)}`);
  }

  function highlightStep(step) {
    layers.overlay.querySelectorAll('.stepHl').forEach((e) => e.remove());
    const p = step.to || step.from;
    if (!p) return;
    el('circle', { cx: p.x, cy: p.y, r: 30, class: 'hl stepHl' }, layers.overlay);
    if (step.level && step.level > 0) applyLevelFilter(currentLevel === 'all' ? 'all' : step.level);
  }

  // ------------------------------------------------------------------ panel rendering
  function renderResult(res) {
    $('error').classList.add('hidden');
    $('result').classList.remove('hidden');
    const sum = $('summary');
    sum.innerHTML = '';
    const tile = (b, s, wide) => { const t = html('div', 'tile' + (wide ? ' wide' : ''), null, sum); html('b', null, b, t); html('span', null, s, t); return t; };
    const gateT = tile(`${res.gate.display.tr} · ${res.gate.id}`, lang === 'fa' ? 'ورودی' : lang === 'tr' ? 'Kapı' : 'Gate', true);
    html('div', 'gateSrc', (lang === 'fa' ? 'منبع: ' : 'source: ') + (res.gate.source_label[lang] || res.gate.source_label.en), gateT);
    tile(res.destination.level_name[lang], lang === 'fa' ? 'طبقه' : lang === 'tr' ? 'Kat' : 'Level');
    tile(`${res.destination.section} / ${res.ticket.row || '—'} / ${res.ticket.seat || '—'}`, lang === 'fa' ? 'سکشن / ردیف / صندلی' : 'Section / Row / Seat');
    tile(`≈ ${fmt(res.summary.indoor_distance_m)} m`, lang === 'fa' ? 'پیاده‌روی داخل سالن' : lang === 'tr' ? 'Salon içi yürüyüş' : 'Indoor walk');
    tile(`≈ ${fmt(res.summary.total_duration_min)} ${lang === 'fa' ? 'دقیقه' : 'min'}`, lang === 'fa' ? 'زمان کل (با صف)' : lang === 'tr' ? 'Toplam süre' : 'Total time (incl. queues)');

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
        const a = html('a', null, lang === 'fa' ? '🗺️ مسیریابی خیابانی (Google Maps)' : '🗺️ Street directions (Google Maps)', body);
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
    html('span', null, `📍 ${lang === 'fa' ? 'فاصله تا' : 'Distance to'} ${res.gate.display.tr}: ≈ ${fmt(o.distance_m)} m`, info);
    html('span', null, `🧭 ${lang === 'fa' ? 'جهت' : 'Bearing'}: ${o.bearing_deg}° (${lang === 'fa' ? o.compass_fa : o.compass})`, info);
    html('span', null, `⏱ ≈ ${fmt(o.duration_min)} ${lang === 'fa' ? 'دقیقه پیاده' : 'min walk'}`, info);
    const a = html('a', null, lang === 'fa' ? 'باز کردن در Google Maps ↗' : 'Open in Google Maps ↗', info);
    a.href = o.directions_url; a.target = '_blank'; a.rel = 'noopener';
    html('span', 'muted', o.note[lang] || o.note.en, info);

    const div = $('leaflet');
    div.classList.add('hidden');
    ensureLeaflet().then((ok) => {
      if (!ok || lastResult !== res) {
        if (!ok) html('span', 'muted', lang === 'fa' ? '(نقشه خیابانی در دسترس نیست – آفلاین)' : '(street map unavailable – offline)', info);
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
    L.circleMarker(origin, { radius: 8, color: '#fff', fillColor: '#7bd389', fillOpacity: 1 }).bindPopup(lang === 'fa' ? 'موقعیت شما' : 'You').addTo(leafletLayer);
    if (o.origin.accuracy_m) L.circle(origin, { radius: o.origin.accuracy_m, color: '#7bd389', weight: 1, fillOpacity: .08 }).addTo(leafletLayer);
    L.circleMarker(gate, { radius: 9, color: '#fff', fillColor: '#4f8cff', fillOpacity: 1 }).bindPopup(`${res.gate.display.tr} (${res.gate.id})`).addTo(leafletLayer);
    L.circleMarker([G.venue.lat, G.venue.lon], { radius: 5, color: '#e76f51', fillColor: '#e76f51', fillOpacity: .9 }).bindPopup(G.venue.name).addTo(leafletLayer);
    L.polyline([origin, gate], { color: '#7bd389', dashArray: '8 8', weight: 4 }).addTo(leafletLayer);
    leafletMap.fitBounds(L.latLngBounds([origin, gate]).pad(0.3));
    setTimeout(() => leafletMap.invalidateSize(), 50);
  }

  function showError(msg) {
    $('result').classList.add('hidden');
    const e = $('error');
    e.textContent = '⛔ ' + msg;
    e.classList.remove('hidden');
  }

  // ------------------------------------------------------------------ form
  function populateForm() {
    const sel = $('section');
    const byLevel = {};
    for (const s of G.sections) (byLevel[s.level] = byLevel[s.level] || []).push(s);
    for (const l of Object.keys(byLevel)) {
      const og = document.createElement('optgroup');
      og.label = G.levels[l].name.fa;
      for (const s of byLevel[l]) { const o = document.createElement('option'); o.value = s.section; o.textContent = `${s.section} (${s.zone})`; og.appendChild(o); }
      sel.appendChild(og);
    }
    sel.value = '414';
    const gs = $('gate');
    for (const g of G.gates) { const o = document.createElement('option'); o.value = g.id; o.textContent = `${g.id} – ${g.display.tr} / ${g.display.fa}`; gs.appendChild(o); }

    const q = new URLSearchParams(location.search);
    for (const k of ['event_id', 'section', 'row', 'seat', 'gate', 'lat', 'lon']) if (q.get(k)) $(k).value = q.get(k);
    if (q.get('accessible')) $('accessible').checked = true;
    if (q.get('lang') && ['fa', 'en', 'tr'].includes(q.get('lang'))) { $('lang').value = q.get('lang'); lang = q.get('lang'); }
    if (!q.get('row') && !q.get('section')) { $('row').value = 'L'; $('seat').value = '1'; }
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

  let gpsAccuracy = null;
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
    if (!navigator.geolocation) { st.textContent = 'مرورگر شما از GPS پشتیبانی نمی‌کند.'; return; }
    st.textContent = '⏳ در حال دریافت موقعیت…';
    navigator.geolocation.getCurrentPosition((pos) => {
      $('lat').value = pos.coords.latitude.toFixed(6);
      $('lon').value = pos.coords.longitude.toFixed(6);
      gpsAccuracy = Math.round(pos.coords.accuracy);
      st.textContent = `✅ موقعیت دریافت شد (دقت ≈ ${gpsAccuracy} m)`;
      runRoute();
    }, (err) => {
      st.textContent = '⛔ دسترسی به موقعیت ممکن نشد: ' + err.message + ' — می‌توانید مختصات را دستی وارد کنید.';
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 });
  }

  // ------------------------------------------------------------------ wire up
  populateForm();
  drawBase();
  $('ticketForm').addEventListener('submit', (e) => { e.preventDefault(); runRoute(); });
  $('btnGps').addEventListener('click', useGps);
  $('btnDemo').addEventListener('click', () => {
    $('lat').value = (G.venue.lat - 0.0022).toFixed(6);
    $('lon').value = (G.venue.lon - 0.0028).toFixed(6);
    gpsAccuracy = 25;
    $('gpsStatus').textContent = 'موقعیت شبیه‌سازی‌شده (~۳۰۰ متر جنوب‌غربی سالن).';
    runRoute();
  });
  $('btnClearGps').addEventListener('click', () => { $('lat').value = ''; $('lon').value = ''; gpsAccuracy = null; $('gpsStatus').textContent = ''; if (lastResult) runRoute(); });
  $('lang').addEventListener('change', (e) => { lang = e.target.value; drawBase(); if (lastResult) runRoute(); });
  document.querySelectorAll('.levels button').forEach((b) => b.addEventListener('click', () => applyLevelFilter(b.dataset.level)));
  $('btnFit').addEventListener('click', () => lastResult && fitToRoute(lastResult));
  $('btnReset').addEventListener('click', () => svg.setAttribute('viewBox', DEFAULT_VIEWBOX));

  const q = new URLSearchParams(location.search);
  if (q.get('section')) runRoute();
})();
