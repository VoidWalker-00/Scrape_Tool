// layout.js — shared nav injected into every page at load time.
//
// Usage: imported as a module, auto-mounts on DOMContentLoaded.
// The active link is highlighted by matching the current path.

const NAV_LINKS = [
  { href: '/index.html', label: 'Dashboard' },
];

class Nav {
  constructor(links) {
    this.links = links;
    this.el = this._build();
  }

  _build() {
    const nav = document.createElement('nav');
    nav.className = 'tw-nav';
    // Makes the nav bar the window drag region when running inside Tauri
    nav.setAttribute('data-tauri-drag-region', '');

    const currentPath = window.location.pathname.replace(/\/$/, '') || '/index.html';

    for (const { href, label } of this.links) {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = label;

      // Match on the filename portion so /index.html and / both highlight Dashboard
      const linkFile = href.replace(/^\//, '');
      const curFile  = currentPath.replace(/^\//, '') || 'index.html';
      if (linkFile === curFile) a.classList.add('active');

      nav.appendChild(a);
    }

    // Brand — absolutely centred in the nav bar
    const brand = document.createElement('span');
    brand.className = 'nav-brand';
    brand.innerHTML = '<span class="nav-logo">◈</span> Scrape Tool';
    nav.appendChild(brand);

    // Window controls — only rendered inside Tauri (decorations: false)
    if (window.__TAURI__) {
      const controls = document.createElement('div');
      controls.className = 'win-controls';

      const appWindow = window.__TAURI__.window.getCurrentWindow();

      const btnMin = document.createElement('button');
      btnMin.className = 'win-btn';
      btnMin.title = 'Minimise';
      btnMin.textContent = '─';
      btnMin.addEventListener('click', () => appWindow.minimize());

      const btnMax = document.createElement('button');
      btnMax.className = 'win-btn';
      btnMax.title = 'Maximise / Restore';
      btnMax.textContent = '□';
      btnMax.addEventListener('click', () => appWindow.toggleMaximize());

      const btnClose = document.createElement('button');
      btnClose.className = 'win-btn win-btn-close';
      btnClose.title = 'Close';
      btnClose.textContent = '✕';
      btnClose.addEventListener('click', () => appWindow.close());

      controls.appendChild(btnMin);
      controls.appendChild(btnMax);
      controls.appendChild(btnClose);
      nav.appendChild(controls);
    }

    return nav;
  }

  mount() {
    document.body.insertBefore(this.el, document.body.firstChild);

    // Wrap all non-nav body children in a scroll container so the scrollbar
    // sits below the nav rather than spanning the full window height.
    const scroll = document.createElement('div');
    scroll.className = 'page-scroll';
    while (document.body.children.length > 1) {
      scroll.appendChild(document.body.children[1]);
    }
    document.body.appendChild(scroll);
  }
}

// Auto-mount on every page that imports this module
document.addEventListener('DOMContentLoaded', () => new Nav(NAV_LINKS).mount());

// Dev live-reload — connects to /dev/reload SSE and reloads the page on any
// file change in public/. Silent no-op in production (endpoint won't exist).
(() => {
  const es = new EventSource('/dev/reload');
  es.onmessage = () => location.reload();
  es.onerror   = () => es.close(); // production / offline — stop retrying
})();
