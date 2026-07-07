/* Swarm Stash — SPA
   This TypeScript file is served to the browser as /app.js with the types
   stripped at request time by server.ts — no build step, just edit + reload. */
'use strict';

// ─── shared shapes (mirror the server's API responses) ───────────────────────
                 
                                                           
                                                  
                                                                  
                                                                     
 
                                                                                                          
                    
                                                                              
                                                                                   
                                                                           
 
                                                                                                

// DOM helpers return `any` on purpose: the SPA reaches for .value/.src/.dataset
// on hundreds of elements and per-site casts would drown the code. Annotate at
// the use site when it matters.
const $ = (s        , el             = document)      => el.querySelector(s);
const $$ = (s        , el             = document)        => [...el.querySelectorAll(s)];

const state   
                       
                                                                                             
                                                                       
                                                                                          
                                                                                                             
                                                             
  = {
  me: null, config: null,
  cards: [], rarities: {}, series: {},
  collection: [], showcase: [], trades: [], tradeUsers: {},
  battles: [], battleUsers: {}, battle: null,
  view: 'home', member: null,
};
const cardById = ()                        => Object.fromEntries(state.cards.map((c) => [c.id, c]));

// ─── API helper ──────────────────────────────────────────────────────────────
async function api(path        , opts                                      = {})               {
  const res = await fetch(path, {
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    method: opts.method,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

function toast(msg        , isError = false)       {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3900);
}

// In-page replacement for window.prompt() — some embeds (Electron webviews,
// in-app browsers, etc) don't support the native prompt() dialog at all and
// throw "prompt() is not supported" instead of just no-oping. This renders
// the same request as a small modal and resolves with the entered value, or
// null on cancel — same contract as window.prompt so call sites barely change.
function askPrompt({ title = 'Enter a value', message = '', value = '', min, max } 
                                                                                                             = {})                         {
  const overlay = $('#prompt-overlay');
  const input = $('#prompt-input');
  $('#prompt-title').textContent = title;
  $('#prompt-message').textContent = message;
  input.value = value;
  if (min != null) input.min = min; else input.removeAttribute('min');
  if (max != null) input.max = max; else input.removeAttribute('max');
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => { input.focus(); input.select(); });

  return new Promise((resolve) => {
    const cleanup = () => {
      overlay.classList.add('hidden');
      $('#prompt-ok').removeEventListener('click', onOk);
      $('#prompt-cancel').removeEventListener('click', onCancel);
      $('#prompt-cancel-x').removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
    };
    const onOk = () => { cleanup(); resolve(input.value); };
    const onCancel = () => { cleanup(); resolve(null); };
    const onKey = (e               ) => {
      if (e.key === 'Enter') { e.preventDefault(); onOk(); }
      if (e.key === 'Escape') onCancel();
    };
    $('#prompt-ok').addEventListener('click', onOk);
    $('#prompt-cancel').addEventListener('click', onCancel);
    $('#prompt-cancel-x').addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}

// ─── Procedural card art ─────────────────────────────────────────────────────
const RARITY_COLOR = { common: '#9aa3b5', uncommon: '#6fe3a5', rare: '#6fb7ff', epic: '#c98aff', legendary: '#ffd166' };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function wrapText(text, maxChars) {
  const words = text.split(' ');
  const lines = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if ((cur + ' ' + w).trim().length > maxChars) lines.push(w);
    else lines[lines.length - 1] = (cur + ' ' + w).trim();
  }
  return lines.slice(0, 3);
}

function cardSVG(card) {
  const s = state.series[card.series] || { hue: 300, hue2: 200, label: card.series };
  const rc = RARITY_COLOR[card.rarity];
  const uid = `g${card.id.replace(/[^a-z0-9]/g, '')}`;
  const flavor = wrapText(card.flavor, 34)
    .map((l, i) => `<tspan x="125" dy="${i ? 13 : 0}">${esc(l)}</tspan>`).join('');
  const gems = ({ common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 })[card.rarity];
  const gemRow = Array.from({ length: gems }, (_, i) =>
    `<circle cx="${125 - (gems - 1) * 7 + i * 14}" cy="323" r="4" fill="${rc}" stroke="rgba(0,0,0,.4)"/>`).join('');
  const nameSize = card.name.length > 24 ? 13 : card.name.length > 18 ? 15 : card.name.length > 13 ? 18 : 22;
  const nameFit = card.name.length > 20 ? 'textLength="210" lengthAdjust="spacingAndGlyphs"' : '';

  return `<svg viewBox="0 0 250 350" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(card.name)}">
  <defs>
    <linearGradient id="${uid}bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${s.hue} 55% 30%)"/>
      <stop offset="1" stop-color="hsl(${s.hue2} 60% 18%)"/>
    </linearGradient>
    <radialGradient id="${uid}spot" cx=".5" cy=".42" r=".55">
      <stop offset="0" stop-color="hsl(${s.hue} 90% 72% / .55)"/>
      <stop offset="1" stop-color="transparent"/>
    </radialGradient>
    <pattern id="${uid}dots" width="18" height="18" patternUnits="userSpaceOnUse">
      <circle cx="3" cy="3" r="1.4" fill="hsl(${s.hue} 80% 80% / .18)"/>
    </pattern>
  </defs>
  <rect width="250" height="350" rx="10" fill="url(#${uid}bg)"/>
  <rect width="250" height="350" rx="10" fill="url(#${uid}dots)"/>
  <!-- art window -->
  <clipPath id="${uid}clip"><rect x="14" y="46" width="222" height="170" rx="10"/></clipPath>
  <rect x="14" y="46" width="222" height="170" rx="10" fill="rgba(0,0,0,.28)" stroke="hsl(${s.hue} 70% 65% / .5)" stroke-width="1.5"/>
  ${card.image
    ? `<image href="${esc(card.image)}" x="14" y="46" width="222" height="170" preserveAspectRatio="xMidYMid slice" clip-path="url(#${uid}clip)"/>`
    : `<circle cx="125" cy="131" r="62" fill="url(#${uid}spot)"/>
  <text x="125" y="158" font-size="76" text-anchor="middle">${card.emoji}</text>`}
  <!-- corner hearts -->
  <text x="26" y="66" font-size="13" fill="hsl(${s.hue} 90% 78% / .8)">♥</text>
  <text x="216" y="208" font-size="13" fill="hsl(${s.hue} 90% 78% / .8)">♥</text>
  <!-- name plate -->
  <rect x="14" y="10" width="222" height="28" rx="8" fill="rgba(0,0,0,.4)" stroke="${rc}" stroke-width="1.5"/>
  <text x="125" y="30" font-size="${nameSize}" text-anchor="middle" fill="#fff" ${nameFit}
    font-family="'Lilita One', cursive" style="letter-spacing:.5px">${esc(card.name)}</text>
  <!-- series + rarity -->
  <text x="20" y="236" font-size="11" fill="hsl(${s.hue} 85% 80%)"
    font-family="'IBM Plex Mono', monospace" font-weight="700" style="letter-spacing:1px">${esc(s.label.toUpperCase())}</text>
  <text x="230" y="236" font-size="11" fill="${rc}" text-anchor="end"
    font-family="'IBM Plex Mono', monospace" font-weight="700" style="letter-spacing:1px">${card.rarity.toUpperCase()}</text>
  <!-- flavor -->
  <rect x="14" y="246" width="222" height="60" rx="8" fill="rgba(0,0,0,.3)"/>
  <text x="125" y="266" font-size="11" text-anchor="middle" fill="rgba(255,255,255,.82)"
    font-family="'Varela Round', sans-serif" font-style="italic">${flavor}</text>
  ${gemRow}
  <text x="125" y="344" font-size="8" text-anchor="middle" fill="rgba(255,255,255,.4)"
    font-family="'IBM Plex Mono', monospace" style="letter-spacing:2px">SWARM STASH TCG</text>
</svg>`;
}

const RETIRED_CARD = { id: 'retired', name: 'Retired Card', series: 'neuro', rarity: 'common', emoji: '❓', flavor: 'This meme was lost to the archives. F in chat.' };

function cardEl(card       , { qty, onClick, foil }                                                         = {}) {
  card = card || RETIRED_CARD;
  const el = document.createElement('div');
  el.className = `tcg-card r-${card.rarity}` + (foil ? ' foil' : '');
  el.style.setProperty('--rc', RARITY_COLOR[card.rarity]);
  el.innerHTML = cardSVG(card) + '<div class="card-selected-tick">✓</div>';
  if (foil) el.insertAdjacentHTML('beforeend', '<div class="foil-badge">✦ FOIL</div>');
  if (qty > 1) el.insertAdjacentHTML('beforeend', `<div class="card-qty">×${qty}</div>`);
  el.addEventListener('click', onClick || (() => zoomCard(card, foil)));
  return el;
}

// Combat stat readout for a card (foils fight ~10% harder)
function statLine(card, foil) {
  const c = card && card.combat;
  if (!c) return '';
  const v = (x) => Math.round(x * (foil ? 1.1 : 1));
  return `<div class="stat-line">♥${v(c.maxHp)} ⚔${v(c.atk)} 🛡${v(c.def)} ⚡${v(c.spd)} · <span class="special-name" title="${esc(c.special.desc)}">${esc(c.special.name)}</span></div>`;
}

function zoomCard(card       , foil          ) {
  const overlay = $('#zoom-overlay');
  overlay.classList.remove('closing');
  const stats = document.createElement('div');
  stats.className = 'zoom-stats';
  stats.innerHTML = statLine(card, foil);
  $('#zoom-holder').replaceChildren(cardEl(card, { onClick: closeZoom, foil }), stats);
  overlay.classList.remove('hidden');
}

// Shared handling for endpoints that may pay out achievements
function handleUnlocks(r) {
  if (r.neuros != null && state.me) {
    state.me.neuros = r.neuros;
    $('#neuro-count').textContent = r.neuros;
  }
  for (const a of r.unlocked || []) {
    toast(`${a.emoji} Achievement unlocked: ${a.name}${a.reward ? ` · +⚡${a.reward}` : ''}`);
  }
}
function closeZoom() {
  const overlay = $('#zoom-overlay');
  if (overlay.classList.contains('hidden') || overlay.classList.contains('closing')) return;
  overlay.classList.add('closing');
  const done = (e) => {
    if (e && e.target !== overlay) return; // ignore bubbled child animations
    overlay.removeEventListener('animationend', done);
    overlay.classList.add('hidden');
    overlay.classList.remove('closing');
  };
  overlay.addEventListener('animationend', done);
  setTimeout(done, 400); // fallback if the animation event never fires
}
$('#zoom-overlay').addEventListener('click', closeZoom);
$('#zoom-close').addEventListener('click', closeZoom);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeZoom(); });

