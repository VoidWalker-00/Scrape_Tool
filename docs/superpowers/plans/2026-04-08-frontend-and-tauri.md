# Frontend + Tauri Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete frontend UI (dashboard, job config/setup, results/logs/history) as plain HTML/CSS/JS, then wrap the app in Tauri for distribution as a native desktop app (.deb + .AppImage).

**Architecture:** Multi-page HTML served by Express (`public/`). Shared JS modules for all API calls, sparkline rendering, and form logic. Tauri wraps the webview and spawns `node server.js` as a sidecar on launch. No backend changes required.

**Tech Stack:** Node.js 25, Express 5, plain HTML/CSS/JS (no framework), Tauri 2, Rust (minimal boilerplate only), Node built-in `assert` + `node:test` for backend contract tests.

**Spec:** `docs/superpowers/specs/2026-04-08-frontend-design.md`

---

## File Map

| File | Status | Responsibility |
|------|--------|----------------|
| `public/js/layout.js` | Modify | Remove old nav links, keep only Dashboard |
| `public/js/api.js` | Create | All fetch() calls — single seam for Tauri IPC swap |
| `public/js/chart.js` | Create | Sparkline canvas renderer |
| `public/js/form.js` | Create | Config form builder: render + read config JSON |
| `public/js/dashboard.js` | Create | Dashboard card grid, polling, + new job flow |
| `public/js/job.js` | Create | Job detail Page 1: Config & Setup tabs |
| `public/js/logs.js` | Create | SSE connection and log rendering |
| `public/js/results.js` | Create | Job detail Page 2: Results/Logs & History tabs |
| `public/index.html` | Modify | Replace placeholder with dashboard shell |
| `public/job.html` | Create | Job detail Page 1 shell |
| `public/results.html` | Create | Job detail Page 2 shell |
| `public/css/style.css` | Modify | Add 6-column field-row variant + group styles |
| `server.js` | Modify | Add `get port()` getter for test isolation |
| `tests/api.test.js` | Create | Backend contract tests (verifies api.js endpoint shapes) |
| `src-tauri/tauri.conf.json` | Create | Window config, bundle targets, resource list |
| `src-tauri/Cargo.toml` | Create | Tauri 2 Rust dependencies |
| `src-tauri/build.rs` | Create | Tauri build script (required boilerplate) |
| `src-tauri/src/main.rs` | Create | Tauri entry point — spawns Express sidecar |

---

## Chunk 1: Shared Modules

### Task 1: Update layout.js

**Files:**
- Modify: `public/js/layout.js`

- [ ] **Step 1: Simplify NAV_LINKS to Dashboard only**

In `public/js/layout.js`, replace only the `NAV_LINKS` array (lines 3–7):

```javascript
const NAV_LINKS = [
  { href: '/index.html', label: 'Dashboard' },
];
```

The rest of `buildNav()` is unchanged — the existing active-link logic already compares pathnames only (not query strings), so no further edits are needed.

- [ ] **Step 2: Remove builder link from template.html**

In `public/template.html`, find the empty-state anchor that links to `/builder.html` and remove it (or change the href to `/index.html`). The builder is now part of `job.html`.

- [ ] **Step 3: Verify in browser**

```bash
node server.js
```
Open `http://localhost:3000` — nav shows only "◈ scrape-tool" and "Dashboard".
Open `http://localhost:3000/job.html?name=test` — no nav link is highlighted.

- [ ] **Step 4: Commit**

```bash
git add public/js/layout.js
git commit -m "feat: simplify nav to Dashboard-only"
```

---

### Task 2: Add `port` getter to server.js + api contract tests

**Files:**
- Modify: `server.js`
- Create: `tests/api.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/api.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test --test-concurrency=1 tests/api.test.js
```
Expected: FAIL — `server.port` is not defined.

Note: `--test-concurrency=1` is required because the tests share server state (creating and deleting the same job name). Without it, `node:test` runs top-level tests concurrently and ordered dependencies will fail non-deterministically.

- [ ] **Step 3: Add `port` getter to server.js**

In `server.js`, add after the `stop()` method:

```javascript
// Returns the actual bound port — useful for tests using port:0 (random port)
get port() {
  return this.#httpServer?.address()?.port ?? this.#port;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test --test-concurrency=1 tests/api.test.js
```
Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server.js tests/api.test.js
git commit -m "feat: add server.port getter and API contract tests"
```

---

### Task 3: api.js

**Files:**
- Create: `public/js/api.js`

- [ ] **Step 1: Create api.js**

Create `public/js/api.js`:

```javascript
// api.js — all backend communication for the Scrape Tool frontend.
//
// Every fetch() call lives here. No other file calls fetch() directly.
// This is the single seam: to swap Express for Tauri IPC, update only this file.
//
// All functions return parsed JSON or throw an Error with a .status property.

const _BASE = '';  // Same origin — Express serves both API and static files

