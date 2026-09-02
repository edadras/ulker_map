#!/usr/bin/env node
/** CLI: node scripts/route_cli.js section=414 row=L seat=1 gate=BATI [lat=.. lon=..] [accessible=1] [lang=fa|en|tr] [json=1] */
'use strict';
const path = require('path');
const { createRouter } = require('../src/router');
const { eventGateFor } = require('../server/index');
const graph = require(path.join(__dirname, '..', 'data', 'ulker_arena_navigation_graph.json'));

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const i = a.indexOf('='); return i < 0 ? [a, true] : [a.slice(0, i), a.slice(i + 1)]; }));
const lang = ['fa', 'en', 'tr'].includes(args.lang) ? args.lang : 'fa';
const router = createRouter(graph);
try {
  const req = { section: args.section, row: args.row, seat: args.seat, gate: args.gate, event_id: args.event_id, accessible: args.accessible === '1' };
  req.event_gate = eventGateFor(req.event_id, req.section);
  if (args.lat && args.lon) req.origin = { lat: parseFloat(args.lat), lon: parseFloat(args.lon) };
  const res = router.route(req);
  if (args.json) { console.log(JSON.stringify(res, null, 2)); process.exit(0); }
  console.log(`${res.venue.name} — section ${res.destination.section} / row ${res.ticket.row || '-'} / seat ${res.ticket.seat || '-'}`);
  console.log(`gate: ${res.gate.id} (${res.gate.source})  level: ${res.destination.level}  ~${res.summary.indoor_distance_m} m indoor, ~${res.summary.total_duration_min} min total\n`);
  for (const s of res.steps) {
    console.log(`${String(s.n).padStart(2)}. ${s.icon}  ${s.title[lang]}${s.distance_m ? `  (${s.distance_m} m)` : ''}`);
    if (s.detail && s.detail[lang]) console.log(`      ${s.detail[lang]}`);
  }
  for (const w of res.warnings) console.log(`\n⚠ ${w[lang] || w.en}`);
} catch (e) {
  console.error(`error [${e.code || 'INTERNAL'}]: ${e.message}`);
  process.exit(1);
}
