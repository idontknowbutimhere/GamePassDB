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
  await page.waitForTimeout(8000);

  // Xbox lazy-loads the catalog. Keep scrolling so additional game cards
  // are rendered instead of only collecting the first visible batch.
  let lastCount = 0;
  let unchangedRounds = 0;

  for (let round = 0; round < 40 && unchangedRounds < 5; round++) {
    const count = await page.locator('a[href*="/games/store/"]').count();

    if (count === lastCount) unchangedRounds++;
    else unchangedRounds = 0;
    lastCount = count;

    // Some versions of the page expose a Load more / Show more control.
    const buttons = page.getByRole('button');
    const buttonCount = await buttons.count();
    for (let i = 0; i < buttonCount; i++) {
      const button = buttons.nth(i);
      const text = (await button.innerText().catch(() => '')).trim().toLowerCase();
      if (/^(load|show) more$/.test(text)) {
        await button.click().catch(() => {});
        await page.waitForTimeout(1500);
      }
    }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1800);
  }

  // Give the final lazy-loaded batch a moment to finish.
  await page.waitForTimeout(3000);

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

  if (games.length < 60) {
    throw new Error(`Only detected ${games.length} games after exhausting lazy-loaded content. Refusing to overwrite games.json because the catalog is probably incomplete.`);
  }

  const output = {
    updatedAt: new Date().toISOString(),
    source: URL,
    games
  };

  fs.writeFileSync('games.json', JSON.stringify(output, null, 2) + '\n');
  console.log(`Detected ${games.length} Xbox Game Pass games.`);
})();
