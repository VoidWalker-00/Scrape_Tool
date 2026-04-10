# Web Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local single-user web dashboard that lets you create scrape job configs via a form, run them, view results in a table, and stream live logs — with a plugin hook for post-scrape automation.

**Architecture:** Single Express.js app in `server.js` serving a plain HTML/JS frontend from `public/`. The server calls `scraper.js` directly in-process. Logger is extended to emit events so the server can stream logs to the browser via SSE (Server-Sent Events). A `plugins/` folder is auto-scanned after each scrape; dropping in a new file before or after server start registers it automatically on the next scrape run.

**Tech Stack:** Node.js v25, Express, plain HTML/CSS/JS (no frontend framework), SSE for log streaming, Node built-in `assert` + `node:test` for backend tests.

> **Note on job configs:** All configs live in `Data/Selectors/` (e.g. `Data/Selectors/test.json`). There is no top-level `Selectors/` directory. `SELECTORS_DIR` always points to `path.join(__dirname, 'Data', 'Selectors')`.

---

## File Map

| File | Status | Responsibility |
|------|--------|----------------|
| `server.js` | Create | Express app, all API routes, SSE endpoint, plugin runner |
| `logging.js` | Modify | Extend EventEmitter so server can subscribe to log events |
| `scraper.js` | Modify | Accept optional injected Logger in constructor |
| `plugins/index.js` | Create | Auto-scans `plugins/` folder, runs all hooks after scrape |
| `public/index.html` | Create | Dashboard — lists jobs with Run button and last-run status |
| `public/results.html` | Create | Results viewer — table view for a selected run |
| `public/builder.html` | Create | Job Builder — form that generates and saves JSON config |
| `public/js/dashboard.js` | Create | Fetches job list, triggers runs, polls status |
| `public/js/builder.js` | Create | Form logic, builds config object, POSTs to API |
| `public/js/results.js` | Create | Fetches result data, renders table |
| `public/js/logs.js` | Create | Connects to SSE endpoint, renders log stream |
| `public/css/style.css` | Create | Minimal functional styles |
| `tests/server.test.js` | Create | API route tests using Node built-in test runner |
| `tests/scraper.test.js` | Create | Scraper constructor injection test |
| `Data/Results/` | Create | Directory — one subfolder per job, one JSON file per run |

---

## Chunk 1: Logger EventEmitter + Server Foundation

### Task 1: Extend Logger to emit events

**Files:**
- Modify: `logging.js`
- Create: `tests/logger.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/logger.test.js`:
```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const Logger = require('../logging.js');

test('Logger emits log events', (t, done) => {
  const log = new Logger();
  log.once('log', ({ level, message }) => {
    assert.equal(level, 'INFO');
    assert.equal(message, 'hello');
    done();
  });
  log.info('hello');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/logger.test.js
```
Expected: FAIL — Logger has no `once` method.

- [ ] **Step 3: Extend Logger with EventEmitter**

In `logging.js`, add at the top:
```javascript
const { EventEmitter } = require('events');
```

Change class declaration:
```javascript
class Logger extends EventEmitter {
```

Add `super()` as first line of `constructor()`:
```javascript
constructor() {
  super();
  // ... rest unchanged
}
```

In `#log()`, emit after building the line:
```javascript
#log(level, message, colour) {
  const timestamp = this.#getTimestamp();
  const line = `[${timestamp}] [${level}] ${message}`;
  console.log(`${colour}${line}${COLOURS.reset}`);
  this.emit('log', { level: level.trim(), message, timestamp });
  this.#writeToFile(line);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/logger.test.js
```
Expected: PASS

- [ ] **Step 5: Verify existing test still works**

```bash
node test.js
```
Expected: all handler tests pass (skip scraper test if no network).

- [ ] **Step 6: Commit**

```bash
git add logging.js tests/logger.test.js
git commit -m "feat: extend Logger with EventEmitter for SSE log streaming"
```

---

### Task 2: Express server skeleton

**Files:**
- Create: `server.js`
- Create: `public/index.html` (placeholder)
- Create: `tests/server.test.js`

