const fs = require('fs');

const DATA_FILE = 'steam/games.json';
const MAX_RUNTIME_MS = 9 * 60 * 1000; // hard stop at 9 minutes; leaves workflow headroom
const REQUEST_TIMEOUT_MS = 8000;
const DELAY_MS = 250;
const START = Date.now();

function remaining() { return MAX_RUNTIME_MS - (Date.now() - START); }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getDescription(id) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${id}&l=en&cc=us`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'GamePassDB Steam description updater/1.0' }
    });
    if (!res.ok) return null;
    const json = await res.json();
    const app = json?.[String(id)];
    return app?.success && app.data ? (app.data.short_description || app.data.about_the_game || null) : null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

async function main() {
  if (!fs.existsSync(DATA_FILE)) throw new Error(`${DATA_FILE} does not exist. Run the Steam catalog updater first.`);
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const games = Array.isArray(data) ? data : data.games;
  if (!Array.isArray(games)) throw new Error('Unexpected games.json format.');

  games.sort((a, b) => (Number(b.popularityScore) || 0) - (Number(a.popularityScore) || 0));

  let processed = 0, added = 0, unavailable = 0;
  for (const game of games) {
    if (remaining() <= REQUEST_TIMEOUT_MS + 500) break;
    if (typeof game.description === 'string' && game.description.trim()) continue;

    const description = await getDescription(game.id);
    processed++;
    if (description) { game.description = description; delete game.descriptionStatus; delete game.descriptionCheckedAt; added++; }
    else { game.descriptionStatus = 'unavailable'; game.descriptionCheckedAt = new Date().toISOString(); unavailable++; }

    if (processed % 25 === 0) console.log(`Descriptions: processed=${processed}, added=${added}, unavailable=${unavailable}, remaining=${Math.round(remaining()/1000)}s`);
    if (remaining() > DELAY_MS + REQUEST_TIMEOUT_MS) await sleep(DELAY_MS);
  }

  const output = Array.isArray(data) ? games : { ...data, games };
  fs.writeFileSync(DATA_FILE, JSON.stringify(output));
  console.log(`Finished in ${Math.round((Date.now()-START)/1000)}s: processed=${processed}, added=${added}, unavailable=${unavailable}`);
}

main().catch(err => { console.error(err); process.exit(1); });
