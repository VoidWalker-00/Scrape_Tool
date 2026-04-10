# Scrape Tool — MCP Server

Exposes all Scrape Tool operations as MCP tools so AI clients can manage jobs, trigger scrapes, read results, and configure exports.

**The app server must be running** before using any MCP tool:
```bash
node server.js
```

---

## Tools available

| Tool | What it does |
|------|-------------|
| `list_jobs` | List all jobs with run counts |
| `get_job` | Get a job's full config |
| `create_job` | Create or update a job config |
| `delete_job` | Delete a job |
| `run_job` | Trigger a scrape run |
| `list_runs` | List all runs for a job |
| `get_runs_summary` | Get run summaries (status + item count) |
| `get_run_result` | Get full result data for a run |
| `stream_run_logs` | Stream all log entries for a run |
| `export_run` | Export a run to disk |
| `save_export_config` | Save export settings to a job config |

---

## Claude Code setup

`.mcp.json` is already configured in the project root. Claude Code picks it up automatically when you open this directory.

To verify the server is connected:
```
/mcp
```

---

## Gemini CLI setup

Add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "scrape-tool": {
      "command": "node",
      "args": ["/absolute/path/to/Scrape_Tool/mcp/server.js"],
      "env": {
        "SCRAPE_TOOL_URL": "http://localhost:3000"
      }
    }
  }
}
```

Replace `/absolute/path/to/Scrape_Tool` with the actual path on your machine.

---

## Adding new tools

Add one entry to the `TOOLS` array in `mcp/server.js`:

```js
{
  name:        'tool_name',
  description: 'What it does',
  inputSchema: { type: 'object', properties: { ... }, required: [...] },
  method:      'GET',
  path:        (p) => `/api/some-endpoint/${p.param}`,
  buildBody:   null,   // or (p) => ({ key: p.value }) for POST/PUT
}
```

No other code changes needed.
