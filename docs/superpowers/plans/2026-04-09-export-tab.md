# Export Tab Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Export tab to `results.html` with manual export, auto-save, field reordering, live preview, and per-job export config stored in `_export`.

**Architecture:** `ExportManager` class in `export.js` handles all file I/O (flatten, write, split, naming). Server registers export routes and calls `autoSave` after each run. Frontend `ExportTab` class in `public/js/export.js` owns the tab UI and communicates via `api.js`.

**Tech Stack:** Node.js built-in `fs`/`path`, SheetJS (`xlsx`), Express, vanilla JS ES modules.

---

## Chunk 1: Backend — ExportManager + Server Endpoints

### Task 1: Install xlsx

**Files:**
- Modify: `package.json`

- [ ] Add `xlsx` to dependencies in `package.json`:

```json
{
  "dependencies": {
    "express": "^5.2.1",
    "puppeteer": "^24.40.0",
    "puppeteer-extra": "^3.3.6",
    "puppeteer-extra-plugin-stealth": "^2.11.2",
    "xlsx": "^0.18.5"
  }
}
```

- [ ] Install:

```bash
cd /mnt/Work/Coding_Projects/Scrape_Tool && npm install
```

- [ ] Verify:

```bash
node -e "require('xlsx'); console.log('xlsx ok')"
```

Expected: `xlsx ok`

---

### Task 2: ExportManager — `#flatten`

**Files:**
- Create: `export.js`

- [ ] Create `export.js` with the class skeleton and `#flatten` method:

```js
'use strict';
const fs   = require('fs');
const path = require('path');
const xlsx = require('xlsx');

class ExportManager {
  #resultsDir;
  #selectorsDir;

  constructor({ resultsDir, selectorsDir }) {
    this.#resultsDir   = resultsDir;
    this.#selectorsDir = selectorsDir;
  }

  // Flattens a single result object or array of page objects into [{ col: val }] rows.
  // fieldOrder controls column sequence; unknown fields appended at end.
  #flatten(result, fieldOrder = []) {
    const pages = Array.isArray(result) ? result : [result];
    const allRows = [];

    for (const page of pages) {
      const scalars = {};
      const arrays  = {};
      const groups  = {};

      for (const [key, val] of Object.entries(page)) {
        if (val === null || typeof val !== 'object') {
          scalars[key] = val;
        } else if (Array.isArray(val)) {
          arrays[key] = val;
        } else if (
          Object.keys(val).length > 0 &&
          Object.values(val).every(v => Array.isArray(v))
        ) {
          groups[key] = val;
        } else {
          scalars[key] = JSON.stringify(val);
        }
      }

      // Find max row count across arrays and groups
      const arrayLens  = Object.values(arrays).map(a => a.length);
      const groupLens  = Object.values(groups).flatMap(g =>
        Object.values(g).map(a => a.length)
      );
      const maxLen = Math.max(0, ...arrayLens, ...groupLens);

      if (maxLen === 0) {
        // Only scalars
        allRows.push({ ...scalars });
      } else {
        for (let i = 0; i < maxLen; i++) {
          const row = { ...scalars };
          for (const [k, arr] of Object.entries(arrays)) {
            row[k] = arr[i] ?? '';
          }
          for (const [groupName, fields] of Object.entries(groups)) {
            for (const [subKey, arr] of Object.entries(fields)) {
              row[`${groupName}.${subKey}`] = arr[i] ?? '';
            }
          }
          allRows.push(row);
        }
      }
    }

    if (allRows.length === 0) return { headers: [], rows: [] };

    // Collect all keys, apply fieldOrder
    const allKeys = [...new Set(allRows.flatMap(r => Object.keys(r)))];
    const ordered = [
      ...fieldOrder.filter(k => allKeys.includes(k)),
      ...allKeys.filter(k => !fieldOrder.includes(k)),
    ];

    return { headers: ordered, rows: allRows };
  }
}

module.exports = ExportManager;
```

- [ ] Smoke-test in node REPL:

```bash
node -e "
const E = require('./export.js');
const e = new E({ resultsDir: '.', selectorsDir: '.' });
// Access #flatten via a quick subclass for verification
console.log('ExportManager loads ok');
"
```

Expected: `ExportManager loads ok`

---

### Task 3: `#toCSV`, `#toExcel`, `#writeAppend`

**Files:**
- Modify: `export.js`

- [ ] Add `#toCSV` inside the class (after `#flatten`):

```js
#toCSV(rows, headers) {
  const escape = v => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => escape(row[h])).join(','));
  }
  return lines.join('\n');
}
```

- [ ] Add `#toExcel` inside the class:

```js
#toExcel(rows, headers) {
  const ws = xlsx.utils.json_to_sheet(rows, { header: headers });
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Results');
  return wb;
}
```

