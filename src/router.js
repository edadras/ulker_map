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

    // ----- geo projection -------------------------------------------------

    function mapToLatLon(p) {
      const geo = graph.geo;
      const metersPerDegLat = 111320;
      const metersPerDegLon = 111320 * Math.cos(deg2rad(geo.venue_lat));
      const east = (p.x - center.x) * metersPerUnit;
      const north = -(p.y - center.y) * metersPerUnit;
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
      return { x: round1(center.x + east / metersPerUnit), y: round1(center.y - north / metersPerUnit) };
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
        const gAngle = (rad2deg(Math.atan2(g.y - center.y, g.x - center.x)) + 360) % 360;
        const d = angularDistance(gAngle, section.angle_deg);
        if (!best || d < best.d) best = { d, gate: g };
      }
      return best.gate;
    }

    /** Priority: ticket gate → event mapping → historical section label → geometry. */
    function resolveGate(req, section, warnings) {
      const candidates = [
        { value: req.gate, source: 'ticket', fa: 'از روی بلیط', en: 'from the ticket' },
        { value: req.event_gate, source: 'event_mapping', fa: 'از نقشه ورودی‌های رویداد', en: 'from the event gate mapping' }
      ];
      for (const c of candidates) {
        if (c.value == null || String(c.value).trim() === '') continue;
        const id = normalizeGate(c.value);
        if (id) return { gate: gatesById.get(id), source: c.source, source_label: { fa: c.fa, en: c.en } };
        const err = new Error(`Unknown gate "${c.value}". Known gates: ${graph.gates.map((g) => g.id).join(', ')}`);
        err.code = 'UNKNOWN_GATE';
        throw err;
      }
      if (section.known_ticket_gate_label) {
        const id = normalizeGate(section.known_ticket_gate_label);
        if (id) {
          warnings.push({
            code: 'GATE_FROM_HISTORICAL_LABEL',
            fa: `ورودی روی بلیط مشخص نشده بود؛ از برچسب قبلاً دیده‌شده برای سکشن ${section.section} (${id}) استفاده شد. حتماً با بلیط خود مقایسه کنید.`,
            en: `No gate on the ticket; used the gate label previously seen for section ${section.section} (${id}). Verify against your ticket.`
          });
          return { gate: gatesById.get(id), source: 'section_history', source_label: { fa: 'برچسب قبلی سکشن', en: 'historical section label' } };
        }
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

    function seatPosition(section, rowInfo, seatInfo, warnings) {
      const lvl = graph.levels[section.level];
      const rows = lvl.rows_estimate;
      const seatsPerRow = lvl.seats_per_row_estimate;

      let rowIdx = rowInfo ? rowInfo.index : rows; // unknown row → assume top row
      if (rowInfo && rowInfo.index > rows) {
        warnings.push({
          code: 'ROW_BEYOND_MODEL',
          fa: `ردیف ${rowInfo.label} از تعداد ردیف تخمینی این طبقه (${rows}) بیشتر است؛ موقعیت در آخرین ردیف نمایش داده می‌شود.`,
          en: `Row ${rowInfo.label} exceeds the estimated row count for this level (${rows}); shown at the last row.`
        });
        rowIdx = rows;
      }
      const t = rows > 1 ? (Math.max(1, rowIdx) - 1) / (rows - 1) : 0;
      const r = lvl.row_inner_r + t * (lvl.row_outer_r - lvl.row_inner_r);

      let seatT = 0.5;
      if (seatInfo) {
        const idx = Math.min(Math.max(1, seatInfo.index), seatsPerRow);
        seatT = seatsPerRow > 1 ? (idx - 1) / (seatsPerRow - 1) : 0.5;
      }
      // seat 1 assumed at the clockwise edge of the wedge (screen space)
      const angle = section.angle_deg + (0.5 - seatT) * 2 * section.half_wedge_deg * 0.85;
      const x = round1(center.x + Math.cos(deg2rad(angle)) * r);
      const y = round1(center.y + Math.sin(deg2rad(angle)) * r);

      const rowsFromPortal = rows - Math.max(1, rowIdx);
      const seatSide = seatT < 0.4 ? 'right' : seatT > 0.6 ? 'left' : 'middle';
      return {
        x, y, angle_deg: round1(angle), radius: round1(r),
        rows_from_portal: rowsFromPortal,
        rows_from_front: Math.max(1, rowIdx) - 1,
        seat_side_from_portal: seatSide,
        confidence: 'heuristic_interpolation'
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
            detail: {
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
              fa: `در راهروی ${levelName(node.level, 'fa')} به سمت ${zoneName(section.zone, 'fa')} حرکت کنید`,
              en: `Walk along the ${levelName(node.level, 'en')} concourse towards the ${zoneName(section.zone, 'en')} side`,
              tr: `${levelName(node.level, 'tr')} koridorunda ${zoneName(section.zone, 'tr')} tarafına yürüyün`
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

        if (node.type === 'portal') {
          push({
            type: 'portal', icon: '🚪', level: node.level, node_ids: [node.id],
            from: from && { x: from.x, y: from.y }, to: { x: node.x, y: node.y },
            title: {
              fa: `از ورودی سکشن ${section.section} وارد شوید`,
              en: `Enter through the section ${section.section} portal`,
              tr: `${section.section} blok girişinden girin`
            },
            detail: {
              fa: `ورودی سکشن در سمت ${zoneName(section.zone, 'fa')} سالن، ${levelName(section.level, 'fa')}.`,
              en: `Portal on the ${zoneName(section.zone, 'en')} side, ${levelName(section.level, 'en')}.`,
              tr: `${zoneName(section.zone, 'tr')} tarafı, ${levelName(section.level, 'tr')}.`
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

      if (rowLabel) {
        push({
          type: 'row', icon: '🪑', level: section.level, node_ids: [],
          from: { x: portal.x, y: portal.y }, to: { x: seatPos.x, y: seatPos.y },
          title: { fa: `به ردیف ${rowLabel} بروید`, en: `Go to row ${rowLabel}`, tr: `${rowLabel} sırasına gidin` },
          detail: {
            fa: seatPos.rows_from_portal === 0
              ? 'ردیف شما بالاترین ردیف، درست کنار ورودی سکشن است.'
              : `از ورودی سکشن حدود ${seatPos.rows_from_portal} ردیف به سمت زمین پایین بروید (ردیف ${rowLabel} ${seatPos.rows_from_front + 1}مین ردیف از جلو است).`,
            en: seatPos.rows_from_portal === 0
              ? 'Your row is the top row, right by the portal.'
              : `Walk down about ${seatPos.rows_from_portal} rows from the portal (row ${rowLabel} is row #${seatPos.rows_from_front + 1} from the front).`,
            tr: seatPos.rows_from_portal === 0
              ? 'Sıranız girişin hemen yanında, en üst sıra.'
              : `Girişten yaklaşık ${seatPos.rows_from_portal} sıra aşağı inin.`
          },
          distance_m: Math.round(seatPos.rows_from_portal * 0.85)
        });
      }
      push({
        type: 'seat', icon: '💺', level: section.level, node_ids: [],
        from: { x: portal.x, y: portal.y }, to: { x: seatPos.x, y: seatPos.y },
        title: {
          fa: seatLabel ? `صندلی ${seatLabel} – رسیدید!` : 'به جای خود برسید',
          en: seatLabel ? `Seat ${seatLabel} – you have arrived` : 'Arrive at your seat',
          tr: seatLabel ? `Koltuk ${seatLabel} – vardınız` : 'Koltuğunuza ulaşın'
        },
        detail: {
          fa: seatLabel ? `صندلی ${seatLabel} تقریباً ${sideFa} ردیف (نسبت به ورودی سکشن) است. شماره‌های روی صندلی را چک کنید.` : '',
          en: seatLabel ? `Seat ${seatLabel} is roughly ${sideEn} of the row (facing the floor from the portal). Check the seat numbers.` : '',
          tr: seatLabel ? `Koltuk ${seatLabel} yaklaşık ${sideTr}. Koltuk numaralarını kontrol edin.` : ''
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
      const distance = haversineMeters(origin, gateLL);
      const brg = bearingDeg(origin, gateLL);
      const dir = compass(brg);
      const originMap = distance <= 2500 ? latLonToMap(origin) : null;
      if (distance > 2500) {
        warnings.push({
          code: 'ORIGIN_FAR',
          fa: 'موقعیت شما بیش از ۲.۵ کیلومتر از سالن فاصله دارد؛ مسیر پیاده روی نقشه داخلی رسم نمی‌شود، از لینک مسیریابی استفاده کنید.',
          en: 'You are more than 2.5 km from the venue; the walking leg is not drawn on the indoor map – use the directions link.'
        });
      }
      const url = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lon}&destination=${gate.lat},${gate.lon}&travelmode=walking`;
      return {
        origin: { lat: origin.lat, lon: origin.lon, accuracy_m: origin.accuracy_m || null, map_xy: originMap },
        gate: { id: gate.id, lat: gate.lat, lon: gate.lon, map_xy: { x: gate.x, y: gate.y }, geo_confidence: gate.geo_confidence },
        distance_m: Math.round(distance),
        bearing_deg: Math.round(brg),
        compass: dir,
        compass_fa: COMPASS_FA[dir],
        duration_min: Math.round(distance / walking.speed_m_per_s / 60),
        polyline: [[origin.lat, origin.lon], [gate.lat, gate.lon]],
        directions_url: url,
        note: {
          fa: 'خط مستقیم است؛ برای مسیر واقعی خیابان‌ها از لینک مسیریابی استفاده کنید. مختصات ورودی تخمینی است.',
          en: 'Straight-line only; use the directions link for the real street route. Gate coordinates are approximate.'
        }
      };
    }

    // ----- public API --------------------------------------------------------

    function route(req = {}) {
      const warnings = [];
      const sectionKey = String(req.section == null ? '' : req.section).trim();
      const section = sections.get(sectionKey);
      if (!section) {
        const err = new Error(`Unknown section "${sectionKey}". Valid sections: 101-120, 201-220, 401-422.`);
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
            fa: `پیاده تا ${gate.display.tr}: حدود ${outdoor.distance_m} متر به سمت ${outdoor.compass_fa}`,
            en: `Walk to ${gate.display.en}: about ${outdoor.distance_m} m towards ${outdoor.compass}`,
            tr: `${gate.display.tr}’ne yürüyün: yaklaşık ${outdoor.distance_m} m`
          },
          detail: { fa: outdoor.note.fa, en: outdoor.note.en, tr: '' },
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
          id: gate.id, display: gate.display, node: gate.node,
          source: gateInfo.source, source_label: gateInfo.source_label,
          map_xy: { x: gate.x, y: gate.y }, lat: gate.lat, lon: gate.lon,
          verified_label: gate.verified_label, geo_confidence: gate.geo_confidence
        },
        destination: {
          section: section.section,
          level: section.level,
          level_name: graph.levels[section.level].name,
          zone: section.zone,
          portal: { node: section.portal.node, x: section.portal.x, y: section.portal.y },
          seat: { row: rowInfo ? rowInfo.label : null, seat: seatInfo ? seatInfo.label : null, ...seatPos }
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
          fa: 'مختصات از روی نقشه عمومی صندلی‌ها تخمین زده شده و راهروها، پله‌ها و ورودی‌ها مدل‌سازی شده‌اند، نه نقشه‌برداری‌شده.',
          en: graph.important_warning
        }
      };
    }

    function listSections() {
      return graph.sections.map((s) => ({
        section: s.section, level: s.level, zone: s.zone, known_ticket_gate_label: s.known_ticket_gate_label
      }));
    }

    function listGates() {
      return graph.gates.map((g) => ({
        id: g.id, display: g.display, aliases: g.aliases, lat: g.lat, lon: g.lon, verified_label: g.verified_label
      }));
    }

    return { route, listSections, listGates, normalizeGate, mapToLatLon, latLonToMap, dijkstra, graph };
  }

  return { createRouter, parseRow, parseSeat, haversineMeters, bearingDeg };
});
