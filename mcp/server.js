#!/usr/bin/env node
// mcp/server.js — MCP server for Scrape Tool
//
// Exposes all Scrape Tool operations as MCP tools backed by the REST API.
// The app server must be running (default: http://localhost:3000).
//
// Adding a new tool: add one entry to TOOLS — no handler code needed.

import { Server }   from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const BASE_URL = process.env.SCRAPE_TOOL_URL || 'http://localhost:3000';

// ── Tool registry ─────────────────────────────────────────────────────────────
//
// Each entry describes one MCP tool. The generic handler below routes every
// call through fetch() using the method, path, and optional buildBody here.
//
// To add a new tool: append one object. No other code changes needed.

const TOOLS = [
  // ── Jobs ──────────────────────────────────────────────────────────────────

  {
    name: 'list_jobs',
    description: 'List all scrape jobs with their run counts.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    method: 'GET',
    path: () => '/api/jobs',
  },

  {
    name: 'get_job',
    description: 'Get the full config for a specific job.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Job name' },
      },
      required: ['name'],
    },
    method: 'GET',
    path: (p) => `/api/jobs/${encodeURIComponent(p.name)}`,
  },

  {
    name: 'create_job',
    description: 'Create or update a job config. Pass the full config object including URL and field selectors.',
    inputSchema: {
      type: 'object',
      properties: {
        name:   { type: 'string', description: 'Job name (used as filename)' },
        config: { type: 'object', description: 'Job config object (URL, selectors, _export, etc.)' },
      },
      required: ['name', 'config'],
    },
    method: 'POST',
    path: () => '/api/jobs',
    buildBody: (p) => ({ name: p.name, config: p.config }),
  },

  {
    name: 'delete_job',
    description: 'Delete a job config permanently.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Job name to delete' },
      },
      required: ['name'],
    },
    method: 'DELETE',
    path: (p) => `/api/jobs/${encodeURIComponent(p.name)}`,
  },

  // ── Runs ──────────────────────────────────────────────────────────────────

  {
    name: 'run_job',
    description: 'Trigger a scrape run for a job. Returns a runId — use stream_run_logs or get_run_result to follow progress.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Job name to run' },
      },
      required: ['name'],
    },
    method: 'POST',
    path: (p) => `/api/jobs/${encodeURIComponent(p.name)}/run`,
  },

  {
    name: 'list_runs',
    description: 'List all saved runs for a job (unsorted). Each entry has file and name fields.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Job name' },
      },
      required: ['name'],
    },
    method: 'GET',
    path: (p) => `/api/jobs/${encodeURIComponent(p.name)}/runs`,
  },

  {
    name: 'get_runs_summary',
    description: 'Get a summary of all runs for a job — runId, item count, and success/error status. Lighter than fetching full results.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Job name' },
      },
      required: ['name'],
    },
    method: 'GET',
    path: (p) => `/api/jobs/${encodeURIComponent(p.name)}/runs/summary`,
  },

  {
    name: 'get_run_result',
    description: 'Get the full scraped result data for a specific run.',
    inputSchema: {
      type: 'object',
      properties: {
        name:  { type: 'string', description: 'Job name' },
        runId: { type: 'string', description: 'Run ID (from run_job or list_runs)' },
      },
      required: ['name', 'runId'],
    },
    method: 'GET',
    path: (p) => `/api/jobs/${encodeURIComponent(p.name)}/runs/${encodeURIComponent(p.runId)}`,
  },

  // ── Export ────────────────────────────────────────────────────────────────

  {
    name: 'export_run',
    description: 'Export a run\'s results to disk. Specify folder, format (json/csv/excel), and optional baseName.',
    inputSchema: {
      type: 'object',
      properties: {
        name:       { type: 'string', description: 'Job name' },
        runId:      { type: 'string', description: 'Run ID to export' },
        folder:     { type: 'string', description: 'Output folder path' },
        baseName:   { type: 'string', description: 'Base filename (without extension)' },
        format:     { type: 'string', enum: ['json', 'csv', 'excel'], description: 'Output format' },
        fieldOrder: { type: 'array', items: { type: 'string' }, description: 'Optional column order' },
      },
      required: ['name', 'runId', 'folder'],
    },
    method: 'POST',
    path: (p) => `/api/jobs/${encodeURIComponent(p.name)}/runs/${encodeURIComponent(p.runId)}/export`,
    buildBody: (p) => ({
      folder:     p.folder,
      baseName:   p.baseName,
      format:     p.format || 'json',
      fieldOrder: p.fieldOrder || [],
    }),
  },

  {
    name: 'save_export_config',
    description: 'Save export settings to a job\'s config so they persist across sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        name:         { type: 'string', description: 'Job name' },
        folder:       { type: 'string', description: 'Export folder path' },
        baseName:     { type: 'string', description: 'Base filename' },
        format:       { type: 'string', enum: ['json', 'csv', 'excel'] },
        autoSave:     { type: 'boolean', description: 'Auto-export after every scrape' },
        strategy:     { type: 'string', enum: ['split', 'append'] },
        fieldOrder:   { type: 'array', items: { type: 'string' } },
      },
      required: ['name'],
    },
    method: 'POST',
    path: (p) => `/api/jobs/${encodeURIComponent(p.name)}/export-config`,
    buildBody: (p) => ({
      exportConfig: {
        folder:     p.folder,
        baseName:   p.baseName,
        format:     p.format,
        autoSave:   p.autoSave,
        strategy:   p.strategy,
        fieldOrder: p.fieldOrder,
      },
    }),
  },
];

