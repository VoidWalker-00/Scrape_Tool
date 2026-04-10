const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Logger = require('../logging.js');
const Scraper = require('../scraper.js');

const CONFIG = path.join(__dirname, '..', 'Data', 'Selectors', 'test.json');

test('Scraper uses a new Logger when none is injected', () => {
  const scraper = new Scraper(CONFIG);
  assert.ok(scraper.logger instanceof Logger, 'default logger is a Logger instance');
});

test('Scraper uses the injected Logger instead of creating a new one', () => {
  const injected = new Logger();
  const scraper = new Scraper(CONFIG, null, injected);
  assert.strictEqual(scraper.logger, injected, 'injected logger must be the same instance');
});

test('Injected logger emits events when used via scraper', () => {
  const injected = new Logger();
  const scraper = new Scraper(CONFIG, null, injected);
  const received = [];
  injected.on('log', (e) => received.push(e.message));
  // Directly log through the injected instance to confirm it is wired
  scraper.logger.info('wiring check');
  assert.ok(received.includes('wiring check'), 'injected logger should emit events');
});
