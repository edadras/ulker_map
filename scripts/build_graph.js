#!/usr/bin/env node
/**
 * Builds the indoor navigation graph for Ülker Sports and Event Hall.
 *
 * Input (authoritative):
 *   data/seatmap.json  – seat map exported from the ticketing system. Every seat
 *                        carries its section, row, number and canvas x/y
 *                        (6000×5000 canvas, origin top-left, y grows downward,
 *                        stage rectangle at the top centre).
 *
 * Output:
 *   data/ulker_arena_navigation_graph.json  – graph consumed by src/router.js
 *   web/graph.data.js                       – same graph as a browser global
 *
 * What is REAL (from the seat map): sections, rows, seat numbers, seat
 * coordinates, the stage footprint, the shape and orientation of every stand.
 * What is MODELLED (derived from that geometry, not surveyed): section portals
 * (assumed at the back/top of each stand), concourse loops, stair/elevator
 * cores, gate → security → ticket → hall chains, the metre scale and the
 * compass orientation. See README.md ("Data confidence").
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SEATMAP_PATH = path.join(ROOT, 'data', 'seatmap.json');
const GRAPH_JSON_PATH = path.join(ROOT, 'data', 'ulker_arena_navigation_graph.json');
const GRAPH_JS_PATH = path.join(ROOT, 'web', 'graph.data.js');

const seatmap = JSON.parse(fs.readFileSync(SEATMAP_PATH, 'utf8'));

// ---------------------------------------------------------------------------
// Configuration – everything that is an assumption lives here
// ---------------------------------------------------------------------------

const VENUE = {
  id: 'ulker_sports_arena',
  name: 'Ülker Spor ve Etkinlik Salonu',
  city: 'Istanbul',
  country: 'Türkiye'
};

/**
 * Metre scale of the ticketing canvas. Derived from the seat pitch in the
 * export (30 canvas units between seats, 40 between rows): 30 u ≈ 0.54 m seat
 * width and 40 u ≈ 0.72 m row depth, which also gives a ≈107 m wide bowl.
 * Approximate – verify against an architectural plan.
 */
const METERS_PER_UNIT = 0.018;

/**
 * Compass orientation. The organiser's annotated satellite screenshots put the
 * 400-level entrance on the north-west of the round building, the VIP
 * (floor) entrance on the east and the 100/200 entrance on the south-east.
 * A floor entered from its rear and an upper-level entrance beside the stage
 * end fit the canvas only when canvas-up (the stage) points WEST, i.e. the
 * bearing of canvas-up is 270°: canvas-right = north, canvas-down = east.
 * Confirm on site; change this one constant to rotate everything.
 */
const MAP_NORTH_BEARING_DEG = 270;

/**
 * Building centre: the Google Maps "Ülker Sports Arena" marker, back-computed
 * from the organiser's three entrance pins (their satellite screenshots).
 */
const GEO = {
  venue_lat: 40.992923,
  venue_lon: 29.104806,
  meters_per_unit: METERS_PER_UNIT,
  map_north_bearing_deg: MAP_NORTH_BEARING_DEG,
  confidence: 'entrances_from_organiser_pins',
  note: 'Entrance lat/lon are the organiser\'s GPS pins (±5 m). Building centre derived from those pins. The ticketing canvas is a schematic, so the metre scale is approximate and the projection of GPS positions onto the canvas is indicative only.'
};

/**
 * Real entrances (organiser data, September 2026). Each entrance serves given
 * levels; `approach` is the walking path from the street traced from the
 * organiser's annotated screenshots (street → entrance, entrance excluded).
 * BATI/DOĞU are the labels seen on tickets; their mapping onto the 400 and
 * 100–200 entrances is inferred (west ≈ north-west, east ≈ south-east) – confirm.
 */