- [ ] Add `#writeAppend` inside the class:

```js
#writeAppend(rows, headers, filePath, format) {
  if (format === 'json') {
    let existing = [];
    if (fs.existsSync(filePath)) {
      let raw;
      try { raw = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
      catch { return { ok: false, error: 'Existing file is corrupt' }; }
      existing = Array.isArray(raw) ? raw : [raw];
    }
    const merged = [...existing, ...rows];
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
    return { ok: true };
  }

  if (format === 'csv') {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, this.#toCSV(rows, headers), 'utf8');
      return { ok: true };
    }
    // Use existing column order from first line
    const firstLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];
    const existingHeaders = firstLine.split(',').map(h => h.replace(/^"|"$/g, '').replace(/""/g, '"'));
    const escape = v => {
      const s = v == null ? '' : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const newLines = rows.map(row =>
      existingHeaders.map(h => escape(row[h])).join(',')
    ).join('\n');
    fs.appendFileSync(filePath, '\n' + newLines, 'utf8');
    return { ok: true };
  }

  if (format === 'excel') {
    let wb;
    if (fs.existsSync(filePath)) {
      wb = xlsx.readFile(filePath);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const existing = xlsx.utils.sheet_to_json(ws, { defval: '' });
      const merged = [...existing, ...rows];
      wb.Sheets[wb.SheetNames[0]] = xlsx.utils.json_to_sheet(merged, { header: headers });
    } else {
      wb = this.#toExcel(rows, headers);
    }
    xlsx.writeFile(wb, filePath);
    return { ok: true };
  }

  return { ok: false, error: `Unknown format: ${format}` };
}
```

---

### Task 4: `#resolveFilePath`

**Files:**
- Modify: `export.js`

- [ ] Add `#resolveFilePath` inside the class:

```js
#resolveFilePath(cfg, runId) {
  const { folder, baseName, format, strategy, splitBy, splitSize, naming } = cfg;
  const ext = format === 'excel' ? 'xlsx' : format;

  if (strategy === 'append') {
    return path.join(folder, `${baseName}.${ext}`);
  }

  // strategy: split — determine suffix
  let suffix;

  if (naming === 'datetime') {
    const now = new Date();
    const ts = now.toISOString().slice(0, 16).replace(':', '-').replace('T', 'T');
    suffix = `_${ts}`;
  } else {
    // num or date_num — scan folder for highest existing counter
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const prefix = naming === 'date_num' ? `${baseName}_${today}_` : `${baseName}_`;
    const re = naming === 'date_num'
      ? new RegExp(`^${baseName}_${today}_(\\d+)\\.${ext}$`)
      : new RegExp(`^${baseName}_(\\d+)\\.${ext}$`);

    let max = 0;
    if (fs.existsSync(folder)) {
      for (const f of fs.readdirSync(folder)) {
        const m = f.match(re);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
    }
    const next = max + 1;
    const pad = next >= 1000 ? 4 : 3;
    suffix = naming === 'date_num'
      ? `_${today}_${String(next).padStart(pad, '0')}`
      : `_${String(next).padStart(pad, '0')}`;
  }

  // splitBy: size — check if current file still has room
  if (splitBy === 'size' && naming !== 'datetime') {
    const candidate = path.join(folder, `${baseName}${suffix}.${ext}`);
    // Re-use the latest file if it exists and is under the size limit
    // (suffix already points to "next"; check the previous one)
    const re2 = format === 'excel'
      ? new RegExp(`^${baseName}_(\\d+)\\.xlsx$`)
      : naming === 'date_num'
        ? new RegExp(`^${baseName}_[0-9-]+_(\\d+)\\.${ext}$`)
        : new RegExp(`^${baseName}_(\\d+)\\.${ext}$`);

    const today = new Date().toISOString().slice(0, 10);
    let latestFile = null;
    let latestNum  = 0;
    if (fs.existsSync(folder)) {
      for (const f of fs.readdirSync(folder)) {
        if (naming === 'date_num' && !f.startsWith(`${baseName}_${today}`)) continue;
        const m = f.match(re2);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > latestNum) { latestNum = n; latestFile = path.join(folder, f); }
        }
      }
    }
    if (latestFile && fs.existsSync(latestFile)) {
      const sizeMB = fs.statSync(latestFile).size / (1024 * 1024);
      if (sizeMB < (splitSize || Infinity)) return latestFile; // still fits
    }
  }

  // splitBy: date — use today's date as the filename (no counter)
  if (splitBy === 'date') {
    const today = new Date().toISOString().slice(0, 10);
    return path.join(folder, `${baseName}_${today}.${ext}`);
  }

  return path.join(folder, `${baseName}${suffix}.${ext}`);
}
```

---

### Task 5: `exportRun` + `autoSave`

**Files:**
- Modify: `export.js`

