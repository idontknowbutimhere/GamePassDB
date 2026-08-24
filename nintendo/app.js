const state = { games: [], filtered: [], page: 1, size: 48 };
const el = id => document.getElementById(id);
const norm = v => String(v ?? '').trim().toLowerCase();
const genres = g => Array.isArray(g.genres) ? g.genres : (g.genres ? [g.genres] : []);
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

function fillGenres() {
  const set = new Set();
  state.games.forEach(g => genres(g).forEach(x => { if (String(x).trim()) set.add(String(x).trim()); }));
  [...set].sort().forEach(x => el('genre').insertAdjacentHTML('beforeend', `<option>${esc(x)}</option>`));
}

function apply() {
  const text = norm(el('search').value);
  const platform = norm(el('platform').value);
  const genre = norm(el('genre').value);
  const price = el('price').value;
  state.filtered = state.games.filter(g => {
    if (text && !norm([g.title, g.description, g.developer, g.publisher].join(' ')).includes(text)) return false;
    if (platform && !norm(g.platform).includes(platform)) return false;
    if (genre && !genres(g).some(x => norm(x) === genre)) return false;
    const p = Number(g.price) || 0;
    if (price === 'free' && p !== 0) return false;
    if (price === 'under20' && !(p > 0 && p < 20)) return false;
    if (price === '20to40' && !(p >= 20 && p <= 40)) return false;
    if (price === 'over40' && p <= 40) return false;
    return true;
  });
  state.page = 1;
  render();
}

function render() {
  const start = (state.page - 1) * state.size;
  const items = state.filtered.slice(start, start + state.size);
  const pages = Math.max(1, Math.ceil(state.filtered.length / state.size));
  el('status').style.display = items.length ? 'none' : 'block';
  el('games').innerHTML = items.map(g => `<a class='game' href='${g.url || '#'}' target='_blank' rel='noopener'><img loading='lazy' src='${g.image || ''}' alt=''><div class='body'><div class='title'>${esc(g.title)}</div><div class='meta'>${esc(g.platform || 'Nintendo eShop')}</div><div class='price'>${Number(g.price) > 0 ? esc(g.currency || 'CAD') + ' $' + Number(g.price).toFixed(2) : 'Free'}</div></div></a>`).join('');
  el('page').textContent = `Page ${state.page} / ${pages}`;
  el('prev').disabled = state.page <= 1;
  el('next').disabled = state.page >= pages;
}

async function init() {
  try {
    const r = await fetch('./games.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    state.games = Array.isArray(d.games) ? d.games : d;
    fillGenres();
    state.filtered = state.games;
    render();
  } catch (e) {
    el('status').textContent = 'Nintendo catalog is not available yet. Run the updater from GitHub Actions to populate it.';
    console.error(e);
  }
}
['platform','genre','price'].forEach(id => el(id).addEventListener('change', apply));
el('search').addEventListener('input', apply);
el('prev').onclick = () => { if (state.page > 1) { state.page--; render(); } };
el('next').onclick = () => { if (state.page < Math.ceil(state.filtered.length / state.size)) { state.page++; render(); } };
init();
