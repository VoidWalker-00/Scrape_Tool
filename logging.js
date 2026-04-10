const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

// Directory where log files are saved
const LOG_DIR = path.join(__dirname, 'Logs');

// Rotate to a new file once this size is reached
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

// Log files older than this are deleted on startup
const MAX_AGE_DAYS = 7;

// Terminal colour codes for each log level
const COLOURS = {
  reset: '\x1b[0m',
  info: '\x1b[32m',   // green
  warn: '\x1b[33m',   // yellow
  error: '\x1b[31m',  // red
};

// Logger extends EventEmitter so external consumers (e.g. the SSE endpoint
// in server.js) can subscribe to log events without modifying this class.
// Each log call emits: { level, message, timestamp }
class Logger extends EventEmitter {
  // Path of the currently active log file
  #currentFilePath = null;

  // Cleanup runs once per process — no point scanning on every new Logger instance
  static #cleaned = false;

  constructor() {
    super();

    // Ensure the Logs/ directory exists before writing anything
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    // Remove stale log files from previous sessions
    this.#cleanOldLogs();

    // Create a fresh timestamped file for this session
    this.#rotateFile();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  info(message) {
    this.#log('INFO ', message, COLOURS.info);
  }

  warn(message) {
    this.#log('WARN ', message, COLOURS.warn);
  }

  error(message) {
    this.#log('ERROR', message, COLOURS.error);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  // Core log method: prints to terminal, emits event, writes to file
  #log(level, message, colour) {
    const timestamp = this.#getTimestamp();
    const line = `[${timestamp}] [${level}] ${message}`;

    // Coloured output in the terminal
    console.log(`${colour}${line}${COLOURS.reset}`);

    // Emit so subscribers (e.g. SSE stream) can forward the entry
    this.emit('log', { level: level.trim(), message, timestamp });

    // Persist to disk
    this.#writeToFile(line);
  }

  // Appends a line to the current log file, rotating first if it's too large
  #writeToFile(line) {
    if (this.#fileTooLarge()) {
      this.#rotateFile();
    }
    fs.appendFileSync(this.#currentFilePath, line + '\n', 'utf8');
  }

  // Returns true if the current log file has hit the size limit
  #fileTooLarge() {
    if (!this.#currentFilePath || !fs.existsSync(this.#currentFilePath)) {
      return false;
    }
    const { size } = fs.statSync(this.#currentFilePath);
    return size >= MAX_FILE_SIZE;
  }

  // Points #currentFilePath at a new timestamped file (does not create it yet —
  // appendFileSync creates it on the first write)
  #rotateFile() {
    const name = this.#getTimestamp().replace(/[: ]/g, '-');
    this.#currentFilePath = path.join(LOG_DIR, `${name}.txt`);
  }

  // Deletes .txt files in Logs/ that are older than MAX_AGE_DAYS.
  // Runs at most once per process — no benefit repeating it on every scrape.
  #cleanOldLogs() {
    if (Logger.#cleaned) return;
    Logger.#cleaned = true;
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(LOG_DIR);
    for (const file of files) {
      if (!file.endsWith('.txt')) continue;
      const filePath = path.join(LOG_DIR, file);
      const { mtimeMs } = fs.statSync(filePath);
      if (mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
      }
    }
  }

  // Returns current date-time as "YYYY-MM-DD HH:MM:SS"
  #getTimestamp() {
    const now = new Date();
    const date = now.toLocaleDateString('en-CA'); // YYYY-MM-DD
    const time = now.toTimeString().slice(0, 8);  // HH:MM:SS
    return `${date} ${time}`;
  }
}

module.exports = Logger;
