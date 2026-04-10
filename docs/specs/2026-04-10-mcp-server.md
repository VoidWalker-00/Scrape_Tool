# MCP Server — Design Spec
_Date: 2026-04-10_

## Overview

A standalone MCP (Model Context Protocol) server that lets AI clients (Claude Code, Gemini CLI) operate the Scrape Tool via natural language. Wraps the existing REST API — the app server must be running.

---

## Architecture

**File:** `mcp/server.js`
**Transport:** stdio (spawned as subprocess by Claude Code / Gemini)
**Dependency:** `@modelcontextprotocol/sdk`
**Config:** `SCRAPE_TOOL_URL` env var (default: `http://localhost:3000`)

The server holds a **tool registry** — an array of plain objects describing each tool. One generic handler routes every tool call to the right REST endpoint. Adding a new feature requires only a new entry in the registry array, no new handler code.

---

## Registry entry shape

```js
{
  name:        string,        // snake_case tool name shown to the AI
  description: string,        // what the tool does
  inputSchema: JSONSchema,    // parameters the AI must provide
  method:      string,        // HTTP method
  path:        (params) => string,  // builds the endpoint path from params
  buildBody:   (params) => object | null,  // optional — builds request body
}
```

---

## Tools

| Tool | Method | Endpoint |
|------|--------|----------|
| `list_jobs` | GET | `/api/jobs` |
| `get_job` | GET | `/api/jobs/:name` |
| `create_job` | POST | `/api/jobs` |
| `delete_job` | DELETE | `/api/jobs/:name` |
| `run_job` | POST | `/api/jobs/:name/run` |
| `list_runs` | GET | `/api/jobs/:name/runs` |
| `get_runs_summary` | GET | `/api/jobs/:name/runs/summary` |
| `get_run_result` | GET | `/api/jobs/:name/runs/:runId` |
| `stream_run_logs` | GET (SSE) | `/api/logs/:runId` |
| `export_run` | POST | `/api/jobs/:name/runs/:runId/export` |
| `save_export_config` | POST | `/api/jobs/:name/export-config` |

### Special case: `stream_run_logs`
SSE does not fit the request/response pattern. This tool connects to `/api/logs/:runId`, buffers all log entries until the `DONE` event, then returns them as a single array. Works for both live and recently completed runs.

---

## New files

| File | Purpose |
|------|---------|
| `mcp/server.js` | MCP server — registry + generic handler |
| `mcp/README.md` | Setup instructions for Claude Code and Gemini CLI |

## Dependencies

- `@modelcontextprotocol/sdk` — MCP server framework

---

## Claude Code integration

Add to `.mcp.json` in the project root:
```json
{
  "mcpServers": {
    "scrape-tool": {
      "command": "node",
      "args": ["mcp/server.js"],
      "env": {
        "SCRAPE_TOOL_URL": "http://localhost:3000"
      }
    }
  }
}
```

## Gemini CLI integration

Add to Gemini's MCP config (`~/.gemini/settings.json`):
```json
{
  "mcpServers": {
    "scrape-tool": {
      "command": "node",
      "args": ["/absolute/path/to/mcp/server.js"],
      "env": {
        "SCRAPE_TOOL_URL": "http://localhost:3000"
      }
    }
  }
}
```
