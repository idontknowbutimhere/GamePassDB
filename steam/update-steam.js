const fs = require('fs');

async function main() {
  const res = await fetch('https://api.steampowered.com/ISteamApps/GetAppList/v2/');
  if (!res.ok) throw new Error(`Steam API returned HTTP ${res.status}`);
  const json = await res.json();
  const apps = (json.applist?.apps || [])
    .filter(app => Number.isInteger(Number(app.appid)) && app.name)
    .map(app => ({ id: Number(app.appid), title: app.name }));

  apps.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  const output = {
    updatedAt: new Date().toISOString(),
    source: 'Steam Web API — ISteamApps/GetAppList',
    count: apps.length,
    games: apps
  };
  fs.writeFileSync('steam/games.json', JSON.stringify(output));
  console.log(`Wrote ${apps.length} Steam apps`);
}
main().catch(err => { console.error(err); process.exit(1); });