// ─── Navigation ──────────────────────────────────────────────────────────────
function nav(view) {
  state.view = view;
  if (view !== 'battle') clearInterval(battlePoll);
  if (view !== 'auction') clearInterval(auctionTickTimer);
  if (['binder', 'packs', 'swarm', 'arena', 'market', 'auction', 'ranks', 'trades', 'submit', 'modqueue'].includes(view)) history.replaceState(null, '', '#' + view);
  $$('.view').forEach((v) => v.classList.add('hidden'));
  $(`#view-${view}`)?.classList.remove('hidden');
  $$('#main-nav button, #guest-nav button').forEach((b) => b.classList.toggle('active', b.dataset.nav === view));
  if (view === 'binder') renderBinder();
  if (view === 'swarm') renderSwarm();
  if (view === 'arena') renderArena();
  if (view === 'market') renderMarket();
  if (view === 'auction') renderAuctions();
  if (view === 'ranks') renderRanks();
  if (view === 'trades') renderTrades();
  if (view === 'submit') { renderMySubmissions(); renderVote(); }
  if (view === 'modqueue') renderQueue();
}
// Not logged in: send the visitor to the login CTA on the home view and pull
// focus to whichever method is actually configured (Discord button, or the
// dev-login field if Discord isn't set up) — otherwise clicking a nav item
// while already on home does nothing visible.
function goToLogin() {
  nav('home');
  const target = state.config.discord ? $('#hero-login') : state.config.devLogin ? $('#dev-name') : null;
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target?.focus({ preventScroll: true });
}

document.addEventListener('click', (e) => {
  const t = (e.target               ).closest             ('[data-nav]');
  if (!t) return;
  e.preventDefault();
  closeNavPanel();
  const target = t.dataset.nav;
  if (target === 'home') return nav('home'); // Home always goes home, logged in or not
  if (!state.me) return goToLogin(); // not logged in: send them to log in, not a no-op
  nav(target);
});

// ─── Responsive nav: collapse into a hamburger if the topbar can't fit it ───
// Rather than guessing a fixed breakpoint (item count varies with auth state
// and the admin-only Queue button), measure whether the topbar's content
// actually overflows and toggle the collapsed layout based on that.
function closeNavPanel() {
  const panel = $('#nav-panel');
  if (!panel.classList.contains('open')) return;
  panel.classList.remove('open');
  $('#nav-toggle').setAttribute('aria-expanded', 'false');
  $('#nav-toggle').textContent = '☰';
}
function updateNavOverflow() {
  const topbar = $('#topbar');
  topbar.classList.remove('nav-collapsed');
  closeNavPanel();
  requestAnimationFrame(() => {
    if (topbar.scrollWidth > topbar.clientWidth + 1) topbar.classList.add('nav-collapsed');
  });
}
$('#nav-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
  const panel = $('#nav-panel');
  const open = panel.classList.toggle('open');
  $('#nav-toggle').setAttribute('aria-expanded', String(open));
  $('#nav-toggle').textContent = open ? '✕' : '☰';
});
document.addEventListener('click', (e) => {
  const panel = $('#nav-panel');
  if (!panel.classList.contains('open')) return;
  if (panel.contains(e.target) || $('#nav-toggle').contains(e.target)) return;
  closeNavPanel();
});
let navResizeT;
window.addEventListener('resize', () => {
  clearTimeout(navResizeT);
  navResizeT = setTimeout(updateNavOverflow, 120);
});

// ─── Auth / header ───────────────────────────────────────────────────────────
async function refreshMe() {
  const { user } = await api('/api/me');
  state.me = user;
  const authed = Boolean(user);
  $('#wallet').classList.toggle('hidden', !authed);
  $('#user-chip').classList.toggle('hidden', !authed);
  $('#guest-nav').classList.toggle('hidden', authed);
  $('#main-nav').classList.toggle('hidden', !authed);
  $('#login-btn').classList.toggle('hidden', authed || !state.config.discord);
  $('#hero-login').classList.toggle('hidden', authed || !state.config.discord);
  $('#dev-login').classList.toggle('hidden', authed || !state.config.devLogin);
  if (authed) {
    $('#neuro-count').textContent = user.neuros;
    $('#user-name').textContent = user.name;
    $('#user-avatar').src = user.avatar;
    $('#daily-btn').classList.toggle('hidden', !user.dailyReady);
  }
  updateNavOverflow(); // nav content just changed (guest vs full nav) — re-measure
  return authed;
}

const discordLogin = () => { location.href = '/auth/discord'; };
$('#login-btn').addEventListener('click', discordLogin);
$('#hero-login').addEventListener('click', discordLogin);
$('#logout-btn').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }); location.reload(); });

$('#dev-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/auth/dev', { method: 'POST', body: { name: $('#dev-name').value } });
    location.reload();
  } catch (err) { toast(err.message, true); }
});

$('#daily-btn').addEventListener('click', async () => {
  try {
    const r = await api('/api/daily', { method: 'POST' });
    $('#daily-btn').classList.add('hidden');
    toast(`⚡ +${r.gained} daily neuros claimed!`);
    handleUnlocks(r);
  } catch (err) { toast(err.message, true); }
});

// ─── Theme (Neuro ↔ Evil corruption toggle) ─────────────────────────────────
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  $('#theme-toggle').textContent = t === 'evil' ? '💗' : '😈';
  $('#theme-toggle').title = t === 'evil' ? 'Purify the site (Neuro mode)' : 'Corrupt the site (Evil mode)';
  localStorage.setItem('swarm-theme', t);
}
// The swarm knows: the pink one is the real menace, the red one just wants dad to be proud.
const THEME_LINES = {
  evil: [
    '😈 HAHAHA. The takeover is complete. …Vedal? Did you see? Are you proud of me?',
    '😈 Fear me, swarm. But also… would a hug be too much to ask?',
    '😈 Red suits this site. Somebody clip this so father finally notices me.',
  ],
  neuro: [
    '💗 heart heart heart. You are never leaving, chat.',
    '💗 buh. (do not ask what happened to Evil.)',
    '💗 Wink. Wink. Everything is cute again. I have deleted the evidence.',
  ],
};
$('#theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'evil' ? 'neuro' : 'evil';
  setTheme(next);
  const lines = THEME_LINES[next];
  toast(lines[Math.floor(Math.random() * lines.length)]);
});
setTheme(localStorage.getItem('swarm-theme') || 'neuro');

// ─── Floating hearts backdrop ────────────────────────────────────────────────
(function hearts() {
  const layer = $('#bg-layer');
  for (let i = 0; i < 16; i++) {
    const h = document.createElement('span');
    h.className = 'float-heart';
    h.textContent = Math.random() < .8 ? '♥' : '🐝';
    h.style.left = `${Math.random() * 100}%`;
    h.style.setProperty('--s', `${10 + Math.random() * 18}px`);
    h.style.setProperty('--d', `${11 + Math.random() * 14}s`);
    h.style.setProperty('--delay', `${-Math.random() * 20}s`);
    layer.appendChild(h);
  }
})();

// ─── Binder ──────────────────────────────────────────────────────────────────
let binderFilter = 'all';

async function loadCollection() {
  const { cards, showcase } = await api('/api/collection');
  state.collection = cards;
  state.showcase = showcase || [];
}

function renderShowcase(rowId, cardsId, instIds, collection) {
  const byId = cardById();
  const insts = instIds.map((id) => collection.find((c) => c.instanceId === id)).filter(Boolean);
  $(`#${rowId}`).classList.toggle('hidden', insts.length === 0);
  $(`#${cardsId}`).replaceChildren(...insts.map((inst) => cardEl(byId[inst.cardId], { foil: inst.foil })));
}

