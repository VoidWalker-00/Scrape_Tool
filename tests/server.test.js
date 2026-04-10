const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Server = require('../server.js');

const SELECTORS_DIR = path.join(__dirname, '..', 'Data', 'Selectors');
const RESULTS_DIR   = path.join(__dirname, '..', 'Data', 'Results');

const server = new Server({ port: 3001 });

before(async () => { await server.start(); });
after(async ()  => { await server.stop();  });

const BASE = 'http://localhost:3001';

test('GET /api/health returns ok', async () => {
  const res = await fetch(`${BASE}/api/health`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
});

test('GET /api/jobs returns array', async () => {
  const res = await fetch(`${BASE}/api/jobs`);
  const body = await res.json();
  assert.ok(Array.isArray(body));
});

// Depends on Data/Selectors/test.json existing with a "URL" field.
// This file is the project's standard test fixture — do not delete it.
test('GET /api/jobs/test returns config with URL field', async () => {
  const res = await fetch(`${BASE}/api/jobs/test`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.URL, 'config must have a URL field');
});

test('GET /api/jobs/:name returns 404 for missing job', async () => {
  const res = await fetch(`${BASE}/api/jobs/doesnotexist`);
  assert.equal(res.status, 404);
});

test('POST /api/jobs/:name/run returns 202 and runId', async () => {
  const res = await fetch(`${BASE}/api/jobs/test/run`, { method: 'POST' });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.ok(body.runId, 'response must include a runId');
});

test('POST /api/jobs/:name/run returns 404 for missing job', async () => {
  const res = await fetch(`${BASE}/api/jobs/doesnotexist/run`, { method: 'POST' });
  assert.equal(res.status, 404);
});

test('GET /api/jobs/:name/runs returns an array', async () => {
  const res = await fetch(`${BASE}/api/jobs/test/runs`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body));
});

test('GET /api/jobs/:name/runs/:runId returns result data', async () => {
  const dir = path.join(RESULTS_DIR, 'test');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'fake-run.json'), JSON.stringify({ Title: 'Test' }));

  const res = await fetch(`${BASE}/api/jobs/test/runs/fake-run`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.Title, 'Test');

  // Cleanup
  fs.unlinkSync(path.join(dir, 'fake-run.json'));
});

test('GET /api/jobs/:name/runs/:runId returns 404 for missing run', async () => {
  const res = await fetch(`${BASE}/api/jobs/test/runs/doesnotexist`);
  assert.equal(res.status, 404);
});

test('POST /api/jobs creates a new config', async () => {
  const res = await fetch(`${BASE}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'test_create',
      config: { URL: 'https://example.com', Title: ['h1', 'Single', 'Text'] }
    })
  });
  assert.equal(res.status, 201);
  fs.unlinkSync(path.join(SELECTORS_DIR, 'test_create.json'));
});

test('DELETE /api/jobs/:name removes config', async () => {
  fs.writeFileSync(
    path.join(SELECTORS_DIR, 'test_delete.json'),
    JSON.stringify({ URL: 'https://example.com' })
  );
  const res = await fetch(`${BASE}/api/jobs/test_delete`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.ok(!fs.existsSync(path.join(SELECTORS_DIR, 'test_delete.json')));
});
