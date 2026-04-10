# Notification System — Design Spec
_Date: 2026-04-10_

## Overview

Notify the user when scrape or export events complete. In-app toast if the app window is focused; desktop notification if not.

---

## Events

| Event | Trigger point |
|-------|--------------|
| Scrape completed | Runner route `finally` block (no error) |
| Scrape errored | Runner route `catch` block |
| Export success | `ExportManager.exportRun()` on success |
| Export error | `ExportManager.exportRun()` on failure |

---

## Architecture

### Server side

**Global SSE endpoint** `GET /api/events`
- Any page in the app connects to this on load
- Server holds connected clients in a Set (same pattern as `#reloadClients`)
- When an event fires, server broadcasts a JSON payload to all connected clients:
  ```json
  { "type": "scrape-done", "job": "...", "runId": "..." }
  { "type": "scrape-error", "job": "...", "message": "..." }
  { "type": "export-done", "job": "...", "path": "..." }
  { "type": "export-error", "job": "...", "message": "..." }
  ```

**Desktop notification endpoint** `POST /api/notify/desktop`
- Accepts `{ title, message }` from the client
- Calls `node-notifier` to fire an OS-level desktop notification
- Returns `{ ok: true }`

**Broadcast helper** — private method `#broadcast(event)` on `Server`
- Serialises event and writes to all `/api/events` SSE clients
- Called from the runner route and export manager

**Wiring export events** — `ExportManager` needs to broadcast events. Two options:
- Pass the broadcast function in as a callback on construction (same pattern as logger injection)
- Emit events from the server after calling `exportRun` / `autoSave`

The second option is cleaner — keeps `ExportManager` unaware of the notification system. The server checks the result of `exportRun` and broadcasts accordingly.

---

### Client side

**`public/js/notifier.js`** — new ES module, included on every HTML page

Responsibilities:
1. Connect to `/api/events` SSE on load
2. On receiving an event:
   - `document.hasFocus()` is `true` → show toast
   - `document.hasFocus()` is `false` → `POST /api/notify/desktop`
3. Manage the toast container

**Toast UI:**
- Fixed container, bottom-right corner, `z-index` above all content
- Each toast: icon (✓ / ✗), job name, short message, auto-dismiss after 3 seconds
- Click to dismiss early
- Stack up to 4 toasts; oldest dismissed first if limit exceeded
- Auto-dismiss after 3 seconds

---

## New files

| File | Purpose |
|------|---------|
| `public/js/notifier.js` | SSE client, toast renderer, desktop trigger |
| `public/css/notifications.css` | Toast styles |

---

## Modified files

| File | Change |
|------|--------|
| `server.js` | `/api/events` SSE endpoint, `/api/notify/desktop` endpoint, `#broadcast()` helper, broadcast calls in runner route and after export calls |
| `package.json` | Add `node-notifier` dependency |
| Every HTML page | `<script type="module" src="/js/notifier.js">` in `<head>` |

---

## Toast message copy

| Event | Title | Message |
|-------|-------|---------|
| Scrape completed | `Job done` | `"{job}" finished successfully` |
| Scrape errored | `Scrape failed` | `"{job}" encountered an error` |
| Export success | `Export saved` | `"{job}" exported to {path}` |
| Export error | `Export failed` | `"{job}" could not be exported` |

---

## Dependencies

- `node-notifier` — server-side OS desktop notifications (Linux/Mac/Windows)
