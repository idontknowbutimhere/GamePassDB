const fs = require('fs');

const CATALOG_URL = 'https://raw.githubusercontent.com/Austrum-lab/steam-appdb/master/data/game.json';
const STEAMSPY_URL = 'https://steamspy.com/api.php';
const BATCH_DELAY_MS = 350;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function cleanTitle(title) {
  return title
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, '-')
    .replace(/\s*[\u2022\u00b7]\s*/g, ' - ')
    .replace(/[\u00a0\u2000-\u200b]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getJson(url, attempt = 1) {
  const res = await fetch(url, { headers: { 'User-Agent': 'GamePassDB SteamDB updater/1.0' } });
  if (!res.ok) {
    if (attempt < 4 && (res.status === 429 || res.status >= 500)) {
      await sleep(attempt * 2000);
      return getJson(url, attempt + 1);
    }
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return res.json();
}

async function getSteamSpyPage(page) {
  return getJson(`${STEAMSPY_URL}?request=all&page=${page}`);
}

async function main() {
  console.log('Downloading Steam game catalogue from steam-appdb...');
  const catalog = await getJson(CATALOG_URL);

  if (!Array.isArray(catalog)) throw new Error('steam-appdb returned an unexpected format.');

  const games = new Map();
  for (const app of catalog) {
    const id = Number(app.appid);
    const title = typeof app.name === 'string' ? cleanTitle(app.name) : '';
    if (Number.isInteger(id) && id > 0 && title) games.set(id, { id, title, popularity: 0, owners: 0, players: 0 });
  }

  if (games.size < 1000) throw new Error(`Safety check failed: only ${games.size} games received.`);
  console.log(`Loaded ${games.size} games. Fetching public SteamSpy popularity data...`);

  // SteamSpy publishes public popularity/ownership data in pages of roughly 1000 apps.
  // We use it as the ranking signal while retaining every game from steam-appdb.
  for (let page = 0; ; page++) {
    console.log(`Fetching popularity page ${page}...`);
    const data = await getSteamSpyPage(page);
    const entries = Object.values(data || {});
    if (!entries.length) break;

    for (const app of entries) {
      const id = Number(app.appid);
      const game = games.get(id);
      if (!game) continue;

      const owners = Number(String(app.owners || '0').replace(/[^0-9]/g, '')) || 0;
      const players = Number(app.ccu) || 0;
      const reviews = Number(app.positive) + Number(app.negative) || 0;

      // Current players are the strongest signal; estimated ownership and review
      // volume provide stable fallback signals for games with little live traffic.
      game.players = players;
      game.owners = owners;
      game.popularity = players * 1000000 + owners + reviews * 100;
    }

    if (entries.length < 900) break;
    await sleep(BATCH_DELAY_MS);
  }

  const apps = [...games.values()];
  apps.sort((a, b) => b.popularity - a.popularity || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));

  // Keep the popularity fields so the website can explain/display the ranking.
  const output = {
    updatedAt: new Date().toISOString(),
    source: 'Austrum-lab/steam-appdb + SteamSpy public popularity data',
    popularity: 'current players > estimated owners > review volume',
    count: apps.length,
    games: apps
  };

  fs.writeFileSync('steam/games.json', JSON.stringify(output));
  console.log(`Wrote ${apps.length} Steam games, ranked by popularity.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
