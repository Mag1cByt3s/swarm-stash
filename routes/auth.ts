// Login & logout: Discord OAuth (production) and the name-only dev login.

import { discordAuth } from '@hono/oauth-providers/discord';
import store from '../db.ts';
import { STARTING_NEUROS, STARTER_CARDS } from '../catalog.ts';
import {
  DISCORD_ENABLED, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DEV_LOGIN, REDIRECT_URI,
} from '../lib/config.ts';
import { clearSession, startSession } from '../lib/session.ts';
import { err, readBody } from '../lib/http.ts';
import type { Router } from '../lib/router.ts';

export function authRoutes(r: Router): void {
  r.get('/auth/discord', ({ res }) => {
    if (!DISCORD_ENABLED) return err(res, 400, 'Discord OAuth is not configured. Set DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET in .env');
    res.writeHead(302, { Location: '/auth/discord/callback' });
    res.end();
  });

  r.app.get(
    '/auth/discord/callback',
    async (c, next) => {
      if (!DISCORD_ENABLED) return c.json({ error: 'Discord OAuth is not configured. Set DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET in .env' }, 400);
      try {
        return await discordAuth({
          client_id: DISCORD_CLIENT_ID,
          client_secret: DISCORD_CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          scope: ['identify'],
        })(c, next);
      } catch (e) {
        console.error('OAuth failed:', (e as Error).message);
        return c.redirect('/?login=failed');
      }
    },
    async (c) => {
      const d = c.get('user-discord');
      if (!d?.id) return c.redirect('/?login=failed');
      const displayName = d.global_name || d.username || 'Discord user';
      const avatar = d.avatar
        ? `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png?size=128`
        : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(d.id) >> 22n) % 6}.png`;

      let user = store.getUserByDiscord(d.id);
      if (!user) {
        user = store.createUser({ discordId: d.id, name: displayName, avatar, neuros: STARTING_NEUROS });
        for (const c of STARTER_CARDS) store.grantCard(user.id, c);
      } else {
        store.setProfile(user.id, displayName, avatar); // keep profile in sync with Discord
      }
      await startSession(c, user.id);
      return c.redirect('/');
    }
  );

  r.post('/auth/dev', async ({ req, res, c }) => {
    if (!DEV_LOGIN) return err(res, 403, 'dev login disabled');
    const { name } = await readBody(req);
    const clean = String(name || '').trim().slice(0, 32);
    if (!clean) return err(res, 400, 'name required');
    let user = store.getDevUserByName(clean);
    if (!user) {
      user = store.createUser({ name: clean, avatar: `/api/avatar/${encodeURIComponent(clean)}.svg`, neuros: STARTING_NEUROS });
      for (const c of STARTER_CARDS) store.grantCard(user.id, c);
    }
    await startSession(c, user.id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  r.post('/auth/logout', ({ res, c }) => {
    clearSession(c);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
}
