'use strict';
const fs     = require('fs');
const path   = require('path');
const xlsx   = require('xlsx');
const Logger = require('./logging.js');

class ExportManager {
  #resultsDir;
  #selectorsDir;
  #logger;

  constructor({ resultsDir, selectorsDir, logger }) {
    this.#resultsDir   = resultsDir;
    this.#selectorsDir = selectorsDir;
    this.#logger       = logger ?? new Logger();
  }

  // Flattens a single result object or array of page objects into [{ col: val }] rows.
  // fieldOrder controls column sequence; unknown fields appended at end.
  #flatten(result, fieldOrder = []) {
    const pages = Array.isArray(result) ? result : [result];
    const allRows = [];

    for (const page of pages) {
      const scalars = {};
      const arrays  = {};
      const groups  = {};

      for (const [key, val] of Object.entries(page)) {
        if (val === null || typeof val !== 'object') {
          scalars[key] = val;
        } else if (Array.isArray(val)) {
          arrays[key] = val;
        } else if (
          Object.keys(val).length > 0 &&
          Object.values(val).every(v => Array.isArray(v))
        ) {
          groups[key] = val;
        } else {
          scalars[key] = JSON.stringify(val);
        }
      }

      // Find max row count across arrays and groups
      const arrayLens = Object.values(arrays).map(a => a.length);
      const groupLens = Object.values(groups).flatMap(g =>
        Object.values(g).map(a => a.length)
      );
      const maxLen = Math.max(0, ...arrayLens, ...groupLens);

      if (maxLen === 0) {
        // Only scalars
        allRows.push({ ...scalars });
      } else {
        for (let i = 0; i < maxLen; i++) {
          const row = { ...scalars };
          for (const [k, arr] of Object.entries(arrays)) {
            row[k] = arr[i] ?? '';
          }
          for (const [groupName, fields] of Object.entries(groups)) {
            for (const [subKey, arr] of Object.entries(fields)) {
              row[`${groupName}.${subKey}`] = arr[i] ?? '';
            }
          }
          allRows.push(row);
        }
      }
    }

    if (allRows.length === 0) return { headers: [], rows: [] };

    // Collect all keys, apply fieldOrder
    const allKeys = [...new Set(allRows.flatMap(r => Object.keys(r)))];
    const ordered = [
      ...fieldOrder.filter(k => allKeys.includes(k)),
      ...allKeys.filter(k => !fieldOrder.includes(k)),
    ];

    return { headers: ordered, rows: allRows };
  }

  #toCSV(rows, headers) {
    const escape = v => {
      const s = v == null ? '' : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.map(escape).join(',')];
    for (const row of rows) {
      lines.push(headers.map(h => escape(row[h])).join(','));
    }
    return lines.join('\n');
  }

  #toExcel(rows, headers) {
    const ws = xlsx.utils.json_to_sheet(rows, { header: headers });
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Results');
    return wb;
  }

  #writeAppend(rows, headers, filePath, format) {
    if (format === 'json') {
      let existing = [];
      if (fs.existsSync(filePath)) {
        let raw;
        try { raw = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
        catch {
          this.#logger.error(`[Export] Corrupt JSON file — aborting append: ${filePath}`);
          return { ok: false, error: 'Existing file is corrupt' };
        }
        existing = Array.isArray(raw) ? raw : [raw];
      }
      const newRows = rows.map(row => Object.fromEntries(headers.map(h => [h, row[h]])));
      const merged = [...existing, ...newRows];
      const tmp = filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf8');
      fs.renameSync(tmp, filePath);
      return { ok: true };
    }

    if (format === 'csv') {
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, this.#toCSV(rows, headers), 'utf8');
        return { ok: true };
      }
      // Use existing column order from first line
      const firstLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];
      const existingHeaders = firstLine.split(',').map(h => h.replace(/^"|"$/g, '').replace(/""/g, '"'));
      const escape = v => {
        const s = v == null ? '' : String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const newLines = rows.map(row =>
        existingHeaders.map(h => escape(row[h])).join(',')
      ).join('\n');
      fs.appendFileSync(filePath, '\n' + newLines, 'utf8');
      return { ok: true };
    }

    if (format === 'excel') {
      let wb;
      if (fs.existsSync(filePath)) {
        wb = xlsx.readFile(filePath);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const existing = xlsx.utils.sheet_to_json(ws, { defval: '' });
        const merged = [...existing, ...rows];
        wb.Sheets[wb.SheetNames[0]] = xlsx.utils.json_to_sheet(merged, { header: headers });
      } else {
        wb = this.#toExcel(rows, headers);
      }
      xlsx.writeFile(wb, filePath);
      return { ok: true };
    }

    return { ok: false, error: `Unknown format: ${format}` };
  }

  #resolveFilePath(cfg, runId) {
    const { folder, baseName, format, strategy, splitBy, splitSize, naming } = cfg;
    const ext = format === 'excel' ? 'xlsx' : format;

    if (strategy === 'append') {
      return path.join(folder, `${baseName}.${ext}`);
    }

    // strategy: split — determine suffix
    let suffix;

    if (naming === 'datetime') {
      const now = new Date();
      suffix = `_${now.toISOString().slice(0, 16).replace(/:/g, '-')}`;
    } else {
      // num or date_num — scan folder for highest existing counter
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const re = naming === 'date_num'
        ? new RegExp(`^${baseName}_${today}_(\\d+)\\.${ext}$`)
        : new RegExp(`^${baseName}_(\\d+)\\.${ext}$`);

      let max = 0;
      if (fs.existsSync(folder)) {
        for (const f of fs.readdirSync(folder)) {
          const m = f.match(re);
          if (m) max = Math.max(max, parseInt(m[1], 10));
        }
      }
      const next = max + 1;
      const pad = next >= 1000 ? 4 : 3;
      suffix = naming === 'date_num'
        ? `_${today}_${String(next).padStart(pad, '0')}`
        : `_${String(next).padStart(pad, '0')}`;
    }

    // splitBy: size — check if current file still has room
    if (splitBy === 'size' && naming !== 'datetime') {
      const today = new Date().toISOString().slice(0, 10);
      const re2 = naming === 'date_num'
        ? new RegExp(`^${baseName}_${today}_(\\d+)\\.${ext}$`)
        : new RegExp(`^${baseName}_(\\d+)\\.${ext}$`);

      let latestFile = null;
      let latestNum  = 0;
      if (fs.existsSync(folder)) {
        for (const f of fs.readdirSync(folder)) {
          const m = f.match(re2);
          if (m) {
            const n = parseInt(m[1], 10);
            if (n > latestNum) { latestNum = n; latestFile = path.join(folder, f); }
          }
        }
      }
      if (latestFile && fs.existsSync(latestFile)) {
        const sizeMB = fs.statSync(latestFile).size / (1024 * 1024);
        if (sizeMB < (splitSize || Infinity)) return latestFile; // still fits
      }
    }

    // splitBy: date — use today's date as the filename (no counter)
    if (splitBy === 'date') {
      const today = new Date().toISOString().slice(0, 10);
      return path.join(folder, `${baseName}_${today}.${ext}`);
    }

    return path.join(folder, `${baseName}${suffix}.${ext}`);
  }

  async exportRun(jobName, runId, opts = {}) {
    this.#logger.info(`[Export] Starting export — job: ${jobName}, run: ${runId}`);

    // Load saved _export config and merge opts on top
    let saved = {};
    const cfgPath = path.join(this.#selectorsDir, `${jobName}.json`);
    if (fs.existsSync(cfgPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        saved = raw._export || {};
      } catch (e) {
        this.#logger.warn(`[Export] Could not read job config for ${jobName}: ${e.message}`);
      }
    }
    const cfg = { ...saved, ...opts };

    const folder     = cfg.folder;
    let   baseName   = cfg.baseName || jobName;
    const format     = cfg.format   || 'json';
    const fieldOrder = cfg.fieldOrder || [];

    if (!folder) {
      this.#logger.error(`[Export] No export folder configured for job: ${jobName}`);
      return { ok: false, error: 'No export folder configured' };
    }

    const basenameRe = /^[a-zA-Z0-9_\-]+$/;
    if (!basenameRe.test(baseName)) {
      this.#logger.error(`[Export] Invalid file name "${baseName}" for job: ${jobName}`);
      return { ok: false, error: 'Invalid file name' };
    }

    // Load result
    const resultPath = path.join(this.#resultsDir, jobName, `${runId}.json`);
    if (!fs.existsSync(resultPath)) {
      this.#logger.error(`[Export] Run not found: ${resultPath}`);
      return { ok: false, error: 'Run not found' };
    }
    let result;
    try { result = JSON.parse(fs.readFileSync(resultPath, 'utf8')); }
    catch (e) {
      this.#logger.error(`[Export] Could not parse result file ${resultPath}: ${e.message}`);
      return { ok: false, error: 'Could not read result file' };
    }

    // Apply baseNameField — append the field's value from the first result row
    if (cfg.baseNameField) {
      const page = Array.isArray(result) ? result[0] : result;
      const raw  = page?.[cfg.baseNameField];
      if (raw !== undefined && raw !== null && typeof raw !== 'object') {
        const suffix = String(raw).trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '');
        if (suffix) {
          this.#logger.info(`[Export] baseNameField "${cfg.baseNameField}" → "${suffix}"`);
          baseName = `${baseName}_${suffix}`;
        } else {
          this.#logger.warn(`[Export] baseNameField "${cfg.baseNameField}" produced empty value — using static baseName`);
        }
      } else {
        this.#logger.warn(`[Export] baseNameField "${cfg.baseNameField}" not found or not scalar — using static baseName`);
      }
    }

    // Flatten
    const { headers, rows } = this.#flatten(result, fieldOrder);
    if (rows.length === 0) {
      this.#logger.warn(`[Export] Result flattened to 0 rows — job: ${jobName}, run: ${runId}`);
    } else {
      this.#logger.info(`[Export] Flattened ${rows.length} row(s), ${headers.length} column(s)`);
    }

    // Create folder if needed
    try { fs.mkdirSync(folder, { recursive: true }); }
    catch (e) {
      this.#logger.error(`[Export] Could not create folder "${folder}": ${e.message}`);
      return { ok: false, error: `Could not create folder: ${e.message}` };
    }

    // Check write permission
    try { fs.accessSync(folder, fs.constants.W_OK); }
    catch (e) {
      this.#logger.error(`[Export] Permission denied for folder "${folder}"`);
      return { ok: false, error: 'Permission denied' };
    }

    // Resolve output path
    const fullCfg = { ...cfg, folder, baseName, format };
    const filePath = this.#resolveFilePath(fullCfg, runId);
    this.#logger.info(`[Export] Output path resolved: ${filePath}`);

    // Write
    const strategy = cfg.strategy || 'split';
    let writeResult;
    if (strategy === 'append') {
      writeResult = this.#writeAppend(rows, headers, filePath, format);
    } else {
      try {
        if (format === 'json') {
          const ordered = rows.map(row => Object.fromEntries(headers.map(h => [h, row[h]])));
          fs.writeFileSync(filePath, JSON.stringify(ordered, null, 2), 'utf8');
        } else if (format === 'csv') {
          fs.writeFileSync(filePath, this.#toCSV(rows, headers), 'utf8');
        } else if (format === 'excel') {
          const wb = this.#toExcel(rows, headers);
          xlsx.writeFile(wb, filePath);
        }
        writeResult = { ok: true };
      } catch (e) {
        this.#logger.error(`[Export] Write failed for "${filePath}": ${e.message}`);
        writeResult = { ok: false, error: e.message };
      }
    }

    if (!writeResult.ok) {
      this.#logger.error(`[Export] Export failed — ${writeResult.error}`);
      return writeResult;
    }

    this.#logger.info(`[Export] Saved to ${filePath}`);
    return { ok: true, path: filePath };
  }

  async autoSave(jobName, runId, logger) {
    // Use the run's logger if provided so auto-save entries appear in the SSE stream,
    // otherwise fall back to the module-level logger.
    const log = logger ?? this.#logger;
    try {
      const cfgPath = path.join(this.#selectorsDir, `${jobName}.json`);
      if (!fs.existsSync(cfgPath)) return;
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (!raw._export?.autoSave) {
        log.info(`[Export] Auto-save skipped — not enabled for job: ${jobName}`);
        return;
      }
      log.info(`[Export] Auto-save triggered — job: ${jobName}, run: ${runId}`);
      const result = await this.exportRun(jobName, runId);
      if (!result.ok) {
        log.error(`[Export] Auto-save failed for ${jobName}/${runId}: ${result.error}`);
      }
      return result;
    } catch (e) {
      log.error(`[Export] Auto-save unexpected error for ${jobName}/${runId}: ${e.message}`);
    }
  }
}

module.exports = ExportManager;