- [ ] Add `exportRun` as a public method:

```js
async exportRun(jobName, runId, opts = {}) {
  // Load saved _export config and merge opts on top
  let saved = {};
  const cfgPath = path.join(this.#selectorsDir, `${jobName}.json`);
  if (fs.existsSync(cfgPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      saved = raw._export || {};
    } catch {}
  }
  const cfg = { ...saved, ...opts };

  const folder   = cfg.folder;
  const baseName = cfg.baseName || jobName;
  const format   = cfg.format   || 'json';
  const fieldOrder = cfg.fieldOrder || [];

  if (!folder) return { ok: false, error: 'No export folder configured' };

  const basenameRe = /^[a-zA-Z0-9_\-]+$/;
  if (!basenameRe.test(baseName)) return { ok: false, error: 'Invalid file name' };

  // Load result
  const resultPath = path.join(this.#resultsDir, jobName, `${runId}.json`);
  if (!fs.existsSync(resultPath)) return { ok: false, error: 'Run not found' };
  let result;
  try { result = JSON.parse(fs.readFileSync(resultPath, 'utf8')); }
  catch { return { ok: false, error: 'Could not read result file' }; }

  // Flatten
  const { headers, rows } = this.#flatten(result, fieldOrder);

  // Create folder if needed
  try { fs.mkdirSync(folder, { recursive: true }); }
  catch (e) { return { ok: false, error: `Could not create folder: ${e.message}` }; }

  // Check write permission
  try { fs.accessSync(folder, fs.constants.W_OK); }
  catch { return { ok: false, error: 'Permission denied' }; }

  // Resolve output path
  const fullCfg = { ...cfg, folder, baseName, format };
  const filePath = this.#resolveFilePath(fullCfg, runId);

  // Write
  const strategy = cfg.strategy || 'split';
  let writeResult;
  if (strategy === 'append') {
    writeResult = this.#writeAppend(rows, headers, filePath, format);
  } else {
    try {
      if (format === 'json') {
        fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf8');
      } else if (format === 'csv') {
        fs.writeFileSync(filePath, this.#toCSV(rows, headers), 'utf8');
      } else if (format === 'excel') {
        const wb = this.#toExcel(rows, headers);
        xlsx.writeFile(wb, filePath);
      }
      writeResult = { ok: true };
    } catch (e) {
      writeResult = { ok: false, error: e.message };
    }
  }

  if (!writeResult.ok) return writeResult;
  return { ok: true, path: filePath };
}
```

- [ ] Add `autoSave` as a public method:

```js
async autoSave(jobName, runId) {
  try {
    const cfgPath = path.join(this.#selectorsDir, `${jobName}.json`);
    if (!fs.existsSync(cfgPath)) return;
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (!raw._export?.autoSave) return;
    const result = await this.exportRun(jobName, runId);
    if (!result.ok) {
      // Logged but never thrown — must not affect run delivery
      console.error(`[ExportManager] autoSave failed for ${jobName}/${runId}: ${result.error}`);
    }
  } catch (e) {
    console.error(`[ExportManager] autoSave error: ${e.message}`);
  }
}
```

---

### Task 6: Server endpoints + auto-save hook

**Files:**
- Modify: `server.js`

- [ ] Add `ExportManager` require at the top of `server.js` alongside existing requires:

```js
const ExportManager = require('./export.js');
```

- [ ] Add `#exportManager` private field alongside the other private fields:

```js
#exportManager = null;
```

- [ ] Instantiate it in the constructor after `this.#app = express()`:

```js
this.#exportManager = new ExportManager({
  resultsDir:   this.#resultsDir,
  selectorsDir: this.#selectorsDir,
});
```

- [ ] Add `this.#registerExportRoutes()` call inside `#registerRoutes()` before `#registerDevReloadRoute`:

```js
this.#registerExportRoutes();
```

- [ ] Add the `#registerExportRoutes` method to the class:

```js
// POST /api/jobs/:name/runs/:runId/export  — manual one-off export
// POST /api/jobs/:name/export-config        — save _export to job config
// GET  /api/check-path?path=...             — test folder writability (no side-effects)
#registerExportRoutes() {
  const app = this.#app;

  app.post('/api/jobs/:name/runs/:runId/export', async (req, res) => {
    const { name, runId } = req.params;
    const result = await this.#exportManager.exportRun(name, runId, req.body);
    res.json(result);
  });

  app.post('/api/jobs/:name/export-config', (req, res) => {
    const cfgPath = path.join(this.#selectorsDir, `${req.params.name}.json`);
    if (!fs.existsSync(cfgPath)) return res.status(404).json({ error: 'Job not found' });
    const job = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const { exportConfig } = req.body;
    // Remove _export entirely if both folder and baseName are empty
    if (!exportConfig?.folder && !exportConfig?.baseName) {
      delete job._export;
    } else {
      job._export = exportConfig;
    }
    fs.writeFileSync(cfgPath, JSON.stringify(job, null, 2), 'utf8');
    res.json({ ok: true });
  });

  app.get('/api/check-path', (req, res) => {
    const folder = req.query.path;
    if (!folder) return res.json({ ok: false, writable: false, error: 'No path provided' });
    if (!fs.existsSync(folder)) {
      return res.json({ ok: true, writable: false, error: 'Path does not exist' });
    }
    try {
      fs.accessSync(folder, fs.constants.W_OK);
      res.json({ ok: true, writable: true });
    } catch {
      res.json({ ok: false, writable: false, error: 'Permission denied' });
    }
  });
}
```

