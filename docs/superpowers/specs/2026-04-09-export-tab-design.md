# Export Tab Design Spec — Scrape Tool

**Date:** 2026-04-09
**Goal:** Add an Export tab to `results.html` that lets users manually export scrape results to JSON, CSV, or Excel, and configure per-job auto-save with flexible file-splitting and naming conventions.

---

## Architecture

**Approach:** Option C — dedicated `ExportManager` module.

Export logic (data flattening, file writing, split strategy, naming) lives in `export.js`. `Server` instantiates it once and calls it after every run completes. Manual export is a separate POST endpoint. The frontend UI lives in `public/js/export.js`.

### New and Modified Files

```
export.js                      ← new: ExportManager class
public/js/export.js            ← new: Export tab UI logic
public/css/results.css         ← modified: export tab styles
public/results.html            ← modified: third tab added
public/js/results.js           ← modified: store _currentResult, init export tab
public/js/api.js               ← modified: exportRun(), saveExportConfig(), checkPath()
server.js                      ← modified: register export routes, call ExportManager post-run
package.json                   ← modified: add xlsx dependency
```

---

## Data Model

Export settings are stored per-job as an `_export` key in the job's config JSON, alongside the existing `_settings` and `_schedule` keys.

```json
"_export": {
  "folder": "/home/user/exports",
  "baseName": "results",
  "format": "csv",
  "fieldOrder": ["Title", "Description", "Author", "Date"],
  "autoSave": true,
  "strategy": "split",
  "splitBy": "result",
  "splitSize": 10,
  "naming": "date_num"
}
```

| Key | Values | Notes |
|---|---|---|
| `folder` | string | Absolute path. Created on export if missing. |
| `baseName` | string | File name without extension. Must match `[a-zA-Z0-9_\-]+`. |
| `format` | `json` `csv` `excel` | Output format. |
| `fieldOrder` | `string[]` | Column order. Fields not in list appended at end in original order. |
| `autoSave` | boolean | Whether to export automatically after each run. |
| `strategy` | `append` `split` | One growing file vs. new file per trigger. |
| `splitBy` | `result` `size` `date` | Only when `strategy: split`. |
| `splitSize` | number (MB) | Only when `splitBy: size`. |
| `naming` | `datetime` `num` `date_num` | Suffix pattern for split filenames. |

If both `folder` and `baseName` are cleared when saving export config, the `_export` key is removed from the job config entirely rather than saved with empty values.

### Naming Convention Examples (`baseName: "results"`, `format: "csv"`)

| `naming` | Example output |
|---|---|
| `datetime` | `results_2026-04-09T14-30.csv` |
| `num` | `results_001.csv`, `results_002.csv` |
| `date_num` | `results_2026-04-09_001.csv` |

---

## `ExportManager` Module (`export.js`)

```
class ExportManager
  constructor({ resultsDir, selectorsDir })
  autoSave(jobName, runId)          ← called by server after run completes
  exportRun(jobName, runId, opts)   ← called by manual export endpoint
  #flatten(result, fieldOrder)      ← flattens result to [{ col: val }] rows
  #toCSV(rows, headers)             ← rows → CSV string
  #toExcel(rows, headers)           ← rows → xlsx buffer via SheetJS
  #resolveFilePath(cfg, runId)      ← applies strategy + naming → full output path
  #writeAppend(rows, headers, filePath, format) ← handles append for all three formats
```

### `#flatten(result, fieldOrder)`

Accepts a single result object or an array of page objects. Multi-page results are concatenated into one flat row list.

Applies the same three-shape classification as `_classifyFields` in `results.js`:
- **Scalars** — primitive values → single column, value repeated on every row
- **Plain arrays** — `Array.isArray(val)` → one column, one row per item
- **Groups** — object where every value is an array (`Object.values(v).every(Array.isArray)`) → columns named `GroupName.SubField`, one row per group item

`fieldOrder` controls column sequence. Fields not present in `fieldOrder` are appended at the end in their original key order.

### `#resolveFilePath(cfg, runId)`

- `strategy: append` → always returns `{folder}/{baseName}.{ext}` (same path every call)
- `strategy: split`:
  - `splitBy: result` → one new file per run; naming determined by `naming` convention
  - `splitBy: size` → check the existing file's size **before** writing; if it already exceeds `splitSize` MB, start a new file using the next name in the sequence
  - `splitBy: date` → one file per UTC calendar day; file named with today's date; a run that crosses midnight produces a single file named with the date when the run started
  - `naming: datetime` → append ISO timestamp to baseName (`YYYY-MM-DDTHH-MM`)
  - `naming: num` → scan folder for files matching `{baseName}_NNN.{ext}` (same baseName prefix only), take the highest N, increment. Always zero-padded to 3 digits. At 1000, pad to 4 digits.
  - `naming: date_num` → same counter scan, scoped to today's date prefix

