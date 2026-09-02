#!/usr/bin/env node
/**
 * Builds the indoor navigation graph for Ülker Sports and Event Hall from the
 * section dataset (data/ulker_arena_navigation_dataset.json).
 *
 * Output:
 *   data/ulker_arena_navigation_graph.json  – graph consumed by src/router.js
 *   web/graph.data.js                       – same graph as a browser global
 *                                              (lets web/index.html work from file://)
 *
 * IMPORTANT: every coordinate produced here is derived from the public seating
 * plan geometry. Corridors, stair cores, lobbies and gates are modelled, not
 * surveyed. See README.md ("Data confidence").
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATASET_PATH = path.join(ROOT, 'data', 'ulker_arena_navigation_dataset.json');
const GRAPH_JSON_PATH = path.join(ROOT, 'data', 'ulker_arena_navigation_graph.json');
const GRAPH_JS_PATH = path.join(ROOT, 'web', 'graph.data.js');

const dataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8'));

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CENTER = { x: 500, y: 500 };

/** Real-world anchoring. Venue centre from Wikipedia; scale + orientation are
 *  assumptions (map "up" == geographic north) and must be verified on-site. */
const GEO = {
  venue_lat: 40.99306,
  venue_lon: 29.10444,
  meters_per_unit: 0.13,
  map_north_bearing_deg: 0,
  confidence: 'approximate_unverified',
  note: 'Venue centre from public sources. Scale/orientation assumed; gate lat/lon are projected from map units and must be verified on-site.'
};

/** Per-level seating model used to estimate a row/seat position inside a section. */
const LEVEL_MODEL = {
  1: {
    name: { fa: 'طبقه ۱ (سکشن‌های ۱۰۰)', en: 'Level 1 (100s)', tr: 'Kat 1 (100’ler)' },
    corridor_offset_units: 25,
    row_inner_r: 150, row_outer_r: 240,
    rows_estimate: 20, seats_per_row_estimate: 20
  },
  2: {
    name: { fa: 'طبقه ۲ (سکشن‌های ۲۰۰)', en: 'Level 2 (200s)', tr: 'Kat 2 (200’ler)' },
    corridor_offset_units: 25,
    row_inner_r: 290, row_outer_r: 340,
    rows_estimate: 12, seats_per_row_estimate: 22
  },
  4: {
    name: { fa: 'طبقه ۴ (سکشن‌های ۴۰۰)', en: 'Level 4 (400s)', tr: 'Kat 4 (400’ler)' },
    corridor_offset_units: 25,
    row_inner_r: 395, row_outer_r: 450,
    rows_estimate: 20, seats_per_row_estimate: 24
  }
};

/** External gates. Only labels that appear on real tickets (BATI / DOĞU) are
 *  modelled. Add more entries here when the organiser confirms other gates. */
const GATES = [
  {
    id: 'BATI', side: 'west', axis_deg: 180,
    display: { tr: 'Batı Girişi', en: 'West Gate (BATI)', fa: 'ورودی غربی' },
    aliases: ['BATI', 'BATİ', 'BATI GIRISI', 'WEST', 'W'],
    verified_label: true
  },
  {
    id: 'DOĞU', side: 'east', axis_deg: 0,
    display: { tr: 'Doğu Girişi', en: 'East Gate (DOĞU)', fa: 'ورودی شرقی' },
    aliases: ['DOĞU', 'DOGU', 'DOĞU GIRISI', 'DOGU GIRISI', 'EAST', 'E'],
    verified_label: true
  }
];

/** Vertical circulation cores (stairs / escalators / elevators). Angles are in
 *  screen space (0° = east, 90° = south because y grows downward). */
const CORES = [
  { id: 'W', angle_deg: 195, display: { fa: 'هسته پله غربی', en: 'West stair core', tr: 'Batı merdiven çekirdeği' }, modes: ['stairs', 'escalator', 'elevator'] },
  { id: 'E', angle_deg: 345, display: { fa: 'هسته پله شرقی', en: 'East stair core', tr: 'Doğu merdiven çekirdeği' }, modes: ['stairs', 'escalator', 'elevator'] },
  { id: 'N', angle_deg: 270, display: { fa: 'هسته پله شمالی', en: 'North stair core', tr: 'Kuzey merdiven çekirdeği' }, modes: ['stairs'] },
  { id: 'S', angle_deg: 90, display: { fa: 'هسته پله جنوبی', en: 'South stair core', tr: 'Güney merdiven çekirdeği' }, modes: ['stairs'] }
];

