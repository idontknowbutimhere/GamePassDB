const fs = require('fs');

const SEARCH_URL = 'https://store.steampowered.com/search/results/';
const PAGE_SIZE = 100;
const DELAY_MS = 400;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPage(start, attempt = 1) {
  const params = new URLSearchParams({
    term: '',
    category1: '998',
    start: String(start),
    count: String(PAGE_SIZE),
    json: '1',
    infinite: '1',
    cc: 'us',
    l: 'english'
  });

  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers: {
      'User-Agent': 'GamePassDB Steam catalog updater/1.0'
    }
  });

  if (!res.ok) {
    if (attempt < 5 && (res.status === 429 || res.status >= 500)) {
      const wait = attempt * 3000;
      console.log(`Steam returned HTTP ${res.status}; retrying in ${wait}ms...`);
      await sleep(wait);
      return fetchPage(start, attempt + 1);
    }
    throw new Error(`Steam Store search returned HTTP ${res.status} at start=${start}`);
  }

  return res.json();
}

async function main() {
  const games = new Map();
  let start = 0;
  let total = null;

  while (total === null || start < total) {
    console.log(`Fetching Steam games ${start}${total === null ? '' : `/${total}`}...`);
    const page = await fetchPage(start);

    if (!page || page.success === false) {
      throw new Error(`Steam Store search returned an unsuccessful response at start=${start}`);
    }

    total = Number(page.total_count ?? page.total ?? 0);
    const html = page.results_html || '';

    // Steam's JSON search endpoint returns the result rows as HTML.
    // Extract app IDs and titles without adding a third-party dependency.
    const rowRegex = /class="[^"]*search_result_row[^"]*"[^>]*href="https?:\/\/store\.steampowered\.com\/app\/(\d+)[^\"]*"[\s\S]*?<span class="title">([\s\S]*?)<\/span>/g;
    let match;
    let found = 0;

    while ((match = rowRegex.exec(html)) !== null) {
      const id = Number(match[1]);
      const title = match[2]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();

      if (Number.isInteger(id) && title) {
        games.set(id, { id, title });
        found++;
      }
    }

    console.log(`  Found ${found} games; ${games.size} unique total.`);

    if (found === 0) {
      throw new Error(`Steam returned no game rows at start=${start}. The store response format may have changed.`);
    }

    start += PAGE_SIZE;
    if (start < total) await sleep(DELAY_MS);
  }

  const apps = [...games.values()];
  apps.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));

  const output = {
    updatedAt: new Date().toISOString(),
    source: 'Steam Store search — category1=998 (Games)',
    count: apps.length,
    games: apps
  };

  fs.writeFileSync('steam/games.json', JSON.stringify(output));
  console.log(`Wrote ${apps.length} Steam games to steam/games.json`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
