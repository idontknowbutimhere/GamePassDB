const { chromium } = require('playwright');
const fs = require('fs');

const URL = 'https://www.xbox.com/en-CA/xbox-game-pass/games';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    locale: 'en-CA',
    viewport: { width: 1440, height: 1000 }
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(10000);

  // The Xbox catalog is dynamically rendered. This first version records
  // the visible game links and cover images so we can verify the selectors
  // against the live Microsoft page before adding metadata matching.
  const games = await page.evaluate(() => {
    const results = [];
    const seen = new Set();

    for (const link of document.querySelectorAll('a[href]')) {
      const href = link.href;
      const img = link.querySelector('img');
      const title = (img?.alt || link.textContent || '').replace(/\s+/g, ' ').trim();

      if (!title || !img || !href.includes('/games/store/')) continue;
      if (seen.has(href)) continue;
      seen.add(href);

      results.push({
        id: href.split('/').pop(),
        title,
        cover: img.currentSrc || img.src || '',
        sourceUrl: href,
        tiers: [],
        platforms: [],
        genres: [],
        indie: false,
        leavingSoon: false
      });
    }

    return results;
  });

  await browser.close();

  if (!games.length) {
    throw new Error('No Game Pass game cards were detected on the Microsoft catalog page. Refusing to overwrite games.json.');
  }

  const output = {
    updatedAt: new Date().toISOString(),
    source: URL,
    games
  };

  fs.writeFileSync('games.json', JSON.stringify(output, null, 2) + '\n');
  console.log(`Detected ${games.length} Xbox Game Pass games.`);
})();