async function _req(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${_BASE}${path}`, opts);
  if (!res.ok) {
    const err = new Error(`API ${res.status}: ${path}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Returns [{ name, runs }]
function listJobs() {
  return _req('GET', '/api/jobs');
}

// Returns the raw config object
function getJob(name) {
  return _req('GET', `/api/jobs/${encodeURIComponent(name)}`);
}

// Creates or overwrites a job config. POST /api/jobs is idempotent (silent overwrite).
// Use for both create and update. Returns { ok: true } with status 201.
// Use response.ok (not === 200) to detect success.
function saveJob(name, config) {
  return _req('POST', '/api/jobs', { name, config });
}

// Returns { ok: true }
function deleteJob(name) {
  return _req('DELETE', `/api/jobs/${encodeURIComponent(name)}`);
}

// Starts a scrape. Returns { runId } with status 202 (run is async).
function runJob(name) {
  return _req('POST', `/api/jobs/${encodeURIComponent(name)}/run`);
}

// Returns [{ file, name }] in filesystem order (NOT sorted).
// Sort by .name to get chronological order — name format: "<jobname>-<timestamp_ms>"
//   runs.sort((a, b) => a.name.localeCompare(b.name))
function listRuns(name) {
  return _req('GET', `/api/jobs/${encodeURIComponent(name)}/runs`);
}

// Returns the full result object. May be null (captcha failure).
function getRun(name, runId) {
  return _req('GET', `/api/jobs/${encodeURIComponent(name)}/runs/${encodeURIComponent(runId)}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add public/js/api.js
git commit -m "feat: add api.js frontend API module"
```

---

### Task 4: chart.js

**Files:**
- Create: `public/js/chart.js`

- [ ] **Step 1: Create chart.js**

Create `public/js/chart.js`:

```javascript
// chart.js — sparkline bar chart renderer.
//
// drawSparkline(canvas, data)
//   canvas — <canvas> element
//   data   — [{ count: number, status: 'success'|'error' }]
//
// Each bar = one run. Height ∝ items scraped. Color = green (success) / orange (error).
// Bars are 40% opacity so text layered above the canvas stays readable.

function drawSparkline(canvas, data) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  if (!data || data.length === 0) return;

  const maxCount = Math.max(...data.map(d => d.count), 1);
  const barWidth = width / data.length;
  const gap = 2;

  data.forEach((d, i) => {
    // Always draw at least a 2px nub if count > 0 so the bar is visible
    const barHeight = d.count > 0
      ? Math.max((d.count / maxCount) * height, 2)
      : 0;
    const x = i * barWidth;
    const y = height - barHeight;

    ctx.fillStyle = d.status === 'error'
      ? 'rgba(232, 125, 62, 0.4)'   // --orange
      : 'rgba(180, 210, 115, 0.4)'; // --green

    ctx.fillRect(x + gap / 2, y, barWidth - gap, barHeight);
  });
}
```

- [ ] **Step 2: Verify manually**

Add to the bottom of `public/template.html` temporarily:

```html
<canvas id="tc" width="200" height="60" style="background:#1e1d1b;display:block;margin-top:1rem;"></canvas>
<script src="/js/chart.js"></script>
<script>
  drawSparkline(document.getElementById('tc'), [
    { count: 10, status: 'success' },
    { count: 0,  status: 'error'   },
    { count: 25, status: 'success' },
    { count: 5,  status: 'success' },
    { count: 0,  status: 'error'   },
  ]);
</script>
```

Open `http://localhost:3000/template.html` — green and orange bars should appear.
Remove the test snippet from `template.html` after verifying.

- [ ] **Step 3: Confirm template.html is clean before committing**

```bash
git diff public/template.html
```
Expected: no diff (the snippet was not staged). If changes appear, revert:
```bash
git checkout public/template.html
```

- [ ] **Step 4: Commit**

```bash
git add public/js/chart.js
git commit -m "feat: add chart.js sparkline renderer"
```

---

### Task 5: form.js + CSS update

**Files:**
- Create: `public/js/form.js`
- Modify: `public/css/style.css`

- [ ] **Step 1: Add 6-column field row CSS**

In `public/css/style.css`, after the existing `.field-row` rule, add:

```css
/* 6-column variant for config form rows:
   [name] [selector] [mode] [type] [group-toggle] [remove]
   Must be used alongside .field-row (which sets display:grid). */
.field-row-6 {
  grid-template-columns: 1fr 1.5fr 1fr 1fr auto auto;
}

/* Group container */
.group-row {
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  background: var(--bg-secondary);
}

.group-subfields {
  padding-left: 1rem;
  border-left: 2px solid var(--border);
  margin: 0.5rem 0;
}
```

- [ ] **Step 2: Create form.js**

Create `public/js/form.js`:

```javascript
// form.js — config form builder for the Job Config tab.
//
// No `export` statements — functions are global, consumed by job.js in the same page.
// This is intentional: plain HTML/JS, no module bundler.
//
// Public API:
//   initForm(container)          — wire up "Add Field" and "Add Pagination" buttons
//   buildForm(container, config) — populate form from a config object
//   readForm(container)          — assemble config object from form state; returns null if URL is empty
//
// Note: "ungroup" (converting a Group row back to a flat field) is not implemented.
// The user must remove the Group row and re-add flat fields manually.
//
// Config schema (mirrors scraper.js):
//   { URL, FieldName: [sel, mode, type], GroupName: [{sub: [sel,mode,type]}, mode, 'Group'],
//     PagKey: [sel, pagMode, 'Pagination'] }

const _FIELD_TYPES  = ['Text', 'URL', 'DateTime', 'Title'];
const _MODES        = ['Single', 'All'];
const _PAGING_MODES = ['Click', 'Scroll', 'URL'];

// ── DOM helpers ───────────────────────────────────────────────────────────────

function _select(options, selected) {
  const s = document.createElement('select');
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt; o.textContent = opt;
    if (opt === selected) o.selected = true;
    s.appendChild(o);
  }
  return s;
}

function _input(placeholder, value = '') {
  const i = document.createElement('input');
  i.type = 'text'; i.placeholder = placeholder; i.value = value;
  return i;
}

function _btn(text, cls) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = text; b.className = cls;
  return b;
}

// ── Flat field row ────────────────────────────────────────────────────────────
// Columns: [name] [selector] [mode] [type] [Group] [✕]

function _makeFieldRow(name = '', selector = '', mode = 'Single', type = 'Text') {
  const row = document.createElement('div');
  row.className = 'field-row field-row-6';
  row.dataset.rowType = 'field';

  const nameIn = _input('Field name', name);     nameIn.dataset.role = 'name';
  const selIn  = _input('CSS selector', selector); selIn.dataset.role = 'selector';
  const modeS  = _select(_MODES, mode);           modeS.dataset.role = 'mode';
  const typeS  = _select(_FIELD_TYPES, type);     typeS.dataset.role = 'type';

  const groupBtn  = _btn('Group', 'btn btn-sm btn-ghost');
  const removeBtn = _btn('✕',    'btn btn-sm btn-danger');

  groupBtn.addEventListener('click',  () => _convertToGroup(row));
  removeBtn.addEventListener('click', () => row.remove());

  row.append(nameIn, selIn, modeS, typeS, groupBtn, removeBtn);
  return row;
}

// ── Pagination row ────────────────────────────────────────────────────────────
// Columns: [name] [selector] [paging-mode] [label] [—] [✕]

function _makePaginationRow(name = 'Pagination', selector = '', mode = 'Click') {
  const row = document.createElement('div');
  row.className = 'field-row field-row-6';
  row.dataset.rowType = 'pagination';

  const nameIn = _input('Field name', name);       nameIn.dataset.role = 'name';
  const selIn  = _input('CSS selector', selector); selIn.dataset.role = 'selector';
  const modeS  = _select(_PAGING_MODES, mode);     modeS.dataset.role = 'mode';

  const label  = document.createElement('span');
  label.className = 'text-faint text-mono'; label.textContent = 'Pagination';
  const spacer    = document.createElement('span');
  const removeBtn = _btn('✕', 'btn btn-sm btn-danger');

  removeBtn.addEventListener('click', () => row.remove());
  row.append(nameIn, selIn, modeS, label, spacer, removeBtn);
  return row;
}

// ── Group row ─────────────────────────────────────────────────────────────────

function _makeGroupRow(name = '', mode = 'All', subFields = []) {
  const wrapper = document.createElement('div');
  wrapper.className = 'group-row';
  wrapper.dataset.rowType = 'group';

  // Header: [name] [mode] [label] [—] [—] [✕]
  const header = document.createElement('div');
  header.className = 'group-header field-row field-row-6';

  const nameIn    = _input('Group name', name); nameIn.dataset.role = 'name';
  const modeS     = _select(_MODES, mode);      modeS.dataset.role  = 'mode';
  const label     = document.createElement('span');
  label.className = 'text-faint text-mono'; label.textContent = 'Group';
  const s1 = document.createElement('span');
  const s2 = document.createElement('span');
  const removeBtn = _btn('✕', 'btn btn-sm btn-danger');

  const subList = document.createElement('div');
  subList.className = 'group-subfields';

  removeBtn.addEventListener('click', () => {
    const hasKids = subList.querySelectorAll('[data-row-type]').length > 0;
    if (hasKids && !confirm('Remove group and all its sub-fields?')) return;
    wrapper.remove();
  });

  header.append(nameIn, modeS, label, s1, s2, removeBtn);

  // Sub-fields
  for (const sf of subFields) {
    subList.appendChild(_makeSubFieldRow(sf.name, sf.selector, sf.mode, sf.type));
  }

  const addSubBtn = _btn('+ Add sub-field', 'btn btn-sm btn-ghost');
  addSubBtn.style.marginTop = '0.4rem';
  addSubBtn.addEventListener('click', () => subList.appendChild(_makeSubFieldRow()));

  wrapper.append(header, subList, addSubBtn);
  return wrapper;
}

// Sub-field row (like field row but no Group toggle)
function _makeSubFieldRow(name = '', selector = '', mode = 'Single', type = 'Text') {
  const row = document.createElement('div');
  row.className = 'field-row field-row-6';
  row.dataset.rowType = 'subfield';

  const nameIn = _input('Field name', name);       nameIn.dataset.role = 'name';
  const selIn  = _input('CSS selector', selector); selIn.dataset.role  = 'selector';
  const modeS  = _select(_MODES, mode);            modeS.dataset.role  = 'mode';
  const typeS  = _select(_FIELD_TYPES, type);      typeS.dataset.role  = 'type';
  const spacer    = document.createElement('span');
  const removeBtn = _btn('✕', 'btn btn-sm btn-danger');

  removeBtn.addEventListener('click', () => row.remove());
  row.append(nameIn, selIn, modeS, typeS, spacer, removeBtn);
  return row;
}

function _convertToGroup(row) {
  const name = row.querySelector('[data-role="name"]').value;
  // Conversion is intentionally destructive: a flat field's selector/mode/type
  // don't map to a Group's structure (which holds sub-fields, not a single selector).
  // Only the field name is preserved. The user must add sub-fields manually.
  row.replaceWith(_makeGroupRow(name));
}

// ── Public API ────────────────────────────────────────────────────────────────

// Wire up Add Field / Add Pagination buttons. Call once after form HTML is in DOM.
// job.js MUST call initForm(container) on page load AND buildForm(container, config)
// after getJob resolves. They are separate so the buttons work even before a config loads.
function initForm(container) {
  container.querySelector('[data-action="add-field"]')
    ?.addEventListener('click', () => {
      container.querySelector('[data-fields]').appendChild(_makeFieldRow());
    });

  container.querySelector('[data-action="add-pagination"]')
    ?.addEventListener('click', () => {
      // Only one pagination row allowed — replace any existing one
      container.querySelector('[data-fields] [data-row-type="pagination"]')?.remove();
      container.querySelector('[data-fields]').appendChild(_makePaginationRow());
    });
}

// Populate form from a config object. Clears existing rows first.
function buildForm(container, config) {
  const urlInput  = container.querySelector('[data-field="url"]');
  const fieldList = container.querySelector('[data-fields]');
  if (!fieldList) return;
  fieldList.innerHTML = '';
  if (!config) return;
  if (urlInput && config.URL) urlInput.value = config.URL;

  for (const [name, def] of Object.entries(config)) {
    if (name === 'URL' || name.startsWith('_')) continue;
    const type = Array.isArray(def) ? def[def.length - 1] : null;

    if (type === 'Pagination') {
      fieldList.appendChild(_makePaginationRow(name, def[0], def[1]));
    } else if (type === 'Group') {
      const [subObj, mode] = def;
      const subs = Object.entries(subObj).map(([n, d]) => ({
        name: n, selector: d[0], mode: d[1], type: d[2],
      }));
      fieldList.appendChild(_makeGroupRow(name, mode, subs));
    } else {
      fieldList.appendChild(_makeFieldRow(name, def[0], def[1], def[2]));
    }
  }
}

// Read form state into a config object. Returns null if URL is empty.
// IMPORTANT: readForm only assembles data fields (URL, flat fields, groups, pagination).
// It skips keys beginning with '_' (like _settings, _chain, _schedule) to avoid
// overwriting them. job.js is responsible for merging those keys back into the
// config before calling saveJob — i.e.:
//   const config = readForm(form);
//   const existing = await getJob(name);
//   config._settings = existing._settings;  // preserve settings
//   await saveJob(name, config);
function readForm(container) {
  const urlInput = container.querySelector('[data-field="url"]');
  const url = urlInput?.value.trim();
  if (!url) return null;

  const config = { URL: url };
  const fieldList = container.querySelector('[data-fields]');
  if (!fieldList) return config;

  for (const row of fieldList.children) {
    const rt = row.dataset.rowType;

    if (rt === 'field') {
      const name = row.querySelector('[data-role="name"]').value.trim();
      if (!name) continue;
      config[name] = [
        row.querySelector('[data-role="selector"]').value.trim(),
        row.querySelector('[data-role="mode"]').value,
        row.querySelector('[data-role="type"]').value,
      ];
    }

    if (rt === 'pagination') {
      const name = row.querySelector('[data-role="name"]').value.trim() || 'Pagination';
      config[name] = [
        row.querySelector('[data-role="selector"]').value.trim(),
        row.querySelector('[data-role="mode"]').value,
        'Pagination',
      ];
    }

    if (rt === 'group') {
      const name = row.querySelector('.group-header [data-role="name"]').value.trim();
      if (!name) continue;
      const mode  = row.querySelector('.group-header [data-role="mode"]').value;
      const subObj = {};
      for (const sub of row.querySelectorAll('[data-row-type="subfield"]')) {
        const sfName = sub.querySelector('[data-role="name"]').value.trim();
        if (!sfName) continue;
        subObj[sfName] = [
          sub.querySelector('[data-role="selector"]').value.trim(),
          sub.querySelector('[data-role="mode"]').value,
          sub.querySelector('[data-role="type"]').value,
        ];
      }
      config[name] = [subObj, mode, 'Group'];
    }
  }

  return config;
}
```

- [ ] **Step 3: Commit**

```bash
git add public/js/form.js public/css/style.css
git commit -m "feat: add form.js config builder and CSS group/field-row-6 styles"
```

---

## Chunk 2: Dashboard Page

### Task 6: index.html

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Replace placeholder with dashboard shell**

Replace the full contents of `public/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dashboard — Scrape Tool</title>
  <link rel="stylesheet" href="/css/style.css" />
  <style>
    .job-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
    }

    /* Job card — clickable, relative for sparkline positioning */
    .job-card {
      position: relative;
      overflow: hidden;
      cursor: pointer;
      min-height: 120px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: border-color var(--transition);
      text-decoration: none;
      color: inherit;
    }

    .job-card:hover { border-color: var(--border-hover); }

    /* Sparkline sits behind all card text */
    .job-card canvas.sparkline {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }

    /* Card text content sits above the canvas */
    .job-card .card-content {
      position: relative;
      z-index: 1;
    }

    .card-name {
      font-family: var(--font-mono);
      font-size: 0.9rem;
      color: var(--text-normal);
    }

    .card-title-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.25rem;
    }

    .card-meta {
      font-size: 0.78rem;
      color: var(--text-faint);
      margin-top: 0.5rem;
    }

    /* + New job card */
    .job-card-new {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 120px;
      cursor: pointer;
      color: var(--text-faint);
      font-size: 2rem;
      transition: color var(--transition), border-color var(--transition);
    }

    .job-card-new:hover {
      color: var(--accent);
      border-color: var(--accent);
    }

    /* Inline new-job prompt replaces the + card */
    .new-job-prompt {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      min-height: 120px;
      justify-content: center;
    }

    .new-job-error {
      font-size: 0.8rem;
      color: var(--danger);
      min-height: 1.2em;
    }
  </style>
</head>
<body>
  <script src="/js/layout.js"></script>
  <main class="tw-main">
    <div class="page-header">
      <h1>Dashboard</h1>
    </div>
    <div id="job-grid" class="job-grid"></div>
  </main>
  <script src="/js/api.js"></script>
  <script src="/js/chart.js"></script>
  <script src="/js/dashboard.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: replace index.html placeholder with dashboard shell"
```

---

### Task 7: dashboard.js

**Files:**
- Create: `public/js/dashboard.js`

- [ ] **Step 1: Create dashboard.js**

Create `public/js/dashboard.js`:

```javascript
// dashboard.js — job card grid, polling, and + new job flow.
//
// Job status is derived state stored in sessionStorage:
//   sessionStorage.getItem('status:<name>') → 'running' | 'error' | 'stopped'
// On hard refresh all statuses reset to 'stopped' (safe default).
//
// Dependencies (loaded before this script): api.js, chart.js

const POLL_MS = 5000;

// ── Status helpers ────────────────────────────────────────────────────────────

function _getStatus(name) {
  return sessionStorage.getItem(`status:${name}`) || 'stopped';
}

// ── Sparkline data ────────────────────────────────────────────────────────────

async function _sparklineData(jobName) {
  try {
    const runs   = await listRuns(jobName);
    const sorted = runs.sort((a, b) => a.name.localeCompare(b.name)).slice(-20);
    return Promise.all(sorted.map(async ({ name: runId }) => {
      try {
        const result = await getRun(jobName, runId);
        if (result === null) return { count: 0, status: 'error' };
        const count = Array.isArray(result)
          ? result.reduce((s, p) => s + Object.keys(p).length, 0)
          : Object.keys(result).length;
        return { count, status: 'success' };
      } catch { return { count: 0, status: 'error' }; }
    }));
  } catch { return []; }
}

// ── Last run summary ──────────────────────────────────────────────────────────

async function _lastRunSummary(jobName) {
  try {
    const runs = await listRuns(jobName);
    if (runs.length === 0) return 'Never run';
    const sorted = runs.sort((a, b) => a.name.localeCompare(b.name));
    const latest = sorted[sorted.length - 1];
    const ts = parseInt(latest.name.split('-').pop(), 10);
    const ms = Date.now() - ts;
    const ago = ms < 60000   ? 'just now'
              : ms < 3600000 ? `${Math.floor(ms / 60000)}m ago`
              : ms < 86400000? `${Math.floor(ms / 3600000)}h ago`
              :                `${Math.floor(ms / 86400000)}d ago`;
    const result = await getRun(jobName, latest.name);
    const count  = result === null ? 0
      : Array.isArray(result)
        ? result.reduce((s, p) => s + Object.keys(p).length, 0)
        : Object.keys(result).length;
    return `Last run ${ago} · ${count} items`;
  } catch { return 'Never run'; }
}

// ── Card creation ─────────────────────────────────────────────────────────────

function _badgeClass(status) {
  return { running: 'badge-success', error: 'badge-error', stopped: 'badge-muted' }[status]
    ?? 'badge-muted';
}

async function _makeJobCard(name) {
  const status = _getStatus(name);
  const dest   = (status === 'running' || status === 'error')
    ? `/results.html?name=${encodeURIComponent(name)}`
    : `/job.html?name=${encodeURIComponent(name)}`;

  const card = document.createElement('a');
  card.className = 'card job-card';
  card.href = dest;

  const canvas = document.createElement('canvas');
  canvas.className = 'sparkline';
  card.appendChild(canvas);

  const content = document.createElement('div');
  content.className = 'card-content';

  const titleRow = document.createElement('div');
  titleRow.className = 'card-title-row';

  const nameEl = document.createElement('span');
  nameEl.className = 'card-name';
  nameEl.textContent = name;

  const badge = document.createElement('span');
  badge.className = `badge ${_badgeClass(status)}`;
  badge.textContent = status;

  titleRow.append(nameEl, badge);

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  meta.textContent = '…';

  content.append(titleRow, meta);
  card.appendChild(content);

  // Populate async data after card is in DOM (so offsetWidth is available)
  requestAnimationFrame(() => {
    canvas.width  = card.offsetWidth;
    canvas.height = card.offsetHeight || 120;
    _sparklineData(name).then(data => drawSparkline(canvas, data));
  });

  _lastRunSummary(name).then(s => { meta.textContent = s; });

  return card;
}

function _makeNewJobCard() {
  const card = document.createElement('div');
  card.className = 'card job-card-new';
  card.textContent = '+';
  card.addEventListener('click', () => _showNewJobPrompt(card));
  return card;
}

function _showNewJobPrompt(card) {
  card.textContent = '';
  card.className = 'card new-job-prompt';

  const input = document.createElement('input');
  input.type = 'text'; input.placeholder = 'Job name';

  const errEl = document.createElement('div');
  errEl.className = 'new-job-error';

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:0.5rem';

  const ok  = document.createElement('button');
  ok.className = 'btn btn-primary btn-sm'; ok.textContent = 'Create';

  const cancel = document.createElement('button');
  cancel.className = 'btn btn-ghost btn-sm'; cancel.textContent = 'Cancel';

  btnRow.append(ok, cancel);
  card.append(input, errEl, btnRow);
  input.focus();

  cancel.addEventListener('click', _renderGrid);

  async function _submit() {
    const name = input.value.trim();
    if (!name) { errEl.textContent = 'Name required.'; return; }
    try {
      const jobs = await listJobs();
      if (jobs.find(j => j.name === name)) {
        errEl.textContent = 'A job with that name already exists.'; return;
      }
      await saveJob(name, { URL: '' });
      window.location.href = `/job.html?name=${encodeURIComponent(name)}`;
    } catch {
      errEl.textContent = 'Failed to create job.';
    }
  }

  ok.addEventListener('click', _submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') _submit(); });
}

// ── Grid render ───────────────────────────────────────────────────────────────

async function _renderGrid() {
  const grid = document.getElementById('job-grid');
  grid.innerHTML = '';

  try {
    const jobs = await listJobs();

    if (jobs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = 'No jobs yet. Click <strong>+</strong> to create one.';
      grid.appendChild(empty);
    } else {
      for (const { name } of jobs) {
        grid.appendChild(await _makeJobCard(name));
      }
    }
  } catch {
    const err = document.createElement('div');
    err.className = 'empty-state';
    err.textContent = 'Could not load jobs. Is the server running?';
    grid.appendChild(err);
  }

  grid.appendChild(_makeNewJobCard());
}

// ── Init ──────────────────────────────────────────────────────────────────────

_renderGrid();
setInterval(_renderGrid, POLL_MS);
```

- [ ] **Step 2: Manual test**

```bash
node server.js
```
Open `http://localhost:3000`:
- Empty state + `+` card shown
- Click `+` → inline prompt appears
- Enter a name, press Enter → navigates to `/job.html?name=<name>`
- Return to dashboard → card appears for the new job

- [ ] **Step 3: Commit**

```bash
git add public/js/dashboard.js
git commit -m "feat: add dashboard.js card grid and new job flow"
```

---

## Chunk 3: Job Detail Page 1 (Config & Setup)

### Task 8: job.html

**Files:**
- Create: `public/job.html`

- [ ] **Step 1: Create job.html**

Create `public/job.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Job — Scrape Tool</title>
  <link rel="stylesheet" href="/css/style.css" />
  <style>
    .tab-bar {
      display: flex;
      border-bottom: 1px solid var(--border);
      margin-bottom: 1.5rem;
    }
    .tab-btn {
      padding: 0.5rem 1.25rem;
      font-size: 0.875rem;
      color: var(--text-muted);
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      transition: color var(--transition), border-color var(--transition);
      margin-bottom: -1px;
    }
    .tab-btn:hover { color: var(--text-normal); }
    .tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }
    .page-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.5rem;
    }
    .setup-section { margin-bottom: 2rem; }
    .setup-section h3 { margin-bottom: 0.75rem; }
  </style>
</head>
<body>
  <script src="/js/layout.js"></script>
  <main class="tw-main">

    <div class="page-nav">
      <h2 id="job-heading">…</h2>
      <a id="view-results-link" href="#" class="btn btn-ghost btn-sm">View Results →</a>
    </div>

    <div class="tab-bar">
      <button class="tab-btn active" data-tab="config">Config</button>
      <button class="tab-btn" data-tab="setup">Setup</button>
    </div>

    <!-- Config tab -->
    <div id="tab-config" class="tab-panel active">
      <div id="config-form">
        <div class="form-group">
          <label for="config-url">Target URL</label>
          <input type="url" id="config-url" data-field="url" placeholder="https://example.com" />
        </div>
        <div class="form-group">
          <label>Fields</label>
          <div id="field-list" data-fields></div>
        </div>
        <div class="flex gap-1 mt-2">
          <button class="btn btn-ghost btn-sm" data-action="add-field">+ Add Field</button>
          <button class="btn btn-ghost btn-sm" data-action="add-pagination">+ Add Pagination</button>
        </div>
        <hr />
        <div class="flex gap-1 mt-2" style="align-items:center;">
          <button id="save-btn" class="btn btn-primary">Save Config</button>
          <span id="save-status" class="text-muted" style="font-size:0.85rem;"></span>
        </div>
      </div>
    </div>

    <!-- Setup tab -->
    <div id="tab-setup" class="tab-panel">

      <div class="setup-section">
        <h3>URL Source</h3>
        <p class="text-muted" style="font-size:0.875rem;">
          Uses the URL from Config. File upload and chain-input sources are coming soon.
        </p>
      </div>
      <hr />

      <div class="setup-section">
        <h3>Run</h3>
        <div style="display:flex; align-items:center; gap:1rem;">
          <button id="run-now-btn" class="btn btn-primary">Run Now</button>
          <span id="run-status" class="text-muted" style="font-size:0.85rem;"></span>
        </div>
      </div>
      <hr />

      <div class="setup-section">
        <h3>Schedule</h3>
        <p class="text-muted" style="font-size:0.875rem;">Scheduled runs are coming soon.</p>
      </div>
      <hr />

      <div class="setup-section">
        <h3>Request Settings</h3>
        <div class="form-group">
          <label for="setting-delay">Delay between pages (ms)</label>
          <input type="number" id="setting-delay" placeholder="0" min="0" style="max-width:200px;" />
        </div>
        <div class="form-group">
          <label for="setting-max-pages">Max pages (blank = no cap)</label>
          <input type="number" id="setting-max-pages" placeholder="∞" min="1" style="max-width:200px;" />
        </div>
        <div style="display:flex; align-items:center; gap:1rem;">
          <button id="save-settings-btn" class="btn btn-sm">Save Settings</button>
          <span id="settings-status" class="text-muted" style="font-size:0.85rem;"></span>
        </div>
      </div>
      <hr />

      <div class="setup-section">
        <h3>Chain Output</h3>
        <p class="text-muted" style="font-size:0.875rem;">Chain jobs together — coming soon.</p>
      </div>

    </div>
  </main>
  <script src="/js/api.js"></script>
  <script src="/js/form.js"></script>
  <script src="/js/job.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/job.html
git commit -m "feat: add job.html Config and Setup shell"
```

---

### Task 9: job.js

**Files:**
- Create: `public/js/job.js`

- [ ] **Step 1: Create job.js**

Create `public/js/job.js`:

```javascript
// job.js — Job detail Page 1: Config & Setup tabs.
//
// Reads ?name= from URL. Loads config into form. Handles Save, Run Now, Settings.
// Dependencies: api.js, form.js

const _params  = new URLSearchParams(window.location.search);
const _jobName = _params.get('name');
if (!_jobName) window.location.href = '/index.html';

// ── Page setup ────────────────────────────────────────────────────────────────

document.title = `${_jobName} — Scrape Tool`;
document.getElementById('job-heading').textContent = _jobName;
document.getElementById('view-results-link').href =
  `/results.html?name=${encodeURIComponent(_jobName)}`;

// ── Tab switching ─────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ── Config form ───────────────────────────────────────────────────────────────

const _form = document.getElementById('config-form');
initForm(_form);

async function _loadConfig() {
  try {
    const config = await getJob(_jobName);
    buildForm(_form, config);
  } catch (err) {
    if (err.status !== 404) console.error('Failed to load config:', err);
    // 404 = new job, start with empty form
  }
}

document.getElementById('save-btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('save-status');
  const config   = readForm(_form);
  if (!config) {
    statusEl.textContent = 'Target URL is required.';
    statusEl.style.color = 'var(--danger)'; return;
  }
  try {
    // Preserve _settings/_chain/_schedule keys that live in Setup tab, not the form
    const existing = await getJob(_jobName).catch(() => ({}));
    for (const key of Object.keys(existing)) {
      if (key.startsWith('_')) config[key] = existing[key];
    }
    await saveJob(_jobName, config);
    statusEl.textContent = 'Saved.';
    statusEl.style.color = 'var(--accent)';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  } catch {
    statusEl.textContent = 'Save failed.';
    statusEl.style.color = 'var(--danger)';
  }
});

// ── Request Settings ──────────────────────────────────────────────────────────

async function _loadSettings() {
  try {
    const config   = await getJob(_jobName);
    const settings = config._settings || {};
    if (settings.delay)    document.getElementById('setting-delay').value    = settings.delay;
    if (settings.maxPages) document.getElementById('setting-max-pages').value = settings.maxPages;
  } catch {}
}

document.getElementById('save-settings-btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('settings-status');
  try {
    const config   = await getJob(_jobName);
    const delay    = document.getElementById('setting-delay').value;
    const maxPages = document.getElementById('setting-max-pages').value;
    config._settings = {};
    if (delay)    config._settings.delay    = parseInt(delay,    10);
    if (maxPages) config._settings.maxPages = parseInt(maxPages, 10);
    await saveJob(_jobName, config);
    statusEl.textContent = 'Saved.';
    statusEl.style.color = 'var(--accent)';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  } catch {
    statusEl.textContent = 'Save failed.';
    statusEl.style.color = 'var(--danger)';
  }
});

// ── Run Now ───────────────────────────────────────────────────────────────────

document.getElementById('run-now-btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('run-status');
  statusEl.textContent = 'Starting…';
  statusEl.style.color = 'var(--text-muted)';
  try {
    const { runId } = await runJob(_jobName);
    sessionStorage.setItem(`status:${_jobName}`, 'running');
    window.location.href =
      `/results.html?name=${encodeURIComponent(_jobName)}&runId=${encodeURIComponent(runId)}`;
  } catch {
    statusEl.textContent = 'Failed to start.';
    statusEl.style.color = 'var(--danger)';
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

_loadConfig();
_loadSettings();
```

- [ ] **Step 2: Manual test**

```bash
node server.js
```
Open `http://localhost:3000/job.html?name=test`:
- Title shows "test — Scrape Tool", heading shows "test"
- Config tab loads with empty form; tabs switch correctly
- Add a field row, set URL, click Save → "Saved." appears
- Reload page → form repopulates from saved config
- Click "Run Now" → navigates to `results.html?name=test&runId=...`

- [ ] **Step 3: Commit**

```bash
git add public/js/job.js
git commit -m "feat: add job.js Config and Setup tab logic"
```

---

## Chunk 4: Job Detail Page 2 (Results, Logs & History)

### Task 10: logs.js

**Files:**
- Create: `public/js/logs.js`

- [ ] **Step 1: Create logs.js**

Create `public/js/logs.js`:

```javascript
// logs.js — SSE client for live log streaming.
//
// connectLogs(runId, logBox) → Promise<void>
//   Opens an SSE connection to /api/logs/:runId immediately.
//   Appends colour-coded log lines to logBox.
//   Resolves when the backend sends a DONE event.
//
// CRITICAL TIMING: Call connectLogs() at the TOP of results.js, before any
// await. The backend fires the first log entries via setImmediate after the
// 202 response — connecting late will silently drop those early entries.

// connectLogs(runId, logBox, onEntry?)
//   onEntry — optional callback called for each log entry: (entry) => void
//             Use this to react to specific levels (e.g. set sessionStorage on ERROR).
function connectLogs(runId, logBox, onEntry) {
  return new Promise((resolve) => {
    const source = new EventSource(`/api/logs/${encodeURIComponent(runId)}`);

    source.onmessage = (event) => {
      const entry = JSON.parse(event.data);

      if (entry.level === 'DONE') {
        source.close();
        resolve();
        return;
      }

      const line = document.createElement('div');
      const cls  = { INFO: 'log-info', WARN: 'log-warn', ERROR: 'log-error' }[entry.level];
      if (cls) line.className = cls;
      line.textContent = `[${entry.timestamp}] [${(entry.level).padEnd(5)}] ${entry.message}`;
      logBox.appendChild(line);
      logBox.scrollTop = logBox.scrollHeight;

      if (onEntry) onEntry(entry);
    };

    source.onerror = () => { source.close(); resolve(); };
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add public/js/logs.js
git commit -m "feat: add logs.js SSE client"
```

---

### Task 11: results.html

**Files:**
- Create: `public/results.html`

- [ ] **Step 1: Create results.html**

Create `public/results.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Results — Scrape Tool</title>
  <link rel="stylesheet" href="/css/style.css" />
  <style>
    .tab-bar {
      display: flex;
      border-bottom: 1px solid var(--border);
      margin-bottom: 1.5rem;
    }
    .tab-btn {
      padding: 0.5rem 1.25rem;
      font-size: 0.875rem;
      color: var(--text-muted);
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      transition: color var(--transition), border-color var(--transition);
      margin-bottom: -1px;
    }
    .tab-btn:hover { color: var(--text-normal); }
    .tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }
    .page-nav {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .log-toggle-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.5rem;
    }
    .results-table-wrap {
      overflow-x: auto;
      padding: 0;
      margin-bottom: 1rem;
    }
    .history-row { cursor: pointer; }
  </style>
</head>
<body>
  <script src="/js/layout.js"></script>
  <main class="tw-main">

    <div class="page-nav">
      <a id="back-link" href="#" class="btn btn-ghost btn-sm">← Config / Setup</a>
      <h2 id="job-heading">…</h2>
    </div>

    <div class="tab-bar">
      <button class="tab-btn active" data-tab="results">Results & Logs</button>
      <button class="tab-btn" data-tab="history">History</button>
    </div>

    <!-- Results & Logs tab -->
    <div id="tab-results" class="tab-panel active">
      <div id="results-area">
        <div class="empty-state">Loading…</div>
      </div>
      <div style="margin-top:1rem;">
        <div class="log-toggle-bar">
          <span class="text-muted" style="font-size:0.85rem;">Logs</span>
          <button id="log-toggle-btn" class="btn btn-ghost btn-sm">Hide Logs</button>
        </div>
        <div id="log-box" class="log-box"></div>
      </div>
    </div>

    <!-- History tab -->
    <div id="tab-history" class="tab-panel">
      <div class="card" style="padding:0;overflow:hidden;">
        <table class="tw-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Items</th>
              <th>Status</th>
              <th>Run ID</th>
            </tr>
          </thead>
          <tbody id="history-body">
            <tr><td colspan="4" class="empty-state">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </div>

  </main>
  <script src="/js/api.js"></script>
  <script src="/js/logs.js"></script>
  <script src="/js/results.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/results.html
git commit -m "feat: add results.html Results/Logs and History shell"
```

---

### Task 12: results.js

**Files:**
- Create: `public/js/results.js`

- [ ] **Step 1: Create results.js**

Create `public/js/results.js`:

```javascript
// results.js — Job detail Page 2: Results & Logs and History tabs.
//
// IMPORTANT: connectLogs() is called at the very top of this script (before any
// await) to avoid missing early SSE events emitted by the backend via setImmediate.
//
// Dependencies: api.js, logs.js

// ── Immediate SSE connection ──────────────────────────────────────────────────
// Must happen before DOMContentLoaded async work to catch early log events.

const _params  = new URLSearchParams(window.location.search);
const _jobName = _params.get('name');
const _runId   = _params.get('runId');

if (!_jobName) window.location.href = '/index.html';

// document.getElementById is safe here because this <script> tag is at the
// bottom of <body> — the DOM is fully parsed before the script executes.
// Do NOT move the <script> tag to <head> without wrapping in DOMContentLoaded.
const _logBox = document.getElementById('log-box');
let   _logsPromise = null;

if (_runId && _logBox) {
  // Pass onEntry callback to catch ERROR-level entries and mark job status immediately.
  // This ensures the dashboard badge shows "error" even if the result is non-null.
  _logsPromise = connectLogs(_runId, _logBox, (entry) => {
    if (entry.level === 'ERROR') {
      sessionStorage.setItem(`status:${_jobName}`, 'error');
    }
  });
}

// ── Page setup ────────────────────────────────────────────────────────────────

document.title = `${_jobName} Results — Scrape Tool`;
document.getElementById('job-heading').textContent = _jobName;
document.getElementById('back-link').href = `/job.html?name=${encodeURIComponent(_jobName)}`;

// ── Tab switching ─────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'history') _loadHistory();
  });
});

// ── Log toggle ────────────────────────────────────────────────────────────────

let _logsVisible = true;

document.getElementById('log-toggle-btn').addEventListener('click', () => {
  _logsVisible = !_logsVisible;
  _logBox.style.display = _logsVisible ? '' : 'none';
  document.getElementById('log-toggle-btn').textContent =
    _logsVisible ? 'Hide Logs' : 'Show Logs';
});

function _hideLogPanel() {
  _logBox.style.display = 'none';
  document.getElementById('log-toggle-btn').style.display = 'none';
  _logsVisible = false;
}

// ── Results rendering ─────────────────────────────────────────────────────────

function _countItems(result) {
  if (result === null) return 0;
  if (Array.isArray(result))
    return result.reduce((s, p) => s + Object.keys(p).length, 0);
  return Object.keys(result).length;
}

function _renderTable(result) {
  const area = document.getElementById('results-area');

  if (result === null) {
    area.innerHTML = '<div class="card"><div class="empty-state" style="color:var(--orange)">Scrape failed — captcha unresolved.</div></div>';
    return;
  }

  const pages = Array.isArray(result) ? result : [result];
  area.innerHTML = '';

  pages.forEach((page, idx) => {
    if (pages.length > 1) {
      const h = document.createElement('h3');
      h.textContent = `Page ${idx + 1}`;
      h.style.marginBottom = '0.5rem';
      area.appendChild(h);
    }

    const keys = Object.keys(page);
    if (keys.length === 0) {
      const e = document.createElement('div');
      e.className = 'empty-state'; e.textContent = 'No data on this page.';
      area.appendChild(e); return;
    }

    const wrap  = document.createElement('div');
    wrap.className = 'card results-table-wrap';
    const table = document.createElement('table');
    table.className = 'tw-table';

    const thead = document.createElement('thead');
    const hRow  = document.createElement('tr');
    keys.forEach(k => {
      const th = document.createElement('th'); th.textContent = k; hRow.appendChild(th);
    });
    thead.appendChild(hRow);
    table.appendChild(thead);

    const tbody  = document.createElement('tbody');
    const maxLen = Math.max(...keys.map(k => Array.isArray(page[k]) ? page[k].length : 1));
    for (let i = 0; i < maxLen; i++) {
      const tr = document.createElement('tr');
      keys.forEach(k => {
        const td  = document.createElement('td');
        const val = Array.isArray(page[k]) ? page[k][i] : (i === 0 ? page[k] : null);
        td.textContent = val ?? '—';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    area.appendChild(wrap);
  });
}

// ── Run loading ───────────────────────────────────────────────────────────────

async function _loadRun(name, runId) {
  document.getElementById('results-area').innerHTML =
    '<div class="empty-state">Loading…</div>';
  try {
    const result = await getRun(name, runId);
    _renderTable(result);
    // Only update status if not already 'error' from an ERROR-level log entry.
    // A null result also means error. Non-null result with no ERROR logs = stopped.
    if (result === null) {
      sessionStorage.setItem(`status:${name}`, 'error');
    } else if (sessionStorage.getItem(`status:${name}`) !== 'error') {
      sessionStorage.setItem(`status:${name}`, 'stopped');
    }
  } catch {
    document.getElementById('results-area').innerHTML =
      '<div class="card"><div class="empty-state" style="color:var(--orange)">Failed to load result.</div></div>';
  }
}

async function _loadMostRecentRun(name) {
  try {
    const runs = await listRuns(name);
    if (runs.length === 0) {
      document.getElementById('results-area').innerHTML =
        '<div class="empty-state">No runs yet. Go to Setup to run this job.</div>';
      _hideLogPanel();
      return;
    }
    const sorted = runs.sort((a, b) => a.name.localeCompare(b.name));
    await _loadRun(name, sorted[sorted.length - 1].name);
  } catch {
    document.getElementById('results-area').innerHTML =
      '<div class="card"><div class="empty-state">Could not load runs.</div></div>';
  }
}

// ── History tab ───────────────────────────────────────────────────────────────

let _historyLoaded = false;

async function _loadHistory() {
  if (_historyLoaded) return;
  _historyLoaded = true;

  const tbody = document.getElementById('history-body');
  tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Loading…</td></tr>';

  try {
    const runs = await listRuns(_jobName);
    if (runs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No runs yet.</td></tr>';
      return;
    }

    // Newest first
    const sorted = runs.sort((a, b) => b.name.localeCompare(a.name));
    tbody.innerHTML = '';

    for (const { name: runId } of sorted) {
      const ts   = parseInt(runId.split('-').pop(), 10);
      const date = isNaN(ts) ? runId : new Date(ts).toLocaleString();

      const tr = document.createElement('tr');
      tr.className = 'history-row';

      const tdDate   = document.createElement('td'); tdDate.textContent = date;
      const tdItems  = document.createElement('td'); tdItems.textContent = '…';
      const tdStatus = document.createElement('td');
      tdStatus.innerHTML = '<span class="badge badge-muted">…</span>';
      const tdId = document.createElement('td');
      tdId.className = 'text-mono text-faint'; tdId.textContent = runId;

      tr.append(tdDate, tdItems, tdStatus, tdId);
      tbody.appendChild(tr);

      // Load item count + status lazily per row
      getRun(_jobName, runId).then(result => {
        tdItems.textContent = _countItems(result);
        tdStatus.innerHTML  = result === null
          ? '<span class="badge badge-error">error</span>'
          : '<span class="badge badge-success">success</span>';
      }).catch(() => {
        tdStatus.innerHTML = '<span class="badge badge-warn">unknown</span>';
      });

      // Click row → load into Results tab and update URL
      tr.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        document.querySelector('[data-tab="results"]').classList.add('active');
        document.getElementById('tab-results').classList.add('active');

        const url = new URL(window.location.href);
        url.searchParams.set('runId', runId);
        window.history.pushState({}, '', url);

        _hideLogPanel();
        _loadRun(_jobName, runId);
      });
    }
  } catch {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Failed to load history.</td></tr>';
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

if (_runId) {
  if (_logsPromise) {
    // Live run — wait for SSE DONE, then load the result.
    // Only set 'stopped' if the onEntry callback hasn't already set 'error'
    // (ERROR-level log entries set status to 'error' in real time).
    _logsPromise.then(() => {
      if (sessionStorage.getItem(`status:${_jobName}`) !== 'error') {
        sessionStorage.setItem(`status:${_jobName}`, 'stopped');
      }
      _loadRun(_jobName, _runId);
    });
  } else {
    _loadRun(_jobName, _runId);
    _hideLogPanel();
  }
} else {
  _hideLogPanel();
  _loadMostRecentRun(_jobName);
}
```

- [ ] **Step 2: Manual test**

```bash
node server.js
```

1. From the dashboard, create a job with a valid URL (e.g. `https://books.toscrape.com`)
2. Add a field (Title, `h1`, Single, Text), save config
3. Go to Setup → click Run Now → verify redirect to `results.html?name=...&runId=...`
4. Watch live logs appear in the log box in real time
5. After run completes, verify the results table renders
6. Click History tab → past run appears with item count and status badge
7. Click the history row → switches to Results tab and loads that run
8. Click "← Config / Setup" → returns to `job.html`

- [ ] **Step 3: Commit**

```bash
git add public/js/results.js
git commit -m "feat: add results.js Results/Logs and History tab logic"
```

---

## Chunk 5: Tauri Setup

### Task 13: Install Prerequisites

- [ ] **Step 1: Install Rust**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Follow the on-screen prompt (option 1 — default install)
source ~/.cargo/env
rustc --version
```
Expected: `rustc 1.xx.x (...)`

- [ ] **Step 2: Install Tauri CLI**

```bash
cargo install tauri-cli --version "^2"
cargo tauri --version
```
Expected: `tauri-cli 2.x.x`

- [ ] **Step 3: Install Arch system dependencies**

```bash
sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget openssl \
  appmenu-gtk-module gtk3 libappindicator-gtk3 librsvg
```

---

### Task 14: Initialize Tauri

- [ ] **Step 1: Run tauri init**

From `/mnt/Work/Coding_Projects/Scrape_Tool`:

```bash
cargo tauri init
```

When prompted:
| Prompt | Answer |
|--------|--------|
| App name | `Scrape Tool` |
| Window title | `Scrape Tool` |
| Frontend dist dir (relative to `src-tauri/`) | `../public` |
| Dev server URL | `http://localhost:3000` |
| Dev command | `node server.js` |
| Build command | *(leave blank)* |

This generates `src-tauri/` with `tauri.conf.json`, `Cargo.toml`, `build.rs`, and `src/main.rs`.

- [ ] **Step 2: Replace tauri.conf.json**

Replace the entire contents of `src-tauri/tauri.conf.json`:

```json
{
  "productName": "Scrape Tool",
  "version": "0.1.0",
  "identifier": "com.scrape-tool.app",
  "build": {
    "frontendDist": "../public",
    "devUrl": "http://localhost:3000",
    "beforeDevCommand": "node server.js",
    "beforeBuildCommand": ""
  },
  "app": {
    "windows": [
      {
        "title": "Scrape Tool",
        "width": 1200,
        "height": 800,
        "minWidth": 960,
        "minHeight": 600,
        "maximized": true,
        "resizable": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["deb", "appimage"],
    "icon": [],
    "resources": [
      "../server.js",
      "../scraper.js",
      "../handler.js",
      "../logging.js",
      "../exporter.js",
      "../plugins/**/*",
      "../public/**/*",
      "../node_modules/**/*"
    ]
  }
}
```

Note: `beforeDevCommand` is a Tauri CLI hook — it does not require `tauri-plugin-shell`. The shell plugin is only needed if frontend JS calls `window.__TAURI__.shell`, which this app does not.

Note: bundling `node_modules` produces a large binary. Acceptable for a personal tool.
Future optimization: use `pkg` or `ncc` to produce a single-file bundle of the Express server.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/
git commit -m "feat: initialize Tauri with window config and bundle targets"
```

---

### Task 15: Express Sidecar in main.rs

- [ ] **Step 1: Verify Cargo.toml**

Check `src-tauri/Cargo.toml`. It should already contain `tauri = { version = "2", ... }`.
Ensure it looks like:

```toml
[package]
name = "scrape-tool"
version = "0.1.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 2: Replace src/main.rs**

Replace the full contents of `src-tauri/src/main.rs`:

```rust
// main.rs — Tauri entry point for Scrape Tool.
//
// Spawns `node server.js` as a background sidecar on launch.
// The Tauri webview connects to http://localhost:3000 (Express).
// On app exit, the Node process is killed via the stored Child handle.
//
// In development (tauri dev):  server.js is in the project root (CWD).
// In production (tauri build): server.js is bundled as a resource next to the binary.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::process::{Command, Child};
use std::sync::{Arc, Mutex};

fn main() {
    let server_js: PathBuf = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
        .map(|dir| dir.join("server.js"))
        .filter(|p| p.exists())
        .unwrap_or_else(|| PathBuf::from("server.js"));

    let working_dir = server_js
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));

    // Spawn and store the child so we can kill it on exit
    let child: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));

    match Command::new("node")
        .arg(&server_js)
        .current_dir(&working_dir)
        .spawn()
    {
        Ok(c)  => *child.lock().unwrap() = Some(c),
        Err(e) => eprintln!("Failed to start Express server: {e}"),
    }

    let child_ref = child.clone();

    tauri::Builder::default()
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(move |_app, event| {
            // Kill the Node sidecar when Tauri exits so it doesn't stay as a zombie
            if let tauri::RunEvent::Exit = event {
                if let Some(mut c) = child_ref.lock().unwrap().take() {
                    let _ = c.kill();
                    let _ = c.wait();
                }
            }
        });
}
```

- [ ] **Step 3: Test with tauri dev**

```bash
cargo tauri dev
```
Expected: A native window opens showing the Scrape Tool dashboard at `http://localhost:3000`.
The Express server is auto-started; the dashboard card grid (or empty state + `+`) is visible.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/main.rs src-tauri/Cargo.toml
git commit -m "feat: add Tauri sidecar to spawn Express server on launch"
```

---

### Task 16: Build Packages

- [ ] **Step 1: Build .deb and .AppImage**

```bash
cargo tauri build
```
Expected output path: `src-tauri/target/release/bundle/`
- `deb/scrape-tool_0.1.0_amd64.deb`
- `appimage/scrape-tool_0.1.0_amd64.AppImage`

Build time: 5–15 minutes on first run (compiles Rust + bundles resources).

- [ ] **Step 2: Test the .AppImage (works on Arch)**

```bash
chmod +x src-tauri/target/release/bundle/appimage/scrape-tool_0.1.0_amd64.AppImage
./src-tauri/target/release/bundle/appimage/scrape-tool_0.1.0_amd64.AppImage
```
Expected: App launches. Dashboard is visible and functional.

- [ ] **Step 3: Test the .deb (Debian/Ubuntu only)**

On a Debian/Ubuntu system:
```bash
sudo dpkg -i src-tauri/target/release/bundle/deb/scrape-tool_0.1.0_amd64.deb
scrape-tool
```

- [ ] **Step 4: Final commit**

```bash
git add src-tauri/
git commit -m "feat: complete Tauri build pipeline for .deb and .AppImage"
```
