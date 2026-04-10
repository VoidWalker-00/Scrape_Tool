const { test, before, after } = require('node:test');
const assert = require('node:assert');
const Server = require('../server.js');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

// These tests verify every endpoint that api.js calls exists and returns the
// expected shape. They run against a real Server instance with temp directories.

let server;
let base;
let tmpSelectors;
let tmpResults;

before(async () => {
  tmpSelectors = fs.mkdtempSync(path.join(os.tmpdir(), 'sel-'));
  tmpResults   = fs.mkdtempSync(path.join(os.tmpdir(), 'res-'));
  server = new Server({ port: 0, selectorsDir: tmpSelectors, resultsDir: tmpResults });
  await server.start();
  base = `http://localhost:${server.port}`;
});

after(async () => {
  await server.stop();
  fs.rmSync(tmpSelectors, { recursive: true });
  fs.rmSync(tmpResults,   { recursive: true });
});

async function req(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${base}${path}`, opts);
}

test('GET /api/jobs returns array', async () => {
  const res = await req('GET', '/api/jobs');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(await res.json()));
});

test('POST /api/jobs creates job and returns 201', async () => {
  const res = await req('POST', '/api/jobs', { name: 'test-job', config: { URL: 'https://example.com' } });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).ok, true);
});

test('GET /api/jobs/:name returns config', async () => {
  const res = await req('GET', '/api/jobs/test-job');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).URL, 'https://example.com');
});

test('GET /api/jobs/:name/runs returns array', async () => {
  const res = await req('GET', '/api/jobs/test-job/runs');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(await res.json()));
});

test('POST /api/jobs/:name/run returns 202 and runId', async () => {
  // Starts an async scrape — we only verify the 202 response shape, not the scrape itself
  const res = await req('POST', '/api/jobs/test-job/run');
  assert.equal(res.status, 202);
  const data = await res.json();
  assert.ok(typeof data.runId === 'string');
  assert.ok(data.runId.startsWith('test-job-'));
});

test('GET /api/jobs/:name/runs/:runId returns result for existing run', async () => {
  // Write a fake result file to tmpResults to test the GET endpoint
  const jobResultsDir = path.join(tmpResults, 'test-job');
  fs.mkdirSync(jobResultsDir, { recursive: true });
  const fakeRunId = 'test-job-9999999999999';
  fs.writeFileSync(path.join(jobResultsDir, `${fakeRunId}.json`), JSON.stringify({ title: 'test' }));
  const res = await req('GET', `/api/jobs/test-job/runs/${fakeRunId}`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { title: 'test' });
});

test('GET /api/jobs/:name/runs/:runId returns 404 for unknown run', async () => {
  const res = await req('GET', '/api/jobs/test-job/runs/nonexistent-run');
  assert.equal(res.status, 404);
});

test('DELETE /api/jobs/:name deletes job', async () => {
  const res = await req('DELETE', '/api/jobs/test-job');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test('GET /api/jobs/:name returns 404 after delete', async () => {
  const res = await req('GET', '/api/jobs/test-job');
  assert.equal(res.status, 404);
});
