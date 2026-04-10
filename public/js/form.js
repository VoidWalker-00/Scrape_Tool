// form.js — config form builder for the Job Config tab.
//
// Usage:
//   const form = new ConfigForm();
//   container.appendChild(form.el);
//   form.build(config);         // populate from existing config object
//   const config = form.read(); // returns config object, or null if URL is empty
//
// Config schema (mirrors scraper.js):
//   { URL, FieldName: [sel, mode, type], GroupName: [{sub: [sel,mode,type]}, mode, 'Group'],
//     PagKey: [sel, pagMode, 'Pagination'] }
//
// Note: read() skips keys beginning with '_' (_settings, _chain, _schedule).
// The caller (job.js) is responsible for merging those back before saving.

import { listJobs, getJob, saveJob } from './api.js';

const _FIELD_TYPES  = ['Text', 'URL', 'DateTime', 'Title'];
const _MODES        = ['Single', 'All'];
const _PAGING_MODES = ['Click', 'Scroll', 'URL'];

// ── DOM helpers ───────────────────────────────────────────────────────────────

function _select(options, selected) {
  const s = document.createElement('select');
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt; o.textContent = opt;
    if (opt === selected) o.selected = true;
    s.appendChild(o);
  }
  return s;
}

function _input(placeholder, value = '') {
  const i = document.createElement('input');
  i.type = 'text'; i.placeholder = placeholder; i.value = value;
  return i;
}

function _btn(text, cls) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = text; b.className = cls;
  return b;
}

// ── Row builders ──────────────────────────────────────────────────────────────

function _makeFieldRow(name = '', selector = '', mode = 'Single', type = 'Text') {
  const row = document.createElement('div');
  row.className = 'field-row field-row-6';
  row.dataset.rowType = 'field';

  const nameIn = _input('Field name', name);       nameIn.dataset.role = 'name';
  const selIn  = _input('CSS selector', selector); selIn.dataset.role  = 'selector';
  const modeS  = _select(_MODES, mode);            modeS.dataset.role  = 'mode';
  const typeS  = _select(_FIELD_TYPES, type);      typeS.dataset.role  = 'type';

  const groupBtn  = _btn('Group', 'btn btn-sm btn-ghost');
  const removeBtn = _btn('✕',    'btn btn-sm btn-danger');

  groupBtn.addEventListener('click',  () => _convertToGroup(row));
  removeBtn.addEventListener('click', () => row.remove());

  row.append(nameIn, selIn, modeS, typeS, groupBtn, removeBtn);
  return row;
}

function _makePaginationRow(name = 'Pagination', selector = '', mode = 'Click') {
  const row = document.createElement('div');
  row.className = 'field-row field-row-6';
  row.dataset.rowType = 'pagination';

  const nameIn = _input('Field name', name);       nameIn.dataset.role = 'name';
  const selIn  = _input('CSS selector', selector); selIn.dataset.role  = 'selector';
  const modeS  = _select(_PAGING_MODES, mode);     modeS.dataset.role  = 'mode';

  const label  = document.createElement('span');
  label.className = 'text-faint text-mono'; label.textContent = 'Pagination';
  const spacer    = document.createElement('span');
  const removeBtn = _btn('✕', 'btn btn-sm btn-danger');

  removeBtn.addEventListener('click', () => row.remove());
  row.append(nameIn, selIn, modeS, label, spacer, removeBtn);
  return row;
}

function _makeSubFieldRow(name = '', selector = '', mode = 'Single', type = 'Text') {
  const row = document.createElement('div');
  row.className = 'field-row field-row-6';
  row.dataset.rowType = 'subfield';

  const nameIn = _input('Field name', name);       nameIn.dataset.role = 'name';
  const selIn  = _input('CSS selector', selector); selIn.dataset.role  = 'selector';
  const modeS  = _select(_MODES, mode);            modeS.dataset.role  = 'mode';
  const typeS  = _select(_FIELD_TYPES, type);      typeS.dataset.role  = 'type';
  const spacer    = document.createElement('span');
  const removeBtn = _btn('✕', 'btn btn-sm btn-danger');

  removeBtn.addEventListener('click', () => row.remove());
  row.append(nameIn, selIn, modeS, typeS, spacer, removeBtn);
  return row;
}

