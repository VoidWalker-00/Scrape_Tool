const { test } = require('node:test');
const assert = require('node:assert');
const Logger = require('../logging.js');

test('Logger emits log events', (t, done) => {
  const log = new Logger();
  log.once('log', ({ level, message }) => {
    assert.equal(level, 'INFO');
    assert.equal(message, 'hello');
    done();
  });
  log.info('hello');
});