// ── Generic HTTP handler ──────────────────────────────────────────────────────

async function callRestTool(tool, params) {
  const url  = BASE_URL + tool.path(params);
  const body = tool.buildBody ? tool.buildBody(params) : undefined;

  const res = await fetch(url, {
    method:  tool.method,
    headers: { 'Content-Type': 'application/json' },
    body:    body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  return JSON.stringify(data, null, 2);
}

// ── SSE log streaming ─────────────────────────────────────────────────────────
//
// Connects to the SSE log stream and buffers all entries until DONE fires,
// then returns the full log as a string. Works for live and recent runs.

async function streamRunLogs(runId) {
  const url = `${BASE_URL}/api/logs/${encodeURIComponent(runId)}`;
  const res = await fetch(url, { headers: { Accept: 'text/event-stream' } });

  if (!res.ok) throw new Error(`Log stream returned ${res.status}`);

  const lines = [];

  // Parse SSE manually from the response body stream
  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let   buffer  = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop(); // keep incomplete chunk

    for (const part of parts) {
      const dataLine = part.split('\n').find(l => l.startsWith('data: '));
      if (!dataLine) continue;
      const entry = JSON.parse(dataLine.slice(6));
      if (entry.level === 'DONE') return lines.join('\n');
      lines.push(`[${entry.timestamp}] [${entry.level.padEnd(5)}] ${entry.message}`);
    }
  }

  return lines.join('\n');
}

// ── MCP server setup ──────────────────────────────────────────────────────────

const server = new Server(
  { name: 'scrape-tool', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// List all available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // Registry-based tools
    ...TOOLS.map(t => ({
      name:        t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
    // SSE tool — defined separately since it has a custom handler
    {
      name: 'stream_run_logs',
      description: 'Stream and return all log entries for a run. Connects to the live log stream and waits until the run finishes. Works for both active and recently completed runs.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Run ID to stream logs for' },
        },
        required: ['runId'],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: params } = request.params;

  try {
    let result;

    if (name === 'stream_run_logs') {
      result = await streamRunLogs(params.runId);
    } else {
      const tool = TOOLS.find(t => t.name === name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      result = await callRestTool(tool, params);
    }

    return {
      content: [{ type: 'text', text: result }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
