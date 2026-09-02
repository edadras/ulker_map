'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createRouter, parseRow, parseSeat } = require('../src/router');

const graph = require(path.join(__dirname, '..', 'data', 'ulker_arena_navigation_graph.json'));
const seatmap = require(path.join(__dirname, '..', 'data', 'seatmap.json'));
const router = createRouter(graph);
const ALL_SECTIONS = graph.sections.map((s) => s.section);
const sectionOf = (name) => graph.sections.find((s) => s.section === name);

function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

test('graph sanity: sections, seats, portals, corridors and edges', () => {
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const s of graph.sections) {
    assert.ok(ids.has(s.portal.node), `missing portal ${s.portal.node}`);
    assert.ok(ids.has(s.corridor_node), `missing corridor ${s.corridor_node}`);
    assert.ok(s.outline.length >= 3);
    assert.ok(s.rows.length === s.row_count);
  }
  for (const e of graph.edges) {
    assert.ok(ids.has(e.from) && ids.has(e.to), `dangling edge ${e.from}->${e.to}`);
    assert.ok(e.cost > 0);
  }
  assert.equal(graph.sections.length, 44);
  assert.equal(graph.gates.length, 3);
  assert.deepEqual(graph.gates.map((g) => g.id).sort(), ['100-200', '400', 'VIP']);
  assert.equal(graph.source.seats, seatmap.seats.length);
  const indexed = Object.values(graph.seat_index).reduce((a, s) => a + s.rows.reduce((b, r) => b + r.seats.length, 0), 0);
  assert.equal(indexed, seatmap.seats.length);
  assert.deepEqual(ALL_SECTIONS.filter((s) => /^1/.test(s)), ['102', '103', '104', '105', '106', '107', '108', '109', '110', '111', '112', '113', '114', '115']);
  assert.ok(ALL_SECTIONS.includes('VIP'));
  assert.equal(graph.coordinate_system.stage.label, 'Stage');
});

test('every seat of the ticketing seat map resolves to its exact coordinates inside its section outline', () => {
  for (const s of seatmap.seats) {
    const got = router.getSeat(s.sectionName, s.rowName, s.number);
    assert.ok(got, `seat ${s.sectionName}/${s.rowName}/${s.number} missing`);
    assert.ok(Math.abs(got.x - s.x) < 0.06 && Math.abs(got.y - s.y) < 0.06, `seat ${s.sectionName}/${s.rowName}/${s.number} moved`);
    assert.equal(got.status, s.status);
    assert.equal(got.price, s.price);
    assert.ok(pointInPolygon(got, sectionOf(String(s.sectionName)).outline), `seat ${s.sectionName}/${s.rowName}/${s.number} outside outline`);
  }
});

test('every section is reachable from every gate, with the expected step skeleton', () => {
  for (const gate of graph.gates) {
    for (const section of ALL_SECTIONS) {
      const sec = sectionOf(section);
      const midRow = graph.seat_index[section].rows[Math.floor(sec.rows.length / 2)];
      const res = router.route({ section, row: midRow.row, seat: String(midRow.seats[0][0]), gate: gate.id });
      assert.equal(res.ok, true);
      assert.equal(res.gate.id, gate.id);
      assert.equal(res.gate.source, 'ticket');
      const types = res.steps.map((s) => s.type);
      assert.deepEqual(types.slice(0, 4), ['gate', 'security', 'ticket_control', 'lobby'], `${gate.id}→${section}: ${types}`);
      assert.ok(types.includes('portal'), `${gate.id}→${section} has portal step`);
      assert.ok(!types.includes('walk'), `${gate.id}→${section} should never pass through a stair core without using it: ${types}`);
      assert.equal(types[types.length - 2], 'row');
      assert.equal(types[types.length - 1], 'seat');
      const level = res.destination.level;
      if (level === 1) assert.ok(!types.includes('vertical'), `${section} on L1 should not change level`);
      else {
        const v = res.steps.find((s) => s.type === 'vertical');
        assert.ok(v, `${gate.id}→${section} needs a vertical step`);
        assert.equal(v.level_to, level);
      }
      if (sec.floor) assert.ok(types.includes('tunnel'), `${section} is reached through the floor tunnel`);
      assert.ok(res.summary.levels_visited.includes(level));
      assert.equal(res.path.nodes[0].id, gate.node);
      assert.equal(res.path.nodes[res.path.nodes.length - 1].id, sec.portal.node);
      assert.ok(res.summary.indoor_distance_m > 0 && res.summary.indoor_distance_m < 400, `distance ${res.summary.indoor_distance_m}`);
      assert.equal(res.destination.seat.confidence, 'exact_seatmap');
    }
  }
});

