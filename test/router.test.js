'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createRouter, parseRow, parseSeat } = require('../src/router');

const graph = require(path.join(__dirname, '..', 'data', 'ulker_arena_navigation_graph.json'));
const router = createRouter(graph);
const ALL_SECTIONS = graph.sections.map((s) => s.section);

test('graph sanity: every section has a portal and corridor node, all edges resolve', () => {
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const s of graph.sections) {
    assert.ok(ids.has(s.portal.node), `missing portal ${s.portal.node}`);
    assert.ok(ids.has(s.corridor_node), `missing corridor ${s.corridor_node}`);
  }
  for (const e of graph.edges) {
    assert.ok(ids.has(e.from) && ids.has(e.to), `dangling edge ${e.from}->${e.to}`);
    assert.ok(e.cost > 0);
  }
  assert.equal(graph.sections.length, 62);
  assert.equal(graph.gates.length, 2);
});

test('every section is reachable from every gate, with the expected step skeleton', () => {
  for (const gate of graph.gates) {
    for (const section of ALL_SECTIONS) {
      const res = router.route({ section, row: 'C', seat: '7', gate: gate.id });
      assert.equal(res.ok, true);
      assert.equal(res.gate.id, gate.id);
      assert.equal(res.gate.source, 'ticket');
      const types = res.steps.map((s) => s.type);
      assert.deepEqual(types.slice(0, 4), ['gate', 'security', 'ticket_control', 'lobby'], `${gate.id}→${section}: ${types}`);
      assert.ok(types.includes('portal'), `${gate.id}→${section} has portal step`);
      assert.equal(types[types.length - 2], 'row');
      assert.equal(types[types.length - 1], 'seat');
      const level = res.destination.level;
      if (level === 1) assert.ok(!types.includes('vertical'), `${section} on L1 should not change level`);
      else {
        const v = res.steps.find((s) => s.type === 'vertical');
        assert.ok(v, `${gate.id}→${section} needs a vertical step`);
        assert.equal(v.level_to, level);
      }
      assert.ok(res.summary.levels_visited.includes(level));
      assert.equal(res.path.nodes[0].id, gate.node);
      assert.equal(res.path.nodes[res.path.nodes.length - 1].id, graph.sections.find((s) => s.section === section).portal.node);
      assert.ok(res.summary.indoor_distance_m > 0 && res.summary.indoor_distance_m < 400, `distance ${res.summary.indoor_distance_m}`);
    }
  }
});

test('reference request: section 414 / row L / seat 1 / BATI', () => {
  const res = router.route({ event_id: 123, section: '414', row: 'L', seat: '1', gate: 'BATI' });
  assert.equal(res.destination.level, 4);
  assert.equal(res.destination.zone, 'north');
  assert.equal(res.ticket.row, 'L');
  assert.equal(res.ticket.seat, '1');
  assert.equal(res.destination.seat.rows_from_front, 11);
  const concourse = res.steps.find((s) => s.type === 'concourse');
  assert.ok(concourse.level === 4);
  assert.ok(concourse.passed_sections.length > 0);
  assert.ok(res.steps.every((s) => s.title.fa && s.title.en && s.title.tr));
  assert.equal(res.warnings.length, 0);
});

test('gate normalisation accepts Turkish spellings and aliases', () => {
  for (const v of ['BATI', 'Batı', 'batı girişi', 'BATİ', 'WEST', 'w', 'Kapı: Batı']) assert.equal(router.normalizeGate(v), 'BATI', v);
  for (const v of ['DOĞU', 'Dogu', 'doğu girişi', 'EAST', 'e', 'Doğu Girişi']) assert.equal(router.normalizeGate(v), 'DOĞU', v);
  assert.equal(router.normalizeGate(''), null);
  assert.equal(router.normalizeGate('KUZEY'), null);
});

test('gate fallback order: ticket → event mapping → section history → geometry', () => {
  const fromEvent = router.route({ section: '105', event_gate: 'DOĞU' });
  assert.equal(fromEvent.gate.id, 'DOĞU');
  assert.equal(fromEvent.gate.source, 'event_mapping');

  const ticketWins = router.route({ section: '105', gate: 'BATI', event_gate: 'DOĞU' });
  assert.equal(ticketWins.gate.id, 'BATI');
  assert.equal(ticketWins.gate.source, 'ticket');

  const hist = router.route({ section: '103' });
  assert.equal(hist.gate.id, 'DOĞU');
  assert.equal(hist.gate.source, 'section_history');
  assert.ok(hist.warnings.some((w) => w.code === 'GATE_FROM_HISTORICAL_LABEL'));

  const geo = router.route({ section: '105' });
  assert.equal(geo.gate.source, 'geometric_fallback');
  assert.ok(geo.warnings.some((w) => w.code === 'GATE_GEOMETRIC_FALLBACK'));
});

test('errors: unknown section / unknown gate', () => {
  assert.throws(() => router.route({ section: '999' }), (e) => e.code === 'UNKNOWN_SECTION');
  assert.throws(() => router.route({ section: '414', gate: 'KUZEY' }), (e) => e.code === 'UNKNOWN_GATE');
});

test('accessible mode only uses cores with elevators', () => {
  const elevatorCores = new Set(graph.cores.filter((c) => c.modes.includes('elevator')).map((c) => c.id));
  for (const section of ['414', '220', '407', '211']) {
    const res = router.route({ section, gate: 'BATI', accessible: true });
    const coresUsed = res.path.nodes.filter((n) => n.type === 'core').map((n) => n.id.split('_')[1]);
    for (const c of coresUsed) assert.ok(elevatorCores.has(c), `${section} used stairs-only core ${c}`);
    const v = res.steps.find((s) => s.type === 'vertical');
    assert.deepEqual(v.modes, ['elevator']);
  }
});

test('row / seat parsing', () => {
  assert.deepEqual(parseRow('L'), { label: 'L', index: 12, scheme: 'alpha' });
  assert.deepEqual(parseRow('aa'), { label: 'AA', index: 27, scheme: 'alpha' });
  assert.deepEqual(parseRow('7'), { label: '7', index: 7, scheme: 'numeric' });
  assert.equal(parseRow(''), null);
  assert.deepEqual(parseSeat('12'), { label: '12', index: 12 });
  assert.equal(parseSeat('x'), null);
  const res = router.route({ section: '414', row: 'ZZ', seat: '1', gate: 'BATI' });
  assert.ok(res.warnings.some((w) => w.code === 'ROW_BEYOND_MODEL'));
});

test('seat position lies inside the section wedge', () => {
  const s = graph.sections.find((x) => x.section === '414');
  const lvl = graph.levels[4];
  for (const seat of ['1', '12', '24']) {
    const res = router.route({ section: '414', row: 'A', seat, gate: 'BATI' });
    const p = res.destination.seat;
    assert.ok(p.radius >= lvl.row_inner_r - 0.1 && p.radius <= lvl.row_outer_r + 0.1);
    const d = Math.abs(((p.angle_deg - s.angle_deg + 540) % 360) - 180);
    assert.ok(d <= s.half_wedge_deg + 0.1, `seat ${seat} angle off by ${d}`);
  }
});

test('outdoor leg from a GPS origin', () => {
  const res = router.route({ section: '414', row: 'L', seat: '1', gate: 'BATI', origin: { lat: 40.9905, lon: 29.1000 } });
  assert.ok(res.outdoor);
  assert.equal(res.steps[0].type, 'outdoor');
  assert.ok(res.outdoor.distance_m > 300 && res.outdoor.distance_m < 600, `distance ${res.outdoor.distance_m}`);
  assert.ok(res.outdoor.directions_url.includes('travelmode=walking'));
  assert.ok(res.outdoor.origin.map_xy, 'origin projected onto the indoor map');
  assert.equal(res.summary.outdoor_distance_m, res.outdoor.distance_m);

  const far = router.route({ section: '414', gate: 'BATI', origin: { lat: 41.05, lon: 28.98 } });
  assert.equal(far.outdoor.origin.map_xy, null);
  assert.ok(far.warnings.some((w) => w.code === 'ORIGIN_FAR'));

  // projection round-trip
  const ll = router.mapToLatLon({ x: 700, y: 300 });
  const xy = router.latLonToMap(ll);
  assert.ok(Math.abs(xy.x - 700) < 0.2 && Math.abs(xy.y - 300) < 0.2);
});