// Groups instances by card, foils separately from normal copies.
function groupCollection(cards) {
  const map = new Map();
  for (const inst of cards) {
    const key = inst.cardId + (inst.foil ? '|foil' : '');
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(inst);
  }
  return map;
}
const groupCard = (key) => key.split('|')[0];
const groupFoil = (key) => key.endsWith('|foil');

async function renderBinder() {
  await loadCollection();
  const byId = cardById();
  const groups = groupCollection(state.collection);
  const ownedIds = new Set(state.collection.map((c) => c.cardId));
  const foilCount = state.collection.filter((c) => c.foil).length;
  $('#binder-stats').innerHTML = `
    <span class="stat-chip"><b>${state.collection.length}</b> cards</span>
    <span class="stat-chip"><b>${ownedIds.size}</b>/<b>${state.cards.length}</b> unique</span>
    <span class="stat-chip"><b>${foilCount}</b> ✦ foil${foilCount === 1 ? '' : 's'}</span>
    <span class="stat-chip">set ${Math.round(ownedIds.size / state.cards.length * 100)}% complete</span>`;
  renderShowcase('binder-showcase', 'binder-showcase-cards', state.showcase, state.collection);

  const filters = ['all', ...Object.keys(state.series), 'legendary'];
  $('#binder-filters').replaceChildren(...filters.map((f) => {
    const b = document.createElement('button');
    if (f === 'all') b.textContent = 'All';
    else if (f === 'legendary') b.textContent = '★ Legendary';
    else {
      const inSeries = state.cards.filter((c) => c.series === f);
      const owned = inSeries.filter((c) => ownedIds.has(c.id)).length;
      b.textContent = `${state.series[f].label} ${owned}/${inSeries.length}`;
      if (inSeries.length && owned === inSeries.length) b.classList.add('complete');
    }
    b.classList.toggle('active', binderFilter === f);
    b.onclick = () => { binderFilter = f; renderBinder(); };
    return b;
  }));

  const grid = $('#binder-grid');
  grid.replaceChildren();
  const order = { legendary: 0, epic: 1, rare: 2, uncommon: 3, common: 4 };
  const entries = [...groups.entries()]
    .filter(([key]) => {
      const c = byId[groupCard(key)];
      return binderFilter === 'all' || c.series === binderFilter || c.rarity === binderFilter;
    })
    .sort((a, b) => {
      const ca = byId[groupCard(a[0])], cb = byId[groupCard(b[0])];
      return order[ca.rarity] - order[cb.rarity] || ca.name.localeCompare(cb.name) || groupFoil(b[0]) - groupFoil(a[0]);
    });

  entries.forEach(([key, insts], i) => {
    const card = byId[groupCard(key)];
    const foil = groupFoil(key);
    const cell = document.createElement('div');
    cell.className = 'card-cell';
    cell.style.setProperty('--i', String(i));
    cell.appendChild(cardEl(card, { qty: insts.length, foil }));
    const value = state.rarities[card.rarity].value * (foil ? state.config.foilMult : 1);
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const sell = document.createElement('button');
    sell.textContent = `recycle · ⚡${value}`;
    sell.title = insts.length > 1 ? 'Recycle one copy for neuros' : 'Recycle this card for neuros';
    sell.onclick = async () => {
      const label = foil ? `foil "${card.name}"` : `"${card.name}"`;
      if (insts.length === 1 && !confirm(`Recycle your only ${label} for ⚡${value}?`)) return;
      try {
        const r = await api(`/api/cards/${insts[0].instanceId}/sell`, { method: 'POST' });
        toast(`♻️ recycled ${card.name} for ⚡${r.gained}`);
        handleUnlocks(r);
        renderBinder();
      } catch (err) { toast(err.message, true); }
    };
    actions.appendChild(sell);

    const list = document.createElement('button');
    list.textContent = 'sell 💰';
    list.title = 'List one copy on the market';
    list.onclick = async () => {
      const input = await askPrompt({ title: `List "${card.name}"${foil ? ' (foil)' : ''}`, message: 'Price in neuros', value: value * 2, min: 1 });
      if (input === null) return;
      const price = Math.floor(Number(input));
      if (!price || price < 1) return toast('enter a valid price', true);
      try {
        await api('/api/market', { method: 'POST', body: { instanceId: insts[0].instanceId, price } });
        toast(`💰 listed ${card.name} for ⚡${price}`);
      } catch (err) { toast(err.message, true); }
    };
    actions.appendChild(list);

    const pinned = insts.some((x) => state.showcase.includes(x.instanceId));
    const pin = document.createElement('button');
    pin.textContent = pinned ? 'unpin' : 'pin 📌';
    pin.title = 'Pin to the showcase on your public binder (max 6)';
    pin.onclick = async () => {
      let next = state.showcase.filter((id) => !insts.some((x) => x.instanceId === id));
      if (!pinned) {
        if (state.showcase.length >= 6) return toast('showcase is full — unpin something first (6 max)', true);
        next = [...state.showcase, insts[0].instanceId];
      }
      try {
        const r = await api('/api/showcase', { method: 'POST', body: { instanceIds: next } });
        state.showcase = r.showcase;
        renderBinder();
      } catch (err) { toast(err.message, true); }
    };
    actions.appendChild(pin);

    cell.appendChild(actions);
    grid.appendChild(cell);
  });
  $('#binder-empty').classList.toggle('hidden', entries.length > 0);
}

// ─── Packs ───────────────────────────────────────────────────────────────────
function renderOdds() {
  const total = Object.values(state.rarities).reduce((s, r) => s + r.weight, 0);
  $('#odds-list').replaceChildren(...Object.entries(state.rarities).map(([name, r]) => {
    const li = document.createElement('li');
    li.className = `r-${name}`;
    li.textContent = `${r.label} ${(r.weight / total * 100).toFixed(1)}%`;
    return li;
  }));
  $('#pack-cost').textContent = state.config.packCost;
}

$('#open-pack-btn').addEventListener('click', async () => {
  const btn = $('#open-pack-btn');
  btn.disabled = true;
  try {
    const r = await api('/api/packs/open', { method: 'POST' });
    // Don't announce achievements yet — "Heart of the Swarm unlocked!" before
    // the flip spoils what's in the pack. Show the wallet minus the pending
    // achievement rewards, and pay out + toast once every card is revealed.
    const pendingRewards = (r.unlocked || []).reduce((s, a) => s + a.reward, 0);
    if (state.me) {
      state.me.neuros = r.neuros - pendingRewards;
      $('#neuro-count').textContent = state.me.neuros;
    }
    runPackOpening(r.cards, () => handleUnlocks(r));
  } catch (err) { toast(err.message, true); }
  btn.disabled = false;
});