const LEVELS = [1, 2, 4];
const VERTICAL_LENGTH_UNITS = { '1-2': 60, '2-4': 110 };
const CHECKPOINT_PENALTY_UNITS = { security: 80, ticket_control: 40 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const deg2rad = (d) => (d * Math.PI) / 180;
const rad2deg = (r) => (r * 180) / Math.PI;
const round1 = (v) => Math.round(v * 10) / 10;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const polar = (angleDeg, r) => ({
  x: round1(CENTER.x + Math.cos(deg2rad(angleDeg)) * r),
  y: round1(CENTER.y + Math.sin(deg2rad(angleDeg)) * r)
});
const angleOf = (p) => {
  let a = rad2deg(Math.atan2(p.y - CENTER.y, p.x - CENTER.x));
  if (a < 0) a += 360;
  return a;
};
const radiusOf = (p) => dist(p, CENTER);
const angularDistance = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const nodes = [];
const nodeIndex = new Map();
const edges = [];

function addNode(node) {
  if (nodeIndex.has(node.id)) throw new Error(`duplicate node ${node.id}`);
  nodeIndex.set(node.id, node);
  nodes.push(node);
  return node;
}

function addEdge(aId, bId, props = {}) {
  const a = nodeIndex.get(aId);
  const b = nodeIndex.get(bId);
  if (!a || !b) throw new Error(`edge references unknown node ${aId} / ${bId}`);
  const length = props.length_units != null ? props.length_units : round1(dist(a, b));
  const penalty = props.penalty_units || 0;
  edges.push({
    from: aId,
    to: bId,
    type: props.type || 'walk',
    length_units: round1(length),
    cost: round1(length + penalty),
    bidirectional: props.bidirectional !== false,
    ...(props.modes ? { modes: props.modes } : {}),
    ...(props.level_from != null ? { level_from: props.level_from, level_to: props.level_to } : {})
  });
}

function projectToLatLon(p) {
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos(deg2rad(GEO.venue_lat));
  const east = (p.x - CENTER.x) * GEO.meters_per_unit;
  const north = -(p.y - CENTER.y) * GEO.meters_per_unit;
  const brg = deg2rad(GEO.map_north_bearing_deg);
  const e = east * Math.cos(brg) + north * Math.sin(brg);
  const n = -east * Math.sin(brg) + north * Math.cos(brg);
  return {
    lat: +(GEO.venue_lat + n / metersPerDegLat).toFixed(6),
    lon: +(GEO.venue_lon + e / metersPerDegLon).toFixed(6)
  };
}

// ---------------------------------------------------------------------------
// 1. Sections, portals, corridor rings
// ---------------------------------------------------------------------------

const sectionsByLevel = new Map();
for (const s of dataset.sections) {
  if (!sectionsByLevel.has(s.level)) sectionsByLevel.set(s.level, []);
  sectionsByLevel.get(s.level).push(s);
}

const corridorRadius = {};
const sectionsOut = [];
const corridorNodesByLevel = {};

for (const level of LEVELS) {
  const secs = (sectionsByLevel.get(level) || [])
    .map((s) => ({ ...s, angle: angleOf(s.estimated_entry_portal) }))
    .sort((a, b) => a.angle - b.angle);

  const maxPortalR = Math.max(...secs.map((s) => radiusOf(s.estimated_entry_portal)));
  corridorRadius[level] = round1(maxPortalR + LEVEL_MODEL[level].corridor_offset_units);
  corridorNodesByLevel[level] = [];

  secs.forEach((s, i) => {
    const prev = secs[(i - 1 + secs.length) % secs.length];
    const next = secs[(i + 1) % secs.length];
    const halfWedge = round1(Math.min(angularDistance(s.angle, prev.angle), angularDistance(s.angle, next.angle)) / 2 * 0.92);

    const portalId = s.internal_node;
    const corridorId = `L${level}_CORRIDOR_${s.section}`;
    const portalPos = s.estimated_entry_portal;
    const corridorPos = polar(s.angle, corridorRadius[level]);

    addNode({
      id: portalId, type: 'portal', level, section: s.section, zone: s.navigation_zone,
      x: portalPos.x, y: portalPos.y,
      label: { fa: `ورودی سکشن ${s.section}`, en: `Section ${s.section} portal`, tr: `${s.section} Blok girişi` },
      confidence: s.confidence
    });
    addNode({
      id: corridorId, type: 'corridor', level, section: s.section, zone: s.navigation_zone,
      x: corridorPos.x, y: corridorPos.y,
      label: { fa: `راهروی طبقه ${level} مقابل ${s.section}`, en: `L${level} concourse at ${s.section}`, tr: `Kat ${level} koridor ${s.section}` },
      confidence: 'modelled_ring_corridor'
    });
    addEdge(corridorId, portalId, { type: 'portal_door' });
    corridorNodesByLevel[level].push({ id: corridorId, angle: s.angle, ...corridorPos });

    sectionsOut.push({
      section: s.section,
      level,
      zone: s.navigation_zone,
      angle_deg: round1(s.angle),
      half_wedge_deg: halfWedge,
      map_center: s.map_center,
      portal: { ...portalPos, node: portalId },
      corridor_node: corridorId,
      known_ticket_gate_label: s.known_ticket_gate_label || null,
      confidence: s.confidence
    });
  });

  // Ring edges between neighbouring corridor nodes
  const ring = corridorNodesByLevel[level];
  ring.forEach((c, i) => {
    const next = ring[(i + 1) % ring.length];
    const arc = deg2rad(angularDistance(c.angle, next.angle)) * corridorRadius[level];
    addEdge(c.id, next.id, { type: 'concourse', length_units: arc });
  });
}

function nearestCorridorNodes(level, angleDeg, count = 2) {
  return [...corridorNodesByLevel[level]]
    .sort((a, b) => angularDistance(a.angle, angleDeg) - angularDistance(b.angle, angleDeg))
    .slice(0, count);
}

// ---------------------------------------------------------------------------
// 2. Vertical cores
// ---------------------------------------------------------------------------

const coreRadius = round1(corridorRadius[4] + 28);
const coresOut = [];

for (const core of CORES) {
  const pos = polar(core.angle_deg, coreRadius);
  const levelNodes = {};
  for (const level of LEVELS) {
    const id = `CORE_${core.id}_L${level}`;
    levelNodes[level] = id;
    addNode({
      id, type: 'core', level, core: core.id, x: pos.x, y: pos.y,
      modes: core.modes,
      label: {
        fa: `${core.display.fa} – طبقه ${level}`,
        en: `${core.display.en} – level ${level}`,
        tr: `${core.display.tr} – kat ${level}`
      },
      confidence: 'modelled_vertical_core'
    });
    for (const c of nearestCorridorNodes(level, core.angle_deg, 2)) {
      addEdge(id, c.id, { type: 'walk' });
    }
  }
  addEdge(levelNodes[1], levelNodes[2], {
    type: 'vertical', modes: core.modes, length_units: VERTICAL_LENGTH_UNITS['1-2'], level_from: 1, level_to: 2
  });
  addEdge(levelNodes[2], levelNodes[4], {
    type: 'vertical', modes: core.modes, length_units: VERTICAL_LENGTH_UNITS['2-4'], level_from: 2, level_to: 4
  });
  coresOut.push({ id: core.id, display: core.display, modes: core.modes, x: pos.x, y: pos.y, nodes: levelNodes });
}

// ---------------------------------------------------------------------------
// 3. Gates → security → ticket control → lobby → L1 concourse / west|east core
// ---------------------------------------------------------------------------

const gatesOut = [];
const gateRadius = coreRadius + 110;

for (const g of GATES) {
  const step = (r) => polar(g.axis_deg, r);
  const gatePos = step(gateRadius);
  const secPos = step(gateRadius - 30);
  const ticketPos = step(gateRadius - 58);
  const lobbyPos = step(gateRadius - 85);

  const gateId = `GATE_${g.id}`;
  const secId = `SECURITY_${g.id}`;
  const ticketId = `TICKET_${g.id}`;
  const lobbyId = `LOBBY_${g.id}`;

  addNode({
    id: gateId, type: 'gate', level: 0, gate: g.id, x: gatePos.x, y: gatePos.y,
    label: g.display, confidence: 'modelled_from_ticket_gate_label'
  });
  addNode({
    id: secId, type: 'security', level: 0, gate: g.id, x: secPos.x, y: secPos.y,
    label: { fa: `کنترل امنیتی ${g.display.tr}`, en: `Security check – ${g.display.en}`, tr: `Güvenlik kontrolü – ${g.display.tr}` },
    confidence: 'modelled'
  });
  addNode({
    id: ticketId, type: 'ticket_control', level: 0, gate: g.id, x: ticketPos.x, y: ticketPos.y,
    label: { fa: `کنترل بلیط ${g.display.tr}`, en: `Ticket check – ${g.display.en}`, tr: `Bilet kontrolü – ${g.display.tr}` },
    confidence: 'modelled'
  });
  addNode({
    id: lobbyId, type: 'lobby', level: 1, gate: g.id, x: lobbyPos.x, y: lobbyPos.y,
    label: { fa: `سالن ورودی ${g.display.tr}`, en: `Entrance hall – ${g.display.en}`, tr: `Giriş holü – ${g.display.tr}` },
    confidence: 'modelled'
  });

  addEdge(gateId, secId, { type: 'checkpoint', penalty_units: CHECKPOINT_PENALTY_UNITS.security });
  addEdge(secId, ticketId, { type: 'checkpoint', penalty_units: CHECKPOINT_PENALTY_UNITS.ticket_control });
  addEdge(ticketId, lobbyId, { type: 'door' });

  // Lobby → ground-level passage to the level-1 concourse (walks under the upper stands)
  for (const c of nearestCorridorNodes(1, g.axis_deg, 2)) {
    addEdge(lobbyId, c.id, { type: 'walk' });
  }
  // Lobby → nearest vertical core on level 1
  const nearestCore = [...CORES].sort((a, b) => angularDistance(a.angle_deg, g.axis_deg) - angularDistance(b.angle_deg, g.axis_deg))[0];
  addEdge(lobbyId, `CORE_${nearestCore.id}_L1`, { type: 'walk' });

  const latlon = projectToLatLon(gatePos);
  gatesOut.push({
    id: g.id,
    display: g.display,
    aliases: g.aliases,
    side: g.side,
    verified_label: g.verified_label,
    node: gateId,
    chain: [gateId, secId, ticketId, lobbyId],
    x: gatePos.x, y: gatePos.y,
    lat: latlon.lat, lon: latlon.lon,
    geo_confidence: GEO.confidence
  });
}

// ---------------------------------------------------------------------------
// 4. Emit
// ---------------------------------------------------------------------------

const graph = {
  venue: { ...dataset.venue, lat: GEO.venue_lat, lon: GEO.venue_lon },
  generated_at: new Date().toISOString(),
  generator: 'scripts/build_graph.js',
  coordinate_system: {
    ...dataset.coordinate_system,
    center: CENTER,
    meters_per_unit: GEO.meters_per_unit,
    map_north_bearing_deg: GEO.map_north_bearing_deg
  },
  geo: GEO,
  gate_policy: dataset.gate_policy,
  important_warning: dataset.important_warning,
  modelling_notes: [
    'Concourse ring corridors are placed ' + LEVEL_MODEL[1].corridor_offset_units + ' units outside each level’s portals.',
    'Four vertical cores (W/E/N/S) connect levels 1→2→4. Only W and E are modelled with elevators.',
    'Gate → security → ticket control → entrance hall chains exist for BATI and DOĞU only.',
    'Row/seat positions are interpolated inside the section wedge (row A assumed nearest the floor, seat 1 assumed at the clockwise edge).',
    'Level 3 is not in the public seating plan and is treated as pass-through.'
  ],
  levels: Object.fromEntries(LEVELS.map((l) => [l, {
    ...LEVEL_MODEL[l],
    corridor_radius: corridorRadius[l],
    section_count: (sectionsByLevel.get(l) || []).length
  }])),
  gates: gatesOut,
  cores: coresOut,
  sections: sectionsOut,
  nodes,
  edges,
  walking: { speed_m_per_s: 1.2, security_wait_min: 2, ticket_check_wait_min: 1 }
};

fs.writeFileSync(GRAPH_JSON_PATH, JSON.stringify(graph, null, 2) + '\n');
fs.mkdirSync(path.dirname(GRAPH_JS_PATH), { recursive: true });
fs.writeFileSync(
  GRAPH_JS_PATH,
  '/* Generated by scripts/build_graph.js – do not edit by hand. */\n' +
  'window.ULKER_GRAPH = ' + JSON.stringify(graph) + ';\n'
);

console.log(`graph: ${nodes.length} nodes, ${edges.length} edges, ${sectionsOut.length} sections, ${gatesOut.length} gates`);
console.log(`wrote ${path.relative(ROOT, GRAPH_JSON_PATH)} and ${path.relative(ROOT, GRAPH_JS_PATH)}`);
