# Frontend Design Spec — Scrape Tool Dashboard

**Date:** 2026-04-08
**Goal:** Build the full frontend for the Scrape Tool web dashboard, designed to be Tauri-compatible from day one.

---

## Architecture

**Approach:** Multi-page HTML with shared JS modules (no framework, no build step).

- Express serves static files from `public/` during development and testing.
- Tauri will be added after the frontend is complete — it will wrap the webview and spawn Express as a sidecar. No frontend code changes required at that point.
- All backend communication goes exclusively through `api.js` — this is the single seam for a future Tauri IPC swap. No other file calls `fetch()` directly.

---

## File Structure

```
public/
  index.html            ← Dashboard (card grid)
  job.html              ← Job detail Page 1: Config & Setup (?name=xyz)
  results.html          ← Job detail Page 2: Results & Logs / History (?name=xyz&runId=abc)
  css/
    style.css           ← existing design system (no changes)
  js/
    layout.js           ← update: nav shows only "Dashboard" link; remove builder/results links
    api.js              ← all fetch() calls to the backend
    chart.js            ← sparkline canvas renderer
    form.js             ← config form builder logic
    dashboard.js        ← dashboard page logic
    job.js              ← job detail Page 1 logic (Config & Setup tabs)
    results.js          ← job detail Page 2 logic (Results/Logs & History tabs)
    logs.js             ← SSE connection and log rendering
```

`public/builder.html` (from the old plan) is removed — its functionality is now the Config tab on `job.html`.

> **Note on legacy files:** Root-level `public/layout.js` and `public/style.css` are superseded by `public/js/layout.js` and `public/css/style.css`. All new HTML pages reference the `js/` and `css/` paths. The root-level copies can be deleted.

---

## `layout.js` Update

The nav is simplified to one link: **Dashboard** (`/index.html`).

`job.html` and `results.html` are not nav links — they are job-scoped pages. Each sets `document.title` to the job name (e.g. `"books-scrape — Scrape Tool"`) and renders a visible `<h2>` heading with the job name so the user always knows where they are.

Active-link matching in `layout.js` uses only the pathname (not the query string) so `job.html?name=xyz` does not accidentally highlight any nav link.

---

## Config JSON Schema

All job configs live in `Data/Selectors/<name>.json`. The schema:

```json
{
  "URL": "https://example.com",
  "FieldName": ["selector", "Single|All", "Text|URL|DateTime|Title"],
  "GroupName": [
    { "SubField": ["selector", "Single|All", "Text|URL|DateTime|Title"] },
    "All",
    "Group"
  ],
  "PaginationKey": ["selector", "Click|Scroll|URL", "Pagination"]
}
```

- `URL` — the start URL (required)
- Flat field — `[selector, mode, type]` where type is `Text`, `URL`, `DateTime`, or `Title`
- Group — `[{ fieldName: [selector, mode, type], ... }, mode, "Group"]`
- Pagination — `[selector, paginationMode, "Pagination"]` where paginationMode is `Click`, `Scroll`, or `URL`

`form.js` must read and write this exact schema. `Group` and `Pagination` are distinct field types handled separately from flat fields.

---

## `api.js` — Function Signatures

All functions return parsed JSON (or throw on non-2xx).

| Function | Method + Path | Payload | Returns |
|---|---|---|---|
| `listJobs()` | GET `/api/jobs` | — | `[{ name, runs }]` |
| `getJob(name)` | GET `/api/jobs/:name` | — | config object |
| `saveJob(name, config)` | POST `/api/jobs` | `{ name, config }` | `{ ok }` |
| `deleteJob(name)` | DELETE `/api/jobs/:name` | — | `{ ok }` |
| `runJob(name)` | POST `/api/jobs/:name/run` | — | `{ runId }` |
| `listRuns(name)` | GET `/api/jobs/:name/runs` | — | `[{ file, name }]` — returned in filesystem order; client must sort by `name` (which encodes the timestamp as `<jobname>-<ms>`) to identify the most recent run reliably. |
| `getRun(name, runId)` | GET `/api/jobs/:name/runs/:runId` | — | result object |

No other file calls `fetch()`.

---

## Pages

