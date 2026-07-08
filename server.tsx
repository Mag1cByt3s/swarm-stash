// Swarm Stash — entry point. Hono owns request routing and response rendering;
// SQLite storage still uses Node's built-in node:sqlite.
//
// This file is only wiring. The actual behavior lives in:
//   routes/   — one file per API area (auth, players, trades, battles, …)
//   lib/      — shared plumbing (config, router, sessions, card pool, …)
//   catalog.ts / achievements.ts / battle.ts — game content & combat rules
//   db.ts     — SQLite storage layer
//   public/   — static assets and browser TS modules served type-stripped

import './env.ts'; // must load .env before any module reads config at import time

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import store from './db.ts';
import { PORT, HOST, BASE_URL, DISCORD_ENABLED, DEV_LOGIN } from './lib/config.ts';
import { Router } from './lib/router.ts';
import { PUBLIC_DIR, serveStrippedTypeScript } from './lib/static.ts';
import { seedBots } from './lib/bots.ts';
import { AppDocument } from './routes/app.tsx';

import { authRoutes } from './routes/auth.ts';
import { siteRoutes } from './routes/site.ts';
import { playerRoutes } from './routes/players.ts';
import { economyRoutes } from './routes/economy.ts';
import { memeRoutes } from './routes/memes.ts';
import { tradeRoutes } from './routes/trades.ts';
import { battleRoutes } from './routes/battles.ts';
import { marketRoutes } from './routes/market.ts';

const router = new Router();
authRoutes(router);
siteRoutes(router);
playerRoutes(router);
economyRoutes(router);
memeRoutes(router);
tradeRoutes(router);
battleRoutes(router);
marketRoutes(router);

seedBots(); // so trading works out of the box

const app = new Hono();
app.route('/', router.app);
app.use('/js/*', async (c, next) => {
  if (new URL(c.req.url).pathname.endsWith('.ts')) return serveStrippedTypeScript(c);
  await next();
});
app.use('*', serveStatic({ root: PUBLIC_DIR }));

app.notFound(async (c) => {
  const url = new URL(c.req.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    return c.json({ error: 'no such endpoint' }, 404);
  }

  if (url.pathname.includes('.')) return c.text('not found', 404);
  return c.html(<AppDocument />);
});

app.onError((e, c) => {
  console.error(`${c.req.method} ${c.req.url} →`, e);
  return c.json({ error: 'internal error' }, 500);
});

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
  console.log(`🐝 Swarm Stash running at ${BASE_URL}`);
  console.log(`   Discord OAuth: ${DISCORD_ENABLED ? 'enabled' : 'NOT configured (using dev login)'} · dev login: ${DEV_LOGIN ? 'on' : 'off'}`);
});

// Settle auctions whose clock ran out even if nobody happens to load the
// market page right at that moment — escrowed neuros shouldn't just sit there.
setInterval(() => {
  try { store.resolveExpiredAuctions(); }
  catch (e) { console.error('auction sweep failed:', e); }
}, 60_000);