test('first and last seat of every row route to their exact seat-map position', () => {
  for (const [name, idx] of Object.entries(graph.seat_index)) {
    for (const r of idx.rows) {
      for (const s of [r.seats[0], r.seats[r.seats.length - 1]]) {
        const res = router.route({ section: name, row: r.row, seat: String(s[0]) });
        const d = res.destination.seat;
        assert.equal(d.confidence, 'exact_seatmap');
        assert.equal(d.x, s[1]);
        assert.equal(d.y, s[2]);
        assert.equal(d.rows_total, idx.rows.length);
        assert.equal(d.rows_from_front + d.rows_from_portal, idx.rows.length - 1);
        assert.ok(d.seat_index_from_left >= 1 && d.seat_index_from_left <= d.seats_in_row);
        assert.equal(res.warnings.length, 0, `${name}/${r.row}/${s[0]}: ${JSON.stringify(res.warnings)}`);
      }
    }
  }
});

test('reference request: section 414 / row L / seat 1 / BATI', () => {
  const res = router.route({ event_id: 123, section: '414', row: 'L', seat: '1', gate: 'BATI' });
  assert.equal(res.destination.level, 4);
  assert.equal(res.destination.zone, 'right');
  assert.equal(res.ticket.row, 'L');
  assert.equal(res.ticket.seat, '1');
  const real = seatmap.seats.find((s) => s.sectionName === '414' && s.rowName === 'L' && s.number === 1);
  assert.ok(Math.abs(res.destination.seat.x - real.x) < 0.06 && Math.abs(res.destination.seat.y - real.y) < 0.06);
  assert.equal(res.destination.seat.rows_from_front, sectionOf('414').rows.indexOf('L'));
  assert.equal(res.destination.seat.status, real.status);
  assert.equal(res.destination.seat.price, real.price);
  const concourse = res.steps.find((s) => s.type === 'concourse');
  assert.ok(concourse.level === 4);
  assert.equal(res.gate.id, '400');
  const v = res.steps.find((s) => s.type === 'vertical');
  assert.ok(v.node_ids.some((id) => id.startsWith('CORE_E400_')), 'uses the stairs/elevator at the 400 entrance');
  assert.ok(res.steps.every((s) => s.title.fa && s.title.en && s.title.tr));
  assert.equal(res.warnings.length, 0);
});

test('VIP floor: reached from level 1 through the floor tunnel, rows counted from the stage', () => {
  const res = router.route({ section: 'VIP', row: 'A', seat: '20' });
  assert.equal(res.gate.id, 'VIP');
  assert.equal(res.gate.source, 'level_entrance');
  assert.equal(res.destination.floor, true);
  assert.equal(res.destination.zone, 'floor');
  const types = res.steps.map((s) => s.type);
  assert.ok(!types.includes('vertical'));
  assert.ok(types.includes('tunnel'));
  assert.equal(res.destination.seat.rows_from_front, 0);
  assert.equal(res.destination.seat.rows_from_portal, 24);
  const back = router.route({ section: 'VIP', row: 'ZZ', seat: '1', gate: 'VIP' });
  assert.equal(back.destination.seat.rows_from_portal, 0);
  assert.equal(back.destination.seat.seat_index_from_left, 1);
});

test('gate normalisation accepts entrance ids, Turkish spellings and aliases', () => {
  for (const v of ['400', '400 Girişi', 'Kat 4', 'BATI', 'Batı', 'batı girişi', 'BATİ', 'WEST', 'w', 'Kapı: Batı']) assert.equal(router.normalizeGate(v), '400', v);
  for (const v of ['100-200', '100', '200', '100–200 Girişi', 'DOĞU', 'Dogu', 'doğu girişi', 'EAST', 'e', 'Doğu Girişi']) assert.equal(router.normalizeGate(v), '100-200', v);
  for (const v of ['VIP', 'vip girişi', 'VIP Kapı', 'Zemin']) assert.equal(router.normalizeGate(v), 'VIP', v);
  assert.equal(router.normalizeGate(''), null);
  assert.equal(router.normalizeGate('KUZEY'), null);
});

