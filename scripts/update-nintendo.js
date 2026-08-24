const fs = require('fs');
const path = require('path');

const ALGOLIA_APP_ID = 'U3B6GR4UA3';
const ALGOLIA_KEY = 'c4da8be7fd29f0f5bfa42920b0a99dc7';
const ALGOLIA_HOST = `https://${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`;
const INDEX = 'ncom_game_en_us';
const PRICE_URL = 'https://api.ec.nintendo.com/v1/price';
const OUTPUT = path.join(__dirname, '..', 'nintendo', 'games.json');
const MIN_GAMES = 1000;
const PAGE_SIZE = 1000;

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

function first(...values) {
  return values.find(v => v !== undefined && v !== null && v !== '');
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') return value.split(/[,|]/).map(s => s.trim()).filter(Boolean);
  return [];
}

function normalizeHit(hit) {
  const nsuid = String(first(hit.nsuid, hit.nsuid_txt?.[0], hit.title_id, hit.id, '') || '');
  const title = String(first(hit.title, hit.name, hit.formal_name, 'Untitled') || 'Untitled').trim();
  const genres = asArray(first(hit.genres, hit.categories?.category, hit.game_categories_txt, hit.game_category));
  const platform = String(first(hit.system, hit.platform, hit.system_name, 'Nintendo Switch') || 'Nintendo Switch');
  const description = String(first(hit.description, hit.description_html, hit.descriptionHTML, hit.long_description, hit.excerpt, hit.summary, '') || '').trim();
  const slug = String(first(hit.slug, hit.url?.split('/').filter(Boolean).pop(), '') || '');
  const price = Number(first(hit.ca_price, hit.eshop_price, hit.price, hit.sale_price, hit.price_regular_f, 0)) || 0;
  const releaseDate = first(hit.release_date, hit.releaseDate, hit.pretty_date_s, hit.release_date_on_eshop, null);
  const image = first(hit.front_box_art, hit.image_url, hit.image, hit.image_url_sq_s, hit.gift_finder_detail_page_image_url_s, null);
  const url = first(hit.url, slug ? `https://www.nintendo.com/us/store/products/${slug}/` : null, null);
  return {
    id: nsuid,
    title,
    description,
    genres,
    platform,
    price,
    currency: 'USD',
    releaseDate,
    developer: first(hit.developer, hit.developer_name, null),
    publisher: first(hit.publisher, hit.publisher_name, null),
    players: first(hit.number_of_players, hit.players, hit.players_to ? `${hit.players_from || 1}-${hit.players_to}` : null, null),
    image,
    url,
    digital: true
  };
}

async function getAllGames() {
  const games = [];
  for (let page = 0; page < 100; page++) {
    const body = {
      requests: [{
        indexName: INDEX,
        params: new URLSearchParams({
          query: '',
          hitsPerPage: String(PAGE_SIZE),
          page: String(page),
          analytics: 'false',
          facets: JSON.stringify(['generalFilters','platform','availability','genres','howToShop','virtualConsole','franchises','priceRange','esrbRating','playerFilters'])
        }).toString()
      }]
    };
    const data = await jsonFetch(ALGOLIA_HOST, {
      method: 'POST',
      headers: {'content-type': 'application/json', 'x-algolia-application-id': ALGOLIA_APP_ID, 'x-algolia-api-key': ALGOLIA_KEY},
      body: JSON.stringify(body)
    });
    const result = data.results?.[0];
    const hits = result?.hits || [];
    games.push(...hits.map(normalizeHit).filter(g => g.id && g.title));
    console.log(`Catalog page ${page + 1}: ${hits.length} games (${games.length} total)`);
    if (!hits.length || page + 1 >= (result?.nbPages || 1)) break;
  }
  return games;
}

async function enrichCanadianPrices(games) {
  // Nintendo's public price endpoint is queried in batches. If it is unavailable,
  // keep the catalog rather than failing the entire update.
  const ids = games.map(g => g.id).filter(id => /^\d{10,}$/.test(id));
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    try {
      const url = `${PRICE_URL}?country=CA&ids=${batch.join(',')}&lang=en`;
      const data = await jsonFetch(url);
      const byId = new Map((data.prices || []).map(p => [String(p.title_id), p]));
      for (const game of games) {
        const p = byId.get(game.id);
        const raw = p?.discount_price?.raw_value ?? p?.regular_price?.raw_value;
        if (raw !== undefined && raw !== null && raw !== '') {
          game.price = Number(raw) || 0;
          game.currency = 'CAD';
        }
      }
    } catch (err) {
      console.warn(`Canadian price batch ${i / 50 + 1} skipped: ${err.message}`);
    }
  }
  return games;
}

async function main() {
  console.log('Fetching public Nintendo digital catalog...');
  let games = await getAllGames();
  games = await enrichCanadianPrices(games);
  games = Array.from(new Map(games.map(g => [g.id, g])).values());
  if (games.length < MIN_GAMES) throw new Error(`Safety check failed: only ${games.length} games found; refusing to replace catalog.`);
  const withRequired = games.filter(g => g.title && g.id && g.genres.length >= 0 && g.image && g.url);
  if (withRequired.length < MIN_GAMES) throw new Error(`Safety check failed: only ${withRequired.length} games have required catalog fields.`);
  const output = { updatedAt: new Date().toISOString(), region: 'CA', source: 'Nintendo eShop public catalog', games };
  fs.mkdirSync(path.dirname(OUTPUT), {recursive: true});
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
  console.log(`Wrote ${games.length} Nintendo digital games to ${OUTPUT}`);
}

main().catch(err => { console.error(err); process.exit(1); });
