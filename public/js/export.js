// export.js — Export tab UI for results.html
//
// Classes:
//   ExportTab — owns the Export tab: output settings, auto-save config,
//               field order, live preview, and manual export.
//
// Dependencies: api.js

import { getJob, listRuns, exportRun, saveExportConfig, checkPath, pickFolder } from './api.js';

const _EXT = { json: '.json', csv: '.csv', excel: '.xlsx' };

// Flattens result to { headers, rows } — mirrors ExportManager#flatten server-side.
function _flattenResult(result, fieldOrder = []) {
  if (!result) return { headers: [], rows: [] };
  const pages = Array.isArray(result) ? result : [result];
  const allRows = [];

  for (const page of pages) {
    const scalars = {}, arrays = {}, groups = {};
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
    const maxLen = Math.max(
      0,
      ...Object.values(arrays).map(a => a.length),
      ...Object.values(groups).flatMap(g => Object.values(g).map(a => a.length))
    );
    if (maxLen === 0) {
      allRows.push({ ...scalars });
    } else {
      for (let i = 0; i < maxLen; i++) {
        const row = { ...scalars };
        for (const [k, arr] of Object.entries(arrays)) row[k] = arr[i] ?? '';
        for (const [gn, fields] of Object.entries(groups)) {
          for (const [sk, arr] of Object.entries(fields)) row[`${gn}.${sk}`] = arr[i] ?? '';
        }
        allRows.push(row);
      }
    }
  }

  if (!allRows.length) return { headers: [], rows: [] };
  const allKeys = [...new Set(allRows.flatMap(r => Object.keys(r)))];
  const headers = [
    ...fieldOrder.filter(k => allKeys.includes(k)),
    ...allKeys.filter(k => !fieldOrder.includes(k)),
  ];
  return { headers, rows: allRows };
}

function _namingExample(baseName, naming, format, fieldValue) {
  const ext  = _EXT[format] || '.json';
  const sanitized = fieldValue ? _sanitizeValue(fieldValue) : '';
  const base = sanitized ? `${baseName || 'results'}_${sanitized}` : (baseName || 'results');
  const today = new Date().toISOString().slice(0, 10);
  if (naming === 'datetime') return `${base}_${today}T14-30${ext}`;
  if (naming === 'num')      return `${base}_001${ext}`;
  return `${base}_${today}_001${ext}`;
}

// Sanitize a field value for use in a filename: spaces → _, strip invalid chars.
function _sanitizeValue(val) {
  return String(val).trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '');
}