test('gate policy: ticket → event mapping → entrance serving the level', () => {
  // no gate given → the entrance that serves the level, no warning
  for (const [section, gate] of [['103', '100-200'], ['215', '100-200'], ['414', '400'], ['402', '400'], ['VIP', 'VIP']]) {
    const res = router.route({ section });
    assert.equal(res.gate.id, gate, section);
    assert.equal(res.gate.source, 'level_entrance');
    assert.equal(res.warnings.length, 0, JSON.stringify(res.warnings));
  }

  const fromEvent = router.route({ section: '105', event_gate: 'DOĞU' });
  assert.equal(fromEvent.gate.id, '100-200');
  assert.equal(fromEvent.gate.source, 'event_mapping');
  assert.equal(fromEvent.warnings.length, 0);

  const ticketWins = router.route({ section: '105', gate: '100', event_gate: '400' });
  assert.equal(ticketWins.gate.id, '100-200');
  assert.equal(ticketWins.gate.source, 'ticket');

  // ticket names an entrance that does not serve the level → routed from it, but warned
  const mismatch = router.route({ section: '105', gate: 'BATI' });
  assert.equal(mismatch.gate.id, '400');
  assert.equal(mismatch.gate.source, 'ticket');
  assert.ok(mismatch.warnings.some((w) => w.code === 'GATE_NOT_FOR_LEVEL'));
  assert.ok(mismatch.steps.some((s) => s.type === 'concourse'));
});

test('errors: unknown section / unknown gate', () => {
  assert.throws(() => router.route({ section: '999' }), (e) => e.code === 'UNKNOWN_SECTION');
  assert.throws(() => router.route({ section: '101' }), (e) => e.code === 'UNKNOWN_SECTION');
  assert.throws(() => router.route({ section: '414', gate: 'KUZEY' }), (e) => e.code === 'UNKNOWN_GATE');
  assert.throws(() => router.listSeats('999'), (e) => e.code === 'UNKNOWN_SECTION');
});

test('accessible mode only uses cores with elevators', () => {
  const elevatorCores = new Set(graph.cores.filter((c) => c.modes.includes('elevator')).map((c) => c.id));
  for (const section of ['414', '215', '407', '211', '402']) {
    const res = router.route({ section, gate: '100-200', accessible: true });
    const coresUsed = res.path.nodes.filter((n) => n.type === 'core').map((n) => n.id.split('_')[1]);
    for (const c of coresUsed) assert.ok(elevatorCores.has(c), `${section} used stairs-only core ${c}`);
    const v = res.steps.find((s) => s.type === 'vertical');
    assert.deepEqual(v.modes, ['elevator']);
  }
});

test('row / seat parsing and unknown row / seat warnings', () => {
  assert.deepEqual(parseRow('L'), { label: 'L', index: 12, scheme: 'alpha' });
  assert.deepEqual(parseRow('aa'), { label: 'AA', index: 27, scheme: 'alpha' });
  assert.deepEqual(parseRow('7'), { label: '7', index: 7, scheme: 'numeric' });
  assert.equal(parseRow(''), null);
  assert.deepEqual(parseSeat('12'), { label: '12', index: 12 });
  assert.equal(parseSeat('x'), null);

  const badRow = router.route({ section: '414', row: 'ZZ', seat: '1', gate: 'BATI' });
  assert.ok(badRow.warnings.some((w) => w.code === 'ROW_NOT_FOUND'));
  assert.equal(badRow.destination.seat.confidence, 'row_unknown_back_row');
  assert.equal(badRow.steps[badRow.steps.length - 2].type, 'row');

  const badSeat = router.route({ section: '414', row: 'L', seat: '99', gate: 'BATI' });
  assert.ok(badSeat.warnings.some((w) => w.code === 'SEAT_NOT_FOUND'));
  assert.equal(badSeat.destination.seat.confidence, 'row_centroid');
  assert.equal(badSeat.destination.seat.row_found, true);

  // row-only request: no seat step detail but still a row step
  const rowOnly = router.route({ section: '109', row: 'V' });
  assert.equal(rowOnly.warnings.length, 0);
  assert.equal(rowOnly.destination.seat.row, 'V');
});

test('seat side and index are consistent with the geometry of the row', () => {
  const idx = graph.seat_index['108'];
  const row = idx.rows[0];
  const first = router.route({ section: '108', row: row.row, seat: String(row.seats[0][0]), gate: 'BATI' }).destination.seat;
  const last = router.route({ section: '108', row: row.row, seat: String(row.seats[row.seats.length - 1][0]), gate: 'BATI' }).destination.seat;
  assert.notEqual(first.seat_side_from_portal, last.seat_side_from_portal);
  assert.ok(first.seat_index_from_left === 1 || last.seat_index_from_left === 1);
  assert.equal(new Set(row.seats.map((s) => router.route({ section: '108', row: row.row, seat: String(s[0]), gate: 'BATI' }).destination.seat.seat_index_from_left)).size, row.seats.length);
});

