// Handler is responsible for all DOM extraction logic.
// Scraper delegates to Handler so that adding a new field type or pagination
// strategy only requires changing this file — scraper.js stays untouched.
class Handler {
  constructor(logger) {
    this.logger = logger;
  }

  // ── Entry point ───────────────────────────────────────────────────────────

  // Routes a field definition to the correct handler method based on its type.
  // Called by Scraper for every field in the config.
  //
  // type === 'Group'      → this.group()
  // type === 'Pagination' → this.pagination()
  // anything else         → this.attribute()  (Text, URL, DateTime, Title, ...)
  async run(type, page, ...args) {
    switch (type) {
      case 'Group':
        return await this.group(page, ...args);
      case 'Pagination':
        return await this.pagination(page, ...args);
      default:
        // Pass the type along so attribute() knows how to format the value
        return await this.attribute(page, ...args, type);
    }
  }

  // ── Field extraction ──────────────────────────────────────────────────────

  // Extracts a value (or array of values) from the page using a CSS selector.
  //
  // mode === 'Single' → finds the first matching element, returns one value
  // mode === 'All'    → finds all matching elements, returns an array
  //
  // The actual value extraction is delegated to #extract() based on type.
  async attribute(page, selector, mode, type) {
    if (mode === 'Single') {
      const el = await page.$(selector);
      if (!el) return null;
      return await this.#extract(page, el, type);
    }

    if (mode === 'All') {
      const els = await page.$$(selector);
      return await Promise.all(els.map(el => this.#extract(page, el, type)));
    }

    return null;
  }

  // Reads the appropriate property from a DOM element based on the field type:
  //
  // URL      → href or src attribute (for links and images)
  // DateTime → datetime attribute (e.g. <time datetime="2024-01-15">), falls back to text
  // Title    → title attribute (tooltip text), falls back to text
  // HTML     → raw innerHTML (useful when content has nested markup to preserve)
  // Image    → src attribute from <img> elements
  // Alt      → alt attribute from <img> elements
  // Aria     → aria-label attribute, falls back to text
  // Text     → plain text content (default for any unknown type)
  async #extract(page, el, type) {
    switch (type) {
      case 'URL':
        return await page.evaluate(e => e.href || e.src || null, el);
      case 'DateTime':
        return await page.evaluate(e => e.getAttribute('datetime') || e.textContent.trim(), el);
      case 'Title':
        return await page.evaluate(e => e.getAttribute('title') || e.textContent.trim(), el);
      case 'HTML':
        return await page.evaluate(e => e.innerHTML, el);
      case 'Image':
        return await page.evaluate(e => e.src || null, el);
      case 'Alt':
        return await page.evaluate(e => e.getAttribute('alt') || null, el);
      case 'Aria':
        return await page.evaluate(e => e.getAttribute('aria-label') || e.textContent.trim(), el);
      case 'Text':
      default:
        return await page.evaluate(e => e.textContent.trim(), el);
    }
  }

  // ── Group extraction ──────────────────────────────────────────────────────

  // Extracts a named set of fields and returns them as a single object.
  // Each field inside the group is processed independently via run().
  //
  // Example config:
  //   "BookInfo": [{ "Title": [".h3 a", "Single", "Title"], ... }, "All", "Group"]
  //
  // Returns: { Title: "...", Price: "...", ... }
  async group(page, fields, mode) {
    const result = {};
    for (const [name, definition] of Object.entries(fields)) {
      const [selector, fieldMode, type] = definition;
      result[name] = await this.run(type, page, selector, fieldMode);
    }
    return result;
  }

  // ── Pagination ────────────────────────────────────────────────────────────

  // Advances to the next page using the specified strategy.
  // Returns true if navigation succeeded (more pages exist), false if done.
  //
  // Click  → clicks a "next page" button and waits for navigation
  // Scroll → scrolls to the bottom and checks if new content loaded
  // URL    → URL-increment pagination is handled by Scraper; returns false here
  async pagination(page, selector, mode) {
    switch (mode) {
      case 'Click': {
        const btn = await page.$(selector);
        if (!btn) return false; // No next button — we're on the last page
        await btn.click();
        await page.waitForNavigation({ waitUntil: 'networkidle2' });
        return true;
      }
      case 'Scroll': {
        const prevHeight = await page.evaluate(() => document.body.scrollHeight);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        // Wait for lazy-loaded content to appear
        await new Promise(r => setTimeout(r, 1500));
        const newHeight = await page.evaluate(() => document.body.scrollHeight);
        // If the page grew taller, new content was loaded
        return newHeight > prevHeight;
      }
      case 'URL':
        // URL-based pagination is driven by the Scraper — signal no auto-navigation
        return false;
      default:
        this.logger.warn(`Unknown pagination mode: ${mode}`);
        return false;
    }
  }
}

module.exports = Handler;