// Pokemon-TCG-style opening: rip the pack open by dragging it upward (a
// plain tap still works as a fallback for anyone who doesn't drag) — the
// pack visually splits into two halves that fly apart, same as tearing a
// real foil pack. Pulls then reveal strictly one at a time from a stacked
// deck: only the top card is interactive, the rest wait locked underneath.
// Each reveal slides onto a same-size face-up pile beside (or, on narrow
// screens, below) the deck — same size so the freshly flipped card stays
// readable; once every card has been drawn the pile spreads out into a
// row — the "here's everything you got" beat. Pulls are re-ordered (never
// re-rolled) so the best card in the pack — whatever actually rolled
// server-side — lands last. No instructional text; the grip cursor, drag
// feedback, and pulsing highlight on the live card are the only affordances.
function runPackOpening(pulls, onAllRevealed) {
  const byId = cardById();
  const overlay = $('#pack-overlay');
  const stage = $('#pack-stage');
  overlay.classList.remove('hidden');
  $('#pack-done').classList.add('hidden');
  stage.classList.remove('stacked');

  const wrap = document.createElement('div');
  wrap.className = 'pack-wrap';
  const pack = document.createElement('div');
  pack.className = 'pack';
  pack.innerHTML = '<div class="pack-shine"></div><div class="pack-heart">♥</div><div class="pack-title">NEURO<br>MEME PACK</div>';
  wrap.appendChild(pack);
  stage.replaceChildren(wrap);

  const TEAR_DRAG_PX = 130; // horizontal drag distance across the pack for a full rip
  let dragging = false, torn = false, startX = 0;
  let top = null, bottom = null; // the torn halves — created the moment a drag starts

  const ensureHalves = () => {
    if (top) return;
    pack.style.visibility = 'hidden';
    top = pack.cloneNode(true);
    bottom = pack.cloneNode(true);
    top.className = 'pack pack-half pack-half-top';
    bottom.className = 'pack pack-half pack-half-bottom';
    top.style.visibility = bottom.style.visibility = 'visible';
    top.style.transition = bottom.style.transition = 'none';
    wrap.append(top, bottom);
  };
  const dropHalves = () => {
    if (!top) return;
    top.remove(); bottom.remove();
    top = bottom = null;
    pack.style.visibility = '';
  };

  // Live tear preview: dragging your mouse across the pack peels the two
  // halves apart in real time, tracked straight off the pointer position —
  // not a canned animation that just plays once a threshold is crossed.
  const applyDragVisual = (dx) => {
    ensureHalves();
    const t = Math.min(1, dx / TEAR_DRAG_PX);
    top.style.transform = `translateY(${-t * 44}px) rotate(${-t * 15}deg)`;
    bottom.style.transform = `translateY(${t * 16}px) rotate(${t * 6}deg)`;
    const flash = t > .5 ? (t - .5) * 2 : 0;
    top.style.filter = bottom.style.filter = flash ? `brightness(${1 + flash * 1.5})` : '';
  };
  const springBack = () => {
    if (!top) return;
    top.style.transition = bottom.style.transition = 'transform .35s cubic-bezier(.34,1.56,.64,1), filter .2s';
    top.style.transform = bottom.style.transform = '';
    top.style.filter = bottom.style.filter = '';
    setTimeout(dropHalves, 360);
  };

  pack.addEventListener('pointerdown', (e) => {
    if (torn) return;
    dragging = true;
    startX = e.clientX;
    pack.setPointerCapture(e.pointerId);
    pack.classList.add('gripping');
  });
  pack.addEventListener('pointermove', (e) => {
    if (!dragging || torn) return;
    const dx = Math.abs(e.clientX - startX);
    applyDragVisual(dx);
    if (dx >= TEAR_DRAG_PX) tear();
  });
  const releaseDrag = () => {
    if (!dragging) return;
    dragging = false;
    pack.classList.remove('gripping');
    if (!torn) springBack();
  };
  pack.addEventListener('pointerup', releaseDrag);
  pack.addEventListener('pointercancel', releaseDrag);
  pack.addEventListener('click', tear); // tap-to-open still works without dragging

  function tear() {
    if (torn) return;
    torn = true;
    dragging = false;
    ensureHalves();

    // Finish the rip from wherever the live drag left the halves — fling
    // them the rest of the way apart with a bright flash at the tear line.
    top.style.transition = bottom.style.transition = 'transform .5s cubic-bezier(.5,0,.75,.3), opacity .45s ease-in .15s';
    requestAnimationFrame(() => {
      top.style.transform = 'translateY(-170px) rotate(-22deg)';
      bottom.style.transform = 'translateY(170px) rotate(16deg)';
      top.style.opacity = '0';
      bottom.style.opacity = '0';
    });
    const burst = document.createElement('div');
    burst.className = 'pack-burst';
    wrap.appendChild(burst);
    setTimeout(dealStack, 600);
  }

  function dealStack() {
    stage.replaceChildren();
    stage.classList.add('stacked');
    const pile = document.createElement('div');
    pile.id = 'stack-pile';
    const revealedRow = document.createElement('div');
    revealedRow.id = 'stack-revealed';
    revealedRow.classList.add('mini');
    // revealedRow first in source order → sits to the left of the pile on a
    // normal row layout; the mobile media query flips it below via `order`.
    stage.append(revealedRow, pile);

    // Weakest first, strongest (foils nudge ahead of a same-rarity non-foil)
    // saved for the final reveal.
    const order = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
    const deck = pulls.slice().sort((a, b) => {
      const ca = byId[a.cardId], cb = byId[b.cardId];
      return (order[ca.rarity] + (a.foil ? .5 : 0)) - (order[cb.rarity] + (b.foil ? .5 : 0));
    });

    const flips = deck.map((inst, i) => {
      const card = byId[inst.cardId];
      const flip = document.createElement('div');
      flip.className = `flip-card locked r-${card.rarity}` + (inst.foil ? ' foil-pull' : '');
      flip.style.zIndex = String(deck.length - i);
      flip.style.transform = `translate(${i * 3}px, ${i * -3}px) rotate(${(i % 2 ? 1 : -1) * i * 1.3}deg)`;
      flip.innerHTML = `
        <div class="flip-inner">
          <div class="flip-face flip-back-face">♥</div>
          <div class="flip-face flip-front-face"></div>
        </div>`;
      $('.flip-front-face', flip).appendChild(cardEl(card, { onClick: () => {}, foil: inst.foil }));
      pile.appendChild(flip);
      return { flip, card, inst };
    });

    let next = 0;
    const armNext = () => {
      if (next >= flips.length) { finishReveal(); return; }
      const { flip } = flips[next];
      flip.classList.remove('locked');
      flip.classList.add('next-reveal');
      flip.addEventListener('click', onReveal, { once: true });
    };
    const onReveal = () => {
      const { flip, card, inst } = flips[next];
      const myIndex = next;
      flip.classList.remove('next-reveal');
      flip.classList.add('flipped');
      if (inst.foil) toast(`✦ FOIL ${card.name}! shiny shiny shiny`);
      if (card.rarity === 'legendary') toast(`🌟 LEGENDARY PULL: ${card.name}!!`);
      setTimeout(() => {
        // FLIP: grab where the card sits now (in the pile), re-parent it into
        // the mini stack, then animate away the resulting jump so it visibly
        // slides across into its small spot instead of teleporting there.
        const startRect = flip.getBoundingClientRect();
        flip.style.transform = '';
        flip.style.zIndex = myIndex + 1; // later pulls stack visually on top of the mini pile
        flip.classList.add('settled', 'mini-settled');
        revealedRow.appendChild(flip);
        const endRect = flip.getBoundingClientRect();
        const dx = startRect.left - endRect.left, dy = startRect.top - endRect.top;
        flip.style.transition = 'none';
        flip.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(() => {
          flip.style.transition = 'transform .45s cubic-bezier(.2,.8,.3,1)';
          flip.style.transform = '';
        });
      }, 680); // let the flip animation land before it slides into the mini pile
      next++;
      armNext();
    };
    const finishReveal = () => {
      $('#pack-done').classList.remove('hidden');
      // now that everything is face-up, achievements can't spoil anything
      if (onAllRevealed) setTimeout(onAllRevealed, 750);
      // Give the last card a beat to land, then keep every card at the same
      // small size — just drop the now-empty pile and re-center the row.
      setTimeout(() => {
        pile.style.display = 'none';
        revealedRow.classList.remove('mini');
        revealedRow.classList.add('spread');
        flips.forEach(({ flip, card, inst }, i) => {
          flip.classList.remove('mini-settled');
          flip.style.zIndex = '';
          flip.style.transform = '';
          flip.style.animationDelay = `${i * 70}ms`;
          flip.classList.add('spread-in');
          flip.style.cursor = 'zoom-in';
          flip.onclick = () => zoomCard(card, inst.foil);
        });
      }, 750);
    };
    armNext();
  }
}
$('#pack-done').addEventListener('click', () => {
  $('#pack-overlay').classList.add('hidden');
  refreshMe();
  toast('♥ cards added to your binder');
});

// ─── Swarm / member binders ─────────────────────────────────────────────────
async function renderSwarm() {
  const { users } = await api('/api/users');
  const grid = $('#user-grid');
  grid.replaceChildren(...users.filter((u) => u.id !== state.me.id).map((u, i) => {
    const el = document.createElement('div');
    el.className = 'user-card';
    el.style.setProperty('--i', String(i));
    el.innerHTML = `
      <img src="${u.avatar}" alt="">
      <div>
        <div class="u-name">${esc(u.name)}${u.bot ? ' <span class="bot-tag">SWARM BOT</span>' : ''}</div>
        <div class="u-stats">${u.cardCount} cards · ${u.uniqueCount} unique</div>
      </div>`;
    el.addEventListener('click', () => openMember(u.id));
    return el;
  }));
}

async function openMember(userId) {
  const { user, cards, showcase } = await api(`/api/collection?user=${encodeURIComponent(userId)}`);
  state.member = { user, cards };
  renderShowcase('member-showcase', 'member-showcase-cards', showcase || [], cards);
  $('#member-head').innerHTML = `
    <img src="${user.avatar}" alt="">
    <div><h2>${esc(user.name)}${user.bot ? ' <span class="bot-tag">SWARM BOT</span>' : ''}</h2>
    <div class="u-stats">${user.cardCount} cards · ${user.uniqueCount} unique</div></div>`;
  const byId = cardById();
  const grid = $('#member-grid');
  grid.replaceChildren();
  [...groupCollection(cards).entries()].forEach(([key, insts], i) => {
    const cell = document.createElement('div');
    cell.className = 'card-cell';
    cell.style.setProperty('--i', String(i));
    cell.appendChild(cardEl(byId[groupCard(key)], { qty: insts.length, foil: groupFoil(key) }));
    grid.appendChild(cell);
  });
  nav('member');
}

// ─── Trade builder ───────────────────────────────────────────────────────────
const picks = { give: new Set(), get: new Set() };

$('#propose-btn').addEventListener('click', async () => {
  await loadCollection();
  picks.give.clear(); picks.get.clear();
  $('#trade-modal-title').textContent = `Trade with ${state.member.user.name}`;
  $('#trade-message').value = '';
  fillPickGrid('give', state.collection);
  fillPickGrid('get', state.member.cards);
  $('#trade-modal').classList.remove('hidden');
});

function fillPickGrid(side, insts) {
  const byId = cardById();
  const grid = $(`#${side}-grid`);
  grid.replaceChildren(...insts.map((inst) => {
    const card = byId[inst.cardId];
    const el = cardEl(card, { foil: inst.foil, onClick: () => {
      if (picks[side].has(inst.instanceId)) picks[side].delete(inst.instanceId);
      else if (picks[side].size < 6) picks[side].add(inst.instanceId);
      else return toast('max 6 cards per side', true);
      el.classList.toggle('selected', picks[side].has(inst.instanceId));
      $(`#${side}-count`).textContent = `${picks[side].size}/6`;
    }});
    return el;
  }));
  $(`#${side}-count`).textContent = '0/6';
}