const GATES = [
  {
    id: '400', serves_levels: [4], lat: 40.993405, lon: 29.104291,
    display: { tr: '400 Girişi (Batı)', en: '400-level entrance (BATI, north-west)', fa: 'ورودی ۴۰۰ (غربی، شمال‌غرب سالن)' },
    short: { tr: '400 Girişi', en: '400 entrance', fa: 'ورودی ۴۰۰' },
    aliases: ['400', '400 GIRISI', '400 KAPI', 'KAT 4', 'BATI', 'BATİ', 'BATI GIRISI', 'WEST', 'W'],
    compass_label: 'BATI', compass_label_assumed: true, verified_location: true,
    approach: {
      color: 'red',
      start_description: { fa: 'از بلوار Ihlamur (ایستگاه اتوبوس سر خیابان Nilüfer)، دور ساختمان کناری از سمت شمال', en: 'From Ihlamur Blv. (bus stop at Nilüfer Sk.), around the annex building on the north side', tr: 'Ihlamur Blv. (Nilüfer Sk. durağı) üzerinden, ek binanın kuzeyinden dolaşarak' },
      waypoints: [[40.993132, 29.106136], [40.993116, 29.10574], [40.993282, 29.105497], [40.993631, 29.105299], [40.993997, 29.105101], [40.99403, 29.104815], [40.993897, 29.104573], [40.993598, 29.104418]]
    }
  },
  {
    id: '100-200', serves_levels: [1, 2], lat: 40.992639, lon: 29.105409,
    display: { tr: '100–200 Girişi (Doğu)', en: '100/200-level entrance (DOĞU, south-east)', fa: 'ورودی ۱۰۰ و ۲۰۰ (شرقی، جنوب‌شرق سالن)' },
    short: { tr: '100–200 Girişi', en: '100–200 entrance', fa: 'ورودی ۱۰۰–۲۰۰' },
    aliases: ['100-200', '100 200', '100', '200', '100 GIRISI', '200 GIRISI', 'KAT 1', 'KAT 2', 'DOĞU', 'DOGU', 'DOĞU GIRISI', 'DOGU GIRISI', 'EAST', 'E'],
    compass_label: 'DOĞU', compass_label_assumed: true, verified_location: true,
    approach: {
      color: 'blue',
      start_description: { fa: 'از پیاده‌روی بلوار Ihlamur به سمت جنوب، سپس از انتهای جنوبی محوطه به سمت شمال تا ورودی', en: 'Along the Ihlamur Blv. sidewalk southwards, then into the plaza from its south end and north to the entrance', tr: 'Ihlamur Blv. kaldırımından güneye, sonra meydanın güney ucundan kuzeye girişe' },
      waypoints: [[40.993144, 29.106082], [40.992344, 29.105499], [40.992398, 29.105344], [40.992515, 29.105332], [40.992632, 29.105392]]
    }
  },
  {
    id: 'VIP', serves_levels: ['floor'], lat: 40.993036, lon: 29.105473,
    display: { tr: 'VIP Girişi (Doğu)', en: 'VIP floor entrance (east)', fa: 'ورودی VIP (شرق سالن)' },
    short: { tr: 'VIP Girişi', en: 'VIP entrance', fa: 'ورودی VIP' },
    aliases: ['VIP', 'VIP GIRISI', 'VIP KAPI', 'ZEMIN', 'FLOOR', 'SAHNE ONU'],
    compass_label: null, compass_label_assumed: false, verified_location: true,
    approach: {
      color: 'yellow',
      start_description: { fa: 'از بلوار Ihlamur، از جنوب میدان کوچک خیابان Nilüfer به سمت غرب', en: 'From Ihlamur Blv., past the south side of the small Nilüfer Sk. roundabout, westwards', tr: 'Ihlamur Blv. üzerinden, Nilüfer Sk. kavşağının güneyinden batıya' },
      waypoints: [[40.993162, 29.10614], [40.993046, 29.10603], [40.992963, 29.105898], [40.99288, 29.105766], [40.992913, 29.105612]]
    }
  }
];

/**
 * Interior section entrances (vomitories) and the signs above them. By default
 * every section has its own entrance signed with the section number. Inside
 * the arena one signed entrance often serves two neighbouring sections (the
 * sign above it reads e.g. "103 – 104"): list those here and the sections
 * share a single portal placed between them. Fill this from the signage
 * inside the arena (photos of the signs are enough).
 */
const SHARED_PORTALS = [
  // { sections: ['103', '104'], sign: '103 – 104' },
];

/** Gate labels historically seen on tickets for a section (informational; the level → entrance table drives routing). */
const KNOWN_TICKET_GATE_LABELS = { 103: 'DOĞU', 410: 'BATI', 414: 'BATI' };

/** Vertical circulation cores. One at each entrance that serves upper levels (with elevators) plus two stairs-only cores. */
const CORES = [
  { id: 'E400', at_gate: '400', display: { fa: 'پله/آسانسور ورودی ۴۰۰', en: 'Stairs/elevator at the 400 entrance', tr: '400 girişi merdiven/asansör' }, modes: ['stairs', 'escalator', 'elevator'] },
  { id: 'E100', at_gate: '100-200', display: { fa: 'پله/آسانسور ورودی ۱۰۰–۲۰۰', en: 'Stairs/elevator at the 100–200 entrance', tr: '100–200 girişi merdiven/asansör' }, modes: ['stairs', 'escalator', 'elevator'] },
  { id: 'S', side: 'left', display: { fa: 'پله سمت جنوب سالن (سمت چپ رو به صحنه)', en: 'South stairs (left side facing the stage)', tr: 'Güney merdiveni (sahneye göre sol)' }, modes: ['stairs'] },
  { id: 'W', side: 'front', display: { fa: 'پله پشت صحنه (غرب)', en: 'Stage-end stairs (west)', tr: 'Sahne arkası merdiveni (batı)' }, modes: ['stairs'] }
];

const LEVELS = [1, 2, 4];
const LEVEL_NAMES = {
  1: { fa: 'طبقه ۱ (سکشن‌های ۱۰۰ و VIP)', en: 'Level 1 (100s and VIP floor)', tr: 'Kat 1 (100’ler ve VIP)' },
  2: { fa: 'طبقه ۲ (سکشن‌های ۲۰۰)', en: 'Level 2 (200s)', tr: 'Kat 2 (200’ler)' },
  4: { fa: 'طبقه ۴ (سکشن‌های ۴۰۰)', en: 'Level 4 (400s)', tr: 'Kat 4 (400’ler)' }
};

/** Modelled distances, in metres, converted to canvas units below. */
const MODEL_M = {
  portal_behind_last_row: 0.9,   // portal sits just behind the last row
  corridor_behind_portal: 1.8,   // concourse centre line behind the portal
  top_corridor_clearance: 2.2,   // concourse passing behind the stage end
  core_outside_corridor: 2.7,    // stair core outside the level-4 concourse
  gate_outside_bowl: 7.0,        // entrance outside the level-4 concourse (building line)
  gate_chain_step: 1.5,          // gate → security → ticket → hall spacing
  core_beside_lobby: 2.5,        // entrance stair core next to the entrance hall
  floor_tunnel_exit: 3.5,        // VIP floor portal behind the last VIP row
  vertical_1_2: 12,              // stair/escalator run level 1 → 2
  vertical_2_4: 25,              // stair/escalator run level 2 → 4 (passes 3)
  behind_stage_penalty: 8,       // discourages the concourse behind the stage
  security_penalty: 10,
  ticket_penalty: 5
};
const U = (m) => m / METERS_PER_UNIT; // metres → canvas units
const MODEL = Object.fromEntries(Object.entries(MODEL_M).map(([k, v]) => [k, U(v)]));

