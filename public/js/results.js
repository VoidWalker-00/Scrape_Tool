// results.js — Job detail Page 2: Results & Logs and History tabs.
//
// Classes:
//   ResultsPage — owns tab switching, log stream, results rendering, history table
//
// IMPORTANT: LogStream.connect() is called immediately in the constructor, before
// any await, to avoid missing early SSE events emitted by the backend via setImmediate.
//
// Dependencies: api.js, logs.js

import { getRun, listRuns, runJob, getRunsSummary } from './api.js';
import { LogStream } from './logs.js';
import { ExportTab } from './export.js';

class ResultsPage {
  constructor(name, runId) {
    this.name  = name;
    this.runId = runId;

    this._logBox      = document.getElementById('log-box');
    this._resultsArea = document.getElementById('results-area');
    this._historyBody = document.getElementById('history-body');
    this._historyLoaded = false;
    this._currentResult = null;
    this._exportTab     = null;

    // CRITICAL: connect before any await so no early log events are missed
    this._stream = new LogStream(this._logBox, (entry) => {
      if (entry.level === 'ERROR') {
        sessionStorage.setItem(`status:${this.name}`, 'error');
      }
    });
    this._logsPromise = runId ? this._stream.connect(runId) : null;

    this._initPage();
    this._initTabs();
    this._initLogToggle();
    this._init();
  }

  // ── Page setup ──────────────────────────────────────────────────────────────

  _initPage() {
    document.title = `${this.name} Results — Scrape Tool`;
    document.getElementById('job-heading').textContent = this.name;
    document.getElementById('back-link').href =
      `/job.html?name=${encodeURIComponent(this.name)}`;
  }

  // ── Tab switching ───────────────────────────────────────────────────────────

  _initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
        if (btn.dataset.tab === 'history') this._loadHistory();
        if (btn.dataset.tab === 'export')  this._initExportTab();
      });
    });
  }

  _initExportTab() {
    if (this._exportTab) return;
    this._exportTab = new ExportTab({
      name:   this.name,
      result: this._currentResult,
    });
    this._exportTab.init();
  }

  // ── Log toggle ──────────────────────────────────────────────────────────────

  _initLogToggle() {
    this._logsVisible = true;
    document.getElementById('log-toggle-btn').addEventListener('click', () => {
      this._logsVisible = !this._logsVisible;
      this._logBox.style.display = this._logsVisible ? '' : 'none';
      document.getElementById('log-toggle-btn').textContent =
        this._logsVisible ? 'Hide Logs' : 'Show Logs';
    });
  }

  _hideLogPanel() {
    this._logBox.style.display = 'none';
    document.getElementById('log-toggle-btn').style.display = 'none';
    this._logsVisible = false;
  }

  // ── Results rendering ───────────────────────────────────────────────────────

  _countItems(result) {
    if (result === null) return 0;
    const pages = Array.isArray(result) ? result : [result];
    let count = 0;
    for (const page of pages) {
      for (const val of Object.values(page)) {
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
          // Group — count by the longest sub-array
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

  // Classify a page's fields into scalars, plain arrays, and group objects.
  // A "group" is an object whose every value is an array (e.g. {Titles:[…], Prices:[…]}).
  _classifyFields(page) {
    const scalars = {};
    const arrays  = {};
    const groups  = {};
    for (const [key, val] of Object.entries(page)) {
      if (val === null || typeof val !== 'object') {
        scalars[key] = val;
      } else if (Array.isArray(val)) {
        arrays[key] = val;
      } else if (Object.keys(val).length > 0 &&
                 Object.values(val).every(v => Array.isArray(v))) {
        groups[key] = val;
      } else {
        scalars[key] = val; // nested objects that aren't groups — stringify fallback
      }
    }
    return { scalars, arrays, groups };
  }

  _renderGroupTable(groupName, fields) {
    const keys   = Object.keys(fields);
    const maxLen = Math.max(...keys.map(k => fields[k].length), 0);

    const section = document.createElement('div');
    section.className = 'result-group';

    const heading = document.createElement('h3');
    heading.className = 'result-group-name';
    heading.textContent = groupName;
    section.appendChild(heading);

    const wrap  = document.createElement('div');
    wrap.className = 'card results-table-wrap';
    const table = document.createElement('table');
    table.className = 'tw-table';

    const thead = document.createElement('thead');
    const hRow  = document.createElement('tr');
    // Row number column
    const thNum = document.createElement('th');
    thNum.textContent = '#';
    thNum.className = 'result-row-num';
    hRow.appendChild(thNum);
    keys.forEach(k => {
      const th = document.createElement('th');
      th.textContent = k;
      hRow.appendChild(th);
    });
    thead.appendChild(hRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let i = 0; i < maxLen; i++) {
      const tr = document.createElement('tr');
      const tdNum = document.createElement('td');
      tdNum.className = 'result-row-num text-faint';
      tdNum.textContent = i + 1;
      tr.appendChild(tdNum);
      keys.forEach(k => {
        const td  = document.createElement('td');
        const val = fields[k][i];
        if (typeof val === 'string' && val.startsWith('http')) {
          const a = document.createElement('a');
          a.href = val; a.textContent = val; a.target = '_blank';
          a.rel = 'noreferrer';
          td.appendChild(a);
        } else {
          td.textContent = val ?? '—';
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    section.appendChild(wrap);
    return section;
  }

  _renderPage(page) {
    const frag = document.createDocumentFragment();
    const { scalars, arrays, groups } = this._classifyFields(page);

    // Scalar + plain-array fields → compact key-value card
    const hasScalars = Object.keys(scalars).length > 0;
    const hasArrays  = Object.keys(arrays).length > 0;
    if (hasScalars || hasArrays) {
      const card = document.createElement('div');
      card.className = 'card result-fields';

      for (const [k, v] of Object.entries(scalars)) {
        const row = document.createElement('div');
        row.className = 'result-field-row';
        const key = document.createElement('span');
        key.className = 'result-field-key';
        key.textContent = k;
        const val = document.createElement('span');
        val.className = 'result-field-val';
        val.textContent = (v !== null && typeof v === 'object')
          ? JSON.stringify(v) : (v ?? '—');
        row.append(key, val);
        card.appendChild(row);
      }

      // Plain arrays as single-column tables inside the same card
      for (const [k, arr] of Object.entries(arrays)) {
        const label = document.createElement('div');
        label.className = 'result-field-key';
        label.style.marginTop = '0.75rem';
        label.textContent = k;
        card.appendChild(label);

        const wrap  = document.createElement('div');
        wrap.className = 'results-table-wrap';
        const table = document.createElement('table');
        table.className = 'tw-table';
        const tbody = document.createElement('tbody');
        arr.forEach((v, i) => {
          const tr = document.createElement('tr');
          const tdNum = document.createElement('td');
          tdNum.className = 'result-row-num text-faint';
          tdNum.textContent = i + 1;
          const td = document.createElement('td');
          td.textContent = v ?? '—';
          tr.append(tdNum, td);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        card.appendChild(wrap);
      }

      frag.appendChild(card);
    }

    // Group fields → each gets its own titled table
    for (const [groupName, fields] of Object.entries(groups)) {
      frag.appendChild(this._renderGroupTable(groupName, fields));
    }

    return frag;
  }

  _renderTable(result) {
    if (result === null) {
      const card = document.createElement('div');
      card.className = 'card';

      const msg = document.createElement('div');
      msg.className   = 'empty-state';
      msg.style.color = 'var(--orange)';
      msg.textContent = 'Scrape failed — captcha unresolved.';

      const retryBtn = document.createElement('button');
      retryBtn.className   = 'btn btn-primary btn-sm';
      retryBtn.textContent = 'Retry';
      retryBtn.style.marginTop = '1rem';
      retryBtn.addEventListener('click', () => this._retry());

      card.append(msg, retryBtn);
      this._resultsArea.innerHTML = '';
      this._resultsArea.appendChild(card);
      return;
    }

    const pages = Array.isArray(result) ? result : [result];
    this._resultsArea.innerHTML = '';

    pages.forEach((page, idx) => {
      if (pages.length > 1) {
        const h = document.createElement('h3');
        h.textContent = `Page ${idx + 1}`;
        h.style.marginTop = '1.5rem';
        h.style.marginBottom = '0.5rem';
        this._resultsArea.appendChild(h);
      }

      if (Object.keys(page).length === 0) {
        const e = document.createElement('div');
        e.className = 'empty-state';
        e.textContent = 'No data on this page.';
        this._resultsArea.appendChild(e);
        return;
      }

      this._resultsArea.appendChild(this._renderPage(page));
    });
  }

  // ── Retry ───────────────────────────────────────────────────────────────────

  async _retry() {
    this._resultsArea.innerHTML = '<div class="empty-state">Starting…</div>';
    try {
      const { runId } = await runJob(this.name);
      sessionStorage.setItem(`status:${this.name}`, 'running');
      window.location.href =
        `/results.html?name=${encodeURIComponent(this.name)}&runId=${encodeURIComponent(runId)}`;
    } catch {
      this._resultsArea.innerHTML =
        '<div class="card"><div class="empty-state" style="color:var(--orange)">Failed to start retry.</div></div>';
    }
  }

  // ── Run loading ─────────────────────────────────────────────────────────────

  async _loadRun(runId) {
    this._currentResult = null;
    this._resultsArea.innerHTML = '<div class="empty-state">Loading…</div>';
    try {
      const result = await getRun(this.name, runId);
      this._renderTable(result);
      this._currentResult = result;
      if (this._exportTab) this._exportTab.setResult(result);
      if (result === null) {
        sessionStorage.setItem(`status:${this.name}`, 'error');
      } else if (sessionStorage.getItem(`status:${this.name}`) !== 'error') {
        sessionStorage.setItem(`status:${this.name}`, 'stopped');
      }
    } catch {
      this._resultsArea.innerHTML =
        '<div class="card"><div class="empty-state" style="color:var(--orange)">Failed to load result.</div></div>';
    }
  }

  async _loadMostRecentRun() {
    try {
      const runs = await listRuns(this.name);
      if (runs.length === 0) {
        this._resultsArea.innerHTML =
          '<div class="empty-state">No runs yet. Go to Setup to run this job.</div>';
        this._hideLogPanel();
        return;
      }
      const sorted = runs.sort((a, b) => a.name.localeCompare(b.name));
      await this._loadRun(sorted[sorted.length - 1].name);
    } catch {
      this._resultsArea.innerHTML =
        '<div class="card"><div class="empty-state">Could not load runs.</div></div>';
    }
  }

  // ── History tab ─────────────────────────────────────────────────────────────

  async _loadHistory() {
    if (this._historyLoaded) return;
    this._historyLoaded = true;

    this._historyBody.innerHTML =
      '<tr><td colspan="4" class="empty-state">Loading…</td></tr>';

    try {
      const summary = await getRunsSummary(this.name);
      if (summary.length === 0) {
        this._historyBody.innerHTML =
          '<tr><td colspan="4" class="empty-state">No runs yet.</td></tr>';
        return;
      }
      const sorted = summary.sort((a, b) => b.runId.localeCompare(a.runId));
      this._historyBody.innerHTML = '';

      for (const { runId, items, status } of sorted) {
        const ts   = parseInt(runId.split('-').pop(), 10);
        const date = isNaN(ts) ? runId : new Date(ts).toLocaleString();

        const tr = document.createElement('tr');
        tr.className = 'history-row';

        const tdDate   = document.createElement('td'); tdDate.textContent = date;
        const tdItems  = document.createElement('td'); tdItems.textContent = items;
        const tdStatus = document.createElement('td');
        tdStatus.innerHTML = status === 'error'
          ? '<span class="badge badge-error">error</span>'
          : status === 'success'
            ? '<span class="badge badge-success">success</span>'
            : '<span class="badge badge-warn">unknown</span>';
        const tdId = document.createElement('td');
        tdId.className = 'text-mono text-faint'; tdId.textContent = runId;

        tr.append(tdDate, tdItems, tdStatus, tdId);
        this._historyBody.appendChild(tr);

        tr.addEventListener('click', () => {
          document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
          document.querySelector('[data-tab="results"]').classList.add('active');
          document.getElementById('tab-results').classList.add('active');

          const url = new URL(window.location.href);
          url.searchParams.set('runId', runId);
          window.history.pushState({}, '', url);

          this._hideLogPanel();
          this._loadRun(runId);
        });
      }
    } catch {
      this._historyBody.innerHTML =
        '<tr><td colspan="4" class="empty-state">Failed to load history.</td></tr>';
    }
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  _init() {
    if (this.runId) {
      if (this._logsPromise) {
        // Live run — wait for SSE DONE then load result
        this._logsPromise.then(() => {
          if (sessionStorage.getItem(`status:${this.name}`) !== 'error') {
            sessionStorage.setItem(`status:${this.name}`, 'stopped');
          }
          this._loadRun(this.runId);
        });
      } else {
        this._loadRun(this.runId);
        this._hideLogPanel();
      }
    } else {
      this._hideLogPanel();
      this._loadMostRecentRun();
    }
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const _params  = new URLSearchParams(window.location.search);
const _name    = _params.get('name');
const _runId   = _params.get('runId');

if (!_name) window.location.href = '/index.html';
else new ResultsPage(_name, _runId);
