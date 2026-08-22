const fs = require('fs');

const SOURCE_URL = 'https://raw.githubusercontent.com/Austrum-lab/steam-appdb/master/data/game.json';

function cleanTitle(value) {
  return value
    .normalize('NFKC')
    // Replace Unicode dash variants and underscores with spaces.
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D_]+/g, ' ')
    // Remove other control/format characters and most symbol noise.
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    // Convert common separators to spaces.
    .replace(/[|¦]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  console.log('Downloading Steam game catalogue from steam-appdb...');

  const res = await fetch(SOURCE_URL, {
    headers: { 'User-Agent': 'GamePassDB SteamDB catalog updater/1.0' }
  });

  if (!res.ok) {
    throw new Error(`steam-appdb returned HTTP ${res.status}`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error('steam-appdb returned an unexpected format; expected an array.');
  }

  const games = new Map();
  for (const app of data) {
    const id = Number(app.appid);
    const title = typeof app.name === 'string' ? cleanTitle(app.name) : '';
    if (Number.isInteger(id) && id > 0 && title) games.set(id, { id, title });
  }

  const apps = [...games.values()];
  if (apps.length < 1000) {
    throw new Error(`Safety check failed: only ${apps.length} games were received.`);
  }

  // Popularity is obtained from SteamSpy's public, keyless endpoint in batches.
  // SteamSpy does not cover every Steam title, so unknown titles stay in the
  // catalogue with popularityScore 0 and appear after ranked titles.
  const STEAMSPY_URL = 'https://steamspy.com/api.php?request=appdetails&appid=';
  const BATCH_SIZE = 50;
  const DELAY_MS = 1000;

  async function getPopularity(id) {
    try {
      const r = await fetch(`${STEAMSPY_URL}${id}`, {
        headers: { 'User-Agent': 'GamePassDB SteamDB popularity updater/1.0' }
      });
      if (!r.ok) return null;
      const d = await r.json();
      if (!d || d.success === false) return null;

      const owners = Number(String(d.owners || '0').replace(/[^0-9]/g, '')) || 0;
      const positive = Number(d.positive) || 0;
      const negative = Number(d.negative) || 0;
      const players = Number(d.players_forever) || 0;
      const rating = positive + negative > 0 ? positive / (positive + negative) : 0;

      // Stable popularity score: owners are the strongest signal, with
      // reviews/current lifetime players providing additional separation.
      return Math.round(owners * 10 + players * 25 + (positive + negative) * 100 * rating);
    } catch {
      return null;
    }
  }

  console.log(`Ranking ${apps.length} games by public SteamSpy popularity data...`);
  let ranked = 0;

  for (let i = 0; i < apps.length; i += BATCH_SIZE) {
    const batch = apps.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async game => ({ game, score: await getPopularity(game.id) })));

    for (const { game, score } of results) {
      game.popularityScore = score ?? 0;
      if (score !== null) ranked++;
    }

    console.log(`Popularity: ${Math.min(i + BATCH_SIZE, apps.length)}/${apps.length} (${ranked} ranked)`);
    if (i + BATCH_SIZE < apps.length) await new Promise(resolve => setTimeout(resolve, DELAY_MS));
  }

  apps.sort((a, b) => {
    if (b.popularityScore !== a.popularityScore) return b.popularityScore - a.popularityScore;
    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  });

  const output = {
    updatedAt: new Date().toISOString(),
    source: 'Austrum-lab/steam-appdb + SteamSpy public popularity data',
    count: apps.length,
    rankedCount: ranked,
    games: apps
  };

  fs.writeFileSync('steam/games.json', JSON.stringify(output));
  console.log(`Wrote ${apps.length} Steam games to steam/games.json; ${ranked} received popularity data.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