const STATUS_CODE = { sold: 's', reserved: 'r', free: 'f', payment_in_progress: 'p' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const deg2rad = (d) => (d * Math.PI) / 180;
const rad2deg = (r) => (r * 180) / Math.PI;
const round1 = (v) => Math.round(v * 10) / 10;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const add = (p, v, k = 1) => ({ x: round1(p.x + v.x * k), y: round1(p.y + v.y * k) });
const norm = (v) => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; };
const mean = (pts) => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });
const angleAround = (c, p) => { let a = rad2deg(Math.atan2(p.y - c.y, p.x - c.x)); if (a < 0) a += 360; return a; };

/** Andrew monotone chain convex hull. */
function convexHull(points) {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

function expandPolygon(poly, margin) {
  const c = mean(poly);
  return poly.map((p) => add(p, norm({ x: p.x - c.x, y: p.y - c.y }), margin));
}

const sectionSortKey = (name) => (/^\d+$/.test(name) ? [0, parseInt(name, 10)] : [1, name]);
const cmpSection = (a, b) => { const ka = sectionSortKey(a), kb = sectionSortKey(b); return ka[0] - kb[0] || (ka[0] === 0 ? ka[1] - kb[1] : String(ka[1]).localeCompare(String(kb[1]))); };
const rowSortKey = (r) => [r.length, r];
const cmpRow = (a, b) => a.length - b.length || a.localeCompare(b);

const nodes = [];
const nodeIndex = new Map();
const edges = [];

function addNode(node) {
  if (nodeIndex.has(node.id)) throw new Error(`duplicate node ${node.id}`);
  node.x = round1(node.x); node.y = round1(node.y);
  nodeIndex.set(node.id, node);
  nodes.push(node);
  return node;
}

function addEdge(aId, bId, props = {}) {
  const a = nodeIndex.get(aId);
  const b = nodeIndex.get(bId);
  if (!a || !b) throw new Error(`edge references unknown node ${aId} / ${bId}`);
  const length = props.length_units != null ? props.length_units : dist(a, b);
  const penalty = props.penalty_units || 0;
  edges.push({
    from: aId,
    to: bId,
    type: props.type || 'walk',
    length_units: round1(length),
    cost: round1(length + penalty),
    bidirectional: props.bidirectional !== false,
    ...(props.modes ? { modes: props.modes } : {}),
    ...(props.level_from != null ? { level_from: props.level_from, level_to: props.level_to } : {}),
    ...(props.behind_stage ? { behind_stage: true } : {})
  });
}

function projectToLatLon(p, center) {
  // canvas-up has compass bearing MAP_NORTH_BEARING_DEG
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos(deg2rad(GEO.venue_lat));
  const east = (p.x - center.x) * METERS_PER_UNIT;
  const north = -(p.y - center.y) * METERS_PER_UNIT;
  const brg = deg2rad(MAP_NORTH_BEARING_DEG);
  const e = east * Math.cos(brg) + north * Math.sin(brg);
  const n = -east * Math.sin(brg) + north * Math.cos(brg);
  return {
    lat: +(GEO.venue_lat + n / metersPerDegLat).toFixed(6),
    lon: +(GEO.venue_lon + e / metersPerDegLon).toFixed(6)
  };
}

// ---------------------------------------------------------------------------
// 1. Read the seat map → sections, rows, seats
// ---------------------------------------------------------------------------

const stageShape = (seatmap.shapes || []).find((s) => /stage|sahne/i.test(s.text || ''));
if (!stageShape) throw new Error('seatmap.json: no "Stage" shape found');
const STAGE = { x: round1(stageShape.x), y: round1(stageShape.y), width: round1(stageShape.width), height: round1(stageShape.height), label: stageShape.text };
const STAGE_CENTER = { x: STAGE.x + STAGE.width / 2, y: STAGE.y + STAGE.height / 2 };

function levelOfSection(name) {
  if (/^1\d\d$/.test(name)) return 1;
  if (/^2\d\d$/.test(name)) return 2;
  if (/^4\d\d$/.test(name)) return 4;
  if (/^vip/i.test(name)) return 1; // floor seating, entered from the ground level
  throw new Error(`cannot infer level for section "${name}"`);
}

const sectionMap = new Map();
for (const s of seatmap.seats) {
  const name = String(s.sectionName).trim();
  if (!sectionMap.has(name)) sectionMap.set(name, { section: name, level: levelOfSection(name), floor: /^vip/i.test(name), seats: [], rows: new Map() });
  const sec = sectionMap.get(name);
  const row = String(s.rowName).trim().toUpperCase();
  const seat = { number: s.number, x: s.x, y: s.y, status: s.status, price: s.price, id: s.id, row };
  sec.seats.push(seat);
  if (!sec.rows.has(row)) sec.rows.set(row, []);
  sec.rows.get(row).push(seat);
}
const sectionNames = [...sectionMap.keys()].sort(cmpSection);

// Seating-bowl centre = centre of the bounding box of the level-1 stands (VIP floor excluded).
const bowlSeats = seatmap.seats.filter((s) => levelOfSection(String(s.sectionName)) === 1 && !/^vip/i.test(String(s.sectionName)));
const bb = { minX: Math.min(...bowlSeats.map((s) => s.x)), maxX: Math.max(...bowlSeats.map((s) => s.x)), minY: Math.min(...bowlSeats.map((s) => s.y)), maxY: Math.max(...bowlSeats.map((s) => s.y)) };
const CENTER = { x: round1((bb.minX + bb.maxX) / 2), y: round1((bb.minY + bb.maxY) / 2) };

/** Zone of a stand relative to the stage, from the bowl centre (screen angle: 0 = right, 90 = down). */
function zoneOf(angle) {
  const bins = [['right', 0], ['rear_right', 45], ['rear', 90], ['rear_left', 135], ['left', 180], ['front_left', 225], ['front', 270], ['front_right', 315]];
  let best = bins[0];
  for (const b of bins) {
    const d = Math.min(Math.abs(angle - b[1]), 360 - Math.abs(angle - b[1]));
    if (d < Math.min(Math.abs(angle - best[1]), 360 - Math.abs(angle - best[1]))) best = b;
  }
  return best[0];
}

// ---------------------------------------------------------------------------
// 2. Per-section geometry: centroid, outward direction, portal, corridor point
// ---------------------------------------------------------------------------

for (const sec of sectionMap.values()) {
  sec.centroid = mean(sec.seats);
  sec.outline = expandPolygon(convexHull(sec.seats.map((s) => ({ x: s.x, y: s.y }))), 22).map((p) => ({ x: round1(p.x), y: round1(p.y) }));

  if (sec.floor) {
    // VIP floor: rows run away from the stage; the floor is entered from the rear (opposite the stage).
    sec.outward = { x: 0, y: 1 };
  } else {
    // Rows are straight lines; "outward" (towards the concourse) is perpendicular to the longest row,
    // pointing away from the bowl centre. Robust against partial rows.
    const radial = norm({ x: sec.centroid.x - CENTER.x, y: sec.centroid.y - CENTER.y });
    const longest = [...sec.rows.values()].sort((a, b) => b.length - a.length)[0].slice().sort((a, b) => a.number - b.number);
    const first = longest[0], last = longest[longest.length - 1];
    const along = norm({ x: last.x - first.x, y: last.y - first.y });
    let perp = { x: -along.y, y: along.x };
    if (perp.x * radial.x + perp.y * radial.y < 0) perp = { x: -perp.x, y: -perp.y };
    sec.outward = longest.length > 1 ? perp : radial;
  }
  const projOut = (p) => (p.x - sec.centroid.x) * sec.outward.x + (p.y - sec.centroid.y) * sec.outward.y;
  const outerEdge = Math.max(...sec.seats.map(projOut));
  const portalOffset = sec.floor ? MODEL.floor_tunnel_exit : MODEL.portal_behind_last_row;
  sec.portal = add(sec.centroid, sec.outward, outerEdge + portalOffset);
  sec.corridor = add(sec.portal, sec.outward, MODEL.corridor_behind_portal);
  sec.angle = angleAround(CENTER, sec.portal);
  sec.zone = sec.floor ? 'floor' : zoneOf(sec.angle);

  // Row order by projection on the outward axis: front row (closest to the floor/stage) first, back row (at the portal) last.
  const rowsOrdered = [...sec.rows.entries()]
    .map(([row, seats]) => ({ row, seats, p: projOut(mean(seats)) }))
    .sort((a, b) => a.p - b.p);
  sec.rowsOrdered = rowsOrdered.map((r) => r.row);
  sec.rowsOrdered.forEach((row, i) => { sec.rows.get(row).from_front = i; });
}

// ---------------------------------------------------------------------------
// 3. Nodes: portals, corridor loops per level
// ---------------------------------------------------------------------------

const levelInfo = {};
const corridorNodesByLevel = {};
const sectionsOut = [];
let prevTop = Infinity;

/** Group sections into signed portals: shared portals from SHARED_PORTALS, one own portal for every other section. */
function portalGroupsForLevel(secs) {
  const taken = new Set();
  const groups = [];
  for (const sp of SHARED_PORTALS) {
    const members = sp.sections.map(String).map((n) => secs.find((s) => s.section === n)).filter(Boolean);
    if (!members.length) continue;
    if (members.length !== sp.sections.length) throw new Error(`SHARED_PORTALS: sections ${sp.sections.join(',')} are not all on the same level / not found`);
    members.forEach((m) => taken.add(m.section));
    const portal = mean(members.map((m) => m.portal));
    const corridor = mean(members.map((m) => m.corridor));
    groups.push({ sign: sp.sign || members.map((m) => m.section).join(' – '), slug: members.map((m) => m.section).join('_'), sections: members, portal: { x: round1(portal.x), y: round1(portal.y) }, corridor: { x: round1(corridor.x), y: round1(corridor.y) }, shared: true });
  }
  for (const s of secs) if (!taken.has(s.section)) groups.push({ sign: s.section, slug: s.section, sections: [s], portal: s.portal, corridor: s.corridor, shared: false });
  for (const g of groups) { g.angle = angleAround(CENTER, g.portal); g.zone = g.sections[0].zone; }
  return groups.sort((a, b) => a.angle - b.angle);
}

const portalsOut = [];

for (const level of LEVELS) {
  const secs = sectionNames.map((n) => sectionMap.get(n)).filter((s) => s.level === level && !s.floor).sort((a, b) => a.angle - b.angle);
  const minSeatY = Math.min(...secs.flatMap((s) => s.seats.map((q) => q.y)));
  let yTop = minSeatY - MODEL.top_corridor_clearance;
  if (yTop > prevTop - MODEL.top_corridor_clearance / 2) yTop = prevTop - MODEL.top_corridor_clearance / 2;
  prevTop = yTop;

  corridorNodesByLevel[level] = [];
  for (const g of portalGroupsForLevel(secs)) {
    const portalId = `L${level}_SECTION_${g.slug}_PORTAL`;
    const corridorId = `L${level}_CORRIDOR_${g.slug}`;
    addNode({
      id: portalId, type: 'portal', level, section: g.sign, sections: g.sections.map((s) => s.section), sign: g.sign, zone: g.zone, x: g.portal.x, y: g.portal.y,
      label: { fa: `ورودی سکشن ${g.sign}`, en: `Section ${g.sign} portal`, tr: `${g.sign} Blok girişi` },
      confidence: g.shared ? 'shared_portal_between_sections' : 'modelled_behind_last_row'
    });
    addNode({
      id: corridorId, type: 'corridor', level, section: g.sign, zone: g.zone, x: g.corridor.x, y: g.corridor.y,
      label: { fa: `راهروی طبقه ${level} مقابل ${g.sign}`, en: `L${level} concourse at ${g.sign}`, tr: `Kat ${level} koridor ${g.sign}` },
      confidence: 'modelled_concourse'
    });
    addEdge(corridorId, portalId, { type: 'portal_door' });
    for (const s of g.sections) { s.portalId = portalId; s.corridorId = corridorId; s.portalSign = g.sign; s.portalShared = g.shared; s.portalPoint = g.portal; }
    corridorNodesByLevel[level].push({ id: corridorId, angle: g.angle, x: g.corridor.x, y: g.corridor.y, section: g.sign });
    portalsOut.push({ id: portalId, level, sign: g.sign, sections: g.sections.map((s) => s.section), shared: g.shared, x: g.portal.x, y: g.portal.y, corridor_node: corridorId });
  }

  // Close the loop behind the stage: the largest angular gap between neighbouring stands is the stage end.
  const ring = corridorNodesByLevel[level];
  let gapIdx = 0, gapSize = -1;
  ring.forEach((c, i) => {
    const next = ring[(i + 1) % ring.length];
    const gap = ((next.angle - c.angle) + 360) % 360;
    if (gap > gapSize) { gapSize = gap; gapIdx = i; }
  });
  const before = ring[gapIdx], after = ring[(gapIdx + 1) % ring.length];
  const cornerA = addNode({ id: `L${level}_CORRIDOR_STAGE_END_A`, type: 'corridor', level, section: null, zone: 'front', x: before.x, y: yTop, behind_stage: true,
    label: { fa: `راهروی طبقه ${level} پشت صحنه`, en: `L${level} concourse behind the stage`, tr: `Kat ${level} sahne arkası koridor` }, confidence: 'modelled_concourse' });
  const cornerB = addNode({ id: `L${level}_CORRIDOR_STAGE_END_B`, type: 'corridor', level, section: null, zone: 'front', x: after.x, y: yTop, behind_stage: true,
    label: { fa: `راهروی طبقه ${level} پشت صحنه`, en: `L${level} concourse behind the stage`, tr: `Kat ${level} sahne arkası koridor` }, confidence: 'modelled_concourse' });
  const cornerMid = addNode({ id: `L${level}_CORRIDOR_STAGE_END_MID`, type: 'corridor', level, section: null, zone: 'front', x: CENTER.x, y: yTop, behind_stage: true,
    label: { fa: `راهروی طبقه ${level} پشت صحنه (وسط)`, en: `L${level} concourse behind the stage (middle)`, tr: `Kat ${level} sahne arkası koridor (orta)` }, confidence: 'modelled_concourse' });
  const loop = [...ring.slice(gapIdx + 1), ...ring.slice(0, gapIdx + 1)].map((c) => c.id); // starts right after the gap
  loop.push(cornerA.id, cornerMid.id, cornerB.id);
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    const behind = a.includes('STAGE_END') || b.includes('STAGE_END');
    addEdge(a, b, { type: 'concourse', behind_stage: behind, penalty_units: behind ? MODEL.behind_stage_penalty / 4 : 0 });
  }
  for (const c of [cornerA, cornerMid, cornerB]) corridorNodesByLevel[level].push({ id: c.id, angle: angleAround(CENTER, c), x: c.x, y: c.y, stage_end: true });

  levelInfo[level] = {
    name: LEVEL_NAMES[level],
    corridor_loop: loop,
    top_corridor_y: round1(yTop),
    section_count: secs.length + (level === 1 ? sectionNames.filter((n) => sectionMap.get(n).floor).length : 0),
    seat_count: sectionNames.filter((n) => sectionMap.get(n).level === level).reduce((a, n) => a + sectionMap.get(n).seats.length, 0)
  };
}