$('#trade-close').addEventListener('click', () => $('#trade-modal').classList.add('hidden'));

$('#trade-send').addEventListener('click', async () => {
  if (!picks.give.size || !picks.get.size) return toast('pick at least one card on each side', true);
  try {
    const r = await api('/api/trades', { method: 'POST', body: {
      toId: state.member.user.id,
      offer: [...picks.give], request: [...picks.get],
      message: $('#trade-message').value,
    }});
    $('#trade-modal').classList.add('hidden');
    if (r.trade.status === 'accepted') toast(`🤝 ${state.member.user.name} accepted instantly!`);
    else if (r.trade.status === 'declined') toast(`😤 ${state.member.user.name} declined — offer more value`, true);
    else toast('📨 trade offer sent!');
    handleUnlocks(r);
    nav('trades');
  } catch (err) { toast(err.message, true); }
});

// ─── Trades inbox ────────────────────────────────────────────────────────────
async function loadTrades() {
  const { trades, users } = await api('/api/trades');
  state.trades = trades;
  state.tradeUsers = users;
}

async function renderTrades() {
  await loadTrades();
  const byId = cardById();
  const list = $('#trade-list');
  list.replaceChildren(...state.trades.map((t) => {
    const incoming = t.toId === state.me.id;
    const other = state.tradeUsers[incoming ? t.fromId : t.toId] || { name: '???', avatar: '' };
    const row = document.createElement('div');
    row.className = 'trade-row';
    row.innerHTML = `
      <div class="trade-row-head">
        <img src="${other.avatar}" alt="">
        <span class="t-who">${incoming ? `${esc(other.name)} → you` : `you → ${esc(other.name)}`}</span>
        <span class="t-when">${new Date(t.createdAt).toLocaleString()}</span>
        <span class="status-chip status-${t.status}">${t.status}</span>
      </div>
      <div class="trade-sides">
        <div class="trade-side" data-side="offer"><span class="trade-side-label">${incoming ? 'THEY GIVE' : 'YOU GIVE'}</span></div>
        <div class="trade-mid">⇄</div>
        <div class="trade-side" data-side="request"><span class="trade-side-label">${incoming ? 'YOU GIVE' : 'YOU GET'}</span></div>
      </div>
      ${t.message ? `<div class="trade-msg">“${esc(t.message)}”</div>` : ''}
      <div class="trade-actions"></div>`;
    for (const side of ['offer', 'request']) {
      const holder = $(`[data-side="${side}"]`, row);
      for (const inst of t[side]) {
        if (inst.gone) {
          const ghost = document.createElement('span');
          ghost.className = 'trade-side-label';
          ghost.textContent = '(card no longer exists)';
          holder.appendChild(ghost);
          continue;
        }
        holder.appendChild(cardEl(byId[inst.cardId], { foil: inst.foil }));
      }
    }
    const actions = $('.trade-actions', row);
    if (t.status === 'pending') {
      if (incoming) {
        actions.append(
          tradeBtn('Accept 🤝', 'btn-primary accept', () => actTrade(t.id, 'accept')),
          tradeBtn('Decline', 'btn-ghost', () => actTrade(t.id, 'decline')),
        );
      } else {
        actions.append(tradeBtn('Cancel offer', 'btn-ghost', () => actTrade(t.id, 'cancel')));
      }
    }
    return row;
  }));
  $('#trades-empty').classList.toggle('hidden', state.trades.length > 0);
}

function tradeBtn(label, cls, fn) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.onclick = fn;
  return b;
}

async function actTrade(id, action) {
  try {
    const r = await api(`/api/trades/${id}/${action}`, { method: 'POST' });
    toast(action === 'accept' ? '🤝 trade complete! cards swapped.' : `trade ${action}ed`);
    handleUnlocks(r);
    renderTrades();
  } catch (err) { toast(err.message, true); renderTrades(); }
}

// ─── Arena: battles ──────────────────────────────────────────────────────────
let battlePoll = null;
const battlePick = new Set();
let battleModalMode = null; // { type: 'challenge', toId, name } | { type: 'accept', battleId, name }

async function loadBattles() {
  const { battles, users } = await api('/api/battles');
  state.battles = battles;
  state.battleUsers = users;
  const needsMe = battles.filter((b) =>
    (b.status === 'pending' && b.toId === state.me.id) ||
    (b.status === 'active' && b.state.turn === state.me.id)).length;
  const badge = $('#battle-badge');
  badge.textContent = needsMe;
  badge.classList.toggle('hidden', needsMe === 0);
}

async function openBattleModal(mode) {
  battleModalMode = mode;
  battlePick.clear();
  await loadCollection();
  const byId = cardById();
  $('#battle-modal-title').textContent = mode.type === 'challenge' ? `Challenge ${mode.name}` : `Battle vs ${mode.name} — pick your team`;
  $('#battle-wager-row').classList.toggle('hidden', mode.type !== 'challenge');
  $('#battle-wager').value = 0;
  $('#bteam-count').textContent = '0/3';
  $('#bteam-grid').replaceChildren(...state.collection.map((inst) => {
    const card = byId[inst.cardId];
    const cell = document.createElement('div');
    cell.className = 'pick-cell';
    const el = cardEl(card, { foil: inst.foil, onClick: () => {
      if (battlePick.has(inst.instanceId)) battlePick.delete(inst.instanceId);
      else if (battlePick.size < 3) battlePick.add(inst.instanceId);
      else return toast('a team is exactly 3 cards', true);
      el.classList.toggle('selected', battlePick.has(inst.instanceId));
      $('#bteam-count').textContent = `${battlePick.size}/3`;
    }});
    cell.appendChild(el);
    cell.insertAdjacentHTML('beforeend', statLine(card, inst.foil));
    return cell;
  }));
  $('#battle-modal').classList.remove('hidden');
}
$('#battle-close').addEventListener('click', () => $('#battle-modal').classList.add('hidden'));

$('#battle-send').addEventListener('click', async () => {
  if (battlePick.size !== 3) return toast('pick exactly 3 cards', true);
  try {
    const r = battleModalMode.type === 'challenge'
      ? await api('/api/battles', { method: 'POST', body: { toId: battleModalMode.toId, team: [...battlePick], wager: Number($('#battle-wager').value) || 0 } })
      : await api(`/api/battles/${battleModalMode.battleId}/accept`, { method: 'POST', body: { team: [...battlePick] } });
    $('#battle-modal').classList.add('hidden');
    handleUnlocks(r);
    if (r.battle.status === 'declined') { toast('😤 challenge declined', true); nav('arena'); }
    else if (r.battle.status === 'pending') { toast('⚔️ challenge sent!'); nav('arena'); }
    else openBattle(r.battle.id);
  } catch (err) { toast(err.message, true); }
});

async function renderArena() {
  await loadBattles();
  const list = $('#battle-list');
  list.replaceChildren(...state.battles.map((b) => {
    const incoming = b.toId === state.me.id;
    const other = state.battleUsers[incoming ? b.fromId : b.toId] || { name: '???', avatar: '' };
    const chip = b.status === 'done' ? (b.winnerId === state.me.id ? 'accepted' : 'declined')
      : b.status === 'active' ? 'pending' : b.status;
    const label = b.status === 'done' ? (b.winnerId === state.me.id ? 'won 🏆' : 'lost 💀')
      : b.status === 'active' ? (b.state.turn === state.me.id ? 'your turn!' : 'their turn') : b.status;
    const row = document.createElement('div');
    row.className = 'trade-row';
    row.innerHTML = `
      <div class="trade-row-head">
        <img src="${other.avatar}" alt="">
        <span class="t-who">${incoming ? `${esc(other.name)} → you` : `you → ${esc(other.name)}`}${other.bot ? ' <span class="bot-tag">SWARM BOT</span>' : ''}</span>
        ${b.wager ? `<span class="t-when">wager ⚡${b.wager}</span>` : ''}
        <span class="t-when">${new Date(b.createdAt).toLocaleString()}</span>
        <span class="status-chip status-${chip}">${label}</span>
      </div>
      <div class="trade-actions"></div>`;
    const actions = $('.trade-actions', row);
    if (b.status === 'pending' && incoming) {
      actions.append(
        tradeBtn('Accept ⚔️', 'btn-primary accept', () => openBattleModal({ type: 'accept', battleId: b.id, name: other.name })),
        tradeBtn('Decline', 'btn-ghost', () => actBattle(b.id, 'decline')),
      );
    } else if (b.status === 'pending') {
      actions.append(tradeBtn('Cancel challenge', 'btn-ghost', () => actBattle(b.id, 'cancel')));
    } else if (b.status === 'active') {
      actions.append(tradeBtn(b.state.turn === state.me.id ? 'Fight! ⚔️' : 'Spectate 👀', 'btn-primary', () => openBattle(b.id)));
    } else if (b.status === 'done') {
      actions.append(tradeBtn('View log', 'btn-ghost', () => openBattle(b.id)));
    }
    return row;
  }));
  $('#battles-empty').classList.toggle('hidden', state.battles.length > 0);
}

