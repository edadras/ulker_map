'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createServer, eventGateFor } = require('../server/index');

function request(server, method, path, body) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: body ? { 'Content-Type': 'application/json' } : {} }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test('HTTP API', async (t) => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());

  const ok = await request(server, 'GET', '/navigation/route?section=414&row=L&seat=1&gate=BATI&lat=40.9905&lon=29.1');
  assert.equal(ok.status, 200);
  const j = JSON.parse(ok.body);
  assert.equal(j.ok, true);
  assert.equal(j.gate.id, '400');
  assert.equal(j.destination.level, 4);
  assert.equal(j.steps[0].type, 'outdoor');

  const ev = await request(server, 'GET', '/navigation/route?section=207&event_id=123');
  assert.equal(JSON.parse(ev.body).gate.source, 'event_mapping');
  assert.equal(JSON.parse(ev.body).gate.id, '100-200');

  const post = await request(server, 'POST', '/navigation/route', { event_id: 123, section: '414', row: 'L', seat: '1', gate: 'BATI', origin: { lat: 40.9905, lon: 29.1 } });
  assert.equal(post.status, 200);
  assert.equal(JSON.parse(post.body).summary.outdoor_distance_m > 0, true);

  const bad = await request(server, 'GET', '/navigation/route?section=999');
  assert.equal(bad.status, 400);
  assert.equal(JSON.parse(bad.body).error.code, 'UNKNOWN_SECTION');

  const badGate = await request(server, 'GET', '/navigation/route?section=414&gate=KUZEY');
  assert.equal(badGate.status, 400);

  const gates = await request(server, 'GET', '/navigation/gates');
  const gatesJ = JSON.parse(gates.body).gates;
  assert.equal(gatesJ.length, 3);
  assert.ok(gatesJ.every((g) => g.approach && g.approach.waypoints.length >= 4 && g.lat && g.lon));

  const sections = await request(server, 'GET', '/navigation/sections');
  assert.equal(JSON.parse(sections.body).sections.length, 44);

  const seats = await request(server, 'GET', '/navigation/seats?section=414&row=L');
  assert.equal(seats.status, 200);
  const seatsJ = JSON.parse(seats.body);
  assert.equal(seatsJ.rows[0].row, 'L');
  assert.ok(seatsJ.rows[0].seats.length > 10);
  assert.equal((await request(server, 'GET', '/navigation/seats?section=999')).status, 400);

  // route by the ticketing-system seat id
  const seatmap = require('../data/seatmap.json');
  const real = seatmap.seats.find((s) => s.sectionName === '109' && s.rowName === 'V' && s.number === 5);
  const byId = await request(server, 'GET', `/navigation/route?seat_id=${real.id}&gate=${encodeURIComponent('DOĞU')}`);
  assert.equal(byId.status, 200);
  const byIdJ = JSON.parse(byId.body);
  assert.equal(byIdJ.destination.section, '109');
  assert.equal(byIdJ.ticket.row, 'V');
  assert.equal(byIdJ.ticket.seat, '5');
  assert.equal(byIdJ.destination.seat.x, Math.round(real.x * 10) / 10);
  const one = await request(server, 'GET', `/navigation/seats?id=${real.id}`);
  assert.equal(JSON.parse(one.body).seat.section, '109');
  const badId = await request(server, 'GET', '/navigation/route?seat_id=nope');
  assert.equal(badId.status, 400);
  assert.equal(JSON.parse(badId.body).error.code, 'UNKNOWN_SEAT_ID');

  const root = await request(server, 'GET', '/');
  assert.equal(root.status, 302);
  assert.equal(root.headers.location, '/web/');
  const page = await request(server, 'GET', '/web/');
  assert.equal(page.status, 200);
  const css = await request(server, 'GET', '/web/style.css');
  assert.equal(css.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  const js = await request(server, 'GET', '/src/router.js');
  assert.equal(js.status, 200);
  const traversal = await request(server, 'GET', '/web/../package.json');
  assert.equal(traversal.status, 404);
});

test('eventGateFor precedence', () => {
  assert.equal(eventGateFor('123', '414'), 'BATI');
  assert.equal(eventGateFor('123', '207'), '100-200');
  assert.equal(eventGateFor('123', '103'), '100-200');
  assert.equal(eventGateFor('123', 'VIP'), 'VIP');
  assert.equal(eventGateFor('999', '414'), null);
  assert.equal(eventGateFor(null, '414'), null);
});
