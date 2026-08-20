const fs = require('fs');

const MARKET = 'CA';
const LANGUAGE = 'en-ca';
const SIGL = {
  all: '29a81209-df6f-41fd-a528-2ae6b91f719c',
  console: 'f6f1f99f-9b49-4ccd-b3bf-4d9767a77f5e',
  pc: 'fdd9e2a7-0fee-49f6-ad69-4354098401ff'
};
const SIGL_URL = 'https://catalog.gamepass.com/sigls/v2';
const PRODUCT_URL = 'https://displaycatalog.mp.microsoft.com/v7.0/products';

async function getJson(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'GamePassDB/1.0' } });
      if (response.ok) return response.json();
      if (attempt === 3) throw new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}

async function getSiglIds(id) {
  const url = `${SIGL_URL}?id=${id}&language=${LANGUAGE}&market=${MARKET}`;
  const data = await getJson(url);
  return [...new Set((Array.isArray(data) ? data : []).map(x => x.id).filter(Boolean))];
}

function chooseCover(images = []) {
  const poster = images.find(x => x.ImagePurpose === 'Poster');
  const portrait = images.find(x => x.Height > x.Width && x.Uri);
  const fallback = images.find(x => x.Uri);
  return (poster || portrait || fallback)?.Uri?.replace(/^http:/, 'https:') || '';
}

function extractGenres(product, localized) {
  const candidates = [
    ...(product.Categories || []),
    ...(product.Properties?.Categories || []),
    ...(localized.Categories || [])
  ];
  return [...new Set(candidates.map(x => typeof x === 'string' ? x : x.Name || x.CategoryName).filter(Boolean))];
}

function extractPlatforms(product, localized) {
  const text = JSON.stringify({ product, localized }).toLowerCase();
  const platforms = [];
  if (text.includes('windows') || text.includes('pc')) platforms.push('PC');
  if (text.includes('xbox series') || text.includes('xbox one') || text.includes('xbox')) platforms.push('Xbox');
  if (text.includes('cloud')) platforms.push('Cloud');
  return [...new Set(platforms)];
}

function readExistingGames() {
  try {
    if (!fs.existsSync('games.json')) return new Map();
    const data = JSON.parse(fs.readFileSync('games.json', 'utf8'));
    return new Map((data.games || []).filter(game => game.id).map(game => [game.id, game]));
  } catch (error) {
    console.warn(`Could not read existing games.json: ${error.message}`);
    return new Map();
  }
}

(async () => {
  console.log(`Fetching Microsoft Game Pass catalog for ${MARKET}/${LANGUAGE}...`);

  const existingGames = readExistingGames();
  console.log(`Existing games loaded: ${existingGames.size}`);

  const lists = {};
  for (const [name, id] of Object.entries(SIGL)) {
    lists[name] = await getSiglIds(id);
    console.log(`${name}: ${lists[name].length} product IDs`);
  }

  const allIds = [...new Set([...lists.all, ...lists.console, ...lists.pc])];
  if (allIds.length < 100) {
    throw new Error(`Only ${allIds.length} product IDs returned. Refusing to overwrite games.json.`);
  }

  const consoleIds = new Set(lists.console);
  const pcIds = new Set(lists.pc);
  const products = [];
  const chunkSize = 20;

  for (let i = 0; i < allIds.length; i += chunkSize) {
    const chunk = allIds.slice(i, i + chunkSize);
    const params = new URLSearchParams({
      bigIds: chunk.join(','),
      market: MARKET,
      languages: LANGUAGE,
      'MS-CV': 'GamePassDB.1'
    });
    const data = await getJson(`${PRODUCT_URL}?${params}`);
    products.push(...(data.Products || []));
    console.log(`Products: ${Math.min(i + chunkSize, allIds.length)}/${allIds.length}`);
  }

  const fetchedGames = products.map(product => {
    const localized = product.LocalizedProperties?.[0] || {};
    const id = product.BigId || product.ProductId || product.Id;
    const title = localized.ProductTitle || localized.Title;
    const images = localized.Images || [];
    const platforms = extractPlatforms(product, localized);
    if (id && consoleIds.has(id) && !platforms.includes('Xbox')) platforms.push('Xbox');
    if (id && pcIds.has(id) && !platforms.includes('PC')) platforms.push('PC');
    const genres = extractGenres(product, localized);
    const old = existingGames.get(id);

    return {
      ...(old || {}),
      id,
      title,
      cover: chooseCover(images) || old?.cover || '',
      sourceUrl: `https://www.xbox.com/en-CA/games/store/-/${id}`,
      tiers: old?.tiers || [],
      platforms,
      genres,
      indie: old?.indie ?? genres.some(g => g.toLowerCase() === 'indie'),
      leavingSoon: old?.leavingSoon ?? false,
      status: 'active'
    };
  }).filter(game => game.id && game.title);

  const active = [...new Map(fetchedGames.map(game => [game.id, game])).values()];
  if (active.length < 100) {
    throw new Error(`Only ${active.length} complete products were returned from ${allIds.length} IDs. Refusing to overwrite games.json.`);
  }

  const activeIds = new Set(active.map(game => game.id));
  const removed = [...existingGames.values()]
    .filter(game => game.id && !activeIds.has(game.id))
    .map(game => ({ ...game, status: 'removed' }));

  const merged = [...active, ...removed];
  const output = {
    updatedAt: new Date().toISOString(),
    source: 'Microsoft Xbox Game Pass catalog APIs',
    market: MARKET,
    language: LANGUAGE,
    games: merged
  };

  fs.writeFileSync('games.json', JSON.stringify(output, null, 2) + '\n');
  console.log(`Active games: ${active.length}`);
  console.log(`Removed games preserved: ${removed.length}`);
  console.log(`Total games in database: ${merged.length}`);
  console.log(`Successfully wrote games.json without deleting rating/history fields.`);
})();
