const fs = require('fs');
const path = require('path');

// plugins/ is the directory this file lives in
const PLUGINS_DIR = __dirname;

// Scans the plugins/ folder and returns all plugin modules as
// [{ name: string, run: Function }].
//
// Each plugin file must export a single async function:
//   module.exports = async function({ job, runId, result, outPath }) { ... }
//
// New plugin files dropped in while the server is running are picked up
// automatically on the next scrape (Node only caches require() for files
// it has already loaded — brand new files are always freshly required).
// If you modify an existing plugin while the server is running, restart
// the server for the change to take effect.
function loadPlugins() {
  return fs.readdirSync(PLUGINS_DIR)
    .filter(f => f.endsWith('.js') && f !== 'index.js') // Skip this file itself
    .map(f => ({
      name: path.basename(f, '.js'),
      run: require(path.join(PLUGINS_DIR, f)),
    }));
}

// Calls every plugin in sequence with the scrape result data.
// If a plugin throws, the error is logged and the remaining plugins still run —
// one bad plugin cannot block the others.
//
// data: { job, runId, result, outPath }
// plugins: optional override — defaults to loadPlugins() (used for testing)
async function runPlugins(data, plugins = loadPlugins()) {
  for (const plugin of plugins) {
    try {
      await plugin.run(data);
    } catch (err) {
      console.error(`Plugin "${plugin.name}" failed: ${err.message}`);
    }
  }
}

module.exports = { runPlugins, loadPlugins };