function _makeGroupRow(name = '', mode = 'All', subFields = []) {
  const wrapper = document.createElement('div');
  wrapper.className = 'group-row';
  wrapper.dataset.rowType = 'group';

  const header = document.createElement('div');
  header.className = 'group-header field-row field-row-6';

  const nameIn = _input('Group name', name); nameIn.dataset.role = 'name';
  const modeS  = _select(_MODES, mode);      modeS.dataset.role  = 'mode';
  const label  = document.createElement('span');
  label.className = 'text-faint text-mono'; label.textContent = 'Group';
  const s1 = document.createElement('span');
  const s2 = document.createElement('span');
  const removeBtn = _btn('✕', 'btn btn-sm btn-danger');

  const subList = document.createElement('div');
  subList.className = 'group-subfields';

  removeBtn.addEventListener('click', () => {
    const hasKids = subList.querySelectorAll('[data-row-type]').length > 0;
    if (hasKids && !confirm('Remove group and all its sub-fields?')) return;
    wrapper.remove();
  });

  header.append(nameIn, modeS, label, s1, s2, removeBtn);

  for (const sf of subFields) {
    subList.appendChild(_makeSubFieldRow(sf.name, sf.selector, sf.mode, sf.type));
  }

  const addSubBtn = _btn('+ Add sub-field', 'btn btn-sm btn-ghost');
  addSubBtn.style.marginTop = '0.4rem';
  addSubBtn.addEventListener('click', () => subList.appendChild(_makeSubFieldRow()));

  wrapper.append(header, subList, addSubBtn);
  return wrapper;
}

function _convertToGroup(row) {
  const name = row.querySelector('[data-role="name"]').value;
  row.replaceWith(_makeGroupRow(name));
}

// ── URL preview helper ────────────────────────────────────────────────────────

function _urlPreview(url) {
  if (Array.isArray(url)) return `${url.length} URL${url.length !== 1 ? 's' : ''}`;
  if (url) return '1 URL';
  return 'empty';
}

// ── URL list helpers ──────────────────────────────────────────────────────────

function _makeUrlRow(value = '') {
  const row = document.createElement('div');
  row.className = 'url-row';

  const input = document.createElement('input');
  input.type        = 'url';
  input.placeholder = 'https://example.com';
  input.value       = value;
  input.dataset.role = 'url';

  const removeBtn = _btn('✕', 'btn btn-sm btn-danger');
  removeBtn.addEventListener('click', () => {
    // Keep at least one row
    const list = row.parentElement;
    if (list && list.children.length > 1) row.remove();
    else input.value = '';
  });

  row.append(input, removeBtn);
  return row;
}

const _PAGE_SIZE = 5;

// ── ConfigForm class ──────────────────────────────────────────────────────────

export class ConfigForm {
  constructor(jobName = '') {
    this._jobName      = jobName;
    this._visibleCount = _PAGE_SIZE;
    this._collapsed    = false;
    this._chainSource  = null;   // { chainJob, chainField } or null
    this.el = this._buildDOM();
    this._fieldList    = this.el.querySelector('[data-fields]');
    this._urlList      = this.el.querySelector('[data-url-list]');
    this._urlSection   = this.el.querySelector('[data-url-section]');
    this._urlFooter    = this.el.querySelector('[data-url-footer]');
    this._urlCount     = this.el.querySelector('[data-url-count]');
    this._chainBadge   = this.el.querySelector('[data-chain-badge]');
    this._chainLabel   = this.el.querySelector('[data-chain-label]');
    this._wireButtons();
  }