test('listSections / listSeats expose the real seat map', () => {
  const secs = router.listSections();
  assert.equal(secs.length, 44);
  const s414 = secs.find((s) => s.section === '414');
  assert.equal(s414.seat_count, 239);
  assert.equal(s414.rows[0], 'A');
  const seats = router.listSeats('414', 'L');
  assert.equal(seats.rows.length, 1);
  assert.equal(seats.rows[0].row, 'L');
  assert.ok(seats.rows[0].seats.every((s) => typeof s.x === 'number' && s.status));
  assert.equal(router.listSeats('VIP').rows.length, 25);
});

test('outdoor leg from a GPS origin', () => {
  const res = router.route({ section: '414', row: 'L', seat: '1', gate: 'BATI', origin: { lat: 40.9905, lon: 29.1000 } });
  assert.ok(res.outdoor);
  assert.equal(res.steps[0].type, 'outdoor');
  assert.ok(res.outdoor.distance_m > 300 && res.outdoor.distance_m < 1200, `distance ${res.outdoor.distance_m}`);
  assert.ok(res.outdoor.distance_m >= res.outdoor.straight_line_m);
  assert.ok(res.outdoor.polyline.length > 2, 'follows the organiser approach path');
  assert.equal(res.outdoor.polyline[0][0], 40.9905);
  assert.deepEqual(res.outdoor.polyline[res.outdoor.polyline.length - 1], [res.gate.lat, res.gate.lon]);
  assert.equal(res.outdoor.polyline_map_xy.length, res.outdoor.polyline.length);
  assert.ok(res.outdoor.directions_url.includes('travelmode=walking'));
  assert.ok(res.outdoor.directions_url.includes('waypoints='));
  assert.equal(res.outdoor.approach.color, 'red');

  // a user standing north of the annex must still follow the red path around it, not cut through the building
  const northSide = router.route({ section: '414', origin: { lat: 40.99415, lon: 29.10495 } });
  assert.ok(northSide.outdoor.polyline.length >= 4);
  assert.ok(northSide.outdoor.approach.joined_at_waypoint >= 3 && northSide.outdoor.approach.joined_at_waypoint <= 5);

  // right at the door → straight in
  const atDoor = router.route({ section: '414', gate: '400', origin: { lat: res.gate.lat + 0.00005, lon: res.gate.lon } });
  assert.equal(atDoor.outdoor.polyline.length, 2);
  assert.ok(atDoor.outdoor.distance_m < 15);

  // from the bus stop on Ihlamur Blv. every entrance is reached along its own approach path
  for (const g of graph.gates) {
    const r = router.route({ section: g.id === 'VIP' ? 'VIP' : g.id === '400' ? '414' : '103', origin: { lat: 40.99333, lon: 29.10642 } });
    assert.equal(r.gate.id, g.id);
    assert.equal(r.outdoor.approach.joined_at_waypoint, 0, `${g.id} joins the approach at its start`);
    assert.ok(r.outdoor.distance_m > 50 && r.outdoor.distance_m < 400, `${g.id}: ${r.outdoor.distance_m}`);
  }
  assert.ok(res.outdoor.origin.map_xy, 'origin projected onto the indoor map');
  assert.equal(res.summary.outdoor_distance_m, res.outdoor.distance_m);

  const far = router.route({ section: '414', gate: 'BATI', origin: { lat: 41.05, lon: 28.98 } });
  assert.equal(far.outdoor.origin.map_xy, null);
  assert.ok(far.warnings.some((w) => w.code === 'ORIGIN_FAR'));

  // projection round-trip and orientation: DOĞU (east) gate must have the larger longitude
  const ll = router.mapToLatLon({ x: 700, y: 300 });
  const xy = router.latLonToMap(ll);
  assert.ok(Math.abs(xy.x - 700) < 0.2 && Math.abs(xy.y - 300) < 0.2);
  const east = graph.gates.find((g) => g.id === '100-200'), west = graph.gates.find((g) => g.id === '400');
  assert.ok(east.lon > west.lon);
  assert.ok(west.lat > east.lat);
  // entrances sit outside the level-4 bowl on the canvas, at their real bearing
  for (const g of graph.gates) {
    assert.ok(g.x < graph.bounds.minX + 900 || g.x > graph.bounds.maxX - 900 || g.y < graph.bounds.minY + 900 || g.y > graph.bounds.maxY - 900, `${g.id} at ${g.x},${g.y}`);
    assert.ok(Math.abs(((g.bearing_from_centre_deg - graph.coordinate_system.map_north_bearing_deg - 90 - g.screen_angle_deg) % 360 + 360) % 360) < 0.2);
  }
});
