// job.js — Job detail Page 1: Config & Setup tabs.
//
// Classes:
//   JobPage — owns tab switching, config form, settings, and run-now flow
//
// Dependencies: api.js, form.js

import { getJob, saveJob, deleteJob, runJob } from './api.js';
import { ConfigForm } from './form.js';

class JobPage {
  constructor(name) {
    this.name  = name;
    this._form = new ConfigForm(this.name);

    this._initPage();
    this._initTabs();
    this._initConfigForm();
    this._initSchedule();
    this._initSettings();
    this._initRunNow();
    this._initRename();
    this._load();
  }

  // ── Page setup ──────────────────────────────────────────────────────────────

  _initPage() {
    document.title = `${this.name} — Scrape Tool`;
    document.getElementById('job-heading').textContent = this.name;
    document.getElementById('view-results-link').href =
      `/results.html?name=${encodeURIComponent(this.name)}`;

    // Mount the ConfigForm DOM into its placeholder
    document.getElementById('config-form-mount').appendChild(this._form.el);
  }

  // ── Tab switching ───────────────────────────────────────────────────────────

  _initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      });
    });
  }

  // ── Rename ──────────────────────────────────────────────────────────────────

  _initRename() {
    document.getElementById('rename-btn').addEventListener('click', () => this._startRename());
  }

  _startRename() {
    const headingEl  = document.getElementById('job-heading');
    const renameBtn  = document.getElementById('rename-btn');
    const container  = headingEl.parentElement;

    renameBtn.style.display = 'none';

    const input = document.createElement('input');
    input.className = 'rename-input';
    input.value     = this.name;
    input.select();

    headingEl.replaceWith(input);
    input.focus();

    const cancel = () => {
      input.replaceWith(headingEl);
      renameBtn.style.display = '';
    };

    const confirm = async () => {
      const newName = input.value.trim();
      if (!newName || newName === this.name) { cancel(); return; }

      input.disabled = true;
      try {
        const config = await getJob(this.name);
        await saveJob(newName, config);
        await deleteJob(this.name);
        window.location.href = `/job.html?name=${encodeURIComponent(newName)}`;
      } catch {
        input.disabled = false;
        input.classList.add('rename-error');
        setTimeout(() => input.classList.remove('rename-error'), 800);
      }
    };

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  confirm();
      if (e.key === 'Escape') cancel();
    });
    input.addEventListener('blur', cancel);
  }

  // ── Config form ─────────────────────────────────────────────────────────────

  _initConfigForm() {
    document.getElementById('save-btn').addEventListener('click', () => this._saveConfig());
    document.getElementById('config-run-btn').addEventListener('click', () => this._runNow());
  }

  async _saveConfig() {
    const statusEl = document.getElementById('save-status');
    const config   = this._form.read();
    if (!config) {
      statusEl.textContent  = 'Target URL is required.';
      statusEl.style.color  = 'var(--danger)';
      return;
    }
    try {
      // Preserve _settings/_chain/_schedule — these live in Setup, not the form
      const existing = await getJob(this.name).catch(() => ({}));
      for (const key of Object.keys(existing)) {
        if (key.startsWith('_')) config[key] = existing[key];
      }
      await saveJob(this.name, config);
      statusEl.textContent = 'Saved.';
      statusEl.style.color = 'var(--accent)';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    } catch {
      statusEl.textContent = 'Save failed.';
      statusEl.style.color = 'var(--danger)';
    }
  }

  // ── Schedule ─────────────────────────────────────────────────────────────────

  _initSchedule() {
    const toggle    = document.getElementById('schedule-enabled');
    const form      = document.getElementById('schedule-form');
    const typeRadios = document.querySelectorAll('input[name="schedule-type"]');
    const freqSel   = document.getElementById('schedule-frequency');
    const dayRow    = document.getElementById('schedule-day-row');

    toggle.addEventListener('change', () => {
      form.hidden = !toggle.checked;
    });

    typeRadios.forEach(r => r.addEventListener('change', () => {
      document.getElementById('schedule-once').hidden      = r.value !== 'once';
      document.getElementById('schedule-recurring').hidden = r.value !== 'recurring';
    }));

    freqSel.addEventListener('change', () => {
      dayRow.hidden = freqSel.value !== 'weekly';
    });
  }

  // ── Request settings ────────────────────────────────────────────────────────

  _initSettings() {
    document.getElementById('save-settings-btn')
      .addEventListener('click', () => this._saveSettings());
  }

  async _loadSettings() {
    try {
      const config = await getJob(this.name);

      // Request settings
      const settings = config._settings || {};
      if (settings.delay)    document.getElementById('setting-delay').value     = settings.delay;
      if (settings.maxPages) document.getElementById('setting-max-pages').value = settings.maxPages;

      // Schedule
      const schedule = config._schedule || {};
      if (schedule.enabled) {
        document.getElementById('schedule-enabled').checked = true;
        document.getElementById('schedule-form').hidden = false;
      }
      if (schedule.type) {
        const radio = document.querySelector(`input[name="schedule-type"][value="${schedule.type}"]`);
        if (radio) {
          radio.checked = true;
          document.getElementById('schedule-once').hidden      = schedule.type !== 'once';
          document.getElementById('schedule-recurring').hidden = schedule.type !== 'recurring';
        }
      }
      if (schedule.datetime) document.getElementById('schedule-datetime').value  = schedule.datetime;
      if (schedule.frequency) {
        document.getElementById('schedule-frequency').value = schedule.frequency;
        document.getElementById('schedule-day-row').hidden  = schedule.frequency !== 'weekly';
      }
      if (schedule.time) document.getElementById('schedule-time').value = schedule.time;
      if (schedule.day !== undefined) document.getElementById('schedule-day').value = schedule.day;
    } catch {}
  }

  async _saveSettings() {
    const statusEl = document.getElementById('settings-status');
    try {
      const config = await getJob(this.name);

      // Request settings
      const delay    = document.getElementById('setting-delay').value;
      const maxPages = document.getElementById('setting-max-pages').value;
      config._settings = {};
      if (delay)    config._settings.delay    = parseInt(delay,    10);
      if (maxPages) config._settings.maxPages = parseInt(maxPages, 10);

      // Schedule
      const schedEnabled = document.getElementById('schedule-enabled').checked;
      config._schedule = { enabled: schedEnabled };
      if (schedEnabled) {
        const schedType = document.querySelector('input[name="schedule-type"]:checked')?.value || 'once';
        config._schedule.type = schedType;
        if (schedType === 'once') {
          config._schedule.datetime = document.getElementById('schedule-datetime').value;
        } else {
          config._schedule.frequency = document.getElementById('schedule-frequency').value;
          config._schedule.time      = document.getElementById('schedule-time').value;
          if (config._schedule.frequency === 'weekly') {
            config._schedule.day = parseInt(document.getElementById('schedule-day').value, 10);
          }
        }
      }

      await saveJob(this.name, config);
      statusEl.textContent = 'Saved.';
      statusEl.style.color = 'var(--accent)';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    } catch {
      statusEl.textContent = 'Save failed.';
      statusEl.style.color = 'var(--danger)';
    }
  }

  // ── Run Now ─────────────────────────────────────────────────────────────────

  _initRunNow() {
    document.getElementById('run-now-btn')
      .addEventListener('click', () => this._runNow());
  }

  async _runNow() {
    const statusEl = document.getElementById('run-status');
    statusEl.textContent = 'Starting…';
    statusEl.style.color = 'var(--text-muted)';
    try {
      const { runId } = await runJob(this.name);
      sessionStorage.setItem(`status:${this.name}`, 'running');
      window.location.href =
        `/results.html?name=${encodeURIComponent(this.name)}&runId=${encodeURIComponent(runId)}`;
    } catch {
      statusEl.textContent = 'Failed to start.';
      statusEl.style.color = 'var(--danger)';
    }
  }

  // ── Init load ───────────────────────────────────────────────────────────────

  async _load() {
    try {
      const config = await getJob(this.name);
      this._form.build(config);
    } catch (err) {
      if (err.status !== 404) console.error('Failed to load config:', err);
    }
    this._loadSettings();
  }
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────

const _name = new URLSearchParams(window.location.search).get('name');
if (!_name) window.location.href = '/index.html';
else new JobPage(_name);