  _buildDOM() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="form-group">
        <div class="url-label-row">
          <div class="flex gap-1" style="align-items:center;">
            <button type="button" class="btn-icon url-collapse-btn" data-action="toggle-collapse" title="Collapse/expand">▾</button>
            <label style="margin:0;">Target URL</label>
            <span data-url-count class="text-faint" style="font-size:0.78rem;"></span>
          </div>
          <div class="flex gap-1">
            <button type="button" class="btn btn-ghost btn-sm" data-action="add-url">+ Add URL</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="from-config" title="Import URLs from another job">🔗</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="from-file">Import</button>
            <input type="file" data-url-file accept=".txt" hidden />
          </div>
        </div>
        <div data-chain-badge class="chain-badge" hidden>
          <span class="chain-badge-icon">⛓</span>
          <span data-chain-label class="chain-badge-label"></span>
          <button type="button" class="btn-icon chain-badge-unlink" data-action="unlink" title="Remove link">✕</button>
        </div>
        <div data-url-section>
          <div data-url-list class="url-list"></div>
          <div data-url-footer class="url-footer" hidden>
            <span data-url-showing class="text-faint"></span>
            <button type="button" class="btn btn-ghost btn-sm" data-action="show-more">Show 5 more</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="show-all">View All</button>
          </div>
        </div>
      </div>
      <div class="form-group">
        <label>Fields</label>
        <div data-fields></div>
      </div>
      <div class="flex gap-1 mt-2">
        <button type="button" class="btn btn-ghost btn-sm" data-action="add-field">+ Add Field</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="add-pagination">+ Add Pagination</button>
      </div>
    `;
    return wrap;
  }

  // Show/hide rows based on _visibleCount; update footer state.
  _updateVisibility() {
    const rows  = [...this._urlList.children];
    const total = rows.length;
    rows.forEach((r, i) => { r.hidden = i >= this._visibleCount; });

    const showing = Math.min(this._visibleCount, total);
    const hidden  = total - showing;

    this._urlCount.textContent = `(${total})`;

    if (hidden > 0) {
      this._urlFooter.hidden = false;
      this._urlFooter.querySelector('[data-url-showing]').textContent =
        `Showing ${showing} of ${total}`;
    } else {
      this._urlFooter.hidden = true;
    }
  }

  // Append urls, replacing a single empty row if present, then update visibility.
  _addUrls(urls) {
    const rows    = [...this._urlList.querySelectorAll('[data-role="url"]')];
    const isEmpty = rows.length === 1 && !rows[0].value;
    if (isEmpty) this._urlList.innerHTML = '';
    urls.forEach(u => this._urlList.appendChild(_makeUrlRow(u)));
    // Reveal newly added rows
    this._visibleCount = this._urlList.children.length;
    this._updateVisibility();
  }

  _wireButtons() {
    this._urlList.appendChild(_makeUrlRow());
    this._updateVisibility();

    // Unlink chain
    this.el.querySelector('[data-action="unlink"]').addEventListener('click', () => {
      this._setChain(null);
      if (this._jobName) {
        getJob(this._jobName).then(cfg => {
          delete cfg._source;
          saveJob(this._jobName, cfg).catch(() => {});
        }).catch(() => {});
      }
    });

    // Collapse toggle
    this.el.querySelector('[data-action="toggle-collapse"]').addEventListener('click', () => {
      this._collapsed = !this._collapsed;
      this._urlSection.hidden  = this._collapsed;
      this._chainBadge.hidden  = this._collapsed || !this._chainSource;
      this.el.querySelector('[data-action="toggle-collapse"]').textContent =
        this._collapsed ? '▸' : '▾';
    });

    // Add URL
    this.el.querySelector('[data-action="add-url"]').addEventListener('click', () => {
      this._urlList.appendChild(_makeUrlRow());
      this._visibleCount = this._urlList.children.length;
      this._updateVisibility();
      this._urlList.lastElementChild.querySelector('[data-role="url"]').focus();
    });

    // From File
    const fileInput = this.el.querySelector('[data-url-file]');
    this.el.querySelector('[data-action="from-file"]').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        const urls = e.target.result.split('\n').map(s => s.trim()).filter(Boolean);
        if (urls.length) this._addUrls(urls);
      };
      reader.readAsText(file);
      fileInput.value = '';
    });

    // From Config — open modal
    this.el.querySelector('[data-action="from-config"]').addEventListener('click', () => {
      this._showLinkModal();
    });

    // Show 5 more
    this.el.querySelector('[data-action="show-more"]').addEventListener('click', () => {
      this._visibleCount += _PAGE_SIZE;
      this._updateVisibility();
    });

    // View All
    this.el.querySelector('[data-action="show-all"]').addEventListener('click', () => {
      this._visibleCount = this._urlList.children.length;
      this._updateVisibility();
    });

    // Fields
    this.el.querySelector('[data-action="add-field"]')
      .addEventListener('click', () => this._fieldList.appendChild(_makeFieldRow()));
    this.el.querySelector('[data-action="add-pagination"]')
      .addEventListener('click', () => {
        this._fieldList.querySelector('[data-row-type="pagination"]')?.remove();
        this._fieldList.appendChild(_makePaginationRow());
      });
  }

  // Update chain badge display and internal state.
  _setChain(source) {
    this._chainSource = source;
    if (source) {
      this._chainLabel.textContent = `${source.chainJob}  ›  ${source.chainField}`;
      this._chainBadge.hidden = false;
    } else {
      this._chainBadge.hidden = true;
      this._chainLabel.textContent = '';
    }
  }

  _showLinkModal() {
    const overlay = document.createElement('div');
    overlay.className = 'link-modal-overlay';
    overlay.innerHTML = `
      <div class="link-modal">
        <div class="link-modal-header">
          <span>Link URL source</span>
          <button type="button" class="btn-icon" data-action="close">✕</button>
        </div>
        <div class="link-modal-body">
          <div data-step="jobs">
            <p class="text-faint link-modal-hint">Choose a source job:</p>
            <div data-job-list class="link-modal-list">
              <span class="text-faint" style="font-size:0.8rem">Loading…</span>
            </div>
          </div>
          <div data-step="fields" hidden>
            <button type="button" class="btn btn-ghost btn-sm" data-action="back" style="margin-bottom:0.75rem;">← Back</button>
            <p class="text-faint link-modal-hint">Choose a field whose results become URLs:</p>
            <div data-field-list class="link-modal-list"></div>
            <div class="link-modal-actions">
              <button type="button" class="btn btn-primary btn-sm" data-action="link">Link</button>
              <button type="button" class="btn btn-ghost btn-sm" data-action="close">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const close     = () => overlay.remove();
    const jobStep   = overlay.querySelector('[data-step="jobs"]');
    const fieldStep = overlay.querySelector('[data-step="fields"]');
    const jobList   = overlay.querySelector('[data-job-list]');
    const fieldList = overlay.querySelector('[data-field-list]');
    let   _selJob   = null;

    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelectorAll('[data-action="close"]').forEach(b => b.addEventListener('click', close));

