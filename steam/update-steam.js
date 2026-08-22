const fs = require('fs');

const SOURCE_URL = 'https://raw.githubusercontent.com/Austrum-lab/steam-appdb/master/data/game.json';

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
    const title = typeof app.name === 'string' ? app.name.trim() : '';

    if (Number.isInteger(id) && id > 0 && title) {
      games.set(id, { id, title });
    }
  }

  const apps = [...games.values()];
  apps.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));

  if (apps.length < 1000) {
    throw new Error(`Safety check failed: only ${apps.length} games were received. Refusing to replace the catalogue.`);
  }

  const output = {
    updatedAt: new Date().toISOString(),
    source: 'Austrum-lab/steam-appdb — data/game.json',
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