- [ ] Add auto-save hook in `#registerRunnerRoutes` immediately after the `fs.writeFileSync(outPath, ...)` line (around line 169):

```js
// Auto-export if _export.autoSave is configured for this job
await this.#exportManager.autoSave(name, runId);
```

---

## Chunk 2: Frontend — API, HTML, CSS, JS

### Task 7: `api.js` additions

**Files:**
- Modify: `public/js/api.js`

- [ ] Add three functions at the bottom of `api.js`:

```js
// Exports a run to disk. opts: { folder, baseName, format, fieldOrder }
// Returns { ok, path } or { ok: false, error }
export function exportRun(name, runId, opts) {
  return _req('POST', `/api/jobs/${encodeURIComponent(name)}/runs/${encodeURIComponent(runId)}/export`, opts);
}

// Saves _export config into the job's config JSON.
export function saveExportConfig(name, exportConfig) {
  return _req('POST', `/api/jobs/${encodeURIComponent(name)}/export-config`, { exportConfig });
}

// Checks whether a folder path exists and is writable. No side-effects.
// Returns { ok, writable, error? }
export function checkPath(folderPath) {
  return _req('GET', `/api/check-path?path=${encodeURIComponent(folderPath)}`);
}
```

---

### Task 8: `results.html` — Export tab

**Files:**
- Modify: `public/results.html`

- [ ] Add `Export` tab button to the `.tab-bar`:

```html
<button class="tab-btn" data-tab="export">Export</button>
```

- [ ] Add the Export tab panel after the History panel (before `</main>`):

```html
<!-- Export tab -->
<div id="tab-export" class="tab-panel">

  <!-- 1. Output Settings -->
  <div class="setup-section">
    <h3>Output Settings</h3>
    <div class="form-group">
      <label for="export-folder">Folder</label>
      <div class="export-path-row">
        <input type="text" id="export-folder" placeholder="/home/user/exports" style="flex:1;" />
        <span id="export-path-status" class="export-path-status"></span>
      </div>
    </div>
    <div class="form-group">
      <label for="export-basename">File name</label>
      <div class="flex gap-1" style="align-items:center;">
        <input type="text" id="export-basename" placeholder="results" style="max-width:200px;" />
        <span id="export-ext-badge" class="text-faint" style="font-size:0.875rem;">.json</span>
      </div>
    </div>
    <div class="form-group">
      <label>Format</label>
      <div class="export-format-group">
        <label class="export-format-btn">
          <input type="radio" name="export-format" value="json" checked /> JSON
        </label>
        <label class="export-format-btn">
          <input type="radio" name="export-format" value="csv" /> CSV
        </label>
        <label class="export-format-btn">
          <input type="radio" name="export-format" value="excel" /> Excel
        </label>
      </div>
    </div>
    <button id="export-save-settings-btn" class="btn btn-sm">Save Settings</button>
    <span id="export-settings-status" class="text-muted" style="font-size:0.85rem; margin-left:0.75rem;"></span>
  </div>
  <hr />

  <!-- 2. Auto-Save -->
  <div class="setup-section">
    <h3>Auto-Save</h3>
    <label class="toggle-label">
      <input type="checkbox" id="export-autosave" />
      <span>Save automatically after each run</span>
    </label>
    <div id="export-autosave-form" hidden>
      <div class="radio-group" style="margin-top:0.75rem;">
        <label class="radio-label">
          <input type="radio" name="export-strategy" value="append" />
          Append to same file
        </label>
        <label class="radio-label">
          <input type="radio" name="export-strategy" value="split" checked />
          Split into new file
        </label>
      </div>
      <div id="export-split-options" style="margin-top:0.75rem;">
        <div class="radio-group">
          <label class="radio-label">
            <input type="radio" name="export-splitby" value="result" checked /> Per result
          </label>
          <label class="radio-label">
            <input type="radio" name="export-splitby" value="size" /> File size
            <input type="number" id="export-splitsize" placeholder="MB" min="1"
              style="max-width:80px; margin-left:0.5rem;" />
          </label>
          <label class="radio-label">
            <input type="radio" name="export-splitby" value="date" /> Date
          </label>
        </div>
        <div class="form-group" style="margin-top:0.75rem;">
          <label>File naming</label>
          <div class="radio-group">
            <label class="radio-label">
              <input type="radio" name="export-naming" value="date_num" checked />
              {Name}_{Date_Num}
            </label>
            <label class="radio-label">
              <input type="radio" name="export-naming" value="num" />
              {Name}_{Num}
            </label>
            <label class="radio-label">
              <input type="radio" name="export-naming" value="datetime" />
              {Name}_{DateTime}
            </label>
          </div>
          <span id="export-naming-example" class="text-faint" style="font-size:0.8rem; margin-top:0.3rem; display:block;"></span>
        </div>
      </div>
    </div>
  </div>
  <hr />

  <!-- 3. Field Order -->
  <div class="setup-section">
    <h3>Field Order</h3>
    <div id="export-field-order">
      <p class="text-faint" style="font-size:0.875rem;">Load a result to edit field order.</p>
    </div>
  </div>
  <hr />

  <!-- 4. Preview -->
  <div class="setup-section">
    <h3>Preview</h3>
    <div id="export-preview" class="export-preview">
      <p class="text-faint" style="font-size:0.875rem;">No result loaded.</p>
    </div>
  </div>
  <hr />

  <!-- 5. Manual Export -->
  <div class="setup-section">
    <h3>Export</h3>
    <div class="flex gap-1" style="align-items:center;">
      <select id="export-run-select" style="max-width:320px;">
        <option value="">Loading runs…</option>
      </select>
      <button id="export-run-btn" class="btn btn-primary" disabled>Export</button>
    </div>
    <span id="export-run-status" class="text-muted" style="font-size:0.85rem; margin-top:0.5rem; display:block;"></span>
  </div>

</div>
```