Counter scan is non-atomic. This tool is single-user and single-process, so concurrent counter collisions are not expected. The limitation is noted but not guarded against.

### `#writeAppend(rows, headers, filePath, format)`

Defines append behaviour per format:

- **JSON** — if the file exists, parse it as an array (or wrap a single object in an array if it was written as one). Concatenate new rows. Write atomically: write to a `.tmp` sibling file, then `fs.renameSync` to the target path. If the existing file is corrupt (parse fails), abort with an error rather than overwriting.
- **CSV** — if the file exists, read the first line to detect the existing column order, then append rows using that column order (not the current `fieldOrder`). This preserves column alignment across appends even if `fieldOrder` has changed since the file was first written. Columns in the new result that are not present in the existing header are silently dropped. If the file does not exist, write header (from current `fieldOrder`) + rows.
- **Excel** — if the file exists, read the workbook with `xlsx.readFile`, find the first sheet, append rows. Write back using `xlsx.writeFile`. If the file does not exist, create a new workbook with one sheet named `Results`.

### `autoSave(jobName, runId)`

Reads the job config from disk to get `_export`. This read happens after the result file has been written, so the risk of observing a partial config write is low (configs are small synchronous writes). The limitation is acknowledged and accepted for a single-user local tool.

Silent no-op if `_export` is missing or `_export.autoSave` is false. Any write error is caught and logged via `Logger` — never throws, so the run result delivery is never affected.

If `opts` (for `exportRun`) omits `folder` and `_export` is also missing, the export returns `{ ok: false, error: 'No export folder configured' }`. There is no default path fallback.

### `exportRun(jobName, runId, opts)`

`opts` overrides `_export` for one-off manual exports — `folder`, `baseName`, `format`, and `fieldOrder` may all differ from the saved config. `opts` is merged over `_export`; any key present in `opts` takes precedence.

**Error contract:** `exportRun` always returns a plain object — never throws. Success: `{ ok: true, path }`. Failure: `{ ok: false, error: '<reason>' }`. The server endpoint forwards this object directly to the client. This applies to all failure cases including missing folder, invalid baseName, filesystem errors, and corrupt existing files.

**`baseName` validation:** Before any file operation, validate that `baseName` matches `[a-zA-Z0-9_\-]+`. Return `{ ok: false, error: 'Invalid file name' }` if it does not. This prevents path traversal via values like `../../etc/passwd`.

**Dependencies:** `fs`, `path`, `xlsx` only. No Express, no Scraper coupling.

---

## Server Endpoints

