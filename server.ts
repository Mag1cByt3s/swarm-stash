// Swarm Stash — entry point. Zero runtime dependencies: Node's built-in http
// server and SQLite (node:sqlite), run directly as TypeScript via Node's
// native type stripping.
//
// This file is only wiring. The actual behavior lives in:
//   routes/   — one file per API area (auth, players, trades, battles, …)
//   lib/      — shared plumbing (config, router, sessions, card pool, …)
//   catalog.ts / achievements.ts / battle.ts — game content & combat rules
//   db.ts     — SQLite storage layer
//   public/   — the SPA (app.ts is served type-stripped as /app.js)

import './env.ts'; // must load .env before any module reads config at import time

import http from 'node:http';
import store from './db.ts';
import { PORT, BASE_URL, DISCORD_ENABLED, DEV_LOGIN } from './lib/config.ts';
import { Router } from './lib/router.ts';
import { err } from './lib/http.ts';
import { serveStatic } from './lib/static.ts';
import { readSession } from './lib/session.ts';
import { seedBots } from './lib/bots.ts';

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

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<unknown> {
  const url = new URL(req.url || '/', BASE_URL);
  const match = router.match(req.method || 'GET', url.pathname);
  if (!match) {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return err(res, 404, 'no such endpoint');
    return serveStatic(res, url.pathname); // everything else is the SPA
  }
  const me = readSession(req);
  if (match.auth && !me) return err(res, 401, 'login required');
  return match.handler({ req, res, url, params: match.params, me });
}

http.createServer((req, res) => {
  handle(req, res).catch((e: unknown) => {
    console.error(`${req.method} ${req.url} →`, e);
    if (!res.headersSent) err(res, 500, 'internal error');
  });
}).listen(PORT, () => {
  console.log(`🐝 Swarm Stash running at ${BASE_URL}`);
  console.log(`   Discord OAuth: ${DISCORD_ENABLED ? 'enabled' : 'NOT configured (using dev login)'} · dev login: ${DEV_LOGIN ? 'on' : 'off'}`);
});

// Settle auctions whose clock ran out even if nobody happens to load the
// market page right at that moment — escrowed neuros shouldn't just sit there.
setInterval(() => {
  try { store.resolveExpiredAuctions(); }
  catch (e) { console.error('auction sweep failed:', e); }
}, 60_000);
