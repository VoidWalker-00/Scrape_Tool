const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const Logger = require('./logging.js');
const Handler = require('./handler.js');

// Stealth plugin makes the browser harder to fingerprint, reducing
// the chance of captcha challenges on sites that detect headless browsers
puppeteer.use(StealthPlugin());

// Scraper manages the browser lifecycle and orchestrates a scrape job.
// It reads a JSON config file that describes what to extract and how to
// paginate, then delegates all DOM extraction to Handler.
class Scraper {
  #browser = null;   // Puppeteer browser instance (set on launch)
  #page = null;      // Active browser tab
  #config = null;    // Parsed JSON config from file
  #logger = null;    // Logger instance (injected or created internally)
  #handler = null;   // Handler instance for DOM extraction
  #solverFn = null;  // Optional external captcha solver function

  // Exposes the logger so tests and the server can verify wiring
  get logger() { return this.#logger; }

  // configPath  — path to the JSON config file describing the scrape job
  // solverFn    — optional async function(page) that solves captchas
  //               if omitted, captchaHandler() pauses and retries instead
  // logger      — optional Logger instance; useful when the server wants to
  //               forward log events to an SSE stream
  constructor(configPath, solverFn = null, logger = null) {
    const raw = fs.readFileSync(configPath, 'utf8');
    this.#config = JSON.parse(raw);
    this.#logger = logger ?? new Logger();
    this.#handler = new Handler(this.#logger);
    this.#solverFn = solverFn;
  }

  // ── Browser lifecycle ─────────────────────────────────────────────────────

  // Launches a headless Chromium browser using the system installation.
  // Must be called before scrape().
  async launch() {
    this.#browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    });
    this.#page = await this.#browser.newPage();
    this.#logger.info('Browser launched');
  }

  // Closes the browser and clears internal references.
  // Safe to call even if launch() was never called.
  async close() {
    if (this.#browser) {
      await this.#browser.close();
      this.#browser = null;
      this.#page = null;
      this.#logger.info('Browser closed');
    }
  }

  // ── Navigation & utilities ────────────────────────────────────────────────

  // Navigates to a URL and waits until network activity settles
  async navigate(url) {
    await this.#page.goto(url, { waitUntil: 'networkidle2' });
    this.#logger.info(`Navigated to ${url}`);
  }

  // Pauses execution for a given number of milliseconds.
  // Useful for rate-limiting between page loads.
  async delay(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Captcha handling ──────────────────────────────────────────────────────

  // Checks the current page for common captcha indicators.
  // Returns true if a captcha is detected, false otherwise.
  async captchaDetection() {
    const detected = await this.#page.evaluate(() => {
      const body = document.body.innerText.toLowerCase();
      const title = document.title.toLowerCase();
      return (
        body.includes('captcha') ||
        body.includes('verify you are human') ||
        title.includes('captcha') ||
        !!document.querySelector('iframe[src*="recaptcha"]') ||
        !!document.querySelector('iframe[src*="hcaptcha"]')
      );
    });

    if (detected) this.#logger.warn('Captcha detected on page');
    return detected;
  }

  // Attempts to resolve a detected captcha.
  // If a solverFn was injected (e.g. a paid service like 2captcha), it is called.
  // Otherwise the scraper pauses for 10 seconds and hopes the captcha clears
  // (e.g. after a retry or IP rotation).
  // To add a solver: pass an async function(page) as the second constructor arg.
  async captchaHandler() {
    if (this.#solverFn) {
      this.#logger.info('Running external captcha solver');
      try {
        await this.#solverFn(this.#page);
      } catch (err) {
        this.#logger.error(`Captcha solver failed: ${err.message}`);
      }
    } else {
      this.#logger.warn('No captcha solver provided — pausing 10s before retry');
      await this.delay(10000);
    }
  }

  // ── Field extraction ──────────────────────────────────────────────────────

  // Extracts a single flat field (Text, URL, DateTime, Title, etc.)
  // definition format: [selector, mode, type]
  async scrapeField(name, definition) {
    const [selector, mode, type] = definition;
    this.#logger.info(`Scraping field "${name}" [${type}/${mode}]`);
    return await this.#handler.run(type, this.#page, selector, mode);
  }

  // Extracts a group of related fields into a nested object.
  // definition format: [{ fieldName: [selector, mode, type], ... }, mode, "Group"]
  async scrapeGroup(name, definition) {
    const [fields, mode, type] = definition;
    this.#logger.info(`Scraping group "${name}" [${mode}]`);
    return await this.#handler.run(type, this.#page, fields, mode);
  }

  // ── Main entry point ──────────────────────────────────────────────────────

  // Runs the full scrape job described by the config file.
  // Handles captcha detection, field extraction, and pagination automatically.
  //
  // Returns:
  //   - A single result object if only one page was scraped
  //   - An array of result objects if pagination produced multiple pages
  //   - null if a captcha could not be resolved
  async scrape() {
    const { URL: url, ...fields } = this.#config;

    await this.navigate(url);

    // Check for captcha before attempting to extract any data
    if (await this.captchaDetection()) {
      await this.captchaHandler();
      // Re-check after the handler attempt — abort if still blocked
      if (await this.captchaDetection()) {
        this.#logger.error('Captcha unresolved — aborting scrape');
        return null;
      }
    }

    // Separate the pagination definition from the data fields so we can
    // handle them differently in the loop below
    let paginationDef = null;
    const dataFields = {};

    for (const [key, value] of Object.entries(fields)) {
      if (value[2] === 'Pagination') {
        paginationDef = value;
      } else {
        dataFields[key] = value;
      }
    }

    const allResults = [];
    let hasMore = true;

    // Page loop: extract data from the current page, then advance if pagination exists
    while (hasMore) {
      const pageResult = {};

      for (const [name, definition] of Object.entries(dataFields)) {
        const type = definition[2];
        if (type === 'Group') {
          pageResult[name] = await this.scrapeGroup(name, definition);
        } else {
          pageResult[name] = await this.scrapeField(name, definition);
        }
      }

      allResults.push(pageResult);
      this.#logger.info(`Page ${allResults.length} scraped`);

      if (paginationDef) {
        // Handler returns true if it navigated to a next page, false if done
        const [selector, mode] = paginationDef;
        hasMore = await this.#handler.run('Pagination', this.#page, selector, mode);
      } else {
        hasMore = false;
      }
    }

    this.#logger.info(`Scrape complete — ${allResults.length} page(s) collected`);

    // Unwrap single-page results for a cleaner API — only return an array
    // when multiple pages were actually scraped
    return allResults.length === 1 ? allResults[0] : allResults;
  }
}

module.exports = Scraper;
