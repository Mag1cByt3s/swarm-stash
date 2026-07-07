// Public site plumbing: client config, the card catalog, the type-stripped
// SPA script, uploaded meme images, and generated identicon avatars.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { RARITIES, SERIES, PACK_COST, PACK_SIZE, DAILY_NEUROS, FOIL_CHANCE, FOIL_MULT } from '../catalog.ts';
import * as battle from '../battle.ts';
import { DISCORD_ENABLED, DEV_LOGIN, MODERATION, UPLOAD_DIR, IMAGE_TYPES } from '../lib/config.ts';
import { sendJSON } from '../lib/http.ts';
import { appJs } from '../lib/static.ts';
import { allCards } from '../lib/cardpool.ts';
import type { Router } from '../lib/router.ts';

// Deterministic pastel identicon for bot / dev accounts
function avatarSVG(seed: string): string {
  const h = crypto.createHash('sha1').update(seed).digest();
  const hue = h[0]! * 360 / 255, hue2 = (hue + 60) % 360;
  const initial = seed.replace(/[^a-zA-Z0-9]/g, ' ').trim().charAt(0).toUpperCase() || '?';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${hue} 70% 65%)"/><stop offset="1" stop-color="hsl(${hue2} 70% 45%)"/>
  </linearGradient></defs>
  <rect width="96" height="96" fill="url(#g)"/>
  <text x="48" y="62" font-family="sans-serif" font-size="44" font-weight="bold" fill="rgba(255,255,255,.92)" text-anchor="middle">${initial}</text>
</svg>`;
}

export function siteRoutes(r: Router): void {
  r.get('/api/config', ({ res }) => sendJSON(res, 200, {
    discord: DISCORD_ENABLED, devLogin: DEV_LOGIN,
    packCost: PACK_COST, packSize: PACK_SIZE, daily: DAILY_NEUROS,
    moderation: MODERATION, foilChance: FOIL_CHANCE, foilMult: FOIL_MULT,
    battle: { moves: battle.MOVES, cycle: battle.CYCLE },
  }));

  r.get('/api/catalog', ({ res }) => {
    const cards = allCards().map((c) => ({ ...c, combat: battle.statsFor(c) }));
    sendJSON(res, 200, { cards, rarities: RARITIES, series: SERIES });
  });

  // the SPA script — public/app.ts with types stripped at serve time
  r.get('/app.js', ({ res }) => {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(appJs());
  });

  // uploaded meme images
  r.get('/memes/:file', ({ res, params }) => {
    const file = path.join(UPLOAD_DIR, path.basename(params.file!));
    fs.readFile(file, (e, buf) => {
      if (e) { res.writeHead(404); return res.end('not found'); }
      const type = IMAGE_TYPES.find((t) => file.endsWith(t.ext));
      res.writeHead(200, {
        'Content-Type': type ? type.mime : 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=86400, immutable',
      });
      res.end(buf);
    });
  });

  r.get('/api/avatar/:file', ({ res, params }) => {
    if (!params.file!.endsWith('.svg')) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
    res.end(avatarSVG(params.file!.slice(0, -4)));
  });
}
