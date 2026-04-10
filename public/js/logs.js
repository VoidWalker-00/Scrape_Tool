// logs.js — SSE client for live log streaming.
//
// Usage:
//   const stream = new LogStream(logBoxEl);
//   await stream.connect(runId);  // resolves when backend sends DONE
//
// CRITICAL TIMING: Call connect() at the TOP of results.js, before any await.
// The backend fires the first log entries via setImmediate after the 202 response
// — connecting late will silently drop those early entries.

export class LogStream {
  // logBox   — <div class="log-box"> element to append lines into
  // onEntry  — optional callback(entry) called for each log entry
  //            Use to react to specific levels (e.g. set sessionStorage on ERROR)
  constructor(logBox, onEntry) {
    this._logBox  = logBox;
    this._onEntry = onEntry || null;
    this._source  = null;
  }

  // Opens the SSE connection and returns a Promise that resolves on DONE or error.
  connect(runId) {
    return new Promise((resolve) => {
      this._source = new EventSource(`/api/logs/${encodeURIComponent(runId)}`);

      this._source.onmessage = (event) => {
        const entry = JSON.parse(event.data);

        if (entry.level === 'DONE') {
          this._source.close();
          resolve();
          return;
        }

        const line = document.createElement('div');
        const cls  = { INFO: 'log-info', WARN: 'log-warn', ERROR: 'log-error' }[entry.level];
        if (cls) line.className = cls;
        line.textContent = `[${entry.timestamp}] [${entry.level.padEnd(5)}] ${entry.message}`;
        this._logBox.appendChild(line);
        this._logBox.scrollTop = this._logBox.scrollHeight;

        if (this._onEntry) this._onEntry(entry);
      };

      this._source.onerror = () => {
        this._source.close();
        resolve();
      };
    });
  }

  // Closes the connection early (e.g. user navigates away mid-run)
  disconnect() {
    this._source?.close();
  }
}