- [ ] Add `export.js` script tag before `</body>`:

```html
<script type="module" src="/js/export.js"></script>
```

---

### Task 9: `results.js` — track `_currentResult` + wire ExportTab

**Files:**
- Modify: `public/js/results.js`

- [ ] Add import at the top of `results.js`:

```js
import { ExportTab } from './export.js';
```

- [ ] Add `this._currentResult = null` and `this._exportTab = null` in the constructor after `this._historyLoaded = false`:

```js
this._currentResult = null;
this._exportTab     = null;
```

- [ ] In `_initTabs`, add Export tab lazy-init alongside the History tab check:

```js
if (btn.dataset.tab === 'export') this._initExportTab();
```

- [ ] Add `_initExportTab` method:

```js
_initExportTab() {
  if (this._exportTab) return;
  this._exportTab = new ExportTab({
    name:   this.name,
    result: this._currentResult,
  });
  this._exportTab.init();
}
```

- [ ] In `_loadRun`, set `this._currentResult = null` at the top of the method (before the loading message):

```js
this._currentResult = null;
```

- [ ] In `_loadRun`, after `this._renderTable(result)` set `_currentResult` and notify ExportTab:

```js
this._currentResult = result;
if (this._exportTab) this._exportTab.setResult(result);
```

---

### Task 10: `public/js/export.js` — ExportTab class

**Files:**
- Create: `public/js/export.js`

- [ ] Create the file:

