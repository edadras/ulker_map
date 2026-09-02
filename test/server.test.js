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
  assert.equal(j.gate.id, 'BATI');
  assert.equal(j.destination.level, 4);
  assert.equal(j.steps[0].type, 'outdoor');

  const ev = await request(server, 'GET', '/navigation/route?section=207&event_id=123');
  assert.equal(JSON.parse(ev.body).gate.source, 'event_mapping');
  assert.equal(JSON.parse(ev.body).gate.id, 'DOĞU');

  const post = await request(server, 'POST', '/navigation/route', { event_id: 123, section: '414', row: 'L', seat: '1', gate: 'BATI', origin: { lat: 40.9905, lon: 29.1 } });
  assert.equal(post.status, 200);
  assert.equal(JSON.parse(post.body).summary.outdoor_distance_m > 0, true);

  const bad = await request(server, 'GET', '/navigation/route?section=999');
  assert.equal(bad.status, 400);
  assert.equal(JSON.parse(bad.body).error.code, 'UNKNOWN_SECTION');

  const badGate = await request(server, 'GET', '/navigation/route?section=414&gate=KUZEY');
  assert.equal(badGate.status, 400);

  const sections = await request(server, 'GET', '/navigation/sections');
  assert.equal(JSON.parse(sections.body).sections.length, 62);

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
  assert.equal(eventGateFor('123', '207'), 'DOĞU');
  assert.equal(eventGateFor('123', '103'), 'DOĞU');
  assert.equal(eventGateFor('999', '414'), null);
  assert.equal(eventGateFor(null, '414'), null);
});