Registered in a new `#registerExportRoutes()` method on `Server`.

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/jobs/:name/runs/:runId/export` | `{ folder, baseName, format, fieldOrder }` | `{ ok, path }` |
| `POST` | `/api/jobs/:name/export-config` | `{ exportConfig }` | `{ ok }` |
| `GET` | `/api/check-path?path=...` | — | `{ ok, writable, error? }` |

**Manual export** — delegates to `exportManager.exportRun(name, runId, opts)`.

**Export config save** — reads job config, patches `_export` key (or removes it if folder+baseName are both empty), writes back. Same pattern as existing settings save.

**Path check (`/api/check-path`)** — read-only intent: only tests writability, does **not** create the folder.
1. If the path does not exist, return `{ ok: true, writable: false, error: 'Path does not exist' }`
2. `fs.accessSync(folder, fs.constants.W_OK)` — verifies write permission
3. Returns `{ ok: true, writable: true }` or `{ ok: false, writable: false, error: 'Permission denied' }`

Folder creation (`fs.mkdirSync(folder, { recursive: true })`) happens at export time (in `exportRun` / `autoSave`), not during the path check. This ensures no directories are created as a side-effect of the user typing a path.

**Auto-save hook** — in the existing run handler, after writing the result file:
```js
await this.#exportManager.autoSave(name, runId);
```
Silent no-op if auto-save is not configured.

### `api.js` Additions

```js
exportRun(name, runId, opts)      // POST /api/jobs/:name/runs/:runId/export
saveExportConfig(name, config)    // POST /api/jobs/:name/export-config
checkPath(path)                   // GET  /api/check-path?path=...
```

All three follow the existing `_req(method, path, body)` pattern in `api.js`.

---

## Export Tab UI (`public/js/export.js`)

Third tab on `results.html`, after Results & Logs and History. Follows the same lazy-load-once pattern as the History tab — initialised on first click, not on page load.

### Wiring to `results.js`

`ResultsPage` stores the currently loaded result as `this._currentResult`. Lifecycle:
- Set to `null` at the top of `_loadRun` (load start)
- Set to the result value (which may be `null` for a failed scrape) immediately after `_renderTable(result)` returns — not inside `_renderTable`, because `_renderTable` returns early for `null` results without rendering a table

When the Export tab is first activated, `results.js` passes `this._currentResult` to the `ExportTab` instance. Subsequent result loads (e.g. clicking a history row) call `exportTab.setResult(result)` to keep the export tab in sync.

`public/js/export.js` imports `listRuns` and `exportRun` directly from `api.js`. It does not depend on `results.js` passing run list data — it fetches independently on first tab activation.

### Sub-sections

**1. Output Settings**
- Folder path text input — calls `/api/check-path` on blur; shows inline `✓ Writable` / `✗ Does not exist` / `✗ Permission denied`
- Base name text input + live extension badge (e.g. `results` `.csv`). Validates on blur: must match `[a-zA-Z0-9_\-]+`.
- Format selector — styled pill buttons: `JSON` `CSV` `Excel`. Switching format updates the preview immediately, re-deriving from the same loaded result data each time.
- Save Settings button — calls `saveExportConfig()`

**2. Auto-Save**
- Toggle (same style as schedule toggle)
- When enabled, reveals:
  - Strategy: `Append to same file` / `Split into new file` (radio)
  - When split: Split by `Per result` / `File size` / `Date` (radio) + MB input when size is chosen
  - Naming: `{Name}_{DateTime}` / `{Name}_{Num}` / `{Name}_{Date_Num}` (radio) with a live example line below (e.g. `→ results_2026-04-09_001.csv`)

**3. Field Order**
- Rendered only when a result is loaded.
- One row per flattened field (same header list as `#flatten` would produce).
- Priority: if `_export.fieldOrder` is saved, show those fields first in saved order, then append any new fields found in the current result. If no result is loaded yet but `_export.fieldOrder` exists, the field order section shows "Load a result to edit field order."
- Each row has ↑ / ↓ buttons and a drag handle (`⠿`).
- Reordering updates the preview live.

**4. Preview**
- Read-only panel, updates live on format or field order change.
- JSON: syntax-highlighted `<pre>`, first 2 objects.
- CSV: plain `<pre>`, header row + first 3 data rows.
- Excel: styled HTML table (no actual xlsx rendered), first 5 rows with a styled header row.
- Shows "No result loaded" placeholder when no data is available.

**5. Manual Export**
- Run selector dropdown populated from `listRuns()`, default = most recent.
- Export button — disabled when no folder/baseName configured. Calls `exportRun()`, shows `Exporting…` spinner, then `✓ Saved to /path/file.csv` or inline error.

### Loading Saved Config
On first tab activation, call `getJob(name)` to read `_export`. Pre-populate all form fields. If `_export` is absent, form shows defaults (format: JSON, strategy: split, splitBy: result, naming: date_num).

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Folder does not exist at check time | Inline: `✗ Does not exist` (not created until export) |
| `mkdirSync` fails at export time | `{ ok: false, error: 'Could not create folder: <reason>' }` |
| No write permission | `{ ok: false, error: 'Permission denied' }`; shown inline in UI |
| `baseName` fails validation | `{ ok: false, error: 'Invalid file name' }`; shown inline in UI |
| Corrupt existing file (append JSON) | `{ ok: false, error: 'Existing file is corrupt' }`; file untouched |
| `xlsx` write failure | `{ ok: false, error: '<reason>' }` |
| Auto-save failure | Caught, logged via `Logger`, never surfaces to client |
| No result loaded | Export button and preview disabled; field order shows placeholder |
| Run not found | `{ ok: false, error: 'Run not found' }`; shown inline in UI |
| `opts.folder` missing and `_export` missing | `{ ok: false, error: 'No export folder configured' }` |

---

## Dependencies

- **`xlsx` (SheetJS)** — add to `package.json` dependencies. Used only in `export.js`.
- No other new dependencies.