```js
// export.js — Export tab UI for results.html
//
// Classes:
//   ExportTab — owns the Export tab: output settings, auto-save config,
//               field order, live preview, and manual export.
//
// Dependencies: api.js

import { getJob, listRuns, exportRun, saveExportConfig, checkPath } from './api.js';

const _EXT = { json: '.json', csv: '.csv', excel: '.xlsx' };

// Flattens result to { headers, rows } — mirrors ExportManager#flatten server-side.
function _flattenResult(result, fieldOrder = []) {
  if (!result) return { headers: [], rows: [] };
  const pages = Array.isArray(result) ? result : [result];
  const allRows = [];

  for (const page of pages) {
    const scalars = {}, arrays = {}, groups = {};
    for (const [key, val] of Object.entries(page)) {
      if (val === null || typeof val !== 'object') {
        scalars[key] = val;
      } else if (Array.isArray(val)) {
        arrays[key] = val;
      } else if (
        Object.keys(val).length > 0 &&
        Object.values(val).every(v => Array.isArray(v))
      ) {
        groups[key] = val;
      } else {
        scalars[key] = JSON.stringify(val);
      }
    }
    const maxLen = Math.max(
      0,
      ...Object.values(arrays).map(a => a.length),
      ...Object.values(groups).flatMap(g => Object.values(g).map(a => a.length))
    );
    if (maxLen === 0) {
      allRows.push({ ...scalars });
    } else {
      for (let i = 0; i < maxLen; i++) {
        const row = { ...scalars };
        for (const [k, arr] of Object.entries(arrays)) row[k] = arr[i] ?? '';
        for (const [gn, fields] of Object.entries(groups)) {
          for (const [sk, arr] of Object.entries(fields)) row[`${gn}.${sk}`] = arr[i] ?? '';
        }
        allRows.push(row);
      }
    }
  }

  if (!allRows.length) return { headers: [], rows: [] };
  const allKeys = [...new Set(allRows.flatMap(r => Object.keys(r)))];
  const headers = [
    ...fieldOrder.filter(k => allKeys.includes(k)),
    ...allKeys.filter(k => !fieldOrder.includes(k)),
  ];
  return { headers, rows: allRows };
}

function _namingExample(baseName, naming, format) {
  const ext = _EXT[format] || '.json';
  const base = baseName || 'results';
  const today = new Date().toISOString().slice(0, 10);
  if (naming === 'datetime') return `${base}_${today}T14-30${ext}`;
  if (naming === 'num')      return `${base}_001${ext}`;
  return `${base}_${today}_001${ext}`;
}

export class ExportTab {
  constructor({ name, result }) {
    this._name       = name;
    this._result     = result;
    this._fieldOrder = [];
    this._loaded     = false;
  }

  init() {
    this._wireOutputSettings();
    this._wireAutoSave();
    this._wireManualExport();
    this._loadConfig();
  }

  setResult(result) {
    this._result = result;
    this._rebuildFieldOrder();
    this._updatePreview();
    this._updateExportBtn();
  }

  // ── Output Settings ────────────────────────────────────────────────────────

  _wireOutputSettings() {
    const folderEl  = document.getElementById('export-folder');
    const baseEl    = document.getElementById('export-basename');
    const extBadge  = document.getElementById('export-ext-badge');
    const saveBtn   = document.getElementById('export-save-settings-btn');
    const statusEl  = document.getElementById('export-settings-status');

    // Path check on blur
    folderEl.addEventListener('blur', async () => {
      const pathStatus = document.getElementById('export-path-status');
      const val = folderEl.value.trim();
      if (!val) { pathStatus.textContent = ''; return; }
      pathStatus.textContent = '…';
      try {
        const res = await checkPath(val);
        if (res.writable) {
          pathStatus.textContent = '✓ Writable';
          pathStatus.className = 'export-path-status ok';
        } else {
          pathStatus.textContent = `✗ ${res.error || 'Not writable'}`;
          pathStatus.className = 'export-path-status err';
        }
      } catch {
        pathStatus.textContent = '✗ Check failed';
        pathStatus.className = 'export-path-status err';
      }
    });

    // Extension badge + preview update on format change
    document.querySelectorAll('input[name="export-format"]').forEach(r => {
      r.addEventListener('change', () => {
        extBadge.textContent = _EXT[r.value] || '.json';
        this._updateNamingExample();
        this._updatePreview();
      });
    });

    baseEl.addEventListener('input', () => {
      this._updateNamingExample();
      this._updatePreview();
    });

    saveBtn.addEventListener('click', async () => {
      const cfg = this._readConfig();
      try {
        await saveExportConfig(this._name, cfg);
        statusEl.textContent = 'Saved.';
        statusEl.style.color = 'var(--accent)';
        setTimeout(() => { statusEl.textContent = ''; }, 2000);
      } catch {
        statusEl.textContent = 'Save failed.';
        statusEl.style.color = 'var(--danger)';
      }
    });
  }

  // ── Auto-Save ──────────────────────────────────────────────────────────────

  _wireAutoSave() {
    const toggle    = document.getElementById('export-autosave');
    const form      = document.getElementById('export-autosave-form');
    const splitOpts = document.getElementById('export-split-options');

    toggle.addEventListener('change', () => {
      form.hidden = !toggle.checked;
    });

    document.querySelectorAll('input[name="export-strategy"]').forEach(r => {
      r.addEventListener('change', () => {
        splitOpts.hidden = r.value !== 'split';
      });
    });

    document.querySelectorAll('input[name="export-naming"]').forEach(r => {
      r.addEventListener('change', () => this._updateNamingExample());
    });
  }

  _updateNamingExample() {
    const el      = document.getElementById('export-naming-example');
    const baseName = document.getElementById('export-basename').value.trim() || 'results';
    const format   = document.querySelector('input[name="export-format"]:checked')?.value || 'json';
    const naming   = document.querySelector('input[name="export-naming"]:checked')?.value || 'date_num';
    el.textContent = `→ ${_namingExample(baseName, naming, format)}`;
  }

  // ── Field Order ────────────────────────────────────────────────────────────

  _rebuildFieldOrder() {
    const container = document.getElementById('export-field-order');
    if (!this._result) {
      container.innerHTML = '<p class="text-faint" style="font-size:0.875rem;">Load a result to edit field order.</p>';
      return;
    }

    const { headers } = _flattenResult(this._result, []);
    // Merge: saved order first, then any new fields
    const merged = [
      ...this._fieldOrder.filter(k => headers.includes(k)),
      ...headers.filter(k => !this._fieldOrder.includes(k)),
    ];
    this._fieldOrder = merged;

    container.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'export-field-list';

    merged.forEach((field, idx) => {
      const row = document.createElement('div');
      row.className = 'export-field-row';
      row.dataset.field = field;

      const handle = document.createElement('span');
      handle.className = 'export-field-handle';
      handle.textContent = '⠿';

      const label = document.createElement('span');
      label.className = 'export-field-label';
      label.textContent = field;

      const up = document.createElement('button');
      up.type = 'button'; up.className = 'btn-icon'; up.textContent = '↑';
      up.disabled = idx === 0;
      up.addEventListener('click', () => {
        [this._fieldOrder[idx - 1], this._fieldOrder[idx]] =
          [this._fieldOrder[idx], this._fieldOrder[idx - 1]];
        this._rebuildFieldOrder();
        this._updatePreview();
      });

      const down = document.createElement('button');
      down.type = 'button'; down.className = 'btn-icon'; down.textContent = '↓';
      down.disabled = idx === merged.length - 1;
      down.addEventListener('click', () => {
        [this._fieldOrder[idx], this._fieldOrder[idx + 1]] =
          [this._fieldOrder[idx + 1], this._fieldOrder[idx]];
        this._rebuildFieldOrder();
        this._updatePreview();
      });

      row.append(handle, label, up, down);
      list.appendChild(row);
    });

    container.appendChild(list);
  }

  // ── Preview ────────────────────────────────────────────────────────────────

  _updatePreview() {
    const container = document.getElementById('export-preview');
    if (!this._result) {
      container.innerHTML = '<p class="text-faint" style="font-size:0.875rem;">No result loaded.</p>';
      return;
    }

    const format = document.querySelector('input[name="export-format"]:checked')?.value || 'json';
    const { headers, rows } = _flattenResult(this._result, this._fieldOrder);

    if (format === 'json') {
      const preview = rows.slice(0, 2);
      const pre = document.createElement('pre');
      pre.className = 'export-preview-code';
      pre.textContent = JSON.stringify(preview, null, 2);
      container.innerHTML = '';
      container.appendChild(pre);
    } else if (format === 'csv') {
      const escape = v => {
        const s = v == null ? '' : String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [headers.map(escape).join(',')];
      rows.slice(0, 3).forEach(row => lines.push(headers.map(h => escape(row[h])).join(',')));
      const pre = document.createElement('pre');
      pre.className = 'export-preview-code';
      pre.textContent = lines.join('\n');
      container.innerHTML = '';
      container.appendChild(pre);
    } else if (format === 'excel') {
      const table = document.createElement('table');
      table.className = 'tw-table export-preview-table';
      const thead = document.createElement('thead');
      const hRow  = document.createElement('tr');
      headers.forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        hRow.appendChild(th);
      });
      thead.appendChild(hRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      rows.slice(0, 5).forEach(row => {
        const tr = document.createElement('tr');
        headers.forEach(h => {
          const td = document.createElement('td');
          td.textContent = row[h] ?? '';
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);

      const wrap = document.createElement('div');
      wrap.className = 'results-table-wrap';
      wrap.appendChild(table);
      container.innerHTML = '';
      container.appendChild(wrap);
    }
  }

  // ── Manual Export ──────────────────────────────────────────────────────────

  _wireManualExport() {
    document.getElementById('export-run-btn').addEventListener('click', async () => {
      const runId    = document.getElementById('export-run-select').value;
      const statusEl = document.getElementById('export-run-status');
      if (!runId) return;

      statusEl.textContent = 'Exporting…';
      statusEl.style.color = 'var(--text-muted)';

      const opts = this._readConfig();
      try {
        const res = await exportRun(this._name, runId, opts);
        if (res.ok) {
          statusEl.textContent = `✓ Saved to ${res.path}`;
          statusEl.style.color = 'var(--accent)';
        } else {
          statusEl.textContent = `✗ ${res.error}`;
          statusEl.style.color = 'var(--danger)';
        }
      } catch {
        statusEl.textContent = '✗ Export failed';
        statusEl.style.color = 'var(--danger)';
      }
    });
  }

  _updateExportBtn() {
    const btn    = document.getElementById('export-run-btn');
    const folder = document.getElementById('export-folder').value.trim();
    const base   = document.getElementById('export-basename').value.trim();
    btn.disabled = !folder || !base;
  }

  // ── Config read/write ──────────────────────────────────────────────────────

  _readConfig() {
    const folder   = document.getElementById('export-folder').value.trim();
    const baseName = document.getElementById('export-basename').value.trim();
    const format   = document.querySelector('input[name="export-format"]:checked')?.value || 'json';
    const autoSave = document.getElementById('export-autosave').checked;
    const strategy = document.querySelector('input[name="export-strategy"]:checked')?.value || 'split';
    const splitBy  = document.querySelector('input[name="export-splitby"]:checked')?.value  || 'result';
    const naming   = document.querySelector('input[name="export-naming"]:checked')?.value   || 'date_num';
    const splitSize = parseInt(document.getElementById('export-splitsize').value, 10) || undefined;

    return {
      folder, baseName, format, fieldOrder: [...this._fieldOrder],
      autoSave, strategy, splitBy, naming,
      ...(splitSize ? { splitSize } : {}),
    };
  }

  async _loadConfig() {
    // Populate run selector
    try {
      const runs = await listRuns(this._name);
      const sel  = document.getElementById('export-run-select');
      sel.innerHTML = '';
      const sorted = runs.sort((a, b) => b.name.localeCompare(a.name));
      sorted.forEach(({ name: runId }, i) => {
        const ts   = parseInt(runId.split('-').pop(), 10);
        const date = isNaN(ts) ? runId : new Date(ts).toLocaleString();
        const opt  = document.createElement('option');
        opt.value = runId; opt.textContent = date;
        if (i === 0) opt.selected = true;
        sel.appendChild(opt);
      });
    } catch {
      document.getElementById('export-run-select').innerHTML = '<option value="">No runs found</option>';
    }

    // Load saved _export config
    try {
      const job = await getJob(this._name);
      const cfg = job._export;
      if (!cfg) return;

      if (cfg.folder)   document.getElementById('export-folder').value   = cfg.folder;
      if (cfg.baseName) document.getElementById('export-basename').value = cfg.baseName;
      if (cfg.format) {
        const r = document.querySelector(`input[name="export-format"][value="${cfg.format}"]`);
        if (r) r.checked = true;
        document.getElementById('export-ext-badge').textContent = _EXT[cfg.format] || '.json';
      }
      if (cfg.autoSave) {
        document.getElementById('export-autosave').checked = true;
        document.getElementById('export-autosave-form').hidden = false;
      }
      if (cfg.strategy) {
        const r = document.querySelector(`input[name="export-strategy"][value="${cfg.strategy}"]`);
        if (r) r.checked = true;
        document.getElementById('export-split-options').hidden = cfg.strategy !== 'split';
      }
      if (cfg.splitBy) {
        const r = document.querySelector(`input[name="export-splitby"][value="${cfg.splitBy}"]`);
        if (r) r.checked = true;
      }
      if (cfg.splitSize) document.getElementById('export-splitsize').value = cfg.splitSize;
      if (cfg.naming) {
        const r = document.querySelector(`input[name="export-naming"][value="${cfg.naming}"]`);
        if (r) r.checked = true;
      }
      if (cfg.fieldOrder) this._fieldOrder = cfg.fieldOrder;

      this._updateNamingExample();
      this._updateExportBtn();
    } catch {}

    // Build field order and preview from current result
    if (this._result) {
      this._rebuildFieldOrder();
      this._updatePreview();
    }
  }
}
```

