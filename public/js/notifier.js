// notifier.js — global notification handler
//
// Connects to /api/events SSE on every page.
// When an event arrives:
//   - App is focused  → show in-app toast
//   - App is not focused → POST /api/notify/desktop (server fires OS notification)

const DISMISS_MS = 3000;
const MAX_TOASTS = 4;

class Notifier {
  constructor() {
    this._container = null;
    this._toasts    = [];
    this._source    = null;
  }

  init() {
    this._createContainer();
    this._connectSSE();
  }

  // ── SSE connection ──────────────────────────────────────────────────────────

  _connectSSE() {
    this._source = new EventSource('/api/events');

    this._source.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (document.hasFocus()) {
        this._showToast(data);
      } else {
        this._triggerDesktop(data);
      }
    };

    // EventSource reconnects automatically on error — no manual retry needed
    this._source.onerror = () => {
      console.warn('[Notifier] SSE connection lost — browser will retry automatically');
    };
  }

  // ── Toast ───────────────────────────────────────────────────────────────────

  _createContainer() {
    const el = document.createElement('div');
    el.id = 'toast-container';
    document.body.appendChild(el);
    this._container = el;
  }

  _showToast(data) {
    const { title, body } = this._copy(data);
    const isError = data.type.endsWith('-error');

    // Drop oldest toast if at the limit
    if (this._toasts.length >= MAX_TOASTS) {
      this._removeToast(this._toasts[0]);
    }

    const el = document.createElement('div');
    el.className = `toast ${isError ? 'toast-err' : 'toast-ok'}`;
    el.innerHTML = `
      <span class="toast-icon">${isError ? '✗' : '✓'}</span>
      <div class="toast-body">
        <div class="toast-title">${title}</div>
        <div class="toast-message">${body}</div>
      </div>
      <button class="toast-close" aria-label="Dismiss">×</button>
    `;

    el.querySelector('.toast-close').addEventListener('click', () => this._removeToast(el));

    this._container.appendChild(el);
    this._toasts.push(el);

    setTimeout(() => this._removeToast(el), DISMISS_MS);
  }

  _removeToast(el) {
    if (!el.parentNode) return;
    el.classList.add('toast-hiding');
    // Remove from DOM after the CSS fade-out animation completes
    setTimeout(() => {
      el.remove();
      this._toasts = this._toasts.filter(t => t !== el);
    }, 200);
  }

  // ── Desktop notification ────────────────────────────────────────────────────

  async _triggerDesktop(data) {
    const { title, body } = this._copy(data);
    try {
      await fetch('/api/notify/desktop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, message: body }),
      });
    } catch (err) {
      console.warn('[Notifier] Desktop notification request failed:', err);
    }
  }

  // ── Message copy ────────────────────────────────────────────────────────────

  _copy({ type, job, message, path }) {
    switch (type) {
      case 'scrape-done':  return { title: 'Job done',      body: `"${job}" finished successfully` };
      case 'scrape-error': return { title: 'Scrape failed', body: `"${job}" encountered an error` };
      case 'export-done':  return { title: 'Export saved',  body: `"${job}" exported to ${path}` };
      case 'export-error': return { title: 'Export failed', body: message || `"${job}" could not be exported` };
      default:             return { title: 'Notification',  body: message || '' };
    }
  }
}

document.addEventListener('DOMContentLoaded', () => new Notifier().init());
