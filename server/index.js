#!/usr/bin/env node
/**
 * Minimal dependency-free HTTP server:
 *
 *   GET  /navigation/route?section=414&row=L&seat=1&gate=BATI[&event_id=123&lat=..&lon=..&accessible=1]
 *   POST /navigation/route            { "event_id":123, "section":"414", "row":"L", "seat":"1", "gate":"BATI", "origin":{"lat":..,"lon":..} }
 *   GET  /navigation/sections
 *   GET  /navigation/gates
 *   GET  /navigation/graph
 *   GET  /health
 *   GET  /            → redirects to /web/ (interactive map)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { createRouter } = require('../src/router');

const ROOT = path.resolve(__dirname, '..');
const GRAPH_PATH = path.join(ROOT, 'data', 'ulker_arena_navigation_graph.json');
const EVENTS_PATH = path.join(ROOT, 'data', 'events.json');

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { if (fallback !== undefined) return fallback; throw e; }
}

const graph = loadJson(GRAPH_PATH);
const events = loadJson(EVENTS_PATH, {});
const router = createRouter(graph);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8'
};
const STATIC_PREFIXES = ['/web/', '/src/', '/data/'];

function eventGateFor(eventId, section) {
  if (eventId == null || eventId === '') return null;
  const ev = events[String(eventId)];
  if (!ev) return null;
  const s = String(section);
  if (ev.section_gates && ev.section_gates[s]) return ev.section_gates[s];
  const level = s.charAt(0);
  if (ev.level_gates && ev.level_gates[level]) return ev.level_gates[level];
  return ev.default_gate || null;
}

function toBool(v) {
  if (v == null) return false;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function buildRequest(params) {
  const req = {
    event_id: params.event_id != null && params.event_id !== '' ? params.event_id : null,
    section: params.section,
    row: params.row,
    seat: params.seat,
    gate: params.gate,
    accessible: typeof params.accessible === 'boolean' ? params.accessible : toBool(params.accessible)
  };
  const origin = params.origin || (params.lat != null && params.lon != null ? { lat: params.lat, lon: params.lon, accuracy_m: params.accuracy } : null);
  if (origin && origin.lat != null && origin.lon != null) {
    req.origin = { lat: parseFloat(origin.lat), lon: parseFloat(origin.lon) };
    if (origin.accuracy_m != null) req.origin.accuracy_m = parseFloat(origin.accuracy_m);
  }
  req.event_gate = eventGateFor(req.event_id, req.section);
  return req;
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(data);
}

function handleRoute(res, params) {
  let req;
  try {
    req = buildRequest(params);
    const result = router.route(req);
    sendJson(res, 200, result);
  } catch (err) {
    const status = err.code === 'UNKNOWN_SECTION' || err.code === 'UNKNOWN_GATE' ? 400 : err.code === 'NO_ROUTE' ? 422 : 500;
    sendJson(res, status, { ok: false, error: { code: err.code || 'INTERNAL', message: err.message }, request: req || params });
  }
}

function serveStatic(res, urlPath) {
  if (urlPath === '/' || urlPath === '/web') {
    res.writeHead(302, { Location: '/web/' });
    res.end();
    return true;
  }
  const rel = urlPath === '/web/' ? '/web/index.html' : urlPath;
  if (!STATIC_PREFIXES.some((p) => rel.startsWith(p))) return false;
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep)) return false;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
  return true;
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
      return res.end();
    }
    if (p === '/health') return sendJson(res, 200, { ok: true, venue: graph.venue.name, nodes: graph.nodes.length, edges: graph.edges.length });
    if (p === '/navigation/sections') return sendJson(res, 200, { ok: true, sections: router.listSections() });
    if (p === '/navigation/gates') return sendJson(res, 200, { ok: true, gates: router.listGates() });
    if (p === '/navigation/graph') return sendJson(res, 200, graph);
    if (p === '/navigation/events') return sendJson(res, 200, { ok: true, events: Object.fromEntries(Object.entries(events).filter(([k]) => !k.startsWith('_'))) });

    if (p === '/navigation/route') {
      if (req.method === 'GET') return handleRoute(res, Object.fromEntries(url.searchParams.entries()));
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
        req.on('end', () => {
          try { handleRoute(res, body ? JSON.parse(body) : {}); }
          catch (e) { sendJson(res, 400, { ok: false, error: { code: 'BAD_JSON', message: e.message } }); }
        });
        return;
      }
      return sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED' } });
    }

    if (req.method === 'GET' && serveStatic(res, p)) return;
    sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `No route for ${p}` } });
  });
}

if (require.main === module) {
  const port = parseInt(process.env.PORT || '8080', 10);
  createServer().listen(port, () => {
    console.log(`Ülker Arena navigation server → http://localhost:${port}/`);
    console.log(`Try: http://localhost:${port}/navigation/route?section=414&row=L&seat=1&gate=BATI`);
  });
}

module.exports = { createServer, buildRequest, eventGateFor };