### 1. Dashboard (`index.html`)

A 3-column card grid showing all saved jobs.

**Each job card displays:**
- Job name
- Status badge: `running` | `stopped` | `error` (see Status section below)
- Background sparkline (rendered on `<canvas>` via `chart.js`)
- Last run summary: e.g. "Last run 2h ago · 142 items" (derived from the most recent run file — see Sparkline Data section)
- Clicking the card navigates based on job status:
  - Idle/stopped → `job.html?name=xyz`
  - Running or error → `results.html?name=xyz` (no runId — shows most recent run or live run)

**`+` card:**
- Sits at the end of the grid
- Clicking opens an inline prompt (job name input + confirm button)
- Validation: empty name → show inline error "Name required". Duplicate name → show "A job with that name already exists." API failure → show "Failed to create job."
- On success: navigate to `job.html?name=xyz`

**Polling:**
- `dashboard.js` polls `listJobs()` every 5 seconds to refresh run counts and badges.

---

### Job Status (Derived State)

The backend has no status endpoint. Status is derived and stored in `sessionStorage` keyed by job name:

- `"running"` — set when "Run Now" is clicked; cleared when the SSE stream receives a `DONE` event
- `"error"` — set when the SSE stream receives an `ERROR`-level log entry during a run
- `"stopped"` — default; also set when `DONE` is received without errors

`dashboard.js` reads `sessionStorage` to set the badge color on each card. On hard refresh, all statuses reset to `"stopped"` (safe default).

---

### Sparkline Data

`chart.js` takes `[{ count, status }]` where:
- `count` = number of top-level keys in the result JSON (proxy for items scraped)
- `status` = `"success"` or `"error"` (derived from whether the result is `null`)

To populate sparkline data, `dashboard.js` calls `listRuns(name)` for each job, then for each run calls `getRun(name, runId)` to get the result. This is intentionally simple — acceptable cost for a local single-user tool with small run counts. If performance becomes an issue, a backend summary endpoint can be added later.

The most recent run's count and timestamp are also used for the "Last run X ago · N items" summary line.

---

### 2. Job Detail — Page 1 (`job.html?name=xyz`)

Page `<title>`: `"<jobname> — Scrape Tool"`. Visible `<h2>` heading with job name.

Two tabs: **Config** and **Setup**.

#### Config Tab

Form-based job config builder driven by `form.js`:

- **URL input** at the top (required)
- **Flat field rows** — each row has:
  - Field name (text input) — becomes the JSON key (e.g. `"Title"`, `"Price"`)
  - CSS selector (text input)
  - Mode dropdown: `Single` | `All`
  - Type dropdown: `Text` | `URL` | `DateTime` | `Title`
  - "Group" toggle button — converts this row into a Group container (see below)
  - Remove button (✕)
- **"Add Field" button** appends a new flat field row
- **"Add Pagination" button** appends one Pagination row (selector + mode dropdown: `Click` | `Scroll` | `URL`)
- **Save button** — assembles config JSON via `form.js` and calls `saveJob(name, config)`. The backend `POST /api/jobs` is intentionally idempotent (silently overwrites), so `saveJob` serves as both create and update. Shows inline success/error feedback.

**Group fields:**
- When "Group" is toggled on a flat field row, the row becomes a Group container with its own label (the field name) and an inner list of sub-field rows.
- Sub-fields use the same selector/mode/type controls as flat fields.
- An "Add sub-field" button appends rows inside the group.
- The Group container itself has a mode dropdown (`Single` | `All`) and a remove button.
- Toggling Group off while sub-fields exist shows a confirmation: "Remove group and all its sub-fields?"

**Loading existing config:**
- On page load, `job.js` calls `getJob(name)` and passes the result to `form.js` to populate the form.
- If the job is new (just created), the form is empty.

#### Setup Tab

Five sections separated by dividers:

