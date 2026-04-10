# Scrape Tool

A desktop web scraping application built with Node.js and Tauri. Define reusable jobs using CSS selectors, run scrapes on demand, and export results to JSON, CSV, or Excel. Everything is controllable via REST API or through an AI client using the built-in MCP server.

---

## Features

### Scraping

- **CSS selector-based jobs** — define fields by selector, selection mode (Single/All), and extraction type
- **Extraction types** — Text, URL, DateTime, Title, HTML, Image, Alt, Aria-label
- **Grouped fields** — extract related fields as nested objects using a Group definition
- **Pagination** — Click (next button), Scroll (lazy-load), or URL-based
- **Stealth mode** — Puppeteer Extra stealth plugin to reduce bot detection
- **Captcha handling** — detects reCAPTCHA/hCaptcha, pauses for manual solve or routes to an external solver

### Jobs & Runs

- Jobs are stored as JSON config files — create, update, and delete without restarting the app
- Each run is saved to disk with a timestamped result file
- Run summaries (item count, success/error status) available without loading full results
- Real-time log streaming via SSE — follow a scrape as it runs

### Export

- **Formats** — JSON, CSV, Excel (.xlsx)
- **Strategies** — Split (new file per export) or Append (add rows to existing file)
- **Split naming** — datetime suffix, incrementing number, or date + number
- **Split triggers** — by file size (MB) or calendar date
- **Field ordering** — define exact column sequence
- **Auto-save** — optionally export automatically after every scrape

### Plugin System

Drop a `.js` file into the `plugins/` folder and it runs automatically after each scrape. Each plugin receives the job name, run ID, full result, and output path. Plugins are hot-loaded — no restart needed.

### Notifications

- In-app toast notifications for scrape and export events
- Desktop OS notification when the app window is not focused

### MCP Server

All operations are exposed as MCP tools, letting AI clients (Claude Code, Gemini CLI) manage the app directly.

| Tool | What it does |
|------|-------------|
| `list_jobs` | List all jobs with run counts |
| `get_job` | Get a job's full config |
| `create_job` | Create or update a job config |
| `delete_job` | Delete a job |
| `run_job` | Trigger a scrape run |
| `list_runs` | List all runs for a job |
| `get_runs_summary` | Get run summaries (item count, status) |
| `get_run_result` | Get full result data for a run |
| `stream_run_logs` | Stream all log entries until a run finishes |
| `export_run` | Export a run to disk |
| `save_export_config` | Persist export settings to a job config |

Claude Code picks up `.mcp.json` automatically when you open this folder.

---

## Requirements

- **Node.js** 18 or later
- **Chromium** — installed and accessible (default path: `/usr/bin/chromium`)
  - Set `CHROMIUM_PATH` environment variable to override
- **Rust** + **Cargo** — only required to build the Tauri desktop app

---

## Installation

### Run as a web app

```bash
git clone https://github.com/VoidWalker-00/Scrape_Tool.git
cd Scrape_Tool
npm install
node server.js
```

Open `http://localhost:3000` in your browser.

### Run as a desktop app (development)

Requires Rust and the Tauri CLI:

```bash
cargo install tauri-cli --version "^2"
npm install
cargo tauri dev
```

### Build desktop installer

```bash
cargo tauri build
```

Outputs a `.deb` package on Linux. For other platforms, use the GitHub Actions release workflow described below.

---

## GitHub Actions — Automated Releases

The workflow at `.github/workflows/release.yml` builds installers for all platforms automatically on GitHub's servers. No local Rust/Tauri setup needed for releasing.

**Trigger:** push a version tag

```bash
git tag v1.0.0
git push origin v1.0.0
```

**What it does:**

Three jobs run in parallel — one per platform:

| Runner | Output files |
|--------|-------------|
| `ubuntu-22.04` | `.deb` (Debian/Ubuntu), `.rpm` (Fedora/RHEL) |
| `windows-latest` | `.exe` (NSIS installer), `.msi` |
| `macos-latest` | `.dmg` |

All artifacts are attached to a **draft** GitHub Release. Review and publish it from the Releases page.

**Each job:**
1. Installs Node.js 20 and Rust (stable)
2. Runs `npm ci`
3. Builds the Tauri app with `tauri-apps/tauri-action`
4. Uploads the installer to the release

> **Note:** Users must have **Node.js installed** on their machine. The app spawns `node server.js` as its backend at runtime — it is not bundled into the binary.

---

## Job Config Format

Jobs are defined as JSON files in `Data/Selectors/`. Each file maps field names to a `[selector, mode, type]` tuple.

```json
{
  "URL": "https://example.com/listings",

  "Title":       [".item h2",      "Single", "Text"],
  "Link":        [".item a",       "Single", "URL"],
  "PublishedAt": [".item time",    "Single", "DateTime"],
  "Thumbnail":   [".item img",     "Single", "Image"],

  "Details": [
    {
      "Price":       [".detail .price",  "Single", "Text"],
      "Description": [".detail .desc",   "Single", "Text"]
    },
    "All",
    "Group"
  ],

  "Tags": [".item .tag", "All", "Text"],

  "Pagination": [".pagination .next", "Single", "Click"],

  "_export": {
    "folder": "/path/to/output",
    "baseName": "listings",
    "format": "csv",
    "strategy": "split",
    "naming": "date_num",
    "autoSave": true
  }
}
```

**Selection modes:** `Single` (first match), `All` (all matches)

**Extraction types:** `Text`, `URL`, `DateTime`, `Title`, `HTML`, `Image`, `Alt`, `Aria`

**Pagination types:** `Click`, `Scroll`, `URL`

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `CHROMIUM_PATH` | `/usr/bin/chromium` | Path to Chromium binary |
| `NODE_ENV` | — | Set to `production` to disable dev reload endpoint |
| `SCRAPE_TOOL_URL` | `http://localhost:3000` | Base URL used by the MCP server |