function nearestCorridorNodes(level, p, count = 2, includeStageEnd = false) {
  return [...corridorNodesByLevel[level]].filter((c) => includeStageEnd || !c.stage_end).sort((a, b) => dist(a, p) - dist(b, p)).slice(0, count);
}

// VIP floor: portal at the rear of the floor, reached through a tunnel under the rear stands from the level-1 concourse.
for (const s of sectionNames.map((n) => sectionMap.get(n)).filter((x) => x.floor)) {
  const portalId = `L1_SECTION_${s.section}_PORTAL`;
  const tunnelId = `L1_FLOOR_TUNNEL_${s.section}`;
  addNode({
    id: portalId, type: 'portal', level: 1, section: s.section, zone: 'floor', floor: true, x: s.portal.x, y: s.portal.y,
    label: { fa: `ورودی محوطه ${s.section} (کف سالن)`, en: `${s.section} floor entrance`, tr: `${s.section} zemin girişi` },
    confidence: 'modelled_floor_entrance'
  });
  addNode({
    id: tunnelId, type: 'tunnel', level: 1, section: s.section, zone: 'floor', x: s.corridor.x, y: s.corridor.y,
    label: { fa: `تونل ورود به کف سالن (${s.section})`, en: `Floor tunnel to ${s.section}`, tr: `${s.section} zemin tüneli` },
    confidence: 'modelled_floor_tunnel'
  });
  addEdge(tunnelId, portalId, { type: 'portal_door' });
  for (const c of nearestCorridorNodes(1, s.corridor, 2)) addEdge(c.id, tunnelId, { type: 'tunnel' });
  s.portalId = portalId; s.corridorId = tunnelId; s.portalSign = s.section; s.portalShared = false; s.portalPoint = s.portal;
  portalsOut.push({ id: portalId, level: 1, sign: s.section, sections: [s.section], shared: false, floor: true, x: s.portal.x, y: s.portal.y, corridor_node: tunnelId });
}