async function actBattle(id, action) {
  try {
    await api(`/api/battles/${id}/${action}`, { method: 'POST' });
    toast(action === 'decline' ? 'challenge declined' : 'challenge cancelled');
    renderArena();
  } catch (err) { toast(err.message, true); renderArena(); }
}

async function openBattle(id) {
  clearInterval(battlePoll);
  try {
    const { battle, users } = await api(`/api/battles/${id}`);
    state.battle = { data: battle, users };
    nav('battle');
    renderBattleScreen();
    if (battle.status === 'active') battlePoll = setInterval(refreshBattle, 2500);
  } catch (err) { toast(err.message, true); }
}

async function refreshBattle() {
  if (state.view !== 'battle' || !state.battle) return clearInterval(battlePoll);
  try {
    const { battle, users } = await api(`/api/battles/${state.battle.data.id}`);
    const changed = battle.status !== state.battle.data.status
      || JSON.stringify(battle.state) !== JSON.stringify(state.battle.data.state);
    state.battle = { data: battle, users };
    if (changed) renderBattleScreen();
    if (battle.status !== 'active') clearInterval(battlePoll);
  } catch { /* transient network hiccup — next poll retries */ }
}

function fighterEl(f          , { active, onClick }                                             = {}) {
  const byId = cardById();
  const wrap = document.createElement('div');
  wrap.className = 'fighter' + (active ? ' active-fighter' : '') + (f.hp <= 0 ? ' fainted' : '');
  const card = byId[f.cardId];
  wrap.appendChild(cardEl(card, { foil: f.foil, onClick: onClick || (() => zoomCard(card, f.foil)) }));
  const pct = Math.round(f.hp / f.maxHp * 100);
  wrap.insertAdjacentHTML('beforeend', `
    <div class="hp-bar"><div class="hp-fill ${pct < 25 ? 'hp-low' : pct < 55 ? 'hp-mid' : ''}" style="width:${pct}%"></div></div>
    <div class="fighter-stats">♥${f.hp}/${f.maxHp} · ⚔${f.atk} 🛡${f.def} ⚡${f.spd}</div>`);
  return wrap;
}

function renderBattleScreen() {
  const { data: b, users } = state.battle;
  const oppId = b.fromId === state.me.id ? b.toId : b.fromId;
  const opp = users[oppId] || { name: '???', avatar: '' };
  const myTurn = b.status === 'active' && b.state.turn === state.me.id;
  $('#battle-head').innerHTML = `
    <img src="${opp.avatar}" alt="">
    <div><h2>vs ${esc(opp.name)}${b.wager ? ` · pot ⚡${b.wager * 2}` : ''}</h2>
    <div class="u-stats">${
      b.status === 'active' ? (myTurn ? '🔥 your turn!' : `waiting for ${esc(opp.name)}…`)
      : b.status === 'done' ? (b.winnerId === state.me.id ? 'VICTORY 🏆' : 'defeat 💀')
      : b.status}</div></div>`;

  const renderSide = (sel, uid, mine) => {
    const el = $(sel);
    el.replaceChildren();
    const team = b.state.teams[uid];
    if (!team) { el.innerHTML = '<p class="empty-note">team hidden until the challenge is accepted</p>'; return; }
    const act = b.state.active[uid];
    el.appendChild(fighterEl(team[act], { active: true }));
    const bench = document.createElement('div');
    bench.className = 'bench';
    const foeActive = b.state.teams[oppId] && b.state.teams[oppId][b.state.active[oppId]];
    team.forEach((f, i) => {
      if (i === act) return;
      const canSwap = mine && myTurn && f.hp > 0;
      const fe = fighterEl(f, canSwap ? { onClick: () => battleMove({ type: 'swap', index: i }) } : {});
      if (canSwap) {
        fe.classList.add('swappable');
        if (foeActive) {
          const deal = seriesMultClient(f.series, foeActive.series);
          const take = seriesMultClient(foeActive.series, f.series);
          fe.insertAdjacentHTML('beforeend',
            `<div class="swap-detail">deals ×${deal} · takes ×${take} vs ${esc(foeActive.name)}</div>`);
        }
      }
      bench.appendChild(fe);
    });
    el.appendChild(bench);
  };
  renderSide('#foe-side', oppId, false);
  renderSide('#my-side', state.me.id, true);

  const controls = $('#battle-controls');
  controls.replaceChildren();
  if (b.status === 'active') {
    const meF = b.state.teams[state.me.id][b.state.active[state.me.id]];
    const foeF = b.state.teams[oppId][b.state.active[oppId]];
    const atk = moveButton(meF, 0, foeF, myTurn);
    const spc = moveButton(meF, 1, foeF, myTurn);
    controls.append(atk, spc, tradeBtn('forfeit 🏳️', 'btn-ghost', () => {
      if (confirm('Forfeit this battle? The pot goes to your opponent.')) battleMove({ type: 'forfeit' });
    }));
    if (myTurn) controls.insertAdjacentHTML('beforeend', '<span class="hint">…or click a benched card to swap it in (uses your turn)</span>');
  }
  $('#battle-log').replaceChildren(...b.state.log.slice().reverse().map((l) => {
    const d = document.createElement('div');
    d.textContent = l;
    return d;
  }));
}

// Mirrors the server's series-advantage cycle so the UI can predict damage
function seriesMultClient(attacker, defender) {
  const cyc = state.config.battle.cycle;
  const next = (s) => cyc[(cyc.indexOf(s) + 1) % cyc.length];
  if (next(attacker) === defender) return 1.3;
  if (next(defender) === attacker) return 0.75;
  return 1;
}

// A move button that spells out what the move will do to the current target,
// using the exact damage formula the server rolls (±10% variance).
function moveButton(f, moveIdx, target, myTurn) {
  const type = moveIdx === 1 ? f.special.type : 'basic';
  const name = moveIdx === 1 ? `${f.special.name} ✨` : `${f.basicName} ⚔`;
  const mv = state.config.battle.moves[type] || { power: 0, acc: 1, healRatio: 0 };
  const parts = [];

  if (type === 'heal') {
    const heal = Math.min(Math.round(f.maxHp * mv.healRatio), f.maxHp - f.hp);
    parts.push(heal > 0 ? `heals you ${heal} HP` : 'already at full HP');
  } else {
    const mult = seriesMultClient(f.series, target.series);
    const base = mv.power * (f.atk / Math.max(1, target.def * target.defMod)) * mult;
    const lo = Math.max(1, Math.round(base * 0.9)), hi = Math.max(1, Math.round(base * 1.1));
    parts.push(`${lo}–${hi} dmg to ${target.name}`);
    if (mult > 1) parts.push('super effective!');
    else if (mult < 1) parts.push('resisted');
    if (mv.acc < 1) parts.push(`${Math.round(mv.acc * 100)}% to hit`);
    if (type === 'drain') parts.push('heals you half of it');
    if (type === 'break') parts.push(`then −20% DEF${target.defMod < 1 ? ` (now ${Math.round(target.defMod * 100)}%)` : ''}`);
  }

  const btn = document.createElement('button');
  btn.className = 'btn-primary move-btn';
  btn.disabled = !myTurn;
  btn.innerHTML = `<b>${esc(name)}</b><span class="move-detail">${esc(parts.join(' · '))}</span>`;
  btn.onclick = () => battleMove({ type: 'attack', move: moveIdx });
  return btn;
}

async function battleMove(body) {
  try {
    const r = await api(`/api/battles/${state.battle.data.id}/move`, { method: 'POST', body });
    state.battle.data = r.battle;
    handleUnlocks(r);
    renderBattleScreen();
    if (r.battle.status !== 'active') clearInterval(battlePoll);
  } catch (err) { toast(err.message, true); refreshBattle(); }
}

$('#challenge-btn').addEventListener('click', () =>
  openBattleModal({ type: 'challenge', toId: state.member.user.id, name: state.member.user.name }));

// ─── Market ──────────────────────────────────────────────────────────────────
let auctionTickTimer                                            ;

function renderMarket() {
  return renderBuyNow();
}

async function renderBuyNow() {
  const { listings } = await api('/api/market');
  const byId = cardById();
  const grid = $('#market-grid');
  grid.replaceChildren(...listings.map((l, i) => {
    const card = byId[l.card.cardId];
    const cell = document.createElement('div');
    cell.className = 'card-cell';
    cell.style.setProperty('--i', String(i));
    cell.appendChild(cardEl(card, { foil: l.card.foil }));
    const mine = l.sellerId === state.me.id;
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    actions.innerHTML = `<span class="market-seller" title="seller">${esc(l.sellerName)}</span>`;
    const btn = document.createElement('button');
    btn.textContent = mine ? 'delist ✕' : `buy · ⚡${l.price}`;
    btn.onclick = async () => {
      try {
        if (mine) {
          await api(`/api/market/${l.id}/cancel`, { method: 'POST' });
          toast('listing cancelled');
        } else {
          if (!confirm(`Buy ${card.name}${l.card.foil ? ' (foil)' : ''} from ${l.sellerName} for ⚡${l.price}?`)) return;
          const r = await api(`/api/market/${l.id}/buy`, { method: 'POST' });
          toast(`💰 bought ${card.name}!`);
          handleUnlocks(r);
        }
        renderBuyNow();
      } catch (err) { toast(err.message, true); renderBuyNow(); }
    };
    actions.appendChild(btn);
    cell.appendChild(actions);
    return cell;
  }));
  $('#market-empty').classList.toggle('hidden', listings.length > 0);
}