// Returns scalar field names from a result that are safe to use as part of a filename.
// Excludes arrays, objects, HTML content, URLs, and file paths.
function _eligibleBaseFields(result) {
  if (!result) return [];
  const page = Array.isArray(result) ? result[0] : result;
  if (!page) return [];
  return Object.entries(page)
    .filter(([, val]) => {
      if (val === null || typeof val === 'object') return false;
      const s = String(val);
      if (s.includes('<') || s.includes('>')) return false;        // HTML tags
      if (/^https?:\/\//i.test(s)) return false;                   // URLs
      if (/^\/|\\/.test(s)) return false;                          // file paths
      if (/\.(jpe?g|png|gif|webp|svg|ico|bmp)$/i.test(s)) return false; // image files
      return true;
    })
    .map(([key]) => key);
}

export class ExportTab {
  constructor({ name, result }) {
    this._name       = name;
    this._result     = result;
    this._fieldOrder = [];
  }

  init() {
    console.log('[ExportTab] init — job:', this._name, '| result loaded:', !!this._result);
    this._wireOutputSettings();
    this._wireAutoSave();
    this._wireManualExport();
    this._loadConfig();
  }

  setResult(result) {
    this._result = result;
    this._populateBaseNameField();
    this._updateBaseNameDisplay();
    this._rebuildFieldOrder();
    this._updatePreview();
    this._updateNamingExample();
    this._updateExportBtn();
  }

  _updateBaseNameDisplay() {
    const input = document.getElementById('export-basename');
    const field = document.getElementById('export-basename-field').value;

    if (!field) {
      // Switched back to Static — restore editable input
      if (this._staticBaseName !== undefined) {
        input.value = this._staticBaseName;
        this._staticBaseName = undefined;
      }
      input.readOnly = false;
      input.classList.remove('basename-dynamic');
      return;
    }

    // Save the current static value once when switching to dynamic
    if (this._staticBaseName === undefined) {
      this._staticBaseName = input.value;
    }

    const page     = this._result ? (Array.isArray(this._result) ? this._result[0] : this._result) : null;
    const raw      = page?.[field];
    const sanitized = (raw !== undefined && raw !== null && typeof raw !== 'object')
      ? String(raw).trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '')
      : '';

    const prefix = this._staticBaseName || '';
    input.value    = prefix && sanitized ? `${prefix}_${sanitized}`
                   : sanitized           ? sanitized
                   : prefix              ? prefix
                   : '';
    input.readOnly = true;
    input.classList.add('basename-dynamic');
  }

  _populateBaseNameField() {
    const sel     = document.getElementById('export-basename-field');
    const current = sel.value || sel.dataset.restore || '';
    sel.innerHTML = '<option value="">— Static —</option>';
    for (const key of _eligibleBaseFields(this._result)) {
      const opt = document.createElement('option');
      opt.value = key; opt.textContent = key;
      if (key === current) opt.selected = true;
      sel.appendChild(opt);
    }
    delete sel.dataset.restore;
  }

  // ── Output Settings ──────────────────────────────────────────────────────────

  _wireOutputSettings() {
    const folderEl  = document.getElementById('export-folder');
    const baseEl    = document.getElementById('export-basename');
    const extBadge  = document.getElementById('export-ext-badge');
    const saveBtn   = document.getElementById('export-save-settings-btn');
    const statusEl  = document.getElementById('export-settings-status');
    const pathStatus = document.getElementById('export-path-status');

    document.getElementById('export-folder-browse').addEventListener('click', async () => {
      console.log('[ExportTab] Browse button clicked');
      try {
        const res = await pickFolder();
        console.log('[ExportTab] pickFolder response:', JSON.stringify(res));
        if (res.ok && res.path) {
          folderEl.value = res.path;
          folderEl.dispatchEvent(new Event('blur'));
          this._updateExportBtn();
        }
      } catch (err) {
        console.error('[ExportTab] pickFolder threw:', err);
        pathStatus.textContent = '✗ Browse failed';
        pathStatus.className = 'export-path-status err';
      }
    });

    folderEl.addEventListener('blur', async () => {
      const val = folderEl.value.trim();
      if (!val) { pathStatus.textContent = ''; pathStatus.className = 'export-path-status'; return; }
      console.log('[ExportTab] checkPath:', val);
      pathStatus.textContent = '…';
      pathStatus.className = 'export-path-status';
      try {
        const res = await checkPath(val);
        console.log('[ExportTab] checkPath response:', JSON.stringify(res));
        if (res.writable) {
          pathStatus.textContent = '✓ Writable';
          pathStatus.className = 'export-path-status ok';
        } else {
          pathStatus.textContent = `✗ ${res.error || 'Not writable'}`;
          pathStatus.className = 'export-path-status err';
        }
      } catch (err) {
        console.error('[ExportTab] checkPath threw:', err);
        pathStatus.textContent = '✗ Check failed';
        pathStatus.className = 'export-path-status err';
      }
      this._updateExportBtn();
    });

    document.querySelectorAll('input[name="export-format"]').forEach(r => {
      r.addEventListener('change', () => {
        extBadge.textContent = _EXT[r.value] || '.json';
        this._updateNamingExample();
        this._updatePreview();
      });
    });

    baseEl.addEventListener('input', () => {
      this._updateNamingExample();
      this._updatePreview();
      this._updateExportBtn();
    });

    folderEl.addEventListener('input', () => {
      this._updateExportBtn();
    });

    document.getElementById('export-basename-field').addEventListener('change', () => {
      this._updateBaseNameDisplay();
      this._updateNamingExample();
    });

    saveBtn.addEventListener('click', async () => {
      const cfg = this._readConfig();
      console.log('[ExportTab] saveExportConfig:', JSON.stringify(cfg));
      try {
        await saveExportConfig(this._name, cfg);
        statusEl.textContent = 'Saved.';
        statusEl.className = 'export-status ok';
        setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'export-status'; }, 2000);
      } catch (err) {
        console.error('[ExportTab] saveExportConfig threw:', err);
        statusEl.textContent = 'Save failed.';
        statusEl.className = 'export-status err';
      }
    });
  }

  // ── Auto-Save ────────────────────────────────────────────────────────────────

  _wireAutoSave() {
    const toggle    = document.getElementById('export-autosave');
    const form      = document.getElementById('export-autosave-form');
    const splitOpts = document.getElementById('export-split-options');

    toggle.addEventListener('change', () => {
      form.hidden = !toggle.checked;
    });

    document.querySelectorAll('input[name="export-strategy"]').forEach(r => {
      r.addEventListener('change', () => {
        splitOpts.hidden = r.value !== 'split';
      });
    });

    document.querySelectorAll('input[name="export-naming"]').forEach(r => {
      r.addEventListener('change', () => this._updateNamingExample());
    });

    document.querySelectorAll('.num-input-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        const delta = parseInt(btn.dataset.delta, 10);
        const min   = parseInt(input.min, 10) || 1;
        const val   = parseInt(input.value, 10) || 0;
        input.value = Math.max(min, val + delta);
      });
    });
  }

  _updateNamingExample() {
    const el       = document.getElementById('export-naming-example');
    const baseName = document.getElementById('export-basename').value.trim() || 'results';
    const format   = document.querySelector('input[name="export-format"]:checked')?.value || 'json';
    const naming   = document.querySelector('input[name="export-naming"]:checked')?.value || 'date_num';
    const field    = document.getElementById('export-basename-field').value;
    let fieldValue = '';
    if (field && this._result) {
      const page = Array.isArray(this._result) ? this._result[0] : this._result;
      fieldValue = page?.[field] ?? '';
    }
    el.textContent = `→ ${_namingExample(baseName, naming, format, fieldValue)}`;
  }

  // ── Field Order ──────────────────────────────────────────────────────────────

  _rebuildFieldOrder() {
    const container = document.getElementById('export-field-order');
    if (!this._result) {
      container.innerHTML = '<p class="text-faint" style="font-size:0.875rem;">Load a result to edit field order.</p>';
      return;
    }

    const { headers } = _flattenResult(this._result, []);
    // Merge: saved order first, then any new fields not yet in the list
    const merged = [
      ...this._fieldOrder.filter(k => headers.includes(k)),
      ...headers.filter(k => !this._fieldOrder.includes(k)),
    ];
    this._fieldOrder = merged;

    container.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'export-field-list';

    merged.forEach((field, idx) => {
      const row = document.createElement('div');
      row.className = 'export-field-row';
      row.dataset.field = field;

      const handle = document.createElement('span');
      handle.className = 'export-field-handle';
      handle.textContent = '⠿';

      const label = document.createElement('span');
      label.className = 'export-field-label';
      label.textContent = field;

      const up = document.createElement('button');
      up.type = 'button'; up.className = 'btn-icon'; up.textContent = '↑';
      up.disabled = idx === 0;
      up.addEventListener('click', () => {
        [this._fieldOrder[idx - 1], this._fieldOrder[idx]] =
          [this._fieldOrder[idx], this._fieldOrder[idx - 1]];
        this._rebuildFieldOrder();
        this._updatePreview();
      });

      const down = document.createElement('button');
      down.type = 'button'; down.className = 'btn-icon'; down.textContent = '↓';
      down.disabled = idx === merged.length - 1;
      down.addEventListener('click', () => {
        [this._fieldOrder[idx], this._fieldOrder[idx + 1]] =
          [this._fieldOrder[idx + 1], this._fieldOrder[idx]];
        this._rebuildFieldOrder();
        this._updatePreview();
      });

      row.append(handle, label, up, down);
      list.appendChild(row);
    });

    container.appendChild(list);
  }

  // ── Preview ──────────────────────────────────────────────────────────────────

  _updatePreview() {
    const container = document.getElementById('export-preview');
    if (!this._result) {
      container.innerHTML = '<p class="text-faint" style="font-size:0.875rem;">No result loaded.</p>';
      return;
    }

    const format = document.querySelector('input[name="export-format"]:checked')?.value || 'json';
    const { headers, rows } = _flattenResult(this._result, this._fieldOrder);

    if (format === 'json') {
      // Rebuild rows as new objects keyed in headers order so JSON.stringify
      // reflects the user's field order (plain object keys follow insertion order).
      const ordered = rows.slice(0, 2).map(row =>
        Object.fromEntries(headers.map(h => [h, row[h]]))
      );
      const pre = document.createElement('pre');
      pre.className = 'export-preview-code';
      pre.textContent = JSON.stringify(ordered, null, 2);
      container.innerHTML = '';
      container.appendChild(pre);

    } else if (format === 'csv') {
      const escape = v => {
        const s = v == null ? '' : String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [headers.map(escape).join(',')];
      rows.slice(0, 3).forEach(row => lines.push(headers.map(h => escape(row[h])).join(',')));
      const pre = document.createElement('pre');
      pre.className = 'export-preview-code';
      pre.textContent = lines.join('\n');
      container.innerHTML = '';
      container.appendChild(pre);

    } else if (format === 'excel') {
      const table = document.createElement('table');
      table.className = 'tw-table export-preview-table';

      const thead = document.createElement('thead');
      const hRow  = document.createElement('tr');
      headers.forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        hRow.appendChild(th);
      });
      thead.appendChild(hRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      rows.slice(0, 5).forEach(row => {
        const tr = document.createElement('tr');
        headers.forEach(h => {
          const td = document.createElement('td');
          td.textContent = row[h] ?? '';
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);

      const wrap = document.createElement('div');
      wrap.className = 'results-table-wrap';
      wrap.appendChild(table);
      container.innerHTML = '';
      container.appendChild(wrap);
    }
  }

  // ── Manual Export ────────────────────────────────────────────────────────────

  _wireManualExport() {
    document.getElementById('export-run-select').addEventListener('change', () => this._updateExportBtn());

    document.getElementById('export-run-btn').addEventListener('click', async () => {
      const runId    = document.getElementById('export-run-select').value;
      const statusEl = document.getElementById('export-run-status');
      console.log('[ExportTab] Export clicked — runId:', runId || '(empty)');

      if (!runId) {
        statusEl.textContent = '✗ No run selected';
        statusEl.style.color = 'var(--danger)';
        return;
      }

      statusEl.textContent = 'Exporting…';
      statusEl.className = 'export-status pending';

      const opts = this._readConfig();
      console.log('[ExportTab] exportRun opts:', JSON.stringify(opts));

      try {
        const res = await exportRun(this._name, runId, opts);
        console.log('[ExportTab] exportRun response:', JSON.stringify(res));
        if (res.ok) {
          statusEl.textContent = `✓ Saved to ${res.path}`;
          statusEl.className = 'export-status ok';
        } else {
          statusEl.textContent = `✗ ${res.error}`;
          statusEl.className = 'export-status err';
        }
      } catch (err) {
        console.error('[ExportTab] exportRun threw:', err);
        statusEl.textContent = `✗ Export failed: ${err.message}`;
        statusEl.className = 'export-status err';
      }
    });
  }

  _updateExportBtn() {
    const btn    = document.getElementById('export-run-btn');
    const folder = document.getElementById('export-folder').value.trim();
    const runId  = document.getElementById('export-run-select').value;
    btn.disabled = !folder || !runId;
  }

  // ── Config read / load ───────────────────────────────────────────────────────

  _readConfig() {
    const folder        = document.getElementById('export-folder').value.trim();
    // When dynamic, use the stored static prefix — not the computed display value
    const baseName      = (this._staticBaseName !== undefined
      ? this._staticBaseName
      : document.getElementById('export-basename').value
    ).trim();
    const baseNameField = document.getElementById('export-basename-field').value || undefined;
    const format        = document.querySelector('input[name="export-format"]:checked')?.value || 'json';
    const autoSave      = document.getElementById('export-autosave').checked;
    const strategy      = document.querySelector('input[name="export-strategy"]:checked')?.value || 'split';
    const splitBy       = document.querySelector('input[name="export-splitby"]:checked')?.value  || 'result';
    const naming        = document.querySelector('input[name="export-naming"]:checked')?.value   || 'date_num';
    const splitSize     = parseInt(document.getElementById('export-splitsize').value, 10) || undefined;

    return {
      folder, baseName, format, fieldOrder: [...this._fieldOrder],
      autoSave, strategy, splitBy, naming,
      ...(baseNameField ? { baseNameField } : {}),
      ...(splitSize     ? { splitSize }     : {}),
    };
  }

  async _loadConfig() {
    // Populate run selector
    try {
      const runs = await listRuns(this._name);
      const sel  = document.getElementById('export-run-select');
      sel.innerHTML = '';
      const sorted = runs.sort((a, b) => b.name.localeCompare(a.name));
      sorted.forEach(({ name: runId }, i) => {
        const ts   = parseInt(runId.split('-').pop(), 10);
        const date = isNaN(ts) ? runId : new Date(ts).toLocaleString();
        const opt  = document.createElement('option');
        opt.value = runId; opt.textContent = date;
        if (i === 0) opt.selected = true;
        sel.appendChild(opt);
      });
      if (sorted.length === 0) {
        sel.innerHTML = '<option value="">No runs found</option>';
      }
    } catch {
      document.getElementById('export-run-select').innerHTML = '<option value="">No runs found</option>';
    }

    // Load saved _export config and pre-populate form
    try {
      const job = await getJob(this._name);
      const cfg = job._export;
      if (!cfg) {
        document.getElementById('export-basename').value = this._name;
        this._updateNamingExample();
        this._updateExportBtn();
        if (this._result) { this._populateBaseNameField(); this._rebuildFieldOrder(); this._updatePreview(); }
        return;
      }

      if (cfg.folder)   document.getElementById('export-folder').value   = cfg.folder;
      document.getElementById('export-basename').value = cfg.baseName || this._name;
      if (cfg.format) {
        const r = document.querySelector(`input[name="export-format"][value="${cfg.format}"]`);
        if (r) { r.checked = true; document.getElementById('export-ext-badge').textContent = _EXT[cfg.format] || '.json'; }
      }
      if (cfg.autoSave) {
        document.getElementById('export-autosave').checked = true;
        document.getElementById('export-autosave-form').hidden = false;
      }
      if (cfg.strategy) {
        const r = document.querySelector(`input[name="export-strategy"][value="${cfg.strategy}"]`);
        if (r) { r.checked = true; document.getElementById('export-split-options').hidden = cfg.strategy !== 'split'; }
      }
      if (cfg.splitBy) {
        const r = document.querySelector(`input[name="export-splitby"][value="${cfg.splitBy}"]`);
        if (r) r.checked = true;
      }
      if (cfg.splitSize) document.getElementById('export-splitsize').value = cfg.splitSize;
      if (cfg.naming) {
        const r = document.querySelector(`input[name="export-naming"][value="${cfg.naming}"]`);
        if (r) r.checked = true;
      }
      if (cfg.fieldOrder?.length)  this._fieldOrder = cfg.fieldOrder;
      if (cfg.baseNameField) {
        const r = document.getElementById('export-basename-field');
        // Option may not exist yet if result isn't loaded; store and restore after populate
        r.dataset.restore = cfg.baseNameField;
      }
    } catch (err) {
      console.warn('[ExportTab] Could not load export config:', err);
    }

    this._updateNamingExample();
    this._updateExportBtn();
    if (this._result) { this._populateBaseNameField(); this._rebuildFieldOrder(); this._updatePreview(); }
  }
}
