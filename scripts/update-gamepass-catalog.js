const fs = require('fs');
const { chromium } = require('playwright');

const MARKET = 'CA';
const LANGUAGE = 'en-ca';
const SIGL = { all: '29a81209-df6f-41fd-a528-2ae6b91f719c', console: 'f6f1f99f-9b49-4ccd-b3bf-4d9767a77f5e', pc: 'fdd9e2a7-0fee-49f6-ad69-4354098401ff' };
const SIGL_URL = 'https://catalog.gamepass.com/sigls/v2';
const PRODUCT_URL = 'https://displaycatalog.mp.microsoft.com/v7.0/products';
const ID_AT_XBOX_URL = 'https://www.xbox.com/en-CA/games/id';

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
async function getSiglIds(id) { const data = await getJson(`${SIGL_URL}?id=${id}&language=${LANGUAGE}&market=${MARKET}`); return [...new Set((Array.isArray(data) ? data : []).map(x => x.id).filter(Boolean))]; }
async function getOfficialIndieTitles() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ locale: LANGUAGE });
    await page.goto(ID_AT_XBOX_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    const titles = await page.locator('a[href*="/games/store/"]').evaluateAll(links => links.map(link => (link.textContent || '').replace(/quick look/ig, '').trim()).filter(text => text.length >= 2 && text.length <= 120));
    return [...new Set(titles)];
  } catch (error) { console.warn(`Could not read official ID@Xbox page: ${error.message}`); return []; }
  finally { await browser.close(); }
}
function normalizeTitle(title) { return String(title || '').toLowerCase().replace(/[®™©]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' '); }
function chooseCover(images = []) { const poster = images.find(x => x.ImagePurpose === 'Poster'); const portrait = images.find(x => x.Height > x.Width && x.Uri); const fallback = images.find(x => x.Uri); return (poster || portrait || fallback)?.Uri?.replace(/^http:/, 'https:') || ''; }
function extractGenres(product, localized) { const candidates = [...(product.Categories || []), ...(product.Properties?.Categories || []), ...(localized.Categories || [])]; return [...new Set(candidates.map(x => typeof x === 'string' ? x : x.Name || x.CategoryName).filter(Boolean))]; }
function extractPlatforms(product, localized) { const text = JSON.stringify({ product, localized }).toLowerCase(); const platforms = []; if (text.includes('windows') || text.includes('pc')) platforms.push('PC'); if (text.includes('xbox series') || text.includes('xbox one') || text.includes('xbox')) platforms.push('Xbox'); if (text.includes('cloud')) platforms.push('Cloud'); return [...new Set(platforms)]; }
function extractDescription(localized, old = {}) {
  const candidates = [localized.ProductDescription, localized.Description, localized.LongDescription, localized.ShortDescription, localized.ProductShortDescription, old.description];
  const value = candidates.find(x => typeof x === 'string' && x.trim().length > 0);
  return value ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
}
function readExistingGames() { try { if (!fs.existsSync('games.json')) return new Map(); const data = JSON.parse(fs.readFileSync('games.json', 'utf8')); return new Map((data.games || []).filter(game => game.id).map(game => [game.id, game])); } catch (error) { console.warn(`Could not read existing games.json: ${error.message}`); return new Map(); } }

(async () => {
  console.log(`Fetching Microsoft Game Pass catalog for ${MARKET}/${LANGUAGE}...`);
  const existingGames = readExistingGames();
  const officialIndieTitles = await getOfficialIndieTitles();
  const indieSet = new Set(officialIndieTitles.map(normalizeTitle));
  const lists = {};
  for (const [name, id] of Object.entries(SIGL)) { lists[name] = await getSiglIds(id); console.log(`${name}: ${lists[name].length} product IDs`); }
  const allIds = [...new Set([...lists.all, ...lists.console, ...lists.pc])];
  if (allIds.length < 100) throw new Error(`Only ${allIds.length} product IDs returned. Refusing to overwrite games.json.`);
  const consoleIds = new Set(lists.console), pcIds = new Set(lists.pc), products = [], chunkSize = 20;
  for (let i = 0; i < allIds.length; i += chunkSize) {
    const chunk = allIds.slice(i, i + chunkSize);
    const params = new URLSearchParams({ bigIds: chunk.join(','), market: MARKET, languages: LANGUAGE, 'MS-CV': 'GamePassDB.1' });
    const data = await getJson(`${PRODUCT_URL}?${params}`);
    products.push(...(data.Products || []));
    console.log(`Products: ${Math.min(i + chunkSize, allIds.length)}/${allIds.length}`);
  }
  const fetchedGames = products.map(product => {
    const localized = product.LocalizedProperties?.[0] || {}, id = product.BigId || product.ProductId || product.Id, title = localized.ProductTitle || localized.Title, images = localized.Images || [], platforms = extractPlatforms(product, localized);
    if (id && consoleIds.has(id) && !platforms.includes('Xbox')) platforms.push('Xbox');
    if (id && pcIds.has(id) && !platforms.includes('PC')) platforms.push('PC');
    const genres = extractGenres(product, localized), old = existingGames.get(id), officialIndie = indieSet.has(normalizeTitle(title));
    return { ...(old || {}), id, title, description: extractDescription(localized, old), cover: chooseCover(images) || old?.cover || '', sourceUrl: `https://www.xbox.com/en-CA/games/store/-/${id}`, tiers: old?.tiers || [], platforms, genres, indie: officialIndie || genres.some(g => String(g).toLowerCase() === 'indie'), leavingSoon: old?.leavingSoon ?? false, status: 'active' };
  }).filter(game => game.id && game.title);
  const active = [...new Map(fetchedGames.map(game => [game.id, game])).values()];
  if (active.length < 100) throw new Error(`Only ${active.length} complete products were returned from ${allIds.length} IDs. Refusing to overwrite games.json.`);
  const activeIds = new Set(active.map(game => game.id));
  const removed = [...existingGames.values()].filter(game => game.id && !activeIds.has(game.id)).map(game => ({ ...game, status: 'removed' }));
  const merged = [...active, ...removed];
  fs.writeFileSync('games.json', JSON.stringify({ updatedAt: new Date().toISOString(), source: 'Microsoft Xbox Game Pass catalog APIs + official ID@Xbox collection', market: MARKET, language: LANGUAGE, games: merged }, null, 2) + '\n');
  console.log(`Official indie titles: ${officialIndieTitles.length}`);
  console.log(`Active games: ${active.length}`);
  console.log(`Removed games preserved: ${removed.length}`);
  console.log(`Total games in database: ${merged.length}`);
})();