for (const name of sectionNames) {
  const s = sectionMap.get(name);
  sectionsOut.push({
    section: s.section,
    level: s.level,
    floor: s.floor,
    zone: s.zone,
    angle_deg: round1(s.angle),
    centroid: { x: round1(s.centroid.x), y: round1(s.centroid.y) },
    outward: { x: +s.outward.x.toFixed(4), y: +s.outward.y.toFixed(4) },
    outline: s.outline,
    portal: { x: s.portalPoint.x, y: s.portalPoint.y, node: s.portalId, sign: s.portalSign, shared: s.portalShared },
    corridor_node: s.corridorId,
    rows: s.rowsOrdered,
    row_count: s.rows.size,
    seat_count: s.seats.length,
    known_ticket_gate_label: KNOWN_TICKET_GATE_LABELS[s.section] || null,
    confidence: { seats: 'exact_from_ticketing_seatmap', portal: s.floor ? 'modelled_floor_entrance' : 'modelled_behind_last_row' }
  });
}

// ---------------------------------------------------------------------------
// 4. Entrances (real GPS pins) → security → ticket control → entrance hall
// ---------------------------------------------------------------------------

const l4 = corridorNodesByLevel[4];
const corridorBounds = {
  minX: Math.min(...l4.map((c) => c.x)), maxX: Math.max(...l4.map((c) => c.x)),
  minY: Math.min(...l4.map((c) => c.y)), maxY: Math.max(...l4.map((c) => c.y))
};
/** Building centre on the canvas = centre of the level-4 bowl (the round building is centred on the bowl, not on the floor). */
const GEO_CENTER = { x: round1((corridorBounds.minX + corridorBounds.maxX) / 2), y: round1((corridorBounds.minY + corridorBounds.maxY) / 2) };

