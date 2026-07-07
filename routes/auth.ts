// Login & logout: Discord OAuth (production) and the name-only dev login.

import crypto from 'node:crypto';
import store from '../db.ts';
import { STARTING_NEUROS, STARTER_CARDS } from '../catalog.ts';
import {
  DISCORD_ENABLED, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DEV_LOGIN, REDIRECT_URI,
} from '../lib/config.ts';
import { makeSession, sessionCookie, clearSessionCookie } from '../lib/session.ts';
import { err, readBody } from '../lib/http.ts';
import type { Router } from '../lib/router.ts';

const oauthStates = new Map<string, number>(); // state -> expiry

export function authRoutes(r: Router): void {
  r.get('/auth/discord', ({ res }) => {
    if (!DISCORD_ENABLED) return err(res, 400, 'Discord OAuth is not configured. Set DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET in .env');
    const state = crypto.randomBytes(16).toString('hex');
    oauthStates.set(state, Date.now() + 10 * 60e3);
    const auth = new URL('https://discord.com/oauth2/authorize');
    auth.search = new URLSearchParams({ client_id: DISCORD_CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: 'identify', state }).toString();
    res.writeHead(302, { Location: auth.href });
    res.end();
  });

  r.get('/auth/discord/callback', async ({ url, res }) => {
    const state = url.searchParams.get('state') ?? '';
    const code = url.searchParams.get('code');
    const exp = oauthStates.get(state);
    oauthStates.delete(state);
    if (!code || !exp || exp < Date.now()) { res.writeHead(302, { Location: '/?login=failed' }); return res.end(); }
    try {
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
      });
      if (!tokenRes.ok) throw new Error(`token exchange ${tokenRes.status}`);
      const { access_token } = await tokenRes.json() as { access_token: string };
      const userRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${access_token}` } });
      if (!userRes.ok) throw new Error(`user fetch ${userRes.status}`);
      const d = await userRes.json() as { id: string; username: string; global_name?: string; avatar?: string };
      const avatar = d.avatar
        ? `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png?size=128`
        : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(d.id) >> 22n) % 6}.png`;

      let user = store.getUserByDiscord(d.id);
      if (!user) {
        user = store.createUser({ discordId: d.id, name: d.global_name || d.username, avatar, neuros: STARTING_NEUROS });
        for (const c of STARTER_CARDS) store.grantCard(user.id, c);
      } else {
        store.setProfile(user.id, d.global_name || d.username, avatar); // keep profile in sync with Discord
      }
      res.writeHead(302, { 'Set-Cookie': sessionCookie(makeSession(user.id)), Location: '/' });
      res.end();
    } catch (e) {
      console.error('OAuth failed:', (e as Error).message);
      res.writeHead(302, { Location: '/?login=failed' });
      res.end();
    }
  });

  r.post('/auth/dev', async ({ req, res }) => {
    if (!DEV_LOGIN) return err(res, 403, 'dev login disabled');
    const { name } = await readBody(req);
    const clean = String(name || '').trim().slice(0, 32);
    if (!clean) return err(res, 400, 'name required');
    let user = store.getDevUserByName(clean);
    if (!user) {
      user = store.createUser({ name: clean, avatar: `/api/avatar/${encodeURIComponent(clean)}.svg`, neuros: STARTING_NEUROS });
      for (const c of STARTER_CARDS) store.grantCard(user.id, c);
    }
    res.writeHead(200, { 'Set-Cookie': sessionCookie(makeSession(user.id)), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  r.post('/auth/logout', ({ res }) => {
    res.writeHead(200, { 'Set-Cookie': clearSessionCookie, 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
}
