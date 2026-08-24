const fs = require('fs');
const DATA_FILE = 'steam/games.json';
const MAX_RUNTIME_MS = 9 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const DELAY_MS = 250;
const START = Date.now();
function remaining() { return MAX_RUNTIME_MS - (Date.now() - START); }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function getDetails(id) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${id}&l=en&cc=us`, { signal: controller.signal, headers: { 'User-Agent': 'GamePassDB Steam metadata updater/1.0' } });
    if (!res.ok) return null;
    const json = await res.json();
    const app = json?.[String(id)];
    return app?.success && app.data ? app.data : null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}
async function main() {
  if (!fs.existsSync(DATA_FILE)) throw new Error(`${DATA_FILE} does not exist. Run the Steam catalog updater first.`);
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const games = Array.isArray(data) ? data : data.games;
  if (!Array.isArray(games)) throw new Error('Unexpected games.json format.');
  games.sort((a, b) => (Number(b.popularityScore) || 0) - (Number(a.popularityScore) || 0));
  let processed = 0, added = 0, metadataAdded = 0, unavailable = 0;
  for (const game of games) {
    const hasDescription = typeof game.description === 'string' && game.description.trim();
    const hasPlatforms = game.platforms && typeof game.platforms === 'object';
    const hasGenres = Array.isArray(game.genres) && game.genres.length;
    if (hasDescription && hasPlatforms && hasGenres) continue;
    if (remaining() <= REQUEST_TIMEOUT_MS + 500) break;
    const details = await getDetails(game.id);
    processed++;
    if (details) {
      const description = details.short_description || details.about_the_game || null;
      if (!hasDescription && description) { game.description = description; added++; }
      if (Array.isArray(details.genres) && details.genres.length) { game.genres = details.genres.map(x => typeof x === 'string' ? x : x?.description).filter(Boolean); metadataAdded++; }
      if (details.platforms && typeof details.platforms === 'object') { game.platforms = { windows: details.platforms.windows === true, mac: details.platforms.mac === true, linux: details.platforms.linux === true }; metadataAdded++; }
      delete game.descriptionStatus; delete game.descriptionCheckedAt;
    } else if (!hasDescription) { game.descriptionStatus = 'unavailable'; game.descriptionCheckedAt = new Date().toISOString(); unavailable++; }
    if (processed % 25 === 0) console.log(`Metadata: processed=${processed}, descriptions=${added}, metadata=${metadataAdded}, unavailable=${unavailable}, remaining=${Math.round(remaining()/1000)}s`);
    if (remaining() > DELAY_MS + REQUEST_TIMEOUT_MS) await sleep(DELAY_MS);
  }
  const output = Array.isArray(data) ? games : { ...data, games };
  fs.writeFileSync(DATA_FILE, JSON.stringify(output));
  console.log(`Finished in ${Math.round((Date.now()-START)/1000)}s: processed=${processed}, descriptions=${added}, metadata=${metadataAdded}, unavailable=${unavailable}`);
}
main().catch(err => { console.error(err); process.exit(1); });