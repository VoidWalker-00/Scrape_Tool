// dashboard.js — job card grid, polling, and new job flow.
//
// Classes:
//   JobCard    — owns one job card element, handles stats + accent border
//   NewJobCard — owns the + card and inline creation prompt
//   Dashboard  — owns the grid, manages JobCard instances, drives polling
//
// Dependencies: api.js

import { listJobs, listRuns, getRun, saveJob, runJob, deleteJob } from './api.js';

const POLL_MS = 5000;

// ── JobCard ───────────────────────────────────────────────────────────────────

class JobCard {
  constructor(name) {
    this.name = name;
    this.el = this._build();
    requestAnimationFrame(() => this._refresh());
  }

  _getStatus() {
    return sessionStorage.getItem(`status:${this.name}`) || 'stopped';
  }

  _badgeClass(status) {
    return { running: 'badge-success', error: 'badge-error', stopped: 'badge-muted' }[status]
      ?? 'badge-muted';
  }

  _build() {
    const status = this._getStatus();

    const card = document.createElement('a');
    card.className      = 'card job-card';
    card.href           = `/job.html?name=${encodeURIComponent(this.name)}`;
    card.dataset.name   = this.name;
    card.dataset.health = 'none';

    const delBtn = document.createElement('button');
    delBtn.className = 'card-del-btn';
    delBtn.title     = 'Delete job';
    delBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
      <path d="M1 3h11M4.5 3V2a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1M2.5 3l.75 8h7.5l.75-8"/>
      <line x1="5" y1="6" x2="5" y2="9.5"/>
      <line x1="8" y1="6" x2="8" y2="9.5"/>
    </svg>`;
    delBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      this._delete();
    });
    card.appendChild(delBtn);

    const content = document.createElement('div');
    content.className = 'card-content';

    const titleRow = document.createElement('div');
    titleRow.className = 'card-title-row';

    const nameEl = document.createElement('span');
    nameEl.className   = 'card-name';
    nameEl.textContent = this.name;

    this._badge = document.createElement('span');
    this._badge.className   = `badge ${this._badgeClass(status)}`;
    this._badge.textContent = status;

    this._meta = document.createElement('div');
    this._meta.className   = 'card-meta';
    this._meta.textContent = '…';

    const btnRow = document.createElement('div');
    btnRow.className = 'card-btn-row';

    const runBtn = document.createElement('button');
    runBtn.className = 'btn btn-sm card-run-btn';
    runBtn.title     = 'Run job';
    runBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor"><path d="M2 1.5l8 4-8 4V1.5z"/></svg>`;
    runBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      this._run(runBtn);
    });

    const logsBtn = document.createElement('a');
    logsBtn.className   = 'btn btn-sm';
    logsBtn.textContent = 'Results / Logs';
    logsBtn.href        = `/results.html?name=${encodeURIComponent(this.name)}`;
    logsBtn.addEventListener('click', e => e.stopPropagation());

    btnRow.append(runBtn, logsBtn);
    titleRow.append(nameEl, this._badge);
    content.append(titleRow, this._meta);
    card.append(content, btnRow);

    return card;
  }

  async _delete() {
    try {
      await deleteJob(this.name);
      this.el.remove();
    } catch {
      // silently ignore — card stays if delete fails
    }
  }

  async _run(btn) {
    btn.disabled   = true;
    btn.innerHTML  = '…';
    try {
      const { runId } = await runJob(this.name);
      sessionStorage.setItem(`status:${this.name}`, 'running');
      window.location.href =
        `/results.html?name=${encodeURIComponent(this.name)}&runId=${encodeURIComponent(runId)}`;
    } catch {
      btn.disabled  = false;
      btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor"><path d="M2 1.5l8 4-8 4V1.5z"/></svg>`;
    }
  }

  // Loads run history and computes stats + health in one pass.
  // Fetches only the last 10 results to keep it fast.
  async _loadStats() {
    const runs = await listRuns(this.name);
    if (runs.length === 0) return null;

    const sorted = runs.sort((a, b) => a.name.localeCompare(b.name));
    const latest = sorted[sorted.length - 1];
    const sample = sorted.slice(-10);

    const ts  = parseInt(latest.name.split('-').pop(), 10);
    const ms  = Date.now() - ts;
    const ago = ms < 60000    ? 'just now'
              : ms < 3600000  ? `${Math.floor(ms / 60000)}m ago`
              : ms < 86400000 ? `${Math.floor(ms / 3600000)}h ago`
              :                 `${Math.floor(ms / 86400000)}d ago`;

    const results = await Promise.all(
      sample.map(({ name: id }) => getRun(this.name, id).catch(() => null))
    );

    const ok     = results.filter(r => r !== null).length;
    const health = ok === results.length ? 'ok'
                 : ok === 0             ? 'error'
                 :                        'warn';

    return { total: runs.length, ok, of: results.length, ago, health };
  }

  async _refresh() {
    try {
      const stats = await this._loadStats();
      if (!stats) {
        this._meta.textContent  = 'Never run';
        this.el.dataset.health  = 'none';
        return;
      }
      const pct = stats.of > 0 ? Math.round((stats.ok / stats.of) * 100) : 0;
      this._meta.textContent = `${stats.total} runs · ${pct}% ok · ${stats.ago}`;
      this.el.dataset.health = stats.health;
    } catch {
      this._meta.textContent = 'Never run';
    }
  }
}

