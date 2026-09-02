/**
 * Ülker Arena indoor navigation engine.
 *
 * Works in Node (module.exports) and in the browser (window.UlkerRouter).
 *
 *   const { createRouter } = require('./src/router');
 *   const router = createRouter(graph);
 *   const result = router.route({ section: '414', row: 'L', seat: '1', gate: 'BATI',
 *                                 origin: { lat, lon } });
 *
 * The route is: [GPS → gate] → gate → security → ticket check → entrance hall →
 * (vertical core to the right level) → concourse → section portal → row → seat.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UlkerRouter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Text helpers
  // -------------------------------------------------------------------------

  const ZONE_NAMES = {
    // stage-relative zones (as seen by a spectator facing the stage)
    front_left: { fa: 'جلو، سمت چپ (رو به صحنه)', en: 'front-left (facing the stage)', tr: 'ön sol (sahneye bakarken)' },
    left: { fa: 'سمت چپ (رو به صحنه)', en: 'left side (facing the stage)', tr: 'sol taraf (sahneye bakarken)' },
    rear_left: { fa: 'عقب، سمت چپ', en: 'rear-left', tr: 'arka sol' },
    rear: { fa: 'عقب سالن (روبه‌روی صحنه)', en: 'rear (opposite the stage)', tr: 'arka (sahne karşısı)' },
    rear_right: { fa: 'عقب، سمت راست', en: 'rear-right', tr: 'arka sağ' },
    right: { fa: 'سمت راست (رو به صحنه)', en: 'right side (facing the stage)', tr: 'sağ taraf (sahneye bakarken)' },
    front_right: { fa: 'جلو، سمت راست (رو به صحنه)', en: 'front-right (facing the stage)', tr: 'ön sağ (sahneye bakarken)' },
    front: { fa: 'پشت صحنه', en: 'stage end', tr: 'sahne ucu' },
    floor: { fa: 'کف سالن (جلوی صحنه)', en: 'arena floor (in front of the stage)', tr: 'zemin (sahne önü)' },
    // compass zones (legacy)
    north: { fa: 'شمال', en: 'north', tr: 'kuzey' },
    south: { fa: 'جنوب', en: 'south', tr: 'güney' },
    east: { fa: 'شرق', en: 'east', tr: 'doğu' },
    west: { fa: 'غرب', en: 'west', tr: 'batı' },
    north_west: { fa: 'شمال‌غرب', en: 'north-west', tr: 'kuzeybatı' },
    north_east: { fa: 'شمال‌شرق', en: 'north-east', tr: 'kuzeydoğu' },
    south_west: { fa: 'جنوب‌غرب', en: 'south-west', tr: 'güneybatı' },
    south_east: { fa: 'جنوب‌شرق', en: 'south-east', tr: 'güneydoğu' }
  };

  const MODE_NAMES = {
    stairs: { fa: 'پله', en: 'stairs', tr: 'merdiven' },
    escalator: { fa: 'پله‌برقی', en: 'escalator', tr: 'yürüyen merdiven' },
    elevator: { fa: 'آسانسور', en: 'elevator', tr: 'asansör' }
  };

  const COMPASS_16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const COMPASS_FA = {
    N: 'شمال', NNE: 'شمال‌شمال‌شرق', NE: 'شمال‌شرق', ENE: 'شرق‌شمال‌شرق', E: 'شرق', ESE: 'شرق‌جنوب‌شرق',
    SE: 'جنوب‌شرق', SSE: 'جنوب‌جنوب‌شرق', S: 'جنوب', SSW: 'جنوب‌جنوب‌غرب', SW: 'جنوب‌غرب', WSW: 'غرب‌جنوب‌غرب',
    W: 'غرب', WNW: 'غرب‌شمال‌غرب', NW: 'شمال‌غرب', NNW: 'شمال‌شمال‌غرب'
  };

  function stripTurkish(s) {
    return String(s)
      .replace(/İ/g, 'I').replace(/ı/g, 'i').replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
      .replace(/Ş/g, 'S').replace(/ş/g, 's').replace(/Ç/g, 'C').replace(/ç/g, 'c')
      .replace(/Ö/g, 'O').replace(/ö/g, 'o').replace(/Ü/g, 'U').replace(/ü/g, 'u');
  }

  function normalizeKey(s) {
    return stripTurkish(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  }

  /** "L" → 12, "AA" → 27, "12" → 12. Returns null when unparsable. */
  function parseRow(row) {
    if (row == null) return null;
    const raw = String(row).trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) return { label: raw, index: parseInt(raw, 10), scheme: 'numeric' };
    const letters = raw.toUpperCase().replace(/[^A-Z]/g, '');
    if (!letters) return null;
    let idx = 0;
    for (const ch of letters) idx = idx * 26 + (ch.charCodeAt(0) - 64);
    return { label: letters, index: idx, scheme: 'alpha' };
  }

  function parseSeat(seat) {
    if (seat == null) return null;
    const m = String(seat).trim().match(/\d+/);
    if (!m) return null;
    return { label: String(seat).trim(), index: parseInt(m[0], 10) };
  }

  const deg2rad = (d) => (d * Math.PI) / 180;
  const rad2deg = (r) => (r * 180) / Math.PI;
  const round1 = (v) => Math.round(v * 10) / 10;

  function angularDistance(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  function haversineMeters(a, b) {
    const R = 6371000;
    const dLat = deg2rad(b.lat - a.lat);
    const dLon = deg2rad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(deg2rad(a.lat)) * Math.cos(deg2rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function bearingDeg(a, b) {
    const φ1 = deg2rad(a.lat), φ2 = deg2rad(b.lat), Δλ = deg2rad(b.lon - a.lon);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (rad2deg(Math.atan2(y, x)) + 360) % 360;
  }

  function compass(bearing) {
    return COMPASS_16[Math.round(bearing / 22.5) % 16];
  }

  // -------------------------------------------------------------------------
  // Router
  // -------------------------------------------------------------------------

  function createRouter(graph) {
    if (!graph || !Array.isArray(graph.nodes)) throw new Error('createRouter(graph): invalid graph');

    const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
    const sections = new Map(graph.sections.map((s) => [String(s.section), s]));
    const gatesById = new Map(graph.gates.map((g) => [g.id, g]));
    const gateAlias = new Map();
    for (const g of graph.gates) {
      gateAlias.set(normalizeKey(g.id), g.id);
      for (const a of g.aliases || []) gateAlias.set(normalizeKey(a), g.id);
      for (const v of Object.values(g.display || {})) gateAlias.set(normalizeKey(v), g.id);
    }

    const adjacency = new Map();
    const pushAdj = (from, to, edge) => {
      if (!adjacency.has(from)) adjacency.set(from, []);
      adjacency.get(from).push({ to, edge });
    };
    for (const e of graph.edges) {
      pushAdj(e.from, e.to, e);
      if (e.bidirectional !== false) pushAdj(e.to, e.from, e);
    }

    const center = graph.coordinate_system.center || { x: 500, y: 500 };
    const metersPerUnit = graph.coordinate_system.meters_per_unit || 0.13;
    const walking = graph.walking || { speed_m_per_s: 1.2, security_wait_min: 2, ticket_check_wait_min: 1 };
    const statusNames = graph.seat_status_codes || {};

    // ----- seat index (exact coordinates from the ticketing seat map) ---------

    const seatIndex = new Map();
    for (const [name, sec] of Object.entries(graph.seat_index || {})) {
      const rows = (sec.rows || []).map((r, i) => {
        const seats = r.seats.map((s) => ({ number: s[0], x: s[1], y: s[2], status_code: s[3], status: statusNames[s[3]] || s[3], price: s[4] }));
        const cx = seats.reduce((a, s) => a + s.x, 0) / seats.length;
        const cy = seats.reduce((a, s) => a + s.y, 0) / seats.length;
        return { row: r.row, from_front: i, seats, seatMap: new Map(seats.map((s) => [s.number, s])), cx: round1(cx), cy: round1(cy) };
      });
      seatIndex.set(String(name), { section: String(name), rows, rowMap: new Map(rows.map((r) => [r.row, r])) });
    }

    // ----- geo projection -------------------------------------------------

    const geoCenter = graph.coordinate_system.geo_center || center;

    function mapToLatLon(p) {
      const geo = graph.geo;
      const metersPerDegLat = 111320;
      const metersPerDegLon = 111320 * Math.cos(deg2rad(geo.venue_lat));
      const east = (p.x - geoCenter.x) * metersPerUnit;
      const north = -(p.y - geoCenter.y) * metersPerUnit;
      const brg = deg2rad(geo.map_north_bearing_deg || 0);
      const e = east * Math.cos(brg) + north * Math.sin(brg);
      const n = -east * Math.sin(brg) + north * Math.cos(brg);
      return { lat: geo.venue_lat + n / metersPerDegLat, lon: geo.venue_lon + e / metersPerDegLon };
    }

    function latLonToMap(ll) {
      const geo = graph.geo;
      const metersPerDegLat = 111320;
      const metersPerDegLon = 111320 * Math.cos(deg2rad(geo.venue_lat));
      const n = (ll.lat - geo.venue_lat) * metersPerDegLat;
      const e = (ll.lon - geo.venue_lon) * metersPerDegLon;
      const brg = deg2rad(geo.map_north_bearing_deg || 0);
      const east = e * Math.cos(brg) - n * Math.sin(brg);
      const north = e * Math.sin(brg) + n * Math.cos(brg);
      return { x: round1(geoCenter.x + east / metersPerUnit), y: round1(geoCenter.y - north / metersPerUnit) };
    }

    // ----- gate resolution -------------------------------------------------

    function normalizeGate(input) {
      if (input == null || String(input).trim() === '') return null;
      const key = normalizeKey(input);
      if (gateAlias.has(key)) return gateAlias.get(key);
      // tolerate "BATI GİRİŞİ", "Kapı: Batı", etc.
      for (const [alias, id] of gateAlias) {
        if (alias && key.split(' ').includes(alias)) return id;
      }
      return null;
    }

    function nearestGateToSection(section) {
      let best = null;
      for (const g of graph.gates) {
        const d = Math.hypot(g.x - section.portal.x, g.y - section.portal.y);
        if (!best || d < best.d) best = { d, gate: g };
      }
      return best.gate;
    }

    /** The entrance that serves the seat's level (organiser data), if any. */
    function levelEntranceFor(section) {
      const table = graph.level_entrances || {};
      const id = section.floor ? table.floor : table[section.level];
      return id != null ? gatesById.get(String(id)) || null : null;
    }

    /** Priority: ticket gate → event mapping → entrance serving the seat level → geometry. */
    function resolveGate(req, section, warnings) {
      const levelGate = levelEntranceFor(section);
      const candidates = [
        { value: req.gate, source: 'ticket', fa: 'از روی بلیط', en: 'from the ticket' },
        { value: req.event_gate, source: 'event_mapping', fa: 'از نقشه ورودی‌های رویداد', en: 'from the event gate mapping' }
      ];
      for (const c of candidates) {
        if (c.value == null || String(c.value).trim() === '') continue;
        const id = normalizeGate(c.value);
        if (!id) {
          const err = new Error(`Unknown gate "${c.value}". Known gates: ${graph.gates.map((g) => g.id).join(', ')}`);
          err.code = 'UNKNOWN_GATE';
          throw err;
        }
        const gate = gatesById.get(id);
        if (levelGate && levelGate.id !== gate.id) {
          warnings.push({
            code: 'GATE_NOT_FOR_LEVEL',
            fa: `ورودی «${c.value}» (${gate.short ? gate.short.fa : gate.id}) ${c.fa} انتخاب شد، اما ورودی معمول سکشن ${section.section} «${levelGate.short ? levelGate.short.fa : levelGate.id}» است. مسیر از ورودی انتخاب‌شده رسم شد؛ با بلیط/برگزارکننده چک کنید.`,
            en: `Gate "${c.value}" (${gate.short ? gate.short.en : gate.id}) was taken ${c.en}, but section ${section.section} is normally entered through the ${levelGate.short ? levelGate.short.en : levelGate.id}. Routed from the chosen gate – check with the ticket/organiser.`
          });
        }
        return { gate, source: c.source, source_label: { fa: c.fa, en: c.en } };
      }
      if (levelGate) {
        return { gate: levelGate, source: 'level_entrance', source_label: { fa: 'ورودی مخصوص این طبقه', en: 'entrance serving this level' } };
      }
      const g = nearestGateToSection(section);
      warnings.push({
        code: 'GATE_GEOMETRIC_FALLBACK',
        fa: `ورودی مشخص نبود؛ نزدیک‌ترین ورودی از نظر هندسی (${g.id}) انتخاب شد. این انتخاب رسمی نیست و باید با بلیط یا برگزارکننده تأیید شود.`,
        en: `No gate given; picked the geometrically nearest gate (${g.id}). This is NOT an official assignment – confirm with the ticket or organiser.`
      });
      return { gate: g, source: 'geometric_fallback', source_label: { fa: 'نزدیک‌ترین ورودی (تخمینی)', en: 'nearest gate (estimate)' } };
    }

    // ----- shortest path -----------------------------------------------------

    function edgeAllowed(edge, opts) {
      if (opts.accessible && edge.type === 'vertical') {
        return Array.isArray(edge.modes) && edge.modes.includes('elevator');
      }
      return true;
    }

    function dijkstra(startId, goalId, opts = {}) {
      const dist = new Map([[startId, 0]]);
      const prev = new Map();
      const visited = new Set();
      // simple binary-heap-free PQ; graph is small (~150 nodes)
      const open = [{ id: startId, d: 0 }];
      while (open.length) {
        open.sort((a, b) => a.d - b.d);
        const { id, d } = open.shift();
        if (visited.has(id)) continue;
        visited.add(id);
        if (id === goalId) break;
        for (const { to, edge } of adjacency.get(id) || []) {
          if (!edgeAllowed(edge, opts)) continue;
          const nd = d + edge.cost;
          if (nd < (dist.has(to) ? dist.get(to) : Infinity)) {
            dist.set(to, nd);
            prev.set(to, { id, edge });
            open.push({ id: to, d: nd });
          }
        }
      }
      if (!dist.has(goalId)) return null;
      const path = [];
      let cur = goalId;
      while (cur !== undefined) {
        const p = prev.get(cur);
        path.unshift({ node: nodes.get(cur), viaEdge: p ? p.edge : null });
        cur = p ? p.id : undefined;
      }
      return { cost: dist.get(goalId), path };
    }

    // ----- seat model --------------------------------------------------------

    /**
     * Exact seat position from the ticketing seat map. Falls back to the row
     * centre (unknown seat) or the back row (unknown row) with a warning.
     */
    function seatPosition(section, rowInfo, seatInfo, warnings) {
      const idx = seatIndex.get(String(section.section));
      const portal = section.portal;
      const outward = section.outward || { x: 0, y: -1 };
      const facing = { x: -outward.x, y: -outward.y };     // portal → floor/stage
      const right = { x: -facing.y, y: facing.x };         // spectator's right when facing the floor (screen y grows downward)
      const m = (units) => Math.round(units * metersPerUnit * 10) / 10;

      if (!idx || !idx.rows.length) {
        return {
          x: section.centroid.x, y: section.centroid.y, row: null, seat: null, row_found: false, seat_found: false,
          rows_total: 0, rows_from_front: null, rows_from_portal: null, seat_side_from_portal: 'middle',
          distance_from_portal_m: m(Math.hypot(section.centroid.x - portal.x, section.centroid.y - portal.y)),
          confidence: 'section_centroid'
        };
      }

      const rowKey = rowInfo ? rowInfo.label : null;
      const row = rowKey ? idx.rowMap.get(rowKey) : null;
      if (rowKey && !row) {
        warnings.push({
          code: 'ROW_NOT_FOUND',
          fa: `ردیف «${rowKey}» در سکشن ${section.section} وجود ندارد (ردیف‌ها: ${idx.rows.map((r) => r.row).join('، ')}). موقعیت در ردیف آخر نمایش داده می‌شود.`,
          en: `Row "${rowKey}" does not exist in section ${section.section} (rows: ${idx.rows.map((r) => r.row).join(', ')}). Shown at the back row.`
        });
      }
      if (!row) {
        const back = idx.rows[idx.rows.length - 1];
        return {
          x: back.cx, y: back.cy, row: null, seat: null, row_found: false, seat_found: false,
          rows_total: idx.rows.length, rows_from_front: back.from_front, rows_from_portal: 0, seat_side_from_portal: 'middle',
          seats_in_row: back.seats.length,
          distance_from_portal_m: m(Math.hypot(back.cx - portal.x, back.cy - portal.y)),
          confidence: 'row_unknown_back_row'
        };
      }

      const seat = seatInfo ? row.seatMap.get(seatInfo.index) : null;
      if (seatInfo && !seat) {
        const nums = row.seats.map((s) => s.number);
        warnings.push({
          code: 'SEAT_NOT_FOUND',
          fa: `صندلی ${seatInfo.label} در ردیف ${row.row} سکشن ${section.section} وجود ندارد (صندلی‌های ${Math.min(...nums)} تا ${Math.max(...nums)}). وسط ردیف نمایش داده می‌شود.`,
          en: `Seat ${seatInfo.label} does not exist in row ${row.row} of section ${section.section} (seats ${Math.min(...nums)}–${Math.max(...nums)}). Shown at the row centre.`
        });
      }
      const p = seat ? { x: seat.x, y: seat.y } : { x: row.cx, y: row.cy };
      const lateral = (q) => (q.x - row.cx) * right.x + (q.y - row.cy) * right.y;
      const halfWidth = Math.max(...row.seats.map((s) => Math.abs(lateral(s))));
      const lat = lateral(p);
      const side = Math.abs(lat) <= Math.max(45, halfWidth * 0.2) ? 'middle' : lat > 0 ? 'right' : 'left';
      const fromLeft = seat ? row.seats.filter((s) => lateral(s) < lat - 1e-6).length + 1 : null;

      return {
        x: p.x, y: p.y,
        row: row.row, seat: seat ? seat.number : null,
        row_found: true, seat_found: !!seat,
        rows_total: idx.rows.length,
        rows_from_front: row.from_front,
        rows_from_portal: idx.rows.length - 1 - row.from_front,
        seats_in_row: row.seats.length,
        seat_index_from_left: fromLeft,          // counted from the left when facing the floor/stage
        seat_side_from_portal: side,
        distance_from_portal_m: m(Math.hypot(p.x - portal.x, p.y - portal.y)),
        ...(seat ? { status: seat.status, status_code: seat.status_code, price: seat.price } : {}),
        confidence: seat ? 'exact_seatmap' : 'row_centroid'
      };
    }

    // ----- step builder ------------------------------------------------------

    function levelName(level, lang) {
      const l = graph.levels[level];
      return l ? l.name[lang] : `L${level}`;
    }

    function zoneName(zone, lang) {
      return (ZONE_NAMES[zone] || ZONE_NAMES.north)[lang];
    }

    function buildSteps(path, gateInfo, section, rowInfo, seatInfo, seatPos, opts) {
      const steps = [];
      let stepNo = 0;
      const push = (s) => {
        stepNo += 1;
        steps.push({ n: stepNo, ...s });
      };

      const m = (units) => Math.round(units * metersPerUnit);
      const gate = gateInfo.gate;

      let i = 0;
      while (i < path.length) {
        const { node, viaEdge } = path[i];
        const from = i > 0 ? path[i - 1].node : null;

        if (node.type === 'gate') {
          push({
            type: 'gate', icon: '🚪', level: 0, node_ids: [node.id],
            to: { x: node.x, y: node.y },
            title: {
              fa: `از ${gate.display.tr} (${gate.display.fa}) وارد شوید`,
              en: `Enter through ${gate.display.en}`,
              tr: `${gate.display.tr}’nden girin`
            },
            detail: {
              fa: `ورودی ${gateInfo.source_label.fa} تعیین شد.`,
              en: `Gate chosen ${gateInfo.source_label.en}.`,
              tr: `Kapı: ${gate.id}`
            },
            distance_m: 0
          });
          i += 1; continue;
        }

        if (node.type === 'security' || node.type === 'ticket_control') {
          const isSec = node.type === 'security';
          push({
            type: node.type, icon: isSec ? '🛂' : '🎫', level: 0, node_ids: [node.id],
            from: from && { x: from.x, y: from.y }, to: { x: node.x, y: node.y },
            title: isSec
              ? { fa: 'از کنترل امنیتی عبور کنید', en: 'Pass the security check', tr: 'Güvenlik kontrolünden geçin' }
              : { fa: 'بلیط خود را نشان دهید (کنترل بلیط)', en: 'Show your ticket (ticket check)', tr: 'Biletinizi gösterin (bilet kontrolü)' },
            detail: isSec
              ? { fa: 'کیف و وسایل را برای بازرسی آماده کنید.', en: 'Have bags ready for inspection.', tr: 'Çantanızı kontrole hazırlayın.' }
              : {
                fa: `بلیط: سکشن ${section.section}، ردیف ${rowInfo ? rowInfo.label : '—'}، صندلی ${seatInfo ? seatInfo.label : '—'}`,
                en: `Ticket: section ${section.section}, row ${rowInfo ? rowInfo.label : '—'}, seat ${seatInfo ? seatInfo.label : '—'}`,
                tr: `Bilet: blok ${section.section}, sıra ${rowInfo ? rowInfo.label : '—'}, koltuk ${seatInfo ? seatInfo.label : '—'}`
              },
            distance_m: m(viaEdge ? viaEdge.length_units : 0),
            wait_min: isSec ? walking.security_wait_min : walking.ticket_check_wait_min
          });
          i += 1; continue;
        }

        if (node.type === 'lobby') {
          push({
            type: 'lobby', icon: '🏟️', level: 1, node_ids: [node.id],
            from: from && { x: from.x, y: from.y }, to: { x: node.x, y: node.y },
            title: { fa: 'وارد سالن ورودی شوید', en: 'Enter the entrance hall', tr: 'Giriş holüne girin' },
            detail: section.floor
              ? { fa: 'مقصد شما در کف سالن (جلوی صحنه) است؛ از همین طبقه با تونل به کف سالن می‌روید.', en: 'Your seat is on the arena floor; you reach it from this level through the floor tunnel.', tr: 'Koltuğunuz zeminde; bu kattan zemin tüneliyle ulaşırsınız.' }
              : {
                fa: section.level === 1 ? 'مقصد شما در همین طبقه است.' : `باید به ${levelName(section.level, 'fa')} بروید.`,
                en: section.level === 1 ? 'Your seat is on this level.' : `You need to go up to ${levelName(section.level, 'en')}.`,
                tr: section.level === 1 ? 'Koltuğunuz bu katta.' : `${levelName(section.level, 'tr')}’a çıkmanız gerekiyor.`
              },
            distance_m: m(viaEdge ? viaEdge.length_units : 0)
          });
          i += 1; continue;
        }

        if (node.type === 'core') {
          // Collect the whole vertical run: walk-in, vertical edges, walk-out
          let j = i;
          let units = viaEdge ? viaEdge.length_units : 0;
          const ids = [node.id];
          const startLevel = node.level;
          let endLevel = node.level;
          let usedVertical = false;
          while (j + 1 < path.length && path[j + 1].node.type === 'core') {
            j += 1;
            units += path[j].viaEdge.length_units;
            ids.push(path[j].node.id);
            endLevel = path[j].node.level;
            if (path[j].viaEdge.type === 'vertical') usedVertical = true;
          }
          const coreDef = graph.cores.find((c) => c.id === node.core);
          if (usedVertical) {
            const modes = (coreDef.modes || ['stairs']).filter((md) => !opts.accessible || md === 'elevator');
            const modesFa = modes.map((md) => MODE_NAMES[md].fa).join(' / ');
            const modesEn = modes.map((md) => MODE_NAMES[md].en).join(' / ');
            const modesTr = modes.map((md) => MODE_NAMES[md].tr).join(' / ');
            const up = endLevel > startLevel;
            push({
              type: 'vertical', icon: up ? '⬆️' : '⬇️', level: endLevel, level_from: startLevel, level_to: endLevel,
              node_ids: ids, from: from && { x: from.x, y: from.y }, to: { x: node.x, y: node.y },
              modes,
              title: {
                fa: `با ${modesFa} به ${levelName(endLevel, 'fa')} ${up ? 'بروید' : 'پایین بروید'}`,
                en: `Take the ${modesEn} ${up ? 'up' : 'down'} to ${levelName(endLevel, 'en')}`,
                tr: `${modesTr} ile ${levelName(endLevel, 'tr')}’a ${up ? 'çıkın' : 'inin'}`
              },
              detail: {
                fa: `${coreDef.display.fa}؛ از طبقه ${startLevel} به طبقه ${endLevel}${endLevel === 4 ? ' (طبقه ۳ را رد کنید)' : ''}.`,
                en: `${coreDef.display.en}; level ${startLevel} → ${endLevel}${endLevel === 4 ? ' (pass level 3)' : ''}.`,
                tr: `${coreDef.display.tr}; kat ${startLevel} → ${endLevel}.`
              },
              distance_m: m(units)
            });
          } else {
            push({
              type: 'walk', icon: '🚶', level: node.level, node_ids: ids,
              from: from && { x: from.x, y: from.y }, to: { x: node.x, y: node.y },
              title: { fa: `از کنار ${coreDef.display.fa} عبور کنید`, en: `Pass the ${coreDef.display.en}`, tr: `${coreDef.display.tr} yanından geçin` },
              detail: { fa: '', en: '', tr: '' },
              distance_m: m(units)
            });
          }
          i = j + 1; continue;
        }

        if (node.type === 'corridor') {
          let j = i;
          let units = viaEdge ? viaEdge.length_units : 0;
          const ids = [node.id];
          const passed = [];
          while (j + 1 < path.length && path[j + 1].node.type === 'corridor') {
            passed.push(path[j].node.section);
            j += 1;
            units += path[j].viaEdge.length_units;
            ids.push(path[j].node.id);
          }
          const last = path[j].node;
          const startAngle = (rad2deg(Math.atan2(node.y - center.y, node.x - center.x)) + 360) % 360;
          const endAngle = (rad2deg(Math.atan2(last.y - center.y, last.x - center.x)) + 360) % 360;
          let delta = ((endAngle - startAngle + 540) % 360) - 180;
          const clockwise = delta > 0; // y grows downward → positive angle delta is clockwise on screen
          const passedText = passed.length ? passed.join('، ') : null;
          push({
            type: 'concourse', icon: '🚶', level: node.level, node_ids: ids,
            from: from && { x: from.x, y: from.y }, to: { x: last.x, y: last.y },
            direction: Math.abs(delta) < 1 ? 'straight' : clockwise ? 'clockwise' : 'counter_clockwise',
            passed_sections: passed,
            title: {
              fa: `در راهروی ${levelName(node.level, 'fa')} به سمت «${zoneName(section.zone, 'fa')}» حرکت کنید`,
              en: `Walk along the ${levelName(node.level, 'en')} concourse towards the ${zoneName(section.zone, 'en')}`,
              tr: `${levelName(node.level, 'tr')} koridorunda ${zoneName(section.zone, 'tr')} yönünde yürüyün`
            },
            detail: {
              fa: passedText
                ? `از مقابل سکشن‌های ${passedText} رد شوید تا به سکشن ${section.section} برسید.`
                : `ورودی سکشن ${section.section} همین‌جاست.`,
              en: passedText
                ? `Pass sections ${passed.join(', ')} until you reach section ${section.section}.`
                : `Section ${section.section} portal is right here.`,
              tr: passedText
                ? `${passed.join(', ')} bloklarını geçip ${section.section} bloğuna ulaşın.`
                : `${section.section} blok girişi burada.`
            },
            distance_m: m(units)
          });
          i = j + 1; continue;
        }

        if (node.type === 'tunnel') {
          push({
            type: 'tunnel', icon: '⬇️', level: node.level, node_ids: [node.id],
            from: from && { x: from.x, y: from.y }, to: { x: node.x, y: node.y },
            title: { fa: 'از تونل زیر جایگاه به کف سالن بروید', en: 'Take the tunnel under the stands down to the floor', tr: 'Tribün altındaki tünelden zemine inin' },
            detail: { fa: `تونل کف سالن به محوطه ${section.section} می‌رسد.`, en: `The floor tunnel leads to the ${section.section} area.`, tr: `Zemin tüneli ${section.section} alanına çıkar.` },
            distance_m: m(viaEdge ? viaEdge.length_units : 0)
          });
          i += 1; continue;
        }

        if (node.type === 'portal') {
          push({
            type: 'portal', icon: '🚪', level: node.level, node_ids: [node.id],
            from: from && { x: from.x, y: from.y }, to: { x: node.x, y: node.y },
            title: section.floor
              ? { fa: `وارد محوطه ${section.section} (کف سالن) شوید`, en: `Enter the ${section.section} floor area`, tr: `${section.section} zemin alanına girin` }
              : {
                fa: `از ورودی سکشن ${section.section} وارد شوید`,
                en: `Enter through the section ${section.section} portal`,
                tr: `${section.section} blok girişinden girin`
              },
            detail: section.floor
              ? { fa: 'ورودی کف سالن در انتهای عقبی محوطه، روبه‌روی صحنه است.', en: 'The floor entrance is at the rear of the floor, facing the stage.', tr: 'Zemin girişi alanın arkasında, sahneye bakar.' }
              : {
                fa: `ورودی سکشن پشت آخرین ردیف، ${zoneName(section.zone, 'fa')}، ${levelName(section.level, 'fa')}.`,
                en: `Portal behind the last row, ${zoneName(section.zone, 'en')}, ${levelName(section.level, 'en')}.`,
                tr: `Giriş son sıranın arkasında, ${zoneName(section.zone, 'tr')}, ${levelName(section.level, 'tr')}.`
              },
            distance_m: m(viaEdge ? viaEdge.length_units : 0)
          });
          i += 1; continue;
        }

        // any other node type: plain walk
        push({
          type: 'walk', icon: '🚶', level: node.level, node_ids: [node.id],
          from: from && { x: from.x, y: from.y }, to: { x: node.x, y: node.y },
          title: { fa: node.label ? node.label.fa : node.id, en: node.label ? node.label.en : node.id, tr: node.label ? node.label.tr : node.id },
          detail: { fa: '', en: '', tr: '' },
          distance_m: m(viaEdge ? viaEdge.length_units : 0)
        });
        i += 1;
      }

      // Row + seat steps (inside the section; not graph nodes)
      const portal = path[path.length - 1].node;
      const rowLabel = rowInfo ? rowInfo.label : null;
      const seatLabel = seatInfo ? seatInfo.label : null;
      const sideFa = { left: 'سمت چپ', right: 'سمت راست', middle: 'وسط' }[seatPos.seat_side_from_portal];
      const sideEn = { left: 'to your left', right: 'to your right', middle: 'in the middle' }[seatPos.seat_side_from_portal];
      const sideTr = { left: 'solunuzda', right: 'sağınızda', middle: 'ortada' }[seatPos.seat_side_from_portal];

      const towardsFa = section.floor ? 'به سمت صحنه' : 'به سمت زمین/صحنه';
      if (rowLabel && seatPos.row_found) {
        const rf = seatPos.rows_from_front + 1, rp = seatPos.rows_from_portal, rt = seatPos.rows_total;
        push({
          type: 'row', icon: '🪑', level: section.level, node_ids: [],
          from: { x: portal.x, y: portal.y }, to: { x: seatPos.x, y: seatPos.y },
          title: { fa: `به ردیف ${rowLabel} بروید`, en: `Go to row ${rowLabel}`, tr: `${rowLabel} sırasına gidin` },
          detail: {
            fa: rp === 0
              ? `ردیف ${rowLabel} آخرین ردیف (${rt}مین از جلو)، درست کنار ورودی است.`
              : `از ورودی ${rp} ردیف ${towardsFa} پایین بروید؛ ردیف ${rowLabel} ${rf}مین ردیف از جلو از ${rt} ردیف است.`,
            en: rp === 0
              ? `Row ${rowLabel} is the back row (row ${rt} of ${rt}), right at the portal.`
              : `Walk ${rp} row${rp > 1 ? 's' : ''} down from the portal; row ${rowLabel} is row ${rf} of ${rt} from the front.`,
            tr: rp === 0
              ? `${rowLabel} sırası girişin hemen yanındaki son sıra (${rt}/${rt}).`
              : `Girişten ${rp} sıra aşağı inin; ${rowLabel} sırası önden ${rf}. sıra (toplam ${rt}).`
          },
          distance_m: Math.round(seatPos.distance_from_portal_m)
        });
      } else if (rowLabel) {
        push({
          type: 'row', icon: '🪑', level: section.level, node_ids: [],
          from: { x: portal.x, y: portal.y }, to: { x: seatPos.x, y: seatPos.y },
          title: { fa: `ردیف ${rowLabel} را پیدا کنید`, en: `Find row ${rowLabel}`, tr: `${rowLabel} sırasını bulun` },
          detail: { fa: 'این ردیف در نقشه صندلی‌ها نیست؛ شماره ردیف‌ها را روی پله‌ها چک کنید.', en: 'This row is not in the seat map; check the row numbers on the aisle.', tr: 'Bu sıra koltuk planında yok; sıra numaralarını kontrol edin.' },
          distance_m: Math.round(seatPos.distance_from_portal_m)
        });
      }
      const k = seatPos.seat_index_from_left, n = seatPos.seats_in_row;
      push({
        type: 'seat', icon: '💺', level: section.level, node_ids: [],
        from: { x: portal.x, y: portal.y }, to: { x: seatPos.x, y: seatPos.y },
        title: {
          fa: seatLabel ? `صندلی ${seatLabel} – رسیدید!` : 'به جای خود برسید',
          en: seatLabel ? `Seat ${seatLabel} – you have arrived` : 'Arrive at your seat',
          tr: seatLabel ? `Koltuk ${seatLabel} – vardınız` : 'Koltuğunuza ulaşın'
        },
        detail: {
          fa: seatPos.seat_found
            ? `صندلی ${seatLabel} ${k}مین صندلی از سمت چپ ردیف (رو به صحنه) از ${n} صندلی است – ${sideFa} ردیف. شماره روی صندلی را چک کنید.`
            : seatLabel ? `صندلی ${seatLabel} در این ردیف پیدا نشد؛ شماره‌های روی صندلی‌ها را چک کنید.` : '',
          en: seatPos.seat_found
            ? `Seat ${seatLabel} is seat ${k} of ${n} counted from the left when facing the stage – ${sideEn}. Check the seat number.`
            : seatLabel ? `Seat ${seatLabel} was not found in this row; check the seat numbers.` : '',
          tr: seatPos.seat_found
            ? `Koltuk ${seatLabel}, sahneye bakarken soldan ${k}. koltuk (toplam ${n}) – ${sideTr}. Koltuk numarasını kontrol edin.`
            : seatLabel ? `Koltuk ${seatLabel} bu sırada bulunamadı; koltuk numaralarını kontrol edin.` : ''
        },
        distance_m: 0
      });

      return steps;
    }

    // ----- outdoor leg -------------------------------------------------------

    function outdoorLeg(origin, gate, warnings) {
      if (!origin || typeof origin.lat !== 'number' || typeof origin.lon !== 'number') return null;
      if (Number.isNaN(origin.lat) || Number.isNaN(origin.lon)) return null;
      const gateLL = { lat: gate.lat, lon: gate.lon };
      const straight = haversineMeters(origin, gateLL);
      const wps = (gate.approach && gate.approach.waypoints) || [];
      const ll = (w) => ({ lat: w[0], lon: w[1] });

      // Follow the organiser's approach path (street → entrance): walk to its nearest waypoint, then follow
      // the drawn path to the door (the paths exist because of fences/buildings, so never shortcut them).
      // Only go straight to the door when already next to it.
      const remaining = new Array(wps.length + 1).fill(0);
      for (let i = wps.length - 1; i >= 0; i--) {
        remaining[i] = remaining[i + 1] + haversineMeters(ll(wps[i]), i + 1 < wps.length ? ll(wps[i + 1]) : gateLL);
      }
      let join = { idx: wps.length, cost: straight };
      if (wps.length && straight > 25) {
        let nearest = 0, nearestD = Infinity;
        for (let i = 0; i < wps.length; i++) {
          const d = haversineMeters(origin, ll(wps[i]));
          if (d < nearestD) { nearestD = d; nearest = i; }
        }
        join = { idx: nearest, cost: nearestD + remaining[nearest] };
      }
      const polyline = [[origin.lat, origin.lon], ...wps.slice(join.idx), [gate.lat, gate.lon]];
      const distance = join.cost;
      const brg = bearingDeg(origin, ll(polyline[1]));
      const dir = compass(brg);
      const near = straight <= 2500;
      if (!near) {
        warnings.push({
          code: 'ORIGIN_FAR',
          fa: 'موقعیت شما بیش از ۲.۵ کیلومتر از سالن فاصله دارد؛ مسیر پیاده روی نقشه داخلی رسم نمی‌شود، از لینک مسیریابی استفاده کنید.',
          en: 'You are more than 2.5 km from the venue; the walking leg is not drawn on the indoor map – use the directions link.'
        });
      }
      const via = wps.slice(join.idx);
      const viaForUrl = via.length > 2 ? [via[0], via[via.length - 1]] : via;
      const url = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lon}&destination=${gate.lat},${gate.lon}&travelmode=walking` +
        (viaForUrl.length ? `&waypoints=${viaForUrl.map((w) => `${w[0]},${w[1]}`).join('|')}` : '');
      const desc = gate.approach && gate.approach.start_description;
      return {
        origin: { lat: origin.lat, lon: origin.lon, accuracy_m: origin.accuracy_m || null, map_xy: near ? latLonToMap(origin) : null },
        gate: { id: gate.id, lat: gate.lat, lon: gate.lon, map_xy: { x: gate.x, y: gate.y }, geo_confidence: gate.geo_confidence },
        distance_m: Math.round(distance),
        straight_line_m: Math.round(straight),
        bearing_deg: Math.round(brg),
        compass: dir,
        compass_fa: COMPASS_FA[dir],
        duration_min: Math.round(distance / walking.speed_m_per_s / 60),
        polyline,
        polyline_map_xy: near ? polyline.map((w) => latLonToMap(ll(w))) : null,
        approach: gate.approach ? { color: gate.approach.color, length_m: gate.approach.length_m, joined_at_waypoint: join.idx, followed_waypoints: via.length, description: desc } : null,
        directions_url: url,
        note: {
          fa: (desc ? `مسیر ورود: ${desc.fa}. ` : '') + 'مختصات ورودی از پین‌های برگزارکننده است؛ برای جزئیات خیابان‌ها از لینک مسیریابی استفاده کنید.',
          en: (desc ? `Approach: ${desc.en}. ` : '') + 'Entrance position from the organiser\'s GPS pins; use the directions link for street detail.'
        }
      };
    }

    // ----- public API --------------------------------------------------------

    function route(req = {}) {
      const warnings = [];
      const sectionKey = String(req.section == null ? '' : req.section).trim();
      const section = sections.get(sectionKey);
      if (!section) {
        const err = new Error(`Unknown section "${sectionKey}". Valid sections: ${graph.sections.map((s) => s.section).join(', ')}.`);
        err.code = 'UNKNOWN_SECTION';
        throw err;
      }
      const rowInfo = parseRow(req.row);
      if (req.row != null && String(req.row).trim() !== '' && !rowInfo) {
        warnings.push({ code: 'ROW_UNPARSED', fa: `ردیف «${req.row}» قابل تفسیر نبود.`, en: `Row "${req.row}" could not be parsed.` });
      }
      const seatInfo = parseSeat(req.seat);
      if (req.seat != null && String(req.seat).trim() !== '' && !seatInfo) {
        warnings.push({ code: 'SEAT_UNPARSED', fa: `صندلی «${req.seat}» قابل تفسیر نبود.`, en: `Seat "${req.seat}" could not be parsed.` });
      }
      const opts = { accessible: !!req.accessible };
      const gateInfo = resolveGate(req, section, warnings);
      const gate = gateInfo.gate;

      const result = dijkstra(gate.node, section.portal.node, opts);
      if (!result) {
        const err = new Error(`No route from ${gate.node} to ${section.portal.node}` + (opts.accessible ? ' (accessible mode)' : ''));
        err.code = 'NO_ROUTE';
        throw err;
      }

      const seatPos = seatPosition(section, rowInfo, seatInfo, warnings);
      const steps = buildSteps(result.path, gateInfo, section, rowInfo, seatInfo, seatPos, opts);
      const outdoor = outdoorLeg(req.origin, gate, warnings);

      if (outdoor) {
        steps.unshift({
          n: 0, type: 'outdoor', icon: '📍', level: 0, node_ids: [],
          from: outdoor.origin.map_xy, to: { x: gate.x, y: gate.y },
          title: {
            fa: `پیاده تا ${gate.short ? gate.short.fa : gate.display.fa} (${gate.display.tr}): حدود ${outdoor.distance_m} متر، ابتدا به سمت ${outdoor.compass_fa}`,
            en: `Walk to the ${gate.short ? gate.short.en : gate.display.en} (${gate.display.tr}): about ${outdoor.distance_m} m, first heading ${outdoor.compass}`,
            tr: `${gate.display.tr}’ne yürüyün: yaklaşık ${outdoor.distance_m} m`
          },
          detail: { fa: outdoor.note.fa, en: outdoor.note.en, tr: outdoor.approach && outdoor.approach.description ? outdoor.approach.description.tr : '' },
          distance_m: outdoor.distance_m,
          directions_url: outdoor.directions_url
        });
      }

      const indoorMeters = steps.filter((s) => s.type !== 'outdoor').reduce((a, s) => a + (s.distance_m || 0), 0);
      const waitMin = steps.reduce((a, s) => a + (s.wait_min || 0), 0);
      const indoorMin = indoorMeters / walking.speed_m_per_s / 60 + waitMin;
      const levelsVisited = [...new Set(result.path.map((p) => p.node.level).filter((l) => l > 0))];

      const pathNodes = result.path.map((p) => ({
        id: p.node.id, type: p.node.type, level: p.node.level, x: p.node.x, y: p.node.y,
        via: p.viaEdge ? p.viaEdge.type : null
      }));

      return {
        ok: true,
        venue: graph.venue,
        ticket: {
          event_id: req.event_id != null ? req.event_id : null,
          section: section.section,
          row: rowInfo ? rowInfo.label : null,
          seat: seatInfo ? seatInfo.label : null,
          gate_input: req.gate || null
        },
        gate: {
          id: gate.id, display: gate.display, short: gate.short || null, node: gate.node,
          source: gateInfo.source, source_label: gateInfo.source_label,
          serves_levels: gate.serves_levels || null, compass_label: gate.compass_label || null,
          map_xy: { x: gate.x, y: gate.y }, lat: gate.lat, lon: gate.lon,
          verified_location: !!gate.verified_location, geo_confidence: gate.geo_confidence
        },
        destination: {
          section: section.section,
          level: section.level,
          level_name: graph.levels[section.level].name,
          floor: !!section.floor,
          zone: section.zone,
          zone_name: ZONE_NAMES[section.zone] || null,
          portal: { node: section.portal.node, x: section.portal.x, y: section.portal.y },
          seat: { ...seatPos, row: seatPos.row || (rowInfo ? rowInfo.label : null), seat: seatPos.seat != null ? String(seatPos.seat) : (seatInfo ? seatInfo.label : null) }
        },
        summary: {
          indoor_distance_m: Math.round(indoorMeters),
          indoor_duration_min: Math.round(indoorMin),
          outdoor_distance_m: outdoor ? outdoor.distance_m : null,
          total_duration_min: Math.round(indoorMin + (outdoor ? outdoor.duration_min : 0)),
          levels_visited: levelsVisited,
          level_change: section.level !== 1,
          accessible: opts.accessible,
          graph_cost: round1(result.cost)
        },
        steps,
        path: { nodes: pathNodes, seat: { x: seatPos.x, y: seatPos.y, level: section.level } },
        outdoor,
        warnings,
        confidence: {
          seat: seatPos.confidence,
          fa: 'موقعیت صندلی‌ها، ردیف‌ها و سکشن‌ها دقیقاً از نقشه صندلی سیستم بلیت‌فروشی است؛ ورودی سکشن‌ها، راهروها، پله‌ها، آسانسورها و ورودی‌های سالن از روی همان هندسه مدل‌سازی شده‌اند (نه نقشه‌برداری‌شده). مقیاس متری و جهت جغرافیایی تخمینی است.',
          en: graph.important_warning
        }
      };
    }

    function listSections() {
      return graph.sections.map((s) => ({
        section: s.section, level: s.level, floor: !!s.floor, zone: s.zone, zone_name: ZONE_NAMES[s.zone] || null,
        rows: s.rows, row_count: s.row_count, seat_count: s.seat_count, known_ticket_gate_label: s.known_ticket_gate_label
      }));
    }

    /** All seats of a section (optionally one row) with exact coordinates and sales status. */
    function listSeats(sectionName, rowLabel) {
      const idx = seatIndex.get(String(sectionName == null ? '' : sectionName).trim());
      if (!idx) {
        const err = new Error(`Unknown section "${sectionName}"`);
        err.code = 'UNKNOWN_SECTION';
        throw err;
      }
      const rowKey = rowLabel != null && String(rowLabel).trim() !== '' ? (parseRow(rowLabel) || {}).label : null;
      const rows = idx.rows.filter((r) => !rowKey || r.row === rowKey);
      return {
        section: idx.section,
        rows: rows.map((r) => ({
          row: r.row, from_front: r.from_front,
          seats: r.seats.map((s) => ({ number: s.number, x: s.x, y: s.y, status: s.status, price: s.price }))
        }))
      };
    }

    function getSeat(sectionName, rowLabel, seatNumber) {
      const idx = seatIndex.get(String(sectionName == null ? '' : sectionName).trim());
      const r = idx && parseRow(rowLabel) ? idx.rowMap.get(parseRow(rowLabel).label) : null;
      const s = r && parseSeat(seatNumber) ? r.seatMap.get(parseSeat(seatNumber).index) : null;
      return s ? { section: idx.section, row: r.row, number: s.number, x: s.x, y: s.y, status: s.status, price: s.price } : null;
    }

    function listGates() {
      return graph.gates.map((g) => ({
        id: g.id, display: g.display, short: g.short || null, aliases: g.aliases, serves_levels: g.serves_levels || null,
        compass_label: g.compass_label || null, lat: g.lat, lon: g.lon, verified_location: !!g.verified_location,
        approach: g.approach || null
      }));
    }

    return { route, listSections, listSeats, getSeat, listGates, normalizeGate, mapToLatLon, latLonToMap, dijkstra, graph };
  }

  return { createRouter, parseRow, parseSeat, haversineMeters, bearingDeg, ZONE_NAMES };
});
