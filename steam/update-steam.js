const fs = require('fs');

const SOURCE_URL = 'https://raw.githubusercontent.com/Austrum-lab/steam-appdb/master/data/game.json';

function cleanTitle(value) {
  return value.normalize('NFKC')
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D_]+/g, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/[|¦]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  console.log('Downloading Steam game catalogue from steam-appdb...');
  const res = await fetch(SOURCE_URL, { headers: { 'User-Agent': 'GamePassDB SteamDB catalog updater/1.0' } });
  if (!res.ok) throw new Error(`steam-appdb returned HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('steam-appdb returned an unexpected format; expected an array.');

  const games = new Map();
  for (const app of data) {
    const id = Number(app.appid);
    const title = typeof app.name === 'string' ? cleanTitle(app.name) : '';
    if (Number.isInteger(id) && id > 0 && title) games.set(id, { id, title });
  }
  const apps = [...games.values()];
  if (apps.length < 1000) throw new Error(`Safety check failed: only ${apps.length} games were received.`);

  const STEAMSPY_URL = 'https://steamspy.com/api.php?request=appdetails&appid=';
  const BATCH_SIZE = 50;
  const DELAY_MS = 1000;

  async function getDetails(id) {
    try {
      const r = await fetch(`${STEAMSPY_URL}${id}`, { headers: { 'User-Agent': 'GamePassDB SteamDB updater/1.0' } });
      if (!r.ok) return null;
      const d = await r.json();
      if (!d || d.success === false) return null;

      const owners = Number(String(d.owners || '0').replace(/[^0-9]/g, '')) || 0;
      const positive = Number(d.positive) || 0;
      const negative = Number(d.negative) || 0;
      const players = Number(d.players_forever) || 0;
      const reviews = positive + negative;
      const rating = reviews > 0 ? positive / reviews : 0;
      const popularityScore = Math.round(owners * 10 + players * 25 + reviews * 100 * rating);

      // SteamSpy commonly exposes price in cents and discount as a percentage.
      let priceCents = null;
      if (Number.isFinite(Number(d.price))) priceCents = Number(d.price);
      else if (Number.isFinite(Number(d.initialprice))) priceCents = Number(d.initialprice);
      const discount = Number.isFinite(Number(d.discount)) ? Number(d.discount) : 0;

      return {
        popularityScore,
        priceCents,
        discount,
        owners: d.owners || null,
        reviews,
        positive,
        negative
      };
    } catch {
      return null;
    }
  }

  console.log(`Collecting popularity and price data for ${apps.length} games...`);
  let enriched = 0;
  for (let i = 0; i < apps.length; i += BATCH_SIZE) {
    const batch = apps.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async game => ({ game, details: await getDetails(game.id) })));
    for (const { game, details } of results) {
      game.popularityScore = details?.popularityScore ?? 0;
      game.priceCents = details?.priceCents ?? null;
      game.discount = details?.discount ?? 0;
      game.owners = details?.owners ?? null;
      game.reviews = details?.reviews ?? 0;
      game.positive = details?.positive ?? 0;
      game.negative = details?.negative ?? 0;
      if (details) enriched++;
    }
    console.log(`Enriched: ${Math.min(i + BATCH_SIZE, apps.length)}/${apps.length} (${enriched} with public data)`);
    if (i + BATCH_SIZE < apps.length) await new Promise(resolve => setTimeout(resolve, DELAY_MS));
  }

  apps.sort((a, b) => b.popularityScore - a.popularityScore || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  apps.forEach((game, index) => { game.rank = index + 1; });

  const output = {
    updatedAt: new Date().toISOString(),
    source: 'Austrum-lab/steam-appdb + SteamSpy public popularity/price data',
    count: apps.length,
    enrichedCount: enriched,
    games: apps
  };
  fs.writeFileSync('steam/games.json', JSON.stringify(output));
  console.log(`Wrote ${apps.length} ranked Steam games to steam/games.json.`);
}

main().catch(err => { console.error(err); process.exit(1); });
