const fs = require('fs');
const { execFileSync } = require('child_process');

const DATA_FILE = 'steam/games.json';
const MAX_RUNTIME_MS = 9 * 60 * 30 * 1000; // leave ~30s for writing/commit
const REQUEST_TIMEOUT_MS = 8000;
const DELAY_MS = 250;
const START = Date.now();

function remaining() {
  return MAX_RUNTIME_MS - (Date.now() - START);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getDescription(id) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${id}&l=en&cc=us`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'GamePassDB Steam description updater/1.0' }
    });
    if (!res.ok) return null;
    const json = await res.json();
    const app = json?.[String(id)];
    if (!app?.success || !app.data) return null;
    return app.data.short_description || app.data.about_the_game || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  if (!fs.existsSync(DATA_FILE)) throw new Error(`${DATA_FILE} does not exist. Run the Steam catalog updater first.`);

  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const games = Array.isArray(data) ? data : data.games;
  if (!Array.isArray(games)) throw new Error('Unexpected games.json format.');

  // Popularity first, then everything else. This means the useful games get
  // descriptions first and the worker eventually reaches the obscure titles.
  games.sort((a, b) => (Number(b.popularityScore) || 0) - (Number(a.popularityScore) || 0));

  let processed = 0;
  let added = 0;
  let failed = 0;

  for (const game of games) {
    if (remaining() <= 0) break;
    if (typeof game.description === 'string' && game.description.trim()) continue;

    const description = await getDescription(game.id);
    processed++;

    if (description) {
      game.description = description;
      added++;
    } else {
      // Remember failures so a permanently unavailable app isn't hammered on
      // every run. The timestamp allows a future retry if desired.
      game.descriptionStatus = 'unavailable';
      game.descriptionCheckedAt = new Date().toISOString();
      failed++;
    }

    if (processed % 25 === 0) {
      console.log(`Descriptions: processed ${processed}, added ${added}, unavailable ${failed}, remaining time ${Math.round(remaining()/1000)}s`);
    }

    if (remaining() > DELAY_MS) await sleep(DELAY_MS);
  }

  const output = Array.isArray(data) ? games : { ...data, games };
  fs.writeFileSync(DATA_FILE, JSON.stringify(output));
  console.log(`Description worker finished: processed=${processed}, added=${added}, unavailable=${failed}, time=${Math.round((Date.now()-START)/1000)}s`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