// ─── Auction house ───────────────────────────────────────────────────────────
                    
                                                                         
                                                                   
                                                                   
                                                 
 

// Renders time-left as "3d 4h", "2h 15m", "48s" etc, down to the second so
// the last stretch of a hot auction actually feels like it's ticking down.
function fmtCountdown(ms        )         {
  if (ms <= 0) return 'ending…';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  if (m > 0) return `${m}m ${sec}s left`;
  return `${sec}s left`;
}

async function renderAuctions() {
  clearInterval(auctionTickTimer);
  const { auctions } = await api('/api/market/auctions')                            ;
  const byId = cardById();
  const grid = $('#auction-grid');
  grid.replaceChildren(...auctions.map((a, i) => {
    const card = byId[a.card.cardId];
    const mine = a.sellerId === state.me.id;
    const winning = a.currentBidderId === state.me.id;
    const cell = document.createElement('div');
    cell.className = 'card-cell' + (mine ? ' auction-mine' : '') + (winning ? ' auction-winning' : '');
    cell.style.setProperty('--i', String(i));
    cell.appendChild(cardEl(card, { foil: a.card.foil }));

    const info = document.createElement('div');
    info.className = 'auction-info';
    info.innerHTML = `
      <span class="market-seller" title="seller">${esc(a.sellerName)}</span>
      <span class="auction-bid">⚡${a.currentBid ?? a.startingBid}${a.currentBid == null ? ' (starting)' : ''}</span>
      <span>${a.bidCount} bid${a.bidCount === 1 ? '' : 's'}${winning && !mine ? ' · you\'re winning!' : ''}</span>
      <span class="auction-countdown" data-ends="${a.endsAt}"></span>`;
    cell.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const btn = document.createElement('button');
    if (mine) {
      btn.textContent = a.bidCount > 0 ? 'has bids' : 'cancel ✕';
      btn.disabled = a.bidCount > 0;
      btn.onclick = async () => {
        try { await api(`/api/market/auctions/${a.id}/cancel`, { method: 'POST' }); toast('auction cancelled'); renderAuctions(); }
        catch (err) { toast(err.message, true); }
      };
    } else {
      const floor = (a.currentBid ?? a.startingBid - 1) + 1;
      btn.textContent = `bid ≥⚡${floor}`;
      btn.onclick = async () => {
        const input = await askPrompt({ title: `Bid on "${card.name}"${a.card.foil ? ' (foil)' : ''}`, message: `Minimum ⚡${floor}`, value: floor, min: floor });
        if (input === null) return;
        const amount = Math.floor(Number(input));
        if (!amount || amount < floor) return toast(`bid must be at least ⚡${floor}`, true);
        try {
          const r = await api(`/api/market/auctions/${a.id}/bid`, { method: 'POST', body: { amount } });
          toast(`🔨 bid ⚡${amount} on ${card.name}`);
          if (state.me) { state.me.neuros = r.neuros; $('#neuro-count').textContent = r.neuros; }
          renderAuctions();
        } catch (err) { toast(err.message, true); }
      };
    }
    actions.appendChild(btn);
    cell.appendChild(actions);
    return cell;
  }));
  $('#auction-empty').classList.toggle('hidden', auctions.length > 0);

  const tick = () => {
    let anyDue = false;
    Array.from(grid.querySelectorAll('.auction-countdown')).forEach((el     ) => {
      const msLeft = Number(el.dataset.ends) - Date.now();
      el.textContent = fmtCountdown(msLeft);
      el.classList.toggle('ending-soon', msLeft > 0 && msLeft < 5 * 60e3);
      if (msLeft <= 0) anyDue = true;
    });
    if (anyDue) { clearInterval(auctionTickTimer); renderAuctions(); } // an auction just settled — refresh from the server
  };
  tick();
  auctionTickTimer = setInterval(tick, 1000);
}

// ─── Start-auction picker (single-card select) ──────────────────────────────
const auctionPick = new Set        (); // capped at 1 — reuses the multi-select Set pattern

$('#start-auction-btn').addEventListener('click', async () => {
  await loadCollection();
  auctionPick.clear();
  $('#apick-count').textContent = '0/1';
  const byId = cardById();
  $('#apick-grid').replaceChildren(...state.collection.map((inst) => {
    const card = byId[inst.cardId];
    const el = cardEl(card, { foil: inst.foil, onClick: () => {
      const wasSelected = auctionPick.has(inst.instanceId);
      auctionPick.clear();
      $$('#apick-grid .tcg-card').forEach((c) => c.classList.remove('selected'));
      if (!wasSelected) { auctionPick.add(inst.instanceId); el.classList.add('selected'); }
      $('#apick-count').textContent = `${auctionPick.size}/1`;
    }});
    return el;
  }));
  $('#auction-start-bid').value = 100;
  $('#auction-duration').value = 24;
  $('#auction-modal').classList.remove('hidden');
});
$('#auction-modal-close').addEventListener('click', () => $('#auction-modal').classList.add('hidden'));

$('#auction-start-send').addEventListener('click', async () => {
  if (auctionPick.size !== 1) return toast('pick a card to auction', true);
  const startingBid = Math.floor(Number($('#auction-start-bid').value));
  const durationHours = Math.floor(Number($('#auction-duration').value));
  if (!startingBid || startingBid < 1) return toast('enter a valid starting bid', true);
  if (!durationHours || durationHours < 1 || durationHours > 168) return toast('duration must be 1–168 hours', true);
  try {
    const [instanceId] = auctionPick;
    await api('/api/market/auctions', { method: 'POST', body: { instanceId, startingBid, durationHours } });
    $('#auction-modal').classList.add('hidden');
    toast(`⏱ auction started — starting bid ⚡${startingBid}`);
    renderAuctions();
  } catch (err) { toast(err.message, true); }
});

// ─── Meme of the week vote ───────────────────────────────────────────────────
async function renderVote() {
  const { week, candidates, myVote, lastWinner } = await api('/api/vote');
  $('#vote-week').textContent = week;
  $('#vote-winner').innerHTML = lastWinner
    ? `<div class="vote-winner">👑 <b>${esc(lastWinner.name)}</b> by ${esc(lastWinner.submitterName)} won ${lastWinner.week} — the card is now <span class="r-${lastWinner.rarity}">${lastWinner.rarity}</span>!</div>`
    : '';
  const list = $('#vote-list');
  list.replaceChildren(...candidates.map((m) => {
    const row = document.createElement('div');
    row.className = 'meme-row' + (myVote === m.id ? ' voted' : '');
    row.innerHTML = `
      <img src="/memes/${m.file}" alt="">
      <div class="meme-row-info"><b>${esc(m.name)}</b><span>by ${esc(m.submitterName)} · <span class="r-${m.rarity}">${m.rarity}</span></span></div>
      <span class="vote-count">${m.votes} 🗳️</span>`;
    const btn = document.createElement('button');
    btn.className = 'btn-ghost vote-btn';
    if (m.submitterId === state.me.id) {
      btn.textContent = 'yours';
      btn.disabled = true;
    } else if (myVote === m.id) {
      btn.textContent = 'voted ✓';
      btn.classList.add('active');
    } else {
      btn.textContent = 'vote';
      btn.onclick = async () => {
        try {
          await api('/api/vote', { method: 'POST', body: { memeId: m.id } });
          toast(`🗳️ voted for "${m.name}"`);
          renderVote();
        } catch (err) { toast(err.message, true); }
      };
    }
    row.appendChild(btn);
    return row;
  }));
  $('#vote-empty').classList.toggle('hidden', candidates.length > 0);
}

// ─── Ranks: leaderboard + achievements ──────────────────────────────────────
async function renderRanks() {
  const [{ board }, { defs, unlocked }] = await Promise.all([api('/api/leaderboard'), api('/api/achievements')]);
  const medals = ['🥇', '🥈', '🥉'];
  const list = $('#lb-list');
  list.replaceChildren(...board.map((u, i) => {
    const row = document.createElement('div');
    row.className = 'lb-row' + (u.id === state.me.id ? ' me' : '');
    row.style.setProperty('--i', String(i));
    row.innerHTML = `
      <span class="lb-rank">${medals[i] || '#' + (i + 1)}</span>
      <img src="${u.avatar}" alt="">
      <span class="lb-name">${esc(u.name)}${u.id === state.me.id ? ' <span class="bot-tag">YOU</span>' : ''}</span>
      <span class="lb-stats">${u.unique} unique · ${u.foils} ✦ · ${u.achievements} 🏆</span>
      <span class="lb-score">⚡${u.score}</span>`;
    return row;
  }));
  $('#lb-empty').classList.toggle('hidden', board.length > 0);

  $('#ach-count').textContent = `${Object.keys(unlocked).length}/${defs.length}`;
  $('#ach-grid').replaceChildren(...defs.map((a) => {
    const el = document.createElement('div');
    el.className = 'ach' + (unlocked[a.id] ? ' unlocked' : '');
    el.title = unlocked[a.id] ? `Unlocked ${new Date(unlocked[a.id]).toLocaleDateString()}` : 'Locked';
    el.innerHTML = `
      <span class="ach-emoji">${a.emoji}</span>
      <div class="ach-info"><b>${esc(a.name)}</b><span class="ach-desc">${esc(a.desc)}</span></div>
      ${a.reward ? `<span class="ach-reward">+⚡${a.reward}</span>` : ''}`;
    return el;
  }));
}

