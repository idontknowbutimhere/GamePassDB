const fs = require('fs');

const CATALOG_URL = 'https://raw.githubusercontent.com/Austrum-lab/steam-appdb/master/data/game.json';
const STEAMSPY_ALL = 'https://steamspy.com/api.php?request=all&page=';
const STEAMSPY_PAGE_DELAY = 60000; // SteamSpy documents 1 all request/minute.
const MAX_STEAMSPY_PAGES = 15;

function cleanTitle(value) {
  return value.normalize('NFKC')
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D_]+/g, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/[|¦]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ownerMidpoint(value) {
  if (!value) return 0;
  const nums = String(value).replace(/,/g, '').match(/\d+/g)?.map(Number) || [];
  if (nums.length >= 2) return Math.round((nums[0] + nums[1]) / 2);
  return nums[0] || 0;
}

async function fetchJson(url, label) {
  const r = await fetch(url, { headers: { 'User-Agent': 'GamePassDB SteamDB updater/1.0' } });
  if (!r.ok) throw new Error(`${label} returned HTTP ${r.status}`);
  return r.json();
}

async function main() {
  console.log('1/3 Downloading full Steam game catalogue from steam-appdb...');
  const catalog = await fetchJson(CATALOG_URL, 'steam-appdb');
  if (!Array.isArray(catalog)) throw new Error('steam-appdb returned an unexpected format.');

  const games = new Map();
  for (const app of catalog) {
    const id = Number(app.appid);
    const title = typeof app.name === 'string' ? cleanTitle(app.name) : '';
    if (Number.isInteger(id) && id > 0 && title) games.set(id, { id, title });
  }
  const apps = [...games.values()];
  if (apps.length < 1000) throw new Error(`Safety check failed: only ${apps.length} games received.`);
  console.log(`Steam catalogue: ${apps.length.toLocaleString()} games.`);

  console.log('2/3 Downloading bulk SteamSpy popularity/price pages...');
  console.log('This replaces ~200,000 individual requests with roughly 10–15 bulk requests.');

  const popularity = new Map();
  for (let page = 0; page < MAX_STEAMSPY_PAGES; page++) {
    const data = await fetchJson(`${STEAMSPY_ALL}${page}`, `SteamSpy page ${page}`);
    const rows = Array.isArray(data) ? data : Object.values(data || {});
    if (!rows.length) break;

    for (const d of rows) {
      const id = Number(d.appid);
      if (!Number.isInteger(id) || id <= 0) continue;
      const positive = Number(d.positive) || 0;
      const negative = Number(d.negative) || 0;
      const reviews = positive + negative;
      const owners = ownerMidpoint(d.owners);
      const ccu = Number(d.ccu) || 0;
      // Owners are the main long-term popularity signal; CCU and review volume
      // break ties and give newer popular games a boost.
      const score = Math.round(owners * 10 + ccu * 250 + reviews * 100);
      popularity.set(id, {
        popularityScore: score,
        owners: d.owners || null,
        positive,
        negative,
        reviews,
        ccu,
        priceCents: Number.isFinite(Number(d.price)) ? Number(d.price) : null,
        initialPriceCents: Number.isFinite(Number(d.initialprice)) ? Number(d.initialprice) : null,
        discount: Number.isFinite(Number(d.discount)) ? Number(d.discount) : 0,
        genres: typeof d.genre === 'string' ? d.genre.split(',').map(x => x.trim()).filter(Boolean) : []
      });
    }

    console.log(`SteamSpy: page ${page + 1}, ${rows.length} rows, ${popularity.size.toLocaleString()} unique games.`);
    if (rows.length < 1000 || page === MAX_STEAMSPY_PAGES - 1) break;

    await new Promise(resolve => setTimeout(resolve, STEAMSPY_PAGE_DELAY));
  }

  console.log('3/3 Merging data, ranking and writing games.json...');
  let enriched = 0;
  for (const game of apps) {
    const d = popularity.get(game.id);
    if (d) {
      Object.assign(game, d);
      enriched++;
    } else {
      game.popularityScore = 0;
      game.owners = null;
      game.positive = 0;
      game.negative = 0;
      game.reviews = 0;
      game.ccu = 0;
      game.priceCents = null;
      game.initialPriceCents = null;
      game.discount = 0;
      game.genres = [];
    }
  }

  apps.sort((a, b) => b.popularityScore - a.popularityScore || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  apps.forEach((game, index) => { game.rank = index + 1; });

  const output = {
    updatedAt: new Date().toISOString(),
    source: 'Austrum-lab/steam-appdb + SteamSpy bulk all endpoint',
    count: apps.length,
    enrichedCount: enriched,
    rankingCoverage: `${enriched.toLocaleString()} of ${apps.length.toLocaleString()} games have SteamSpy popularity data`,
    games: apps
  };

  fs.writeFileSync('steam/games.json', JSON.stringify(output));
  console.log(`Done: ${apps.length.toLocaleString()} games, ${enriched.toLocaleString()} ranked/enriched.`);
}

main().catch(err => { console.error(err); process.exit(1); });
