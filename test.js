const path = require('path');
const Logger = require('./logging.js');
const Handler = require('./handler.js');
const Scraper = require('./scraper.js');

const log = new Logger();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function assert(condition, label, actual) {
  if (condition) {
    log.info(`  PASS: ${label}`);
  } else {
    log.error(`  FAIL: ${label} — got: ${JSON.stringify(actual)}`);
    throw new Error(`Assertion failed: ${label}`);
  }
}

// Builds a mock puppeteer page from a map of selector → array of fake elements.
// evaluate(fn, el) simply calls fn(el) so mock elements must look like DOM nodes.
function mockPage(elements) {
  return {
    $:    async (sel) => elements[sel]?.[0] ?? null,
    $$:   async (sel) => elements[sel] ?? [],
    evaluate: async (fn, el) => fn(el),
    waitForNavigation: async () => {},
    click: async () => {},
    evaluate: async (fn, el) => fn(el),
  };
}

function el(props) {
  return {
    textContent: '',
    href: null,
    src: null,
    getAttribute: () => null,
    ...props,
  };
}

// ─── Handler Tests ────────────────────────────────────────────────────────────

async function testHandler() {
  log.info('=== Handler Tests ===');
  const handler = new Handler(log);

  const textEl  = el({ textContent: 'A Book Title' });
  const linkEl  = el({ textContent: 'Click', href: 'https://example.com/book/1' });
  const dateEl  = el({ textContent: '2024-01-15', getAttribute: (a) => a === 'datetime' ? '2024-01-15' : null });
  const titleEl = el({ textContent: 'Fallback', getAttribute: (a) => a === 'title' ? 'Title Attr' : null });

  const page = mockPage({
    '.text':  [textEl],
    '.link':  [linkEl],
    '.date':  [dateEl],
    '.title': [titleEl],
    '.many':  [textEl, textEl, textEl],
  });

  // attribute — Text/Single
  const text = await handler.attribute(page, '.text', 'Single', 'Text');
  assert(text === 'A Book Title', 'attribute Text/Single', text);

  // attribute — URL/Single
  const url = await handler.attribute(page, '.link', 'Single', 'URL');
  assert(url === 'https://example.com/book/1', 'attribute URL/Single', url);

  // attribute — DateTime/Single (prefers datetime attr)
  const dt = await handler.attribute(page, '.date', 'Single', 'DateTime');
  assert(dt === '2024-01-15', 'attribute DateTime/Single', dt);

  // attribute — Title/Single (prefers title attr)
  const title = await handler.attribute(page, '.title', 'Single', 'Title');
  assert(title === 'Title Attr', 'attribute Title/Single', title);

  // attribute — All mode returns array
  const all = await handler.attribute(page, '.many', 'All', 'Text');
  assert(Array.isArray(all) && all.length === 3, 'attribute Text/All length', all);

  // attribute — missing selector returns null
  const missing = await handler.attribute(page, '.gone', 'Single', 'Text');
  assert(missing === null, 'attribute missing element returns null', missing);

  // group — collects named fields into object
  const groupPage = mockPage({ '.name': [textEl], '.url': [linkEl] });
  const group = await handler.group(groupPage, {
    Name: ['.name', 'Single', 'Text'],
    Link: ['.url',  'Single', 'URL'],
  }, 'Single');
  assert(group.Name === 'A Book Title',                  'group Name field',  group.Name);
  assert(group.Link === 'https://example.com/book/1',    'group Link field',  group.Link);

  // pagination — Click with no button returns false
  const emptyPage = mockPage({});
  const noPagination = await handler.pagination(emptyPage, 'li.next a', 'Click');
  assert(noPagination === false, 'pagination Click with no button returns false', noPagination);

  // run — routes unknown type through attribute
  const routed = await handler.run('Text', page, '.text', 'Single');
  assert(routed === 'A Book Title', 'run routes Text to attribute', routed);

  log.info('Handler tests complete\n');
}

// ─── Scraper Tests ────────────────────────────────────────────────────────────

async function testScraper() {
  log.info('=== Scraper Tests ===');

  const configPath = path.join(__dirname, 'Data', 'Selectors', 'test.json');
  const scraper = new Scraper(configPath);

  await scraper.launch();
  const result = await scraper.scrape();
  await scraper.close();

  assert(result !== null, 'scrape result is not null', result);

  // Page_Title
  assert(typeof result.Page_Title === 'string' && result.Page_Title.length > 0,
    'Page_Title is a non-empty string', result.Page_Title);
  log.info(`  Page title: "${result.Page_Title}"`);

  // Book_Details group
  assert(result.Book_Details !== null && typeof result.Book_Details === 'object',
    'Book_Details group is an object', result.Book_Details);

  assert(Array.isArray(result.Book_Details.Titles) && result.Book_Details.Titles.length > 0,
    'Book_Details.Titles is a non-empty array', result.Book_Details.Titles);

  assert(Array.isArray(result.Book_Details.Prices) && result.Book_Details.Prices.length > 0,
    'Book_Details.Prices is a non-empty array', result.Book_Details.Prices);

  assert(Array.isArray(result.Book_Details.Links) && result.Book_Details.Links.length > 0,
    'Book_Details.Links is a non-empty array', result.Book_Details.Links);

  assert(result.Book_Details.Titles.length === result.Book_Details.Prices.length,
    'Titles and Prices counts match', result.Book_Details.Titles.length);

  log.info(`  Books found: ${result.Book_Details.Titles.length}`);
  log.info(`  First book: "${result.Book_Details.Titles[0]}" — ${result.Book_Details.Prices[0]}`);

  log.info('Scraper tests complete\n');
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function run() {
  try {
    await testHandler();
    await testScraper();
    log.info('All tests passed');
  } catch (err) {
    log.error(`Tests failed: ${err.message}`);
    process.exit(1);
  }
}

run();