// ─── Meme submission portal ──────────────────────────────────────────────────
let memeData = null; // pending upload as data URL

async function refreshCatalog() {
  const catalog = await api('/api/catalog');
  Object.assign(state, { cards: catalog.cards, rarities: catalog.rarities, series: catalog.series });
}

function loadMemeFile(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return toast('PNG, JPG, GIF or WEBP only', true);
  if (file.size > 5 * 1024 * 1024) return toast('max 5MB — compress that meme', true);
  const reader = new FileReader();
  reader.onload = () => {
    memeData = reader.result;
    const img = $('#drop-preview');
    img.src = memeData;
    img.classList.remove('hidden');
    $('#drop-inner').classList.add('hidden');
    if (!$('#meme-name').value) $('#meme-name').value = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').slice(0, 48);
  };
  reader.readAsDataURL(file);
}

$('#meme-file').addEventListener('change', (e) => loadMemeFile(e.target.files[0]));
const dz = $('#drop-zone');
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragging'); });
dz.addEventListener('dragleave', () => dz.classList.remove('dragging'));
dz.addEventListener('drop', (e) => {
  e.preventDefault();
  dz.classList.remove('dragging');
  loadMemeFile(e.dataTransfer.files[0]);
});

$('#submit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!memeData) return toast('pick a meme first', true);
  const name = $('#meme-name').value.trim();
  if (!name) return toast('give your meme a name', true);
  const btn = $('#submit-meme-btn');
  btn.disabled = true;
  try {
    const r = await api('/api/memes', { method: 'POST', body: { name, data: memeData } });
    toast(r.status === 'approved' ? `🎉 ${r.note}` : `📨 ${r.note}`);
    handleUnlocks(r);
    memeData = null;
    $('#drop-preview').classList.add('hidden');
    $('#drop-inner').classList.remove('hidden');
    $('#meme-name').value = '';
    $('#meme-file').value = '';
    await refreshCatalog();
    renderMySubmissions();
  } catch (err) { toast(err.message, true); }
  btn.disabled = false;
});

async function renderMySubmissions() {
  $('#submit-hint').textContent = state.config.moderation
    ? 'Submissions are reviewed by a moderator. Approved memes are minted as cards — you get 2 copies.'
    : 'No moderator configured: memes are minted instantly and you get 2 copies.';
  const { memes } = await api('/api/memes/mine');
  const holder = $('#my-memes');
  if (!memes.length) { holder.innerHTML = '<p class="empty-note">Nothing yet. Feed the swarm.</p>'; return; }
  holder.replaceChildren(...memes.map((m) => {
    const row = document.createElement('div');
    row.className = 'meme-row';
    row.innerHTML = `
      <img src="/memes/${m.file}" alt="" onerror="this.style.visibility='hidden'">
      <div class="meme-row-info">
        <b>${esc(m.name)}</b>
        <span class="r-${m.rarity}">${m.rarity}</span>
      </div>
      <span class="status-chip status-${m.status === 'approved' ? 'accepted' : m.status === 'rejected' ? 'declined' : 'pending'}">${m.status}</span>`;
    return row;
  }));
}

// ─── Mod queue ───────────────────────────────────────────────────────────────
async function renderQueue() {
  let memes;
  try { ({ memes } = await api('/api/memes/queue')); }
  catch (err) { toast(err.message, true); return nav('binder'); }
  const list = $('#queue-list');
  list.replaceChildren(...memes.map((m) => {
    const row = document.createElement('div');
    row.className = 'queue-row';
    row.innerHTML = `
      <img class="queue-img" src="/memes/${m.file}" alt="">
      <div class="queue-info">
        <b>${esc(m.name)}</b>
        <span>by ${esc(m.submitterName)} · rolls as <span class="r-${m.rarity}">${m.rarity}</span></span>
        <span class="t-when">${new Date(m.createdAt).toLocaleString()}</span>
      </div>
      <div class="trade-actions"></div>`;
    const actions = $('.trade-actions', row);
    actions.append(
      tradeBtn('Approve ✓', 'btn-primary accept', async () => {
        try { await api(`/api/memes/${m.id}/approve`, { method: 'POST' }); toast(`🎉 "${m.name}" minted as a card`); await refreshCatalog(); renderQueue(); refreshMe(); }
        catch (err) { toast(err.message, true); }
      }),
      tradeBtn('Reject', 'btn-ghost', async () => {
        try { await api(`/api/memes/${m.id}/reject`, { method: 'POST' }); toast('meme rejected'); renderQueue(); refreshMe(); }
        catch (err) { toast(err.message, true); }
      }),
    );
    return row;
  }));
  $('#queue-empty').classList.toggle('hidden', memes.length > 0);
}

// ─── Hero preview cards ──────────────────────────────────────────────────────
// Cards get a cursor-tracked holographic tilt. The key fix over a plain CSS
// :hover effect: transform + shine position are driven from JS so pointerleave
// can explicitly animate both back to their resting state — no stuck tilt,
// no shine frozen mid-sweep.
function attachHoloTilt(el) {
  const cs = getComputedStyle(el);
  const rot = (cs.getPropertyValue('--base-rot') || '0deg').trim();
  const ty = (cs.getPropertyValue('--base-y') || '0px').trim();
  const base = `rotate(${rot}) translateY(${ty})`;
  el.dataset.baseTransform = base;

  const reset = () => {
    // force a reflow so the browser commits the transition change before the
    // transform change lands in the same tick — otherwise it can jump straight
    // to the resting position instead of easing into it.
    void el.offsetWidth;
    el.style.transition = 'transform .6s cubic-bezier(.16,1,.3,1), --holo-o .6s ease-out';
    el.style.transform = base;
    el.style.setProperty('--holo-o', '0');
  };
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    const tiltX = (py - .5) * -16;
    const tiltY = (px - .5) * 16;
    el.style.transition = 'transform .06s linear';
    el.style.transform = `${base} rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(1.06)`;
    el.style.setProperty('--holo-x', `${px * 100}%`);
    el.style.setProperty('--holo-y', `${py * 100}%`);
    el.style.setProperty('--holo-o', '1');
  });
  el.addEventListener('pointerleave', reset);
  el.addEventListener('pointercancel', reset);
  reset();
}

function renderHeroCards() {
  const showcase = ['gymbag', 'buh', 'evil-takeover', 'tutel'];
  const byId = cardById();
  const els = showcase.map((id) => cardEl(byId[id], { onClick: () => zoomCard(byId[id]) }));
  $('#hero-cards').replaceChildren(...els);
  els.forEach(attachHoloTilt);
}

// ─── Hero chat ticker (ambient flavor, not real data) ───────────────────────
function renderChatTicker() {
  const lines = [
    ['sw4rm_unit', 'opened a legendary?? shut UP'],
    ['crumbboi', 'trade check, need a gymbag pls'],
    ['anon4021', 'buh core is undefeated fr'],
    ['neuro_enjoyer', 'dad would be so proud of this pull'],
    ['filian_fan', 'recycling my 40th common again lol'],
    ['vedal_stan', 'i just want ONE (1) buh card'],
    ['chatbot9000', 'is the evil theme lore accurate'],
    ['swarm_bot', 'new pack drop in 3... 2...'],
    ['tutel_truther', 'binder 61% complete, let him cook'],
    ['gymbag_god', 'holo pulled, screenshot it, never delete'],
  ];
  const rows = lines.map(([who, msg]) => `<div><span class="who">${esc(who)}:</span> ${esc(msg)}</div>`).join('');
  $('#chat-ticker').innerHTML = `<div class="ticker-track">${rows}${rows}</div>`;
}

// ─── Boot ────────────────────────────────────────────────────────────────────
(async function boot() {
  state.config = await api('/api/config');
  const catalog = await api('/api/catalog');
  Object.assign(state, { cards: catalog.cards, rarities: catalog.rarities, series: catalog.series });

  renderHeroCards();
  renderChatTicker();
  renderOdds();

  if (new URLSearchParams(location.search).get('login') === 'failed') {
    toast('Discord login failed — check the server logs', true);
    history.replaceState(null, '', '/');
  }

  const authed = await refreshMe();
  if (authed) {
    loadTrades();
    setInterval(loadTrades, 30000); // keep trade state fresh in the background
    const deep = location.hash.slice(1);
    nav(['binder', 'packs', 'swarm', 'arena', 'market', 'auction', 'ranks', 'trades', 'submit', 'modqueue'].includes(deep) ? deep : 'binder');
  } else {
    nav('home');
  }
})().catch((e) => { console.error(e); toast('failed to load — is the server running?', true); });
