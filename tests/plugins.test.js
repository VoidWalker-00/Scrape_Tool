const { test } = require('node:test');
const assert = require('node:assert');
const { runPlugins } = require('../plugins/index.js');

test('runPlugins calls all registered plugins with data', async () => {
  const calls = [];
  const fakePlugins = [
    { name: 'a', run: async (data) => calls.push(`a:${data.job}`) },
    { name: 'b', run: async (data) => calls.push(`b:${data.job}`) },
  ];
  await runPlugins({ job: 'test' }, fakePlugins);
  assert.deepEqual(calls, ['a:test', 'b:test']);
});

test('runPlugins continues if one plugin throws', async () => {
  const calls = [];
  const fakePlugins = [
    { name: 'bad',  run: async () => { throw new Error('oops'); } },
    { name: 'good', run: async (data) => calls.push('good') },
  ];
  await runPlugins({ job: 'test' }, fakePlugins);
  assert.deepEqual(calls, ['good']);
});