**URL Source** (radio, pick one):
- *Type directly* — textarea, one URL per line. Overrides the `URL` field in the config for this run.
- *Load from `.txt` file* — `<input type="file" accept=".txt">`. File is read client-side with the `FileReader` API. The resulting URL list is passed to the run the same way as typed URLs (POSTed as part of the run request body — requires a backend update to accept `urls[]`). **Note:** this is a planned extension; in the initial implementation, URL source defaults to the config `URL` field and this section is a UI stub.
- *Pull from another job's field* — job picker (populated from `listJobs()`), then field picker (populated from the selected job's config keys). Selecting a field means: after that job's most recent run, use the values of that field as URLs for this job. **Note:** also a stub in the initial implementation.

**Run:**
- "Run Now" button — calls `runJob(name)`, receives `{ runId }`, then navigates to `results.html?name=xyz&runId=<runId>`. Sets `sessionStorage` status to `"running"`.

**Schedule:**
- Toggle to enable scheduling. When enabled: one-off (date + time picker) or recurring (daily/weekly + time of day).
- **Note:** Scheduling is a UI stub in the initial implementation. Schedule config is saved as part of the job JSON under a `_schedule` key but is not yet executed by the backend.

**Request Settings:**
- Delay between page loads (ms input, default 0)
- Max pages cap (number input, default blank = no cap)
- These are saved in the job config under a `_settings` key.

**Chain Output:**
- After this job finishes, trigger another job (job picker from `listJobs()`).
- Pass a specific field from this job's results as the URL source of the next job (field picker from this job's config keys).
- **Note:** Chain execution is a UI stub in the initial implementation. Chain config is saved under a `_chain` key but is not yet executed.

**Navigation:**
- A "View Results →" link to `results.html?name=xyz` is always visible at the bottom of the page.

---

### 3. Job Detail — Page 2 (`results.html?name=xyz&runId=abc`)

Page `<title>`: `"<jobname> Results — Scrape Tool"`. Visible `<h2>` heading with job name.

**"← Config / Setup" link** at the top always visible, links to `job.html?name=xyz`.

Two tabs: **Results & Logs** and **History**.

#### Results & Logs Tab

**On page load:**
- If `runId` is in the URL: this is a live or just-completed run.
  - `logs.js` immediately opens the SSE connection to `/api/logs/:runId`.
  - Once SSE receives `DONE`, `results.js` calls `getRun(name, runId)` to load the result.
- If no `runId` in the URL: load the most recent run by calling `listRuns(name)` and picking the last entry.
- If no runs exist: show empty state — "No runs yet. Go to Setup to run this job."

**Results table:**
- Dynamically built from the JSON keys of the loaded result object.
- If result is `null` (captcha failure): show error state — "Scrape failed — captcha unresolved."
- If result is an array (paginated): render each page as a section with a heading "Page N".
- Loading state: show a spinner/skeleton while fetching.

**Log panel:**
- Rendered below the results table.
- Toggle button "Show / Hide Logs" controls visibility (hidden by default after run completes).
- During a live run: visible by default, streams SSE entries in real time.
- After run: shows the captured log entries (retained in memory from the SSE stream).
- Color-coded: `log-info` (green), `log-warn` (yellow), `log-error` (orange).

#### History Tab

Table of past runs for this job:
- Columns: **Timestamp** (parsed from runId, formatted as readable date/time), **Items** (top-level key count of result), **Status** (success / error / null), **Run ID**
- Duration is not available from the current backend — column is omitted.
- Data source: `listRuns(name)` for the list; `getRun(name, runId)` loaded lazily per row when the user clicks a row.
- Clicking a row loads that run's result into the Results & Logs tab (switches to that tab) and updates the URL to `results.html?name=xyz&runId=<clickedRunId>`.

---

## Shared JS Modules

| Module | Responsibility |
|--------|---------------|
| `api.js` | All `fetch()` calls per the contract table above. Single seam — no other file calls `fetch()` directly. |
| `chart.js` | `drawSparkline(canvas, data)` where `data` is `[{ count, status }]`. Draws one bar per run, height proportional to count, green for success, orange for error. |
| `form.js` | `buildForm(container, config)` populates the form from a config object. `readForm(container)` assembles and returns a config object from the current form state. Handles flat fields, groups, and pagination. |
| `dashboard.js` | Renders job card grid on load, polls every 5s, handles `+` new job inline prompt. |
| `job.js` | Reads `?name=` from URL, calls `getJob` + `form.js` to populate Config tab, wires up Run Now → navigate with runId, handles tab switching. |
| `results.js` | Reads `?name=` and `?runId=` from URL, manages Results/Logs and History tabs, calls `logs.js` for live runs. |
| `logs.js` | `connectLogs(runId, logBox)` — opens SSE to `/api/logs/:runId`, appends formatted entries to `logBox` element, resolves a returned Promise when `DONE` is received. **The SSE connection must be opened before any async work (e.g. before rendering or navigation) to avoid losing early log entries the backend emits immediately via `setImmediate`.** |