---

### Task 11: `results.css` — Export tab styles

**Files:**
- Modify: `public/css/results.css`

- [ ] Append export styles to `results.css`:

```css
/* ── Export tab ──────────────────────────────────────────────────── */
.export-path-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.export-path-status {
  font-size: 0.8rem;
  white-space: nowrap;
}

.export-path-status.ok  { color: var(--accent); }
.export-path-status.err { color: var(--danger); }

.export-format-group {
  display: flex;
  gap: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  overflow: hidden;
  width: fit-content;
}

.export-format-btn {
  display: flex;
  align-items: center;
  padding: 0.35rem 0.9rem;
  font-size: 0.875rem;
  color: var(--text-muted);
  cursor: pointer;
  background: var(--bg-interactive);
  border-right: 1px solid var(--border);
  transition: background var(--transition), color var(--transition);
  user-select: none;
}

.export-format-btn:last-child { border-right: none; }

.export-format-btn input[type="radio"] { display: none; }

.export-format-btn:has(input:checked) {
  background: var(--accent-dim);
  color: var(--accent);
  font-weight: 600;
}

.export-field-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.export-field-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.5rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  font-size: 0.875rem;
}

.export-field-handle {
  color: var(--text-faint);
  cursor: grab;
  font-size: 1rem;
  line-height: 1;
}

.export-field-label { flex: 1; }

.export-preview {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  padding: 0.75rem;
  max-height: 280px;
  overflow: auto;
}

.export-preview-code {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--text-normal);
  white-space: pre;
  margin: 0;
}
```