// ── NewJobCard ────────────────────────────────────────────────────────────────

class NewJobCard {
  constructor(onCreated) {
    this._onCreated = onCreated;
    this.el = this._buildPlusCard();
  }

  _buildPlusCard() {
    const card = document.createElement('div');
    card.className   = 'card job-card-new';
    card.textContent = '+';
    card.addEventListener('click', () => this._showPrompt());
    return card;
  }

  _showPrompt() {
    const card = this.el;
    card.textContent = '';
    card.className   = 'card new-job-prompt';

    const input = document.createElement('input');
    input.type        = 'text';
    input.placeholder = 'Job name';

    const errEl = document.createElement('div');
    errEl.className = 'new-job-error';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:0.5rem';

    const ok = document.createElement('button');
    ok.className   = 'btn btn-primary btn-sm';
    ok.textContent = 'Create';

    const cancel = document.createElement('button');
    cancel.className   = 'btn btn-ghost btn-sm';
    cancel.textContent = 'Cancel';

    btnRow.append(ok, cancel);
    card.append(input, errEl, btnRow);
    input.focus();

    cancel.addEventListener('click', () => {
      card.textContent = '+';
      card.className   = 'card job-card-new';
      card.addEventListener('click', () => this._showPrompt(), { once: true });
    });

    const submit = async () => {
      const name = input.value.trim();
      if (!name) { errEl.textContent = 'Name required.'; return; }
      try {
        await saveJob(name, { URL: '' });
        window.location.href = `/job.html?name=${encodeURIComponent(name)}`;
      } catch {
        errEl.textContent = 'Failed to create job.';
      }
    };

    ok.addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

class Dashboard {
  constructor(gridEl) {
    this._grid    = gridEl;
    this._cards   = new Map();
    this._newCard = new NewJobCard();
    this._grid.appendChild(this._newCard.el);
  }

  async refresh() {
    if (this._grid.querySelector('.new-job-prompt')) return;

    let jobs;
    try {
      jobs = await listJobs();
    } catch {
      if (this._cards.size === 0 && !this._grid.querySelector('.empty-state')) {
        const err = document.createElement('div');
        err.className   = 'empty-state';
        err.textContent = 'Could not load jobs. Is the server running?';
        this._grid.insertBefore(err, this._newCard.el);
      }
      return;
    }

    for (const [name, card] of this._cards) {
      if (!jobs.find(j => j.name === name)) {
        card.el.remove();
        this._cards.delete(name);
      }
    }

    if (jobs.length > 0) this._grid.querySelector('.empty-state')?.remove();

    for (const { name } of jobs) {
      if (!this._cards.has(name)) {
        const card = new JobCard(name);
        this._cards.set(name, card);
        this._grid.insertBefore(card.el, this._newCard.el);
      }
    }

    if (jobs.length === 0 && !this._grid.querySelector('.empty-state')) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = 'No jobs yet. Click <strong>+</strong> to create one.';
      this._grid.insertBefore(empty, this._newCard.el);
    }
  }

  start() {
    this.refresh();
    setInterval(() => this.refresh(), POLL_MS);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

new Dashboard(document.getElementById('job-grid')).start();