---

## Navigation Logic

| From | Action | Destination |
|------|--------|-------------|
| Dashboard | Click idle/stopped job card | `job.html?name=xyz` |
| Dashboard | Click running/error job card | `results.html?name=xyz` |
| Dashboard | Click `+` card + confirm name | `job.html?name=xyz` (new job) |
| Job Page 1 | Click "Run Now" | `results.html?name=xyz&runId=<runId>` |
| Job Page 1 | Click "View Results →" | `results.html?name=xyz` |
| Job Page 2 | Click "← Config / Setup" | `job.html?name=xyz` |
| Job Page 2 History | Click a run row | stays on `results.html`, updates `?runId=`, loads that run |

---

## Implementation Notes

- `public/js/layout.js` must be **edited** (not created) — remove `builder.html` and `results.html` from `NAV_LINKS`, leaving only the Dashboard entry. `template.html`'s empty-state link to `/builder.html` should also be removed.
- In `api.js`, use `response.ok` (not `response.status === 200`) to detect success on `saveJob`, since `POST /api/jobs` returns 201.
- The `.field-row` CSS class in `style.css` is currently a 5-column grid. The config form field row has 6 controls (name, selector, mode, type, group toggle, remove). Add a column or use a different layout class for config form rows.
- Page titles use `"<jobname> — Scrape Tool"` for `job.html` and `"<jobname> Results — Scrape Tool"` for `results.html`. This difference is intentional.

---

## Tauri Integration

### Approach: Express Sidecar

Tauri wraps the existing frontend and backend with zero code changes:
- Tauri spawns `node server.js` as a sidecar process on launch via the `shell` plugin
- The webview loads `http://localhost:3000` — Express serves both the API and static frontend
- On app close, Tauri kills the sidecar process
- `api.js` remains unchanged — all calls still go to `localhost:3000`

Node.js must be installed on the user's system. Acceptable for a personal local tool.

### Window Configuration

- Title: `Scrape Tool`
- Starts maximized
- Resizable, minimum size 960×600

### New Files

```
src-tauri/
  tauri.conf.json   ← window config, sidecar config, app metadata, bundle targets
  Cargo.toml        ← Rust dependencies (tauri + shell plugin only)
  src/
    main.rs         ← minimal entry point: boots Tauri, spawns Express sidecar
```

### Packaging

Build targets: `.deb` + `.AppImage`, both produced by `tauri build`.

- `.deb` lists `nodejs` as a system dependency in the package manifest
- `.AppImage` is self-contained except for Node.js (user must have it installed)

### Dev Workflow

- `node server.js` continues to work standalone for backend/API development
- `tauri dev` wraps the webview in a native window for full app development
- No changes to any existing file — Tauri is purely additive

### Prerequisites (one-time setup)

```bash
# Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Tauri CLI
cargo install tauri-cli

# Arch system dependencies
sudo pacman -S webkit2gtk base-devel curl wget openssl appmenu-gtk-module \
  gtk3 libappindicator-gtk3 librsvg libvips
```

---

## Tauri Compatibility Notes

- Frontend is plain static HTML/JS — no build step, no framework. Tauri-compatible by default.
- `api.js` is the only file that calls the backend. Swapping to Tauri IPC means updating one file.
- Express continues to run as a sidecar process when packaged in Tauri.
- No direct filesystem access from frontend JS — all file operations go through the Express API. The `.txt` file upload (URL Source) uses the `FileReader` API to read the file client-side and sends the contents to the server; no raw filesystem path is exposed.
- `sessionStorage` for job status is per-window — compatible with Tauri's single-window model.