const metersPerDegLat = 111320;
const metersPerDegLon = 111320 * Math.cos(deg2rad(GEO.venue_lat));
/** Compass bearing (from the building centre) → screen angle on the canvas (0° = right, 90° = down). */
const bearingToScreen = (bearing) => ((bearing - MAP_NORTH_BEARING_DEG - 90) % 360 + 360) % 360;
const bearingOf = (lat, lon) => (rad2deg(Math.atan2((lon - GEO.venue_lon) * metersPerDegLon, (lat - GEO.venue_lat) * metersPerDegLat)) + 360) % 360;
function haversine(a, b) {
  const R = 6371000, dLat = deg2rad(b[0] - a[0]), dLon = deg2rad(b[1] - a[1]);
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(deg2rad(a[0])) * Math.cos(deg2rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(q));
}

const gatesOut = [];
const coresOut = [];
const gateGeometry = {};

for (const g of GATES) {
  const bearing = bearingOf(g.lat, g.lon);
  const theta = bearingToScreen(bearing);
  const dir = { x: Math.cos(deg2rad(theta)), y: Math.sin(deg2rad(theta)) };
  const inward = { x: -dir.x, y: -dir.y };
  // place the entrance just outside the level-4 concourse along that direction
  const reach = Math.max(...l4.map((c) => (c.x - GEO_CENTER.x) * dir.x + (c.y - GEO_CENTER.y) * dir.y));
  const gatePos = add(GEO_CENTER, dir, reach + MODEL.gate_outside_bowl);
  const secPos = add(gatePos, inward, MODEL.gate_chain_step);
  const ticketPos = add(gatePos, inward, MODEL.gate_chain_step * 2);
  const lobbyPos = add(gatePos, inward, MODEL.gate_chain_step * 3);
  const perp = { x: -dir.y, y: dir.x };
  const corePos = add(add(lobbyPos, inward, MODEL.core_beside_lobby * 0.4), perp, MODEL.core_beside_lobby);
  gateGeometry[g.id] = { dir, inward, gatePos, lobbyPos, corePos, bearing: round1(bearing), theta: round1(theta) };

  const gateId = `GATE_${g.id}`, secId = `SECURITY_${g.id}`, ticketId = `TICKET_${g.id}`, lobbyId = `LOBBY_${g.id}`;
  addNode({ id: gateId, type: 'gate', level: 0, gate: g.id, x: gatePos.x, y: gatePos.y, label: g.display, lat: g.lat, lon: g.lon, confidence: 'organiser_gps_pin' });
  addNode({ id: secId, type: 'security', level: 0, gate: g.id, x: secPos.x, y: secPos.y,
    label: { fa: `کنترل امنیتی ${g.short.fa}`, en: `Security check – ${g.short.en}`, tr: `Güvenlik kontrolü – ${g.short.tr}` }, confidence: 'modelled' });
  addNode({ id: ticketId, type: 'ticket_control', level: 0, gate: g.id, x: ticketPos.x, y: ticketPos.y,
    label: { fa: `کنترل بلیط ${g.short.fa}`, en: `Ticket check – ${g.short.en}`, tr: `Bilet kontrolü – ${g.short.tr}` }, confidence: 'modelled' });
  addNode({ id: lobbyId, type: 'lobby', level: 1, gate: g.id, x: lobbyPos.x, y: lobbyPos.y,
    label: { fa: `سالن ورودی ${g.short.fa}`, en: `Entrance hall – ${g.short.en}`, tr: `Giriş holü – ${g.short.tr}` }, confidence: 'modelled' });

  addEdge(gateId, secId, { type: 'checkpoint', penalty_units: MODEL.security_penalty });
  addEdge(secId, ticketId, { type: 'checkpoint', penalty_units: MODEL.ticket_penalty });
  addEdge(ticketId, lobbyId, { type: 'door' });
  for (const c of nearestCorridorNodes(1, lobbyPos, 2, true)) addEdge(lobbyId, c.id, { type: 'walk' });

  const approach = g.approach ? { ...g.approach, waypoints: g.approach.waypoints.map((w) => [+w[0].toFixed(6), +w[1].toFixed(6)]) } : null;
  if (approach) {
    const pts = [...approach.waypoints, [g.lat, g.lon]];
    approach.length_m = Math.round(pts.slice(1).reduce((a, p, i) => a + haversine(pts[i], p), 0));
    approach.source = 'traced from organiser-annotated satellite screenshots (±10 m)';
  }
  gatesOut.push({
    id: g.id, display: g.display, short: g.short, aliases: g.aliases, serves_levels: g.serves_levels,
    compass_label: g.compass_label, compass_label_assumed: g.compass_label_assumed, verified_location: g.verified_location,
    node: gateId, lobby_node: lobbyId, chain: [gateId, secId, ticketId, lobbyId],
    x: gatePos.x, y: gatePos.y, bearing_from_centre_deg: round1(bearing), screen_angle_deg: round1(theta),
    lat: g.lat, lon: g.lon, geo_confidence: 'organiser_gps_pin',
    approach
  });
}

