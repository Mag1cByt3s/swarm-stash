/* Swarm Stash — SPA entry point.
   Served to the browser as ES modules with the types stripped at request time
   by the server — no build step, just edit + reload.

   Importing a view module registers its view with nav.ts and wires up its DOM
   listeners; this file only runs the boot sequence. */

import { toast } from './dom.ts';
import { state } from './state.ts';
import { api, refreshCatalog } from './api.ts';
import { nav } from './nav.ts';
import { refreshMe } from './auth.ts';
import { renderOdds } from './packs.ts';
import { loadTrades } from './trades.ts';
import { renderHeroCards, renderChatTicker } from './home.ts';
import './theme.ts';
import './binder.ts';
import './swarm.ts';
import './arena.ts';
import './market.ts';
import './auction.ts';
import './ranks.ts';
import './memes.ts';
import './admin.ts';

(async function boot() {
  state.config = await api('/api/config');
  await refreshCatalog();

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
    nav(['binder', 'packs', 'swarm', 'arena', 'market', 'auction', 'ranks', 'trades', 'submit', 'modqueue', 'admin'].includes(deep) ? deep : 'binder');
  } else {
    nav('home');
  }
})().catch((e) => { console.error(e); toast('failed to load — is the server running?', true); });
