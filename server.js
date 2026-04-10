const express      = require('express');
const fs           = require('fs');
const path         = require('path');
const { spawnSync } = require('child_process');
const notifier     = require('node-notifier');
const Scraper      = require('./scraper.js');
const Logger       = require('./logging.js');
const { runPlugins } = require('./plugins/index.js');
const ExportManager  = require('./export.js');

// Counts total items in a scrape result — used by the runs/summary endpoint.
// Groups count by their longest sub-array, plain arrays by length, scalars as 1.
function _countItems(result) {
  if (result === null) return 0;
  const pages = Array.isArray(result) ? result : [result];
  let count = 0;
  for (const page of pages) {
    for (const val of Object.values(page)) {
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        const lens = Object.values(val).map(v => Array.isArray(v) ? v.length : 0);
        if (lens.length) count += Math.max(...lens);
      } else if (Array.isArray(val)) {
        count += val.length;
      } else {
        count += 1;
      }
    }
  }
  return count;
}

// Server encapsulates the Express app, all API routes, and SSE state.
// Using a class instead of a bare module means:
//   - start() / stop() give explicit lifecycle control (no process juggling in tests)
//   - Private fields keep sseClients and directory paths from leaking globally
//   - Ports and directories can be overridden per-instance (useful for tests)
class Server {
  #app = null;          // Express application
  #httpServer = null;   // Underlying Node http.Server (returned by app.listen)
  #sseClients = new Map(); // runId → res: active SSE connections for live log streaming
  #reloadClients = new Set(); // res: SSE connections waiting for dev live-reload signals
  #notifyClients = new Set(); // res: SSE connections for global notification events
  #port;
  #selectorsDir;        // Where JSON job configs are stored
  #resultsDir;          // Where scrape result JSON files are saved
  #exportManager = null;