// ---------------------------------------------------------------------------
// 5. Vertical cores (at the entrances + two stairs-only cores)
// ---------------------------------------------------------------------------

const sideCorePos = {
  left: { x: corridorBounds.minX - MODEL.core_outside_corridor, y: CENTER.y },
  front: { x: CENTER.x, y: corridorBounds.minY - MODEL.core_outside_corridor }
};

for (const core of CORES) {
  const pos = core.at_gate ? gateGeometry[core.at_gate].corePos : sideCorePos[core.side];
  const levelNodes = {};
  for (const level of LEVELS) {
    const id = `CORE_${core.id}_L${level}`;
    levelNodes[level] = id;
    addNode({
      id, type: 'core', level, core: core.id, x: pos.x, y: pos.y, modes: core.modes,
      label: { fa: `${core.display.fa} – طبقه ${level}`, en: `${core.display.en} – level ${level}`, tr: `${core.display.tr} – kat ${level}` },
      confidence: 'modelled_vertical_core'
    });
    // A core is a spur off the concourse (one access edge per level) so it can never act as a corridor shortcut.
    for (const c of nearestCorridorNodes(level, pos, 1, core.side === 'front' || !!core.at_gate)) addEdge(id, c.id, { type: 'core_access' });
  }
  if (core.at_gate) addEdge(`LOBBY_${core.at_gate}`, levelNodes[1], { type: 'walk' });
  addEdge(levelNodes[1], levelNodes[2], { type: 'vertical', modes: core.modes, length_units: MODEL.vertical_1_2, level_from: 1, level_to: 2 });
  addEdge(levelNodes[2], levelNodes[4], { type: 'vertical', modes: core.modes, length_units: MODEL.vertical_2_4, level_from: 2, level_to: 4 });
  coresOut.push({ id: core.id, at_gate: core.at_gate || null, side: core.side || null, display: core.display, modes: core.modes, x: round1(pos.x), y: round1(pos.y), nodes: levelNodes });
}

// ---------------------------------------------------------------------------
// 6. Compact seat index (row order front → back, seats sorted by number)
// ---------------------------------------------------------------------------

const seatIndex = {};
let seatTotal = 0;
for (const name of sectionNames) {
  const s = sectionMap.get(name);
  seatIndex[name] = {
    section: name,
    level: s.level,
    rows: s.rowsOrdered.map((row) => ({
      row,
      seats: [...s.rows.get(row)].sort((a, b) => a.number - b.number)
        .map((q) => [q.number, round1(q.x), round1(q.y), STATUS_CODE[q.status] || '?', q.price])
    }))
  };
  seatTotal += s.seats.length;
}

// ---------------------------------------------------------------------------
// 7. Emit
// ---------------------------------------------------------------------------