    overlay.querySelector('[data-action="back"]').addEventListener('click', () => {
      fieldStep.hidden = true;
      jobStep.hidden   = false;
      _selJob = null;
    });

    overlay.querySelector('[data-action="link"]').addEventListener('click', async () => {
      const checked = fieldList.querySelector('input[type="radio"]:checked');
      if (!checked || !_selJob) return;
      const source = { chainJob: _selJob, chainField: checked.value };
      this._setChain(source);
      // Persist _source immediately
      if (this._jobName) {
        try {
          const cfg = await getJob(this._jobName);
          cfg._source = { type: 'chain', ...source };
          await saveJob(this._jobName, cfg);
        } catch {}
      }
      close();
    });

    document.body.appendChild(overlay);

    listJobs().then(jobs => {
      jobList.innerHTML = '';
      const others = jobs.filter(j => j.name !== this._jobName);
      if (!others.length) {
        jobList.innerHTML = '<span class="text-faint" style="font-size:0.8rem">No other jobs found.</span>';
        return;
      }
      others.forEach(({ name }) => {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'link-modal-item'; btn.textContent = name;
        btn.addEventListener('click', async () => {
          try {
            const config = await getJob(name);
            _selJob = name;
            fieldList.innerHTML = '';

            // Flatten all scraped fields (top-level + group subfields), skip URL and privates
            const fields = [];
            for (const [k, def] of Object.entries(config)) {
              if (k === 'URL' || k.startsWith('_')) continue;
              if (!Array.isArray(def)) continue;
              const type = def[def.length - 1];
              if (type === 'Pagination') continue;
              if (type === 'Group') {
                const [subObj] = def;
                for (const subKey of Object.keys(subObj)) {
                  fields.push({ key: `${k}.${subKey}`, label: `${k}  ›  ${subKey}` });
                }
              } else {
                fields.push({ key: k, label: k });
              }
            }

            if (!fields.length) {
              fieldList.innerHTML = '<span class="text-faint" style="font-size:0.8rem">No fields defined in this job.</span>';
            } else {
              fields.forEach(({ key, label }, i) => {
                const row = document.createElement('label');
                row.className = 'link-field-row';
                row.innerHTML =
                  `<input type="radio" name="link-field" value="${key}"${i === 0 ? ' checked' : ''} />` +
                  `<span class="link-field-name">${label}</span>`;
                fieldList.appendChild(row);
              });
            }

            jobStep.hidden   = true;
            fieldStep.hidden = false;
          } catch {
            jobList.innerHTML = '<span class="text-faint" style="font-size:0.8rem">Failed to load job.</span>';
          }
        });
        jobList.appendChild(btn);
      });
    }).catch(() => {
      jobList.innerHTML = '<span class="text-faint" style="font-size:0.8rem">Failed to load jobs.</span>';
    });
  }

  build(config) {
    this._fieldList.innerHTML = '';
    this._urlList.innerHTML   = '';
    this._visibleCount        = _PAGE_SIZE;

    if (!config) { this._urlList.appendChild(_makeUrlRow()); this._updateVisibility(); return; }

    const urls = Array.isArray(config.URL) ? config.URL : config.URL ? [config.URL] : [];
    if (urls.length === 0) this._urlList.appendChild(_makeUrlRow());
    else urls.forEach(u => this._urlList.appendChild(_makeUrlRow(u)));
    this._updateVisibility();

    // Restore chain badge if _source is a chain
    const src = config._source;
    if (src?.type === 'chain' && src.chainJob && src.chainField) {
      this._setChain({ chainJob: src.chainJob, chainField: src.chainField });
    } else {
      this._setChain(null);
    }

    for (const [name, def] of Object.entries(config)) {
      if (name === 'URL' || name.startsWith('_')) continue;
      const type = Array.isArray(def) ? def[def.length - 1] : null;
      if (type === 'Pagination') {
        this._fieldList.appendChild(_makePaginationRow(name, def[0], def[1]));
      } else if (type === 'Group') {
        const [subObj, mode] = def;
        const subs = Object.entries(subObj).map(([n, d]) => ({
          name: n, selector: d[0], mode: d[1], type: d[2],
        }));
        this._fieldList.appendChild(_makeGroupRow(name, mode, subs));
      } else {
        this._fieldList.appendChild(_makeFieldRow(name, def[0], def[1], def[2]));
      }
    }
  }

  read() {
    const urls = [...this._urlList.querySelectorAll('[data-role="url"]')]
      .map(i => i.value.trim()).filter(Boolean);
    if (urls.length === 0) return null;

    const config = { URL: urls.length === 1 ? urls[0] : urls };

    for (const row of this._fieldList.children) {
      const rt = row.dataset.rowType;
      if (rt === 'field') {
        const name = row.querySelector('[data-role="name"]').value.trim();
        if (!name) continue;
        config[name] = [
          row.querySelector('[data-role="selector"]').value.trim(),
          row.querySelector('[data-role="mode"]').value,
          row.querySelector('[data-role="type"]').value,
        ];
      }
      if (rt === 'pagination') {
        const name = row.querySelector('[data-role="name"]').value.trim() || 'Pagination';
        config[name] = [
          row.querySelector('[data-role="selector"]').value.trim(),
          row.querySelector('[data-role="mode"]').value,
          'Pagination',
        ];
      }
      if (rt === 'group') {
        const name = row.querySelector('.group-header [data-role="name"]').value.trim();
        if (!name) continue;
        const mode   = row.querySelector('.group-header [data-role="mode"]').value;
        const subObj = {};
        for (const sub of row.querySelectorAll('[data-row-type="subfield"]')) {
          const sfName = sub.querySelector('[data-role="name"]').value.trim();
          if (!sfName) continue;
          subObj[sfName] = [
            sub.querySelector('[data-role="selector"]').value.trim(),
            sub.querySelector('[data-role="mode"]').value,
            sub.querySelector('[data-role="type"]').value,
          ];
        }
        config[name] = [subObj, mode, 'Group'];
      }
    }

    return config;
  }
}