  // port         — defaults to 3000
  // selectorsDir — defaults to Data/Selectors/
  // resultsDir   — defaults to Data/Results/
  constructor({ port = 3000, selectorsDir, resultsDir } = {}) {
    this.#port = port;
    // In packaged builds SCRAPE_TOOL_DATA points to a writable app data dir;
    // in development __dirname (project root) is used as before.
    const dataRoot = process.env.SCRAPE_TOOL_DATA || __dirname;
    this.#selectorsDir = selectorsDir ?? path.join(dataRoot, 'Data', 'Selectors');
    this.#resultsDir   = resultsDir   ?? path.join(dataRoot, 'Data', 'Results');

    this.#app = express();
    this.#app.use(express.json());

    this.#exportManager = new ExportManager({
      resultsDir:   this.#resultsDir,
      selectorsDir: this.#selectorsDir,
    });

    // Serve the frontend (HTML/CSS/JS) from the public/ directory
    this.#app.use(express.static(path.join(__dirname, 'public')));

    this.#registerRoutes();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  // Starts the HTTP server and resolves when it is ready to accept connections
  start() {
    return new Promise(resolve => {
      this.#httpServer = this.#app.listen(this.#port, () => {
        console.log(`Dashboard running at http://localhost:${this.#port}`);
        resolve();
      });
    });
  }

  // Gracefully closes the server, waiting for in-flight requests to finish
  stop() {
    return new Promise((resolve, reject) => {
      if (!this.#httpServer) return resolve();
      this.#httpServer.close(err => err ? reject(err) : resolve());
    });
  }

  // Returns the actual bound port — useful when port:0 assigns a random port
  get port() {
    return this.#httpServer?.address()?.port ?? this.#port;
  }

  // ── Route registration ────────────────────────────────────────────────────

  // Coordinator — calls each focused registration method in turn.
  // To add a new route group, create a new #register*Routes() method and
  // call it here.
  #registerRoutes() {
    this.#registerHealthRoutes();
    this.#registerJobRoutes();
    this.#registerRunnerRoutes();
    this.#registerSSERoutes();
    this.#registerResultRoutes();
    this.#registerExportRoutes();
    this.#registerNotificationRoutes();
    if (process.env.NODE_ENV !== 'production') this.#registerDevReloadRoute();
  }

  // GET /api/health
  // Simple liveness check — used by tests and monitoring to confirm the server is up
  #registerHealthRoutes() {
    this.#app.get('/api/health', (req, res) => res.json({ ok: true }));
  }

  // GET    /api/jobs          — list all job configs with run counts
  // GET    /api/jobs/:name    — get a single job config
  // POST   /api/jobs          — create a new job config
  // DELETE /api/jobs/:name    — delete a job config
  #registerJobRoutes() {
    const app = this.#app;

    // Returns all saved job configs as [{ name, runs }]
    // runs = number of result files saved for that job
    app.get('/api/jobs', (req, res) => {
      const files = fs.readdirSync(this.#selectorsDir).filter(f => f.endsWith('.json'));
      const jobs = files.map(f => {
        const name = path.basename(f, '.json');
        const resultsPath = path.join(this.#resultsDir, name);
        const runs = fs.existsSync(resultsPath) ? fs.readdirSync(resultsPath).length : 0;
        return { name, runs };
      });
      res.json(jobs);
    });

    // Returns the raw JSON config for a single job
    app.get('/api/jobs/:name', (req, res) => {
      const filePath = path.join(this.#selectorsDir, `${req.params.name}.json`);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
      res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    });

    // Saves a new job config to Data/Selectors/<name>.json
    // Body: { name: string, config: object }
    app.post('/api/jobs', (req, res) => {
      const { name, config } = req.body;
      if (!name || !config) return res.status(400).json({ error: 'name and config required' });
      const filePath = path.join(this.#selectorsDir, `${name}.json`);
      fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
      res.status(201).json({ ok: true });
    });

    // Deletes a job config file
    app.delete('/api/jobs/:name', (req, res) => {
      const filePath = path.join(this.#selectorsDir, `${req.params.name}.json`);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
      fs.unlinkSync(filePath);
      res.json({ ok: true });
    });
  }

  // POST /api/jobs/:name/run
  // Kicks off a scrape in the background and immediately returns a runId.
  // The client uses runId to connect to the SSE stream and later fetch results.
  #registerRunnerRoutes() {
    this.#app.post('/api/jobs/:name/run', (req, res) => {
      const { name } = req.params;
      const configPath = path.join(this.#selectorsDir, `${name}.json`);
      if (!fs.existsSync(configPath)) return res.status(404).json({ error: 'Job not found' });

      // Unique ID for this run — used as the SSE channel key and result filename
      const runId = `${name}-${Date.now()}`;

      // Respond immediately with 202 so the client can open the SSE stream
      // before the scrape starts producing log entries
      res.status(202).json({ runId });

      setImmediate(async () => {
        // Create a fresh Logger for this run.
        // Each run writes to its own timestamped file in Logs/.
        const logger = new Logger();

        // Forward every log event to the SSE client watching this runId
        logger.on('log', (entry) => {
          const client = this.#sseClients.get(runId);
          if (client) client.write(`data: ${JSON.stringify(entry)}\n\n`);
        });

        // Inject the logger so its events reach the SSE stream
        const scraper = new Scraper(configPath, null, logger);

        try {
          await scraper.launch();
          const result = await scraper.scrape();
          await scraper.close();

          // Save the result as JSON — one file per run under Data/Results/<job>/
          const jobResultsDir = path.join(this.#resultsDir, name);
          fs.mkdirSync(jobResultsDir, { recursive: true });
          const outPath = path.join(jobResultsDir, `${runId}.json`);
          fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

          // Auto-export if _export.autoSave is configured for this job
          const autoSaveResult = await this.#exportManager.autoSave(name, runId, logger);
          if (autoSaveResult) {
            if (autoSaveResult.ok) {
              this.#broadcast({ type: 'export-done', job: name, path: autoSaveResult.path });
            } else {
              this.#broadcast({ type: 'export-error', job: name, message: autoSaveResult.error });
            }
          }

          // Run any post-scrape plugins (email, upload, etc.)
          await runPlugins({ job: name, runId, result, outPath });

          this.#broadcast({ type: 'scrape-done', job: name, runId });
        } catch (err) {
          logger.error(`Scrape failed: ${err.message}`);
          this.#broadcast({ type: 'scrape-error', job: name, message: err.message });
        } finally {
          // Signal the SSE client that the run is finished, then close the stream
          const client = this.#sseClients.get(runId);
          if (client) {
            client.write(`data: ${JSON.stringify({ level: 'DONE', message: 'Scrape finished' })}\n\n`);
            client.end();
            this.#sseClients.delete(runId);
          }
        }
      });
    });
  }

  // GET /api/logs/:runId
  // Opens a Server-Sent Events stream for a specific run.
  // The browser connects here after receiving a runId from POST /run
  // and receives log entries in real time until the scrape finishes.
  #registerSSERoutes() {
    this.#app.get('/api/logs/:runId', (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Send headers immediately so the browser opens the stream before
      // the first log entry arrives
      res.flushHeaders();

      // Register this response object so the runner can push events to it
      this.#sseClients.set(req.params.runId, res);

      // Clean up if the browser tab closes before the scrape finishes
      req.on('close', () => this.#sseClients.delete(req.params.runId));
    });
  }

  // GET /api/jobs/:name/runs          — list all saved runs for a job
  // GET /api/jobs/:name/runs/summary  — list runs with item count and status (no full payloads)
  // GET /api/jobs/:name/runs/:runId   — get the full result data for one run
  #registerResultRoutes() {
    const app = this.#app;

    // Lists all saved result files for a job as [{ file, name }]
    app.get('/api/jobs/:name/runs', (req, res) => {
      const jobResultsDir = path.join(this.#resultsDir, req.params.name);
      if (!fs.existsSync(jobResultsDir)) return res.json([]);
      const files = fs.readdirSync(jobResultsDir).filter(f => f.endsWith('.json'));
      res.json(files.map(f => ({ file: f, name: path.basename(f, '.json') })));
    });

    // Returns [{ runId, items, status }] for the history tab.
    // Reads every result file but returns only summary data — avoids sending full payloads.
    // Must be registered before /:runId so "summary" is not matched as a runId.
    app.get('/api/jobs/:name/runs/summary', (req, res) => {
      const jobResultsDir = path.join(this.#resultsDir, req.params.name);
      if (!fs.existsSync(jobResultsDir)) return res.json([]);
      const files = fs.readdirSync(jobResultsDir).filter(f => f.endsWith('.json'));
      const summary = files.map(f => {
        const runId = path.basename(f, '.json');
        try {
          const result = JSON.parse(fs.readFileSync(path.join(jobResultsDir, f), 'utf8'));
          return { runId, items: _countItems(result), status: result === null ? 'error' : 'success' };
        } catch {
          return { runId, items: 0, status: 'unknown' };
        }
      });
      res.json(summary);
    });

    // Returns the full result data for a single run
    app.get('/api/jobs/:name/runs/:runId', (req, res) => {
      const filePath = path.join(this.#resultsDir, req.params.name, `${req.params.runId}.json`);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
      res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    });
  }

  // POST /api/jobs/:name/runs/:runId/export  — manual one-off export
  // POST /api/jobs/:name/export-config        — save _export to job config
  // GET  /api/check-path?path=...             — test folder writability (no side-effects)
  #registerExportRoutes() {
    const app = this.#app;

    app.post('/api/jobs/:name/runs/:runId/export', async (req, res) => {
      const { name, runId } = req.params;
      console.log(`[Server] POST export — job: ${name}, run: ${runId}, body:`, JSON.stringify(req.body));
      const result = await this.#exportManager.exportRun(name, runId, req.body);
      console.log(`[Server] export result:`, JSON.stringify(result));
      if (result.ok) {
        this.#broadcast({ type: 'export-done', job: name, path: result.path });
      } else {
        this.#broadcast({ type: 'export-error', job: name, message: result.error });
      }
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

    app.get('/api/pick-folder', (req, res) => {
      const result = spawnSync('zenity', ['--file-selection', '--directory'], { encoding: 'utf8' });
      if (result.status !== 0 || !result.stdout.trim()) {
        return res.json({ ok: false });
      }
      res.json({ ok: true, path: result.stdout.trim() });
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

  // Broadcasts a notification event to all connected /api/events SSE clients.
  // event: { type, job, ...payload }
  #broadcast(event) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of this.#notifyClients) res.write(data);
  }

  // GET  /api/events          — SSE stream for global notification events
  // POST /api/notify/desktop  — fires an OS desktop notification via node-notifier
  #registerNotificationRoutes() {
    this.#app.get('/api/events', (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      this.#notifyClients.add(res);
      req.on('close', () => this.#notifyClients.delete(res));
    });

    this.#app.post('/api/notify/desktop', (req, res) => {
      const { title, message } = req.body;
      notifier.notify({ title, message, sound: false });
      res.json({ ok: true });
    });
  }

  // GET /dev/reload
  // SSE endpoint used only in development. The browser connects on load and
  // receives a "reload" event whenever any file in public/ changes.
  // Debounced to 50 ms to avoid duplicate events from editors that write twice.
  #registerDevReloadRoute() {
    const publicDir = path.join(__dirname, 'public');
    let debounce = null;

    fs.watch(publicDir, { recursive: true }, () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        for (const res of this.#reloadClients) {
          res.write('data: reload\n\n');
        }
      }, 50);
    });

    this.#app.get('/dev/reload', (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      this.#reloadClients.add(res);
      req.on('close', () => this.#reloadClients.delete(res));
    });
  }
}

// When run directly (`node server.js`), start on the default port.
// When imported as a module (e.g. in tests), do nothing — the caller controls lifecycle.
if (require.main === module) {
  new Server().start();
}

module.exports = Server;