const allX = nodes.map((n) => n.x), allY = nodes.map((n) => n.y);
const bounds = { minX: Math.floor(Math.min(...allX)), maxX: Math.ceil(Math.max(...allX)), minY: Math.floor(Math.min(...allY)), maxY: Math.ceil(Math.max(...allY)) };

const graph = {
  venue: { ...VENUE, lat: GEO.venue_lat, lon: GEO.venue_lon },
  generated_at: new Date().toISOString(),
  generator: 'scripts/build_graph.js',
  source: { seatmap: 'data/seatmap.json', seats: seatTotal, sections: sectionNames.length },
  coordinate_system: {
    type: 'ticketing_canvas',
    width: seatmap.canvasSize.width,
    height: seatmap.canvasSize.height,
    origin: 'top_left',
    center: CENTER,
    geo_center: GEO_CENTER,
    stage: STAGE,
    stage_center: { x: round1(STAGE_CENTER.x), y: round1(STAGE_CENTER.y) },
    meters_per_unit: METERS_PER_UNIT,
    map_north_bearing_deg: MAP_NORTH_BEARING_DEG,
    note: 'Same canvas as the ticketing system seat map: every seat x/y in this graph is the seat map value.'
  },
  bounds,
  geo: GEO,
  gate_policy: {
    priority_1: 'Use KAPI/GATE printed on the ticket (entrance id, or BATI/DOĞU label); warn if it is not the entrance that serves the seat level.',
    priority_2: 'Use the event-specific section-to-gate mapping (data/events.json).',
    priority_3: 'Use the entrance that serves the seat level (organiser data: 400 → 400 entrance, 100/200 → 100–200 entrance, VIP → VIP entrance).',
    priority_4: 'Only use the geometrically nearest entrance as an internal fallback (warned).'
  },
  level_entrances: { 1: '100-200', 2: '100-200', 4: '400', floor: 'VIP' },
  important_warning: 'Seat, row and section positions come from the ticketing seat map and are exact in canvas units; entrance GPS positions and street approach paths come from the organiser. Portals, concourses, stairs, elevators and checkpoints are modelled from that geometry – they are not surveyed. The metre scale and the compass orientation of the canvas are estimates. Verify on-site or against an architectural plan before production use.',
  modelling_notes: [
    `Section portals are placed ${MODEL_M.portal_behind_last_row} m behind the last row of each stand, on the axis of the rows; concourse centre lines ${MODEL_M.corridor_behind_portal} m behind the portals.`,
    `Interior entrance signs: ${SHARED_PORTALS.length ? SHARED_PORTALS.map((p) => p.sign || p.sections.join(' – ')).join(', ') + ' are shared entrances; every other section has its own.' : 'one signed entrance per section (SHARED_PORTALS is empty – fill it from the signs inside the arena).'}`,
    'Each level has one concourse loop that follows the real stand geometry and closes behind the stage end (those segments carry a small penalty).',
    'The VIP floor is entered from the rear of the floor through a tunnel under the rear stands, from the level-1 concourse.',
    'Vertical cores: one at the 400 entrance and one at the 100–200 entrance (stairs + escalator + elevator) plus two stairs-only cores (south side, stage end).',
    'Entrances: 400 (north-west), 100–200 (south-east) and VIP floor (east) at the organiser\'s GPS pins; each has a security → ticket control → entrance hall chain. Their canvas position is the bearing from the building centre, just outside the level-4 concourse.',
    'Outdoor approach paths (street → entrance) are traced from the organiser\'s annotated satellite screenshots.',
    `Scale ${METERS_PER_UNIT} m per canvas unit (from the 30/40-unit seat/row pitch); canvas-up (stage) points to compass bearing ${MAP_NORTH_BEARING_DEG}° (west), inferred from the entrance positions.`,
    'Level 3 is not in the seat map and is treated as pass-through.'
  ],
  levels: levelInfo,
  gates: gatesOut,
  cores: coresOut,
  sections: sectionsOut,
  portals: portalsOut,
  seat_index: seatIndex,
  seat_status_codes: Object.fromEntries(Object.entries(STATUS_CODE).map(([k, v]) => [v, k])),
  nodes,
  edges,
  walking: { speed_m_per_s: 1.2, security_wait_min: 2, ticket_check_wait_min: 1 }
};

fs.writeFileSync(GRAPH_JSON_PATH, JSON.stringify(graph, null, 1) + '\n');
fs.mkdirSync(path.dirname(GRAPH_JS_PATH), { recursive: true });
fs.writeFileSync(GRAPH_JS_PATH, '/* Generated by scripts/build_graph.js – do not edit by hand. */\nwindow.ULKER_GRAPH = ' + JSON.stringify(graph) + ';\n');

console.log(`graph: ${nodes.length} nodes, ${edges.length} edges, ${sectionsOut.length} sections, ${seatTotal} seats, ${gatesOut.length} gates`);
console.log(`bowl centre ${CENTER.x},${CENTER.y}; building centre ${GEO_CENTER.x},${GEO_CENTER.y}; bounds ${JSON.stringify(bounds)}`);
for (const g of gatesOut) console.log(`  entrance ${g.id}: bearing ${g.bearing_from_centre_deg}° → canvas (${g.x}, ${g.y}), approach ${g.approach ? g.approach.length_m + ' m' : '-'}`);
console.log(`wrote ${path.relative(ROOT, GRAPH_JSON_PATH)} and ${path.relative(ROOT, GRAPH_JS_PATH)}`);