- [ ] **Step 1: Install Express**

```bash
npm install express
```

- [ ] **Step 2: Create minimal server**

`server.js`:
```javascript
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

const SELECTORS_DIR = path.join(__dirname, 'Data', 'Selectors');
const RESULTS_DIR   = path.join(__dirname, 'Data', 'Results');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Dashboard running at http://localhost:${PORT}`));

module.exports = app;
```

- [ ] **Step 3: Create placeholder index.html**

`public/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Scrape Dashboard</title></head>
<body><h1>Dashboard</h1></body>
</html>
```

- [ ] **Step 4: Write health check test**

Create `tests/server.test.js`:
```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SELECTORS_DIR = path.join(__dirname, '..', 'Data', 'Selectors');
const RESULTS_DIR   = path.join(__dirname, '..', 'Data', 'Results');

// Server must be started before running these tests:
//   node server.js &
//   sleep 1
//   node --test tests/server.test.js
//   kill %1

test('GET /api/health returns ok', async () => {
  const res = await fetch('http://localhost:3000/api/health');
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
});
```

- [ ] **Step 5: Run server and test**

```bash
node server.js &
sleep 1
node --test tests/server.test.js
kill %1
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server.js public/index.html tests/server.test.js
git commit -m "feat: add Express server skeleton with health endpoint"
```

---

## Chunk 2: Jobs API

### Task 3: List and get job configs

**Files:**
- Modify: `server.js`
- Modify: `tests/server.test.js`

- [ ] **Step 1: Create Data/Results directory and gitkeep**

```bash
mkdir -p Data/Results
touch Data/Results/.gitkeep
```

- [ ] **Step 2: Write failing tests**

Add to `tests/server.test.js`:
```javascript
test('GET /api/jobs returns array', async () => {
  const res = await fetch('http://localhost:3000/api/jobs');
  const body = await res.json();
  assert.ok(Array.isArray(body));
});

// Depends on Data/Selectors/test.json existing with a "URL" field.
// This file is the project's standard test fixture — do not delete it.
test('GET /api/jobs/test returns config with URL field', async () => {
  const res = await fetch('http://localhost:3000/api/jobs/test');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.URL, 'config must have a URL field');
});

test('GET /api/jobs/:name returns 404 for missing job', async () => {
  const res = await fetch('http://localhost:3000/api/jobs/doesnotexist');
  assert.equal(res.status, 404);
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
node server.js &
sleep 1
node --test tests/server.test.js
kill %1
```
Expected: FAIL — routes don't exist yet.

- [ ] **Step 4: Add routes to server.js**

```javascript
// List all jobs
app.get('/api/jobs', (req, res) => {
  const files = fs.readdirSync(SELECTORS_DIR).filter(f => f.endsWith('.json'));
  const jobs = files.map(f => {
    const name = path.basename(f, '.json');
    const resultsPath = path.join(RESULTS_DIR, name);
    const runs = fs.existsSync(resultsPath) ? fs.readdirSync(resultsPath).length : 0;
    return { name, runs };
  });
  res.json(jobs);
});

// Get a single job config
app.get('/api/jobs/:name', (req, res) => {
  const filePath = path.join(SELECTORS_DIR, `${req.params.name}.json`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
});
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
node server.js &
sleep 1
node --test tests/server.test.js
kill %1
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server.js tests/server.test.js Data/Results/.gitkeep
git commit -m "feat: add GET /api/jobs list and detail endpoints"
```

---

### Task 4: Create and delete job configs

**Files:**
- Modify: `server.js`
- Modify: `tests/server.test.js`

- [ ] **Step 1: Write failing tests**

Add to `tests/server.test.js`:
```javascript
test('POST /api/jobs creates a new config', async () => {
  const res = await fetch('http://localhost:3000/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'test_create',
      config: { URL: 'https://example.com', Title: ['h1', 'Single', 'Text'] }
    })
  });
  assert.equal(res.status, 201);
  // Cleanup
  fs.unlinkSync(path.join(SELECTORS_DIR, 'test_create.json'));
});

