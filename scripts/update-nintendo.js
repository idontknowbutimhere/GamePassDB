const fs = require('fs');
const path = require('path');

// Nintendo's public Algolia endpoint now rejects server-side requests (403).
// Use the public TitleDB mirror instead. Nlib documents TitleDB as its source
// for Switch metadata, and TitleDB publishes a Canadian CA.en.json catalog.
const CATALOG_URLS = [
  'https://raw.githubusercontent.com/blawar/titledb/master/CA.en.json',
  'https://raw.githubusercontent.com/blawar/titledb/master/US.en.json'
];
const PRICE_URL = 'https://api.ec.nintendo.com/v1/price';
const OUTPUT = path.join(__dirname, '..', 'nintendo', 'games.json');
const MIN_GAMES = 1000;

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

function first(...values) {
  return values.find(v => v !== undefined && v !== null && v !== '');
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value.flatMap(v => {
      if (typeof v === 'string') return [v];
      if (v && typeof v === 'object') return [first(v.name, v.title, v.label)].filter(Boolean);
      return [];
    }).filter(Boolean);
  }
  if (typeof value === 'string') return value.split(/[,|]/).map(s => s.trim()).filter(Boolean);
  return [];
}

function normalizeBool(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  return ['true', '1', 'yes', 'y'].includes(String(value).trim().toLowerCase());
}

function normalizeReleaseDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const s = String(value);
    if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return String(value);
}

function normalizeHit(nsuid, hit) {
  const id = String(first(hit.id, hit.titleId, hit.title_id, hit.nsuid, nsuid, '') || '');
  const title = String(first(hit.name, hit.title, hit.formal_name, hit.title_name, 'Untitled') || 'Untitled').trim();
  const genres = asArray(first(hit.category, hit.categories, hit.genres, hit.game_categories_txt, hit.game_category, hit.genre));
  const description = String(first(hit.description, hit.description_html, hit.descriptionHTML, hit.intro, hit.summary, hit.excerpt, '') || '').trim();
  const image = first(hit.frontBoxArt, hit.front_box_art, hit.iconUrl, hit.icon_url, hit.image_url_sq_s, hit.image_url_sq, hit.image, null);
  const banner = first(hit.bannerUrl, hit.banner_url, hit.hero_banner_url, hit.image_url_wide, null);
  const screenshots = asArray(hit.screenshots);
  const releaseDate = normalizeReleaseDate(first(hit.releaseDate, hit.release_date, hit.release_date_on_eshop, hit.release_date_on_eshop_s));
  const platform = 'Nintendo Switch';
  const url = `https://www.nintendo.com/en-ca/store/products/${encodeURIComponent(title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}/`;

  return {
    id,
    title,
    description,
    genres,
    platform,
    price: 0,
    currency: 'CAD',
    releaseDate,
    developer: first(hit.developer, hit.developer_name, null),
    publisher: first(hit.publisher, hit.publisher_name, null),
    players: first(hit.numberOfPlayers, hit.number_of_players, hit.players, hit.players_to ? `${hit.players_from || 1}-${hit.players_to}` : null),
    image,
    banner,
    screenshots,
    url,
    nsuid: String(first(hit.nsuid, hit.nsuId, nsuid, '') || ''),
    digital: true,
    available: !normalizeBool(first(hit.is_unavailable, hit.unavailable, false)),
    isDemo: normalizeBool(hit.isDemo ?? hit.is_demo),
    type: first(hit.type, 'base')
  };
}

async function fetchCatalog(url) {
  console.log(`Downloading ${url} ...`);
  const data = await jsonFetch(url);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Catalog response is not an object');

  const games = [];
  for (const [nsuid, hit] of Object.entries(data)) {
    if (!hit || typeof hit !== 'object') continue;
    const game = normalizeHit(nsuid, hit);
    if (!game.id || !game.title) continue;
    if (game.isDemo) continue;
    // Keep actual base games/software. DLC and updates are not useful as catalog games.
    if (['dlc', 'update', 'patch'].includes(String(game.type).toLowerCase())) continue;
    games.push(game);
  }

  const unique = Array.from(new Map(games.map(g => [g.id, g])).values());
  console.log(`Catalog source returned ${unique.length} usable digital games.`);
  return unique;
}

async function getAllGames() {
  let lastError = null;
  for (const url of CATALOG_URLS) {
    try {
      const games = await fetchCatalog(url);
      if (games.length >= MIN_GAMES) return { games, source: url };
      console.warn(`${url} returned only ${games.length} usable games; trying fallback.`);
    } catch (err) {
      lastError = err;
      console.warn(`${url} unavailable: ${err.message}`);
    }
  }
  throw new Error(`No usable Nintendo digital catalog. ${lastError ? lastError.message : 'All sources were too small.'}`);
}

async function enrichCanadianPrices(games) {
  const ids = games.map(g => g.nsuid).filter(id => /^\d{10,}$/.test(id));
  const totalBatches = Math.ceil(ids.length / 50);

  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    try {
      const data = await jsonFetch(`${PRICE_URL}?country=CA&ids=${batch.join(',')}&lang=en`);
      const byId = new Map((data.prices || []).map(p => [String(p.title_id), p]));
      for (const game of games) {
        const p = byId.get(game.nsuid);
        const raw = p?.discount_price?.raw_value ?? p?.regular_price?.raw_value;
        if (raw !== undefined && raw !== null && raw !== '') game.price = Number(raw) || 0;
        if (p?.regular_price?.currency) game.currency = p.regular_price.currency;
        if (p?.sales_status) game.salesStatus = p.sales_status;
      }
      console.log(`Prices: batch ${Math.floor(i / 50) + 1}/${totalBatches}`);
    } catch (err) {
      console.warn(`Canadian price batch ${Math.floor(i / 50) + 1} skipped: ${err.message}`);
    }
  }
  return games;
}

async function main() {
  console.log('Fetching public Nintendo eShop digital catalog from TitleDB...');
  const result = await getAllGames();
  let games = await enrichCanadianPrices(result.games);
  games = Array.from(new Map(games.map(g => [g.id, g])).values());

  if (games.length < MIN_GAMES) throw new Error(`Safety check failed: only ${games.length} games found.`);

  const valid = games.filter(g => g.title && g.id && g.image && g.nsuid);
  if (valid.length < MIN_GAMES) throw new Error(`Safety check failed: only ${valid.length} games have required catalog fields.`);

  // Only write after all validation succeeds. A bad upstream source can never wipe the old catalog.
  const output = {
    updatedAt: new Date().toISOString(),
    region: 'CA',
    platform: 'Nintendo Switch digital store',
    source: `Nintendo Switch TitleDB (${result.source})`,
    games
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
  console.log(`Wrote ${games.length} Nintendo digital games to ${OUTPUT}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});