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
export function listJobs() {
  return _req('GET', '/api/jobs');
}

// Returns the raw config object
export function getJob(name) {
  return _req('GET', `/api/jobs/${encodeURIComponent(name)}`);
}

// Creates or overwrites a job config. POST /api/jobs is idempotent (silent overwrite).
// Use for both create and update. Returns { ok: true } with status 201.
// Use response.ok (not === 200) to detect success.
export function saveJob(name, config) {
  return _req('POST', '/api/jobs', { name, config });
}

// Returns { ok: true }
export function deleteJob(name) {
  return _req('DELETE', `/api/jobs/${encodeURIComponent(name)}`);
}

// Starts a scrape. Returns { runId } with status 202 (run is async).
export function runJob(name) {
  return _req('POST', `/api/jobs/${encodeURIComponent(name)}/run`);
}

// Returns [{ file, name }] in filesystem order (NOT sorted).
// Sort by .name to get chronological order — name format: "<jobname>-<timestamp_ms>"
//   runs.sort((a, b) => a.name.localeCompare(b.name))
export function listRuns(name) {
  return _req('GET', `/api/jobs/${encodeURIComponent(name)}/runs`);
}

// Returns [{ runId, items, status }] — lightweight summary for the history tab.
// Use instead of getRun() when you only need item count and success/error status.
export function getRunsSummary(name) {
  return _req('GET', `/api/jobs/${encodeURIComponent(name)}/runs/summary`);
}

// Returns the full result object. May be null (captcha failure).
export function getRun(name, runId) {
  return _req('GET', `/api/jobs/${encodeURIComponent(name)}/runs/${encodeURIComponent(runId)}`);
}

// Exports a run to disk. opts: { folder, baseName, format, fieldOrder }
// Returns { ok: true, path } or { ok: false, error }
export function exportRun(name, runId, opts) {
  return _req('POST', `/api/jobs/${encodeURIComponent(name)}/runs/${encodeURIComponent(runId)}/export`, opts);
}

// Saves _export config into the job's config JSON.
// Returns { ok: true }
export function saveExportConfig(name, exportConfig) {
  return _req('POST', `/api/jobs/${encodeURIComponent(name)}/export-config`, { exportConfig });
}

// Checks whether a folder path exists and is writable. No side-effects.
// Returns { ok, writable, error? }
export function checkPath(folderPath) {
  return _req('GET', `/api/check-path?path=${encodeURIComponent(folderPath)}`);
}

// Opens a native OS folder picker dialog on the server.
// Returns { ok: true, path } or { ok: false } if the user cancels.
export function pickFolder() {
  return _req('GET', '/api/pick-folder');
}