test('DELETE /api/jobs/:name removes config', async () => {
  // Create a temp file to delete
  fs.writeFileSync(
    path.join(SELECTORS_DIR, 'test_delete.json'),
    JSON.stringify({ URL: 'https://example.com' })
  );
  const res = await fetch('http://localhost:3000/api/jobs/test_delete', {
    method: 'DELETE'
  });
  assert.equal(res.status, 200);
  assert.ok(!fs.existsSync(path.join(SELECTORS_DIR, 'test_delete.json')));
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
node server.js &
sleep 1
node --test tests/server.test.js
kill %1
```

- [ ] **Step 3: Add routes**

```javascript
// Create job
app.post('/api/jobs', (req, res) => {
  const { name, config } = req.body;
  if (!name || !config) return res.status(400).json({ error: 'name and config required' });
  const filePath = path.join(SELECTORS_DIR, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
  res.status(201).json({ ok: true });
});

// Delete job
app.delete('/api/jobs/:name', (req, res) => {
  const filePath = path.join(SELECTORS_DIR, `${req.params.name}.json`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(filePath);
  res.json({ ok: true });
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node server.js &
sleep 1
node --test tests/server.test.js
kill %1
```

- [ ] **Step 5: Commit**

```bash
git add server.js tests/server.test.js
git commit -m "feat: add POST and DELETE /api/jobs endpoints"
```

---

## Chunk 3: Scrape Runner + SSE Log Streaming

### Task 5: Plugin system

**Files:**
- Create: `plugins/index.js`
- Create: `tests/plugins.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/plugins.test.js`:
```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { runPlugins } = require('../plugins/index.js');

test('runPlugins calls all registered plugins with data', async () => {
  const calls = [];
  const fakePlugins = [
    { name: 'a', run: async (data) => calls.push(`a:${data.job}`) },
    { name: 'b', run: async (data) => calls.push(`b:${data.job}`) },
  ];
  await runPlugins({ job: 'test' }, fakePlugins);
  assert.deepEqual(calls, ['a:test', 'b:test']);
});

test('runPlugins continues if one plugin throws', async () => {
  const calls = [];
  const fakePlugins = [
    { name: 'bad',  run: async () => { throw new Error('oops'); } },
    { name: 'good', run: async (data) => calls.push('good') },
  ];
  await runPlugins({ job: 'test' }, fakePlugins);
  assert.deepEqual(calls, ['good']);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node --test tests/plugins.test.js
```

- [ ] **Step 3: Create plugins/index.js**

```javascript
const fs = require('fs');
const path = require('path');

const PLUGINS_DIR = __dirname;

// Scans the plugins/ folder on every call.
// New plugin files dropped in while the server is running are picked up
// automatically on the next scrape (Node only caches require() for files
// it has already loaded — brand new files are always freshly required).
// If you modify an existing plugin while the server is running, restart
// the server for the change to take effect.
function loadPlugins() {
  return fs.readdirSync(PLUGINS_DIR)
    .filter(f => f.endsWith('.js') && f !== 'index.js')
    .map(f => ({
      name: path.basename(f, '.js'),
      run: require(path.join(PLUGINS_DIR, f)),
    }));
}

async function runPlugins(data, plugins = loadPlugins()) {
  for (const plugin of plugins) {
    try {
      await plugin.run(data);
    } catch (err) {
      console.error(`Plugin "${plugin.name}" failed: ${err.message}`);
    }
  }
}

module.exports = { runPlugins, loadPlugins };
```

- [ ] **Step 4: Run to verify it passes**

```bash
node --test tests/plugins.test.js
```

- [ ] **Step 5: Commit**

```bash
git add plugins/index.js tests/plugins.test.js
git commit -m "feat: add plugin system with auto-scan and runPlugins"
```

---

### Task 6: Update Scraper constructor to accept injected Logger

**Files:**
- Modify: `scraper.js`
- Create: `tests/scraper.test.js`

- [ ] **Step 1: Add a logger getter to Scraper (needed for testing)**

Add this after the private field declarations in `scraper.js`:
```javascript
get logger() { return this.#logger; }
```

- [ ] **Step 2: Write the failing test**

Create `tests/scraper.test.js`:
```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Logger = require('../logging.js');
const Scraper = require('../scraper.js');

const CONFIG = path.join(__dirname, '..', 'Data', 'Selectors', 'test.json');

test('Scraper uses a new Logger when none is injected', () => {
  const scraper = new Scraper(CONFIG);
  assert.ok(scraper.logger instanceof Logger, 'default logger is a Logger instance');
});

test('Scraper uses the injected Logger instead of creating a new one', () => {
  const injected = new Logger();
  const scraper = new Scraper(CONFIG, null, injected);
  assert.strictEqual(scraper.logger, injected, 'injected logger must be the same instance');
});

test('Injected logger receives events during scraper operation', (t, done) => {
  const injected = new Logger();
  // The injected logger should emit events when scraper logs.
  // We verify this by listening before constructing — any log event confirms wiring.
  injected.once('log', ({ message }) => {
    assert.ok(message.length > 0, 'log message should be non-empty');
    done();
  });
  // Constructing with a bad config path triggers an error log — enough to confirm wiring.
  try { new Scraper('/nonexistent.json', null, injected); } catch (_) {}
  // If no event fires within the test timeout, node:test will report a failure.
});
```

- [ ] **Step 3: Run to verify tests fail**

```bash
node --test tests/scraper.test.js
```
Expected: the "injected logger must be the same instance" test FAILS (current constructor ignores the third argument).

- [ ] **Step 4: Update Scraper constructor**

In `scraper.js`, change the constructor signature:
```javascript
constructor(configPath, solverFn = null, logger = null) {
  const raw = fs.readFileSync(configPath, 'utf8');
  this.#config = JSON.parse(raw);
  this.#logger = logger ?? new Logger();
  this.#handler = new Handler(this.#logger);
  this.#solverFn = solverFn;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
node --test tests/scraper.test.js
```
Expected: PASS

- [ ] **Step 6: Verify existing tests still pass**

```bash
node test.js
```

- [ ] **Step 7: Commit**

```bash
git add scraper.js tests/scraper.test.js
git commit -m "feat: allow injected Logger in Scraper constructor for SSE wiring"
```

---

### Task 7: Scrape runner endpoint + SSE log stream

**Files:**
- Modify: `server.js`
- Modify: `tests/server.test.js`

- [ ] **Step 1: Write failing tests**

Add to `tests/server.test.js`:
```javascript
test('POST /api/jobs/:name/run returns 202 and runId', async () => {
  const res = await fetch('http://localhost:3000/api/jobs/test/run', {
    method: 'POST'
  });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.ok(body.runId, 'response must include a runId');
});

test('POST /api/jobs/:name/run returns 404 for missing job', async () => {
  const res = await fetch('http://localhost:3000/api/jobs/doesnotexist/run', {
    method: 'POST'
  });
  assert.equal(res.status, 404);
});

test('GET /api/jobs/:name/runs returns an array', async () => {
  const res = await fetch('http://localhost:3000/api/jobs/test/runs');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body));
});
```

- [ ] **Step 2: Add imports to server.js**

```javascript
const Scraper = require('./scraper.js');
const Logger  = require('./logging.js');
const { runPlugins } = require('./plugins/index.js');

// Active SSE clients: runId → res
const sseClients = new Map();
```

- [ ] **Step 3: Add scrape runner route**

```javascript
app.post('/api/jobs/:name/run', (req, res) => {
  const { name } = req.params;
  const configPath = path.join(SELECTORS_DIR, `${name}.json`);
  if (!fs.existsSync(configPath)) return res.status(404).json({ error: 'Job not found' });

  const runId = `${name}-${Date.now()}`;
  res.status(202).json({ runId });

  // Run scrape in background — each run gets its own Logger instance.
  // Each Logger creates a new timestamped file in Logs/ for this run.
  setImmediate(async () => {
    const logger = new Logger();

    logger.on('log', (entry) => {
      const client = sseClients.get(runId);
      if (client) client.write(`data: ${JSON.stringify(entry)}\n\n`);
    });

    const scraper = new Scraper(configPath, null, logger);

    try {
      await scraper.launch();
      const result = await scraper.scrape();
      await scraper.close();

      const jobResultsDir = path.join(RESULTS_DIR, name);
      fs.mkdirSync(jobResultsDir, { recursive: true });
      const outPath = path.join(jobResultsDir, `${runId}.json`);
      fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

      await runPlugins({ job: name, runId, result, outPath });
    } catch (err) {
      logger.error(`Scrape failed: ${err.message}`);
    } finally {
      const client = sseClients.get(runId);
      if (client) {
        client.write(`data: ${JSON.stringify({ level: 'DONE', message: 'Scrape finished' })}\n\n`);
        client.end();
        sseClients.delete(runId);
      }
    }
  });
});
```

- [ ] **Step 4: Add SSE log stream route**

```javascript
app.get('/api/logs/:runId', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.set(req.params.runId, res);
  req.on('close', () => sseClients.delete(req.params.runId));
});
```

- [ ] **Step 5: Add runs list route**

```javascript
app.get('/api/jobs/:name/runs', (req, res) => {
  const jobResultsDir = path.join(RESULTS_DIR, req.params.name);
  if (!fs.existsSync(jobResultsDir)) return res.json([]);
  const files = fs.readdirSync(jobResultsDir).filter(f => f.endsWith('.json'));
  res.json(files.map(f => ({ file: f, name: path.basename(f, '.json') })));
});
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
node server.js &
sleep 1
node --test tests/server.test.js
kill %1
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server.js tests/server.test.js
git commit -m "feat: add scrape runner, SSE log stream, and runs list endpoints"
```

---

## Chunk 4: Results API + Frontend

### Task 8: Results API

**Files:**
- Modify: `server.js`
- Modify: `tests/server.test.js`

- [ ] **Step 1: Write failing test**

Add to `tests/server.test.js`:
```javascript
test('GET /api/jobs/:name/runs/:runId returns result data', async () => {
  const dir = path.join(RESULTS_DIR, 'test');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'fake-run.json'), JSON.stringify({ Title: 'Test' }));

  const res = await fetch('http://localhost:3000/api/jobs/test/runs/fake-run');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.Title, 'Test');

  // Cleanup
  fs.unlinkSync(path.join(dir, 'fake-run.json'));
});

test('GET /api/jobs/:name/runs/:runId returns 404 for missing run', async () => {
  const res = await fetch('http://localhost:3000/api/jobs/test/runs/doesnotexist');
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Add route**

```javascript
app.get('/api/jobs/:name/runs/:runId', (req, res) => {
  const filePath = path.join(RESULTS_DIR, req.params.name, `${req.params.runId}.json`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
});
```

- [ ] **Step 3: Run tests**

```bash
node server.js &
sleep 1
node --test tests/server.test.js
kill %1
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server.js tests/server.test.js
git commit -m "feat: add GET /api/jobs/:name/runs/:runId results endpoint"
```

---

### Task 9: Dashboard frontend

**Files:**
- Modify: `public/index.html`
- Create: `public/js/dashboard.js`
- Create: `public/css/style.css`

- [ ] **Step 1: Create style.css**

`public/css/style.css`:
```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #f5f5f5; color: #222; }
nav { background: #222; padding: 1rem 2rem; display: flex; gap: 2rem; }
nav a { color: #fff; text-decoration: none; font-weight: bold; }
nav a:hover { color: #adf; }
main { max-width: 960px; margin: 2rem auto; padding: 0 1rem; }
h1 { margin-bottom: 1.5rem; }
table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 6px; overflow: hidden; }
th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #eee; }
th { background: #f0f0f0; font-weight: 600; }
button { padding: 0.4rem 1rem; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem; }
.btn-run { background: #2a7; color: #fff; }
.btn-run:hover { background: #1a6; }
.btn-delete { background: #e44; color: #fff; }
.btn-delete:hover { background: #c33; }
```

- [ ] **Step 2: Build index.html**

`public/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Scrape Dashboard</title>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <nav>
    <a href="/">Dashboard</a>
    <a href="/builder.html">New Job</a>
  </nav>
  <main>
    <h1>Scrape Jobs</h1>
    <table>
      <thead>
        <tr><th>Job</th><th>Runs</th><th>Actions</th></tr>
      </thead>
      <tbody id="job-list"></tbody>
    </table>
  </main>
  <script src="/js/dashboard.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create dashboard.js**

`public/js/dashboard.js`:
```javascript
async function loadJobs() {
  const res = await fetch('/api/jobs');
  const jobs = await res.json();
  const tbody = document.getElementById('job-list');
  tbody.innerHTML = '';

  if (jobs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3">No jobs yet. <a href="/builder.html">Create one.</a></td></tr>';
    return;
  }

  for (const job of jobs) {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    const nameLink = document.createElement('a');
    nameLink.href = `/results.html?job=${encodeURIComponent(job.name)}`;
    nameLink.textContent = job.name;
    nameTd.appendChild(nameLink);

    const runsTd = document.createElement('td');
    runsTd.textContent = job.runs;

    const actionsTd = document.createElement('td');

    const runBtn = document.createElement('button');
    runBtn.className = 'btn-run';
    runBtn.textContent = 'Run';
    runBtn.dataset.job = job.name;
    runBtn.addEventListener('click', () => runJob(job.name));

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-delete';
    delBtn.textContent = 'Delete';
    delBtn.dataset.job = job.name;
    delBtn.addEventListener('click', () => deleteJob(job.name));

    actionsTd.appendChild(runBtn);
    actionsTd.appendChild(document.createTextNode(' '));
    actionsTd.appendChild(delBtn);

    tr.appendChild(nameTd);
    tr.appendChild(runsTd);
    tr.appendChild(actionsTd);
    tbody.appendChild(tr);
  }
}

async function runJob(name) {
  const res = await fetch(`/api/jobs/${encodeURIComponent(name)}/run`, { method: 'POST' });
  const { runId } = await res.json();
  window.location.href = `/results.html?job=${encodeURIComponent(name)}&runId=${encodeURIComponent(runId)}&live=1`;
}

async function deleteJob(name) {
  if (!confirm(`Delete job "${name}"?`)) return;
  await fetch(`/api/jobs/${encodeURIComponent(name)}`, { method: 'DELETE' });
  loadJobs();
}

loadJobs();
```

- [ ] **Step 4: Verify in browser**

```bash
node server.js
```
Open `http://localhost:3000` — job list should appear with `test` listed.

- [ ] **Step 5: Run backend tests**

```bash
node server.js &
sleep 1
node --test tests/server.test.js tests/logger.test.js tests/plugins.test.js tests/scraper.test.js
kill %1
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/js/dashboard.js public/css/style.css
git commit -m "feat: add dashboard frontend with job list and run/delete actions"
```

---

### Task 10: Results viewer + live log stream frontend

**Files:**
- Create: `public/results.html`
- Create: `public/js/results.js`
- Create: `public/js/logs.js`

- [ ] **Step 1: Create results.html**

`public/results.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Results</title>
  <link rel="stylesheet" href="/css/style.css">
  <style>
    #log-box { background: #111; color: #0f0; font-family: monospace; font-size: 0.85rem;
               padding: 1rem; border-radius: 6px; height: 200px; overflow-y: auto;
               margin-bottom: 1.5rem; }
    #run-select { margin-bottom: 1rem; padding: 0.4rem; }
    .warn { color: #fa0; } .error { color: #f44; }
  </style>
</head>
<body>
  <nav>
    <a href="/">Dashboard</a>
    <a href="/builder.html">New Job</a>
  </nav>
  <main>
    <h1 id="page-title">Results</h1>
    <div id="log-box" style="display:none"></div>
    <select id="run-select" style="display:none"></select>
    <div id="results-table"></div>
  </main>
  <script src="/js/logs.js"></script>
  <script src="/js/results.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create logs.js**

`public/js/logs.js`:
```javascript
function startLogStream(runId, logBox) {
  logBox.style.display = 'block';
  const es = new EventSource(`/api/logs/${encodeURIComponent(runId)}`);

  es.onmessage = (e) => {
    const { level, message } = JSON.parse(e.data);
    if (level === 'DONE') { es.close(); logBox.style.display = 'none'; return; }
    const line = document.createElement('div');
    line.textContent = `[${level}] ${message}`;
    if (level === 'WARN')  line.className = 'warn';
    if (level === 'ERROR') line.className = 'error';
    logBox.appendChild(line);
    logBox.scrollTop = logBox.scrollHeight;
  };
}
```

- [ ] **Step 3: Create results.js**

`public/js/results.js`:
```javascript
const params  = new URLSearchParams(location.search);
const jobName = params.get('job');
const runId   = params.get('runId');
const live    = params.get('live');

document.getElementById('page-title').textContent = `Results — ${jobName}`;

if (live && runId) {
  startLogStream(runId, document.getElementById('log-box'));
}

function renderTable(data) {
  const container = document.getElementById('results-table');
  const flat = Array.isArray(data) ? data : [data];
  if (flat.length === 0) { container.textContent = 'No data.'; return; }

  const keys = Object.keys(flat[0]);
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  keys.forEach(k => { const th = document.createElement('th'); th.textContent = k; headerRow.appendChild(th); });
  thead.appendChild(headerRow);
  const tbody = document.createElement('tbody');

  for (const row of flat) {
    const tr = document.createElement('tr');
    for (const k of keys) {
      const td = document.createElement('td');
      td.textContent = JSON.stringify(row[k]);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(thead);
  table.appendChild(tbody);
  container.appendChild(table);
}

async function loadRuns() {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobName)}/runs`);
  const runs = await res.json();
  const select = document.getElementById('run-select');

  if (runs.length === 0) {
    document.getElementById('results-table').textContent = 'No runs yet.';
    return;
  }

  select.style.display = 'block';
  for (const run of runs) {
    const opt = document.createElement('option');
    opt.value = run.name;
    opt.textContent = run.name;
    if (run.name === runId) opt.selected = true;
    select.appendChild(opt);
  }

  select.addEventListener('change', () => loadResult(select.value));
  loadResult(select.value || runs[0].name);
}

async function loadResult(name) {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobName)}/runs/${encodeURIComponent(name)}`);
  const data = await res.json();
  document.getElementById('results-table').innerHTML = '';
  renderTable(data);
}

loadRuns();
```

- [ ] **Step 4: Verify end-to-end in browser**

```bash
node server.js
```
1. Open `http://localhost:3000`
2. Click Run on the test job — log stream should appear
3. After scrape finishes, results table should render

- [ ] **Step 5: Commit**

```bash
git add public/results.html public/js/results.js public/js/logs.js
git commit -m "feat: add results viewer with live SSE log stream"
```

---

### Task 11: Job Builder frontend

**Files:**
- Create: `public/builder.html`
- Create: `public/js/builder.js`

- [ ] **Step 1: Create builder.html**

`public/builder.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>New Job</title>
  <link rel="stylesheet" href="/css/style.css">
  <style>
    form { background: #fff; padding: 1.5rem; border-radius: 6px; }
    label { display: block; margin-bottom: 0.25rem; font-weight: 600; }
    input, select { width: 100%; padding: 0.4rem; margin-bottom: 1rem; border: 1px solid #ccc; border-radius: 4px; }
    .field-row { display: grid; grid-template-columns: 2fr 1fr 1fr auto; gap: 0.5rem; margin-bottom: 0.5rem; align-items: center; }
    .field-row input, .field-row select { margin-bottom: 0; }
    .btn-add, .btn-save { margin-top: 0.5rem; background: #226; color: #fff; }
    .btn-add:hover, .btn-save:hover { background: #114; }
    pre { background: #111; color: #0f0; padding: 1rem; border-radius: 6px; font-size: 0.8rem; overflow: auto; }
  </style>
</head>
<body>
  <nav>
    <a href="/">Dashboard</a>
    <a href="/builder.html">New Job</a>
  </nav>
  <main>
    <h1>New Scrape Job</h1>
    <form id="builder-form">
      <label>Job Name</label>
      <input id="job-name" type="text" placeholder="my_job" required>
      <label>URL</label>
      <input id="job-url" type="url" placeholder="https://example.com" required>
      <label>Fields</label>
      <div id="fields-container"></div>
      <button type="button" id="add-field" class="btn-add">+ Add Field</button>
      <br><br>
      <label>Preview</label>
      <pre id="preview">{}</pre>
      <br>
      <button type="submit" class="btn-save">Save Job</button>
    </form>
  </main>
  <script src="/js/builder.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create builder.js**

`public/js/builder.js`:
```javascript
const TYPES = ['Text', 'URL', 'DateTime', 'Title'];
const MODES = ['Single', 'All'];

function addFieldRow(container) {
  const row = document.createElement('div');
  row.className = 'field-row';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Field name';
  nameInput.className = 'field-name';

  const selectorInput = document.createElement('input');
  selectorInput.type = 'text';
  selectorInput.placeholder = 'CSS selector';
  selectorInput.className = 'field-selector';

  const modeSelect = document.createElement('select');
  modeSelect.className = 'field-mode';
  MODES.forEach(m => { const o = document.createElement('option'); o.textContent = m; modeSelect.appendChild(o); });

  const typeSelect = document.createElement('select');
  typeSelect.className = 'field-type';
  TYPES.forEach(t => { const o = document.createElement('option'); o.textContent = t; typeSelect.appendChild(o); });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', () => { row.remove(); updatePreview(); });

  [nameInput, selectorInput, modeSelect, typeSelect].forEach(el => el.addEventListener('input', updatePreview));

  row.append(nameInput, selectorInput, modeSelect, typeSelect, removeBtn);
  container.appendChild(row);
}

function buildConfig() {
  const config = { URL: document.getElementById('job-url').value };
  document.querySelectorAll('.field-row').forEach(row => {
    const name     = row.querySelector('.field-name').value.trim();
    const selector = row.querySelector('.field-selector').value.trim();
    const mode     = row.querySelector('.field-mode').value;
    const type     = row.querySelector('.field-type').value;
    if (name && selector) config[name] = [selector, mode, type];
  });
  return config;
}

function updatePreview() {
  document.getElementById('preview').textContent = JSON.stringify(buildConfig(), null, 2);
}

document.getElementById('add-field').addEventListener('click', () => {
  addFieldRow(document.getElementById('fields-container'));
});

document.getElementById('job-url').addEventListener('input', updatePreview);

document.getElementById('builder-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('job-name').value.trim();
  const config = buildConfig();
  if (!name || !config.URL) return alert('Job name and URL are required.');

  const res = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, config }),
  });

  if (res.ok) {
    window.location.href = '/';
  } else {
    alert('Failed to save job.');
  }
});

// Start with one empty field row
addFieldRow(document.getElementById('fields-container'));
updatePreview();
```

- [ ] **Step 3: Verify in browser**

```bash
node server.js
```
1. Open `http://localhost:3000/builder.html`
2. Fill in name, URL, add fields — preview should update live
3. Save — should redirect to dashboard with new job listed

- [ ] **Step 4: Run all backend tests**

```bash
node server.js &
sleep 1
node --test tests/server.test.js tests/logger.test.js tests/plugins.test.js tests/scraper.test.js
kill %1
```
Expected: all pass.

- [ ] **Step 5: Final commit**

```bash
git add public/builder.html public/js/builder.js
git commit -m "feat: add job builder form with live JSON preview"
```

---

## Running the App

```bash
node server.js
```

Open `http://localhost:3000` in your browser.

## Adding a Plugin

Create any `.js` file in `plugins/` that exports an async function:

```javascript
// plugins/email-notify.js
module.exports = async function ({ job, runId, result, outPath }) {
  // send email, upload file, etc.
};
```

New plugin files are picked up automatically on the next scrape run — no server restart needed.
If you **edit** an existing plugin file, restart the server for the change to take effect (Node caches already-loaded modules).
