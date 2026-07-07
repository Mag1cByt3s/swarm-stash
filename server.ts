// Swarm Stash — Node server with zero runtime dependencies
// Serves the SPA, handles Discord OAuth, and runs the trading API on SQLite
// (node:sqlite). Runs as TypeScript directly via Node's native type stripping.

import './env.ts'; // must load .env before db.ts reads DATA_DIR

import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import {
  CARDS, RARITIES, SERIES, PACK_COST, PACK_SIZE, DAILY_NEUROS, STARTING_NEUROS,
  STARTER_CARDS, FOIL_CHANCE, FOIL_MULT, type Card, type Rarity,
} from './catalog.ts';
import { ACHIEVEMENTS, type Achievement, type AchievementCtx } from './achievements.ts';
import * as battle from './battle.ts';
import type { Fighter } from './battle.ts';
import store from './db.ts';
import type { UserRow, InstanceRow, Trade, Battle, MemeRow, MemeStatus, AuctionRow } from './db.ts';

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const DISCORD_ENABLED = Boolean(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET);
const DEV_LOGIN = process.env.ALLOW_DEV_LOGIN === '1' || !DISCORD_ENABLED;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const REDIRECT_URI = `${BASE_URL}/auth/discord/callback`;

// ─── Meme submission portal config ───────────────────────────────────────────
// ADMINS: comma-separated Discord user IDs (or dev-login names) who moderate
// submissions. If empty, submissions are auto-approved (fine for local play).
const ADMINS = (process.env.ADMINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const MODERATION = ADMINS.length > 0;
const isAdmin = (u: UserRow | null | undefined): boolean =>
  Boolean(u) && (ADMINS.includes(u!.discordId ?? '') || (!u!.discordId && ADMINS.includes(u!.name)));

const UPLOAD_DIR = path.join(process.env.DATA_DIR || path.join(import.meta.dirname, 'data'), 'memes');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_MEME_BYTES = 5 * 1024 * 1024;
const MAX_PENDING_PER_USER = 3;
const APPROVAL_COPIES = 2; // copies the submitter receives when their meme is minted

// magic-byte sniffing — only real raster images become cards (no SVG: script risk)
const IMAGE_TYPES: { ext: string; mime: string; match: (b: Buffer) => boolean }[] = [
  { ext: '.png',  mime: 'image/png',  match: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: '.jpg',  mime: 'image/jpeg', match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.gif',  mime: 'image/gif',  match: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  { ext: '.webp', mime: 'image/webp', match: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

// deterministic rarity from the image hash, matching normal pack odds
function rarityFromHash(seed: string): Rarity {
  const total = Object.values(RARITIES).reduce((s, r) => s + r.weight, 0);
  let roll = (crypto.createHash('sha1').update(seed).digest().readUInt32BE(0) / 0xffffffff) * total;
  for (const [name, r] of Object.entries(RARITIES)) {
    roll -= r.weight;
    if (roll <= 0) return name as Rarity;
  }
  return 'common';
}

// ─── Sessions (HMAC-signed cookie) ───────────────────────────────────────────
const b64u = (buf: string | Buffer): string => Buffer.from(buf).toString('base64url');
const sign = (data: string): string => crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');

function makeSession(uid: string): string {
  const payload = b64u(JSON.stringify({ uid, exp: Date.now() + 30 * 864e5 }));
  return `${payload}.${sign(payload)}`;
}
function readSession(req: IncomingMessage): UserRow | null {
  const raw = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith('sess='));
  if (!raw) return null;
  const [payload, sig] = raw.slice(5).split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { uid: string; exp: number };
    if (exp < Date.now()) return null;
    return store.getUser(uid) || null;
  } catch { return null; }
}
const sessionCookie = (token: string): string =>
  `sess=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`;

// ─── Game helpers ────────────────────────────────────────────────────────────
// The card pool is the built-in lore set plus every approved community meme.
const RETIRED: Card = { id: 'retired', name: 'Retired Card', series: 'meme', rarity: 'common', emoji: '❓', flavor: 'Lost to the archives.' };

const memeToCard = (m: MemeRow): Card => ({
  id: m.id, name: m.name, series: 'meme', rarity: m.rarity,
  emoji: '🖼️', flavor: `submitted by ${m.submitterName}`,
  image: `/memes/${m.file}`,
});

const allCards = (): Card[] => CARDS.concat(store.memesByStatus('approved').map(memeToCard));
const getCard = (id: string): Card => allCards().find((c) => c.id === id) || RETIRED;

function rollCard(): Card {
  const cards = allCards();
  const total = Object.values(RARITIES).reduce((s, r) => s + r.weight, 0);
  let roll = Math.random() * total;
  let rarity: Rarity = 'common';
  for (const [name, r] of Object.entries(RARITIES)) {
    roll -= r.weight;
    if (roll <= 0) { rarity = name as Rarity; break; }
  }
  const pool = cards.filter((c) => c.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)]!;
}

function openPackFor(user: UserRow): InstanceRow[] {
  const cards: Card[] = [];
  for (let i = 0; i < PACK_SIZE; i++) cards.push(rollCard());
  // pity: guarantee at least one uncommon or better per pack
  if (cards.every((c) => c.rarity === 'common')) {
    const pool = allCards().filter((c) => c.rarity !== 'common');
    cards[Math.floor(Math.random() * cards.length)] = pool[Math.floor(Math.random() * pool.length)]!;
  }
  return cards.map((c) => store.grantCard(user.id, c.id, Math.random() < FOIL_CHANCE));
}

const instValue = (inst: InstanceRow): number =>
  RARITIES[getCard(inst.cardId).rarity].value * (inst.foil ? FOIL_MULT : 1);

// ─── Achievements ────────────────────────────────────────────────────────────
// Runs all locked checks for a user; unlocks + pays out rewards, returns the
// newly unlocked definitions so endpoints can surface them as toasts.
function checkAchievements(user: UserRow): Achievement[] {
  if (user.bot) return [];
  const fresh = store.getUser(user.id)!;
  const have = new Set(store.listAchievements(user.id).map((a) => a.achId));
  const insts = store.listByOwner(user.id);
  const isLegendary = (i: InstanceRow) => getCard(i.cardId).rarity === 'legendary';
  const ctx: AchievementCtx = {
    stat: (k) => store.getStat(user.id, k),
    ownedIds: new Set(insts.map((i) => i.cardId)),
    hasFoil: insts.some((i) => i.foil),
    hasLegendary: insts.some(isLegendary),
    hasFoilLegendary: insts.some((i) => i.foil && isLegendary(i)),
    neuros: fresh.neuros,
    approvedMemes: store.approvedCountBy(user.id),
    wotwWins: store.wotwWinsBy(user.id),
  };
  const unlocked: Achievement[] = [];
  let neuros = fresh.neuros;
  for (const a of ACHIEVEMENTS) {
    if (have.has(a.id) || !a.check(ctx)) continue;
    store.unlockAchievement(user.id, a.id);
    neuros += a.reward;
    unlocked.push(a);
  }
  if (neuros !== fresh.neuros) store.setNeuros(user.id, neuros);
  return unlocked;
}
const achOut = ({ id, name, emoji, desc, reward }: Achievement) => ({ id, name, emoji, desc, reward });

// Post-trade bookkeeping for both parties; returns userId → newly unlocked.
function tradeExecuted(trade: Trade): Record<string, Achievement[]> {
  const unlocked: Record<string, Achievement[]> = {};
  for (const id of [trade.fromId, trade.toId]) {
    store.bumpStat(id, 'trades');
    unlocked[id] = checkAchievements(store.getUser(id)!);
  }
  return unlocked;
}

// ─── Battles ─────────────────────────────────────────────────────────────────
const MAX_WAGER = 1000;

// 3 distinct owned instances → fighter snapshots (stats frozen at this moment)
function buildTeam(user: UserRow, ids: unknown): Fighter[] | null {
  if (!Array.isArray(ids) || ids.length !== 3 || new Set(ids).size !== 3) return null;
  const team: Fighter[] = [];
  for (const id of ids as string[]) {
    const inst = store.getInstance(id);
    if (!inst || inst.ownerId !== user.id) return null;
    team.push(battle.fighter(getCard(inst.cardId), Boolean(inst.foil)));
  }
  return team;
}

// Bots field their 3 most valuable cards (distinct cards where possible)
function botTeamIds(bot: UserRow): string[] | null {
  const insts = store.listByOwner(bot.id).sort((a, b) => instValue(b) - instValue(a));
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const i of insts) {
    if (seen.has(i.cardId)) continue;
    seen.add(i.cardId);
    picked.push(i.id);
    if (picked.length === 3) return picked;
  }
  for (const i of insts) { // not enough distinct cards — allow duplicates
    if (!picked.includes(i.id)) picked.push(i.id);
    if (picked.length === 3) return picked;
  }
  return null;
}

function activateBattle(b: Battle, opponentTeam: Fighter[]): void {
  b.state.teams[b.toId] = opponentTeam;
  b.status = 'active';
  // faster opening fighter moves first; challenger wins speed ties
  const from = b.state.teams[b.fromId]![0]!, to = opponentTeam[0]!;
  const first = to.spd > from.spd ? b.toId : b.fromId;
  b.state.turn = first;
  battle.log(b.state, `⚔️ Battle start! ${battle.activeF(b.state, first).name} is faster and moves first.`);
}

function finishBattle(b: Battle, winnerId: string): Record<string, Achievement[]> {
  b.status = 'done';
  b.winnerId = winnerId;
  b.state.turn = null;
  battle.log(b.state, `🏆 ${store.getUser(winnerId)!.name} wins the battle!`);
  if (b.wager > 0) {
    const w = store.getUser(winnerId)!;
    store.setNeuros(winnerId, w.neuros + b.wager * 2);
    battle.log(b.state, `⚡${b.wager * 2} pot goes to the winner.`);
  }
  store.bumpStat(winnerId, 'battleWins');
  const unlocked: Record<string, Achievement[]> = {};
  for (const id of [b.fromId, b.toId]) unlocked[id] = checkAchievements(store.getUser(id)!);
  return unlocked;
}

// Bots take their turns immediately; returns finish unlocks if the bot won.
function runBotTurns(b: Battle): Record<string, Achievement[]> | null {
  let guard = 0;
  while (b.status === 'active' && guard++ < 50) {
    if (!b.state.turn) break;
    const turnUser = store.getUser(b.state.turn);
    if (!turnUser || !turnUser.bot) break;
    const oppId = b.state.turn === b.fromId ? b.toId : b.fromId;
    const wiped = battle.attack(b.state, turnUser.id, oppId, battle.botPickMove(b.state, turnUser.id));
    if (wiped) return finishBattle(b, turnUser.id);
    b.state.turn = oppId;
  }
  return null;
}

const battleOut = (b: Battle) => ({
  id: b.id, fromId: b.fromId, toId: b.toId, wager: b.wager,
  status: b.status, winnerId: b.winnerId, state: b.state,
  createdAt: b.createdAt, updatedAt: b.updatedAt,
});

// ─── Meme of the week ────────────────────────────────────────────────────────
const WOTW_REWARD = 250;
const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

function weekKey(d = new Date()): string { // ISO week, e.g. 2026-W28
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return `${date.getUTCFullYear()}-W${String(Math.ceil(((date.getTime() - yearStart.getTime()) / 864e5 + 1) / 7)).padStart(2, '0')}`;
}

// Lazily crown last week's winner: +neuros for the submitter and the meme
// card gets a permanent one-tier rarity upgrade.
function resolveWeeklyVote(): void {
  const prev = weekKey(new Date(Date.now() - 7 * 864e5));
  if (store.getWinner(prev)) return;
  for (const t of store.votesForWeek(prev)) { // sorted by votes desc
    const meme = store.getMeme(t.memeId);
    if (!meme || meme.status !== 'approved') continue;
    store.recordWinner(prev, meme.id, meme.submitterId);
    const up = RARITY_ORDER[Math.min(RARITY_ORDER.indexOf(meme.rarity) + 1, RARITY_ORDER.length - 1)]!;
    if (up !== meme.rarity) store.setMemeRarity(meme.id, up);
    const sub = store.getUser(meme.submitterId);
    if (sub) {
      store.setNeuros(sub.id, sub.neuros + WOTW_REWARD);
      checkAchievements(store.getUser(sub.id)!);
    }
    return;
  }
}

function publicUser(u: UserRow) {
  const counts = store.userCounts(u.id);
  return {
    id: u.id, name: u.name, avatar: u.avatar, bot: Boolean(u.bot),
    cardCount: counts.cardCount, uniqueCount: counts.uniqueCount,
    joinedAt: u.createdAt,
  };
}
const instOut = (i: InstanceRow) => ({ instanceId: i.id, cardId: i.cardId, ownerId: i.ownerId, obtainedAt: i.obtainedAt, foil: Boolean(i.foil) });

function tradeOut(t: Trade) {
  const resolve = (id: string) => {
    const inst = store.getInstance(id);
    return inst ? instOut(inst) : { instanceId: id, gone: true };
  };
  return { ...t, offer: t.offer.map(resolve), request: t.request.map(resolve) };
}

// ─── Seed bot swarm members so trading works out of the box ─────────────────
function seedBots(): void {
  const bots = [
    { name: 'gymbag_enjoyer',  packs: 5 },
    { name: 'buh_collector',   packs: 6 },
    { name: 'tutel_truther',   packs: 4 },
    { name: 'evil_hag_stan',   packs: 5 },
  ];
  for (const b of bots) {
    if (store.getUserByName(b.name)) continue;
    const user = store.createUser({
      name: b.name, bot: true, neuros: 500,
      avatar: `/api/avatar/${encodeURIComponent(b.name)}.svg`,
    });
    for (let i = 0; i < b.packs; i++) openPackFor(user);
  }
}
seedBots();

// Bots respond to trades: accept if the offered value is fair, otherwise decline.
function botConsiderTrade(trade: Trade): Trade {
  const value = (ids: string[]) => ids.reduce((s, id) => {
    const inst = store.getInstance(id);
    return s + (inst ? instValue(inst) : 0);
  }, 0);
  if (value(trade.offer) >= value(trade.request)) store.executeTrade(trade);
  else store.resolveTrade(trade.id, 'declined');
  return store.getTrade(trade.id)!;
}

// ─── HTTP plumbing ───────────────────────────────────────────────────────────
const MIME: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

function sendJSON(res: ServerResponse, status: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
const err = (res: ServerResponse, status: number, message: string): void => sendJSON(res, status, { error: message });

// Bodies are small JSON blobs of varying shape; routes validate what they use.
function readBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > maxBytes) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

// The SPA source is TypeScript (public/app.ts); browsers can't run it, so we
// serve it with the types stripped — the same machinery Node uses to run
// server.ts, no build step and no committed artifact. Cached until the file
// changes (mtime), so it strips once per edit, not per request.
let appJsCache: { mtimeMs: number; code: string } | null = null;
function appJs(): string {
  const src = path.join(import.meta.dirname, 'public', 'app.ts');
  const { mtimeMs } = fs.statSync(src);
  if (!appJsCache || appJsCache.mtimeMs !== mtimeMs) {
    appJsCache = { mtimeMs, code: stripTypeScriptTypes(fs.readFileSync(src, 'utf8')) };
  }
  return appJsCache.code;
}

function serveStatic(res: ServerResponse, urlPath: string): void {
  const file = path.normalize(path.join(import.meta.dirname, 'public', urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(path.join(import.meta.dirname, 'public'))) return err(res, 403, 'forbidden');
  fs.readFile(file, (e, buf) => {
    if (e) {
      // SPA fallback
      if (!path.extname(file)) return serveStatic(res, '/');
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

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

const oauthStates = new Map<string, number>(); // state -> expiry

// ─── Routes ──────────────────────────────────────────────────────────────────
async function handle(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
  const url = new URL(req.url || '/', BASE_URL);
  const p = url.pathname;
  const me = readSession(req);

  // ── auth ──
  if (p === '/auth/discord' && req.method === 'GET') {
    if (!DISCORD_ENABLED) return err(res, 400, 'Discord OAuth is not configured. Set DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET in .env');
    const state = crypto.randomBytes(16).toString('hex');
    oauthStates.set(state, Date.now() + 10 * 60e3);
    const auth = new URL('https://discord.com/oauth2/authorize');
    auth.search = new URLSearchParams({ client_id: DISCORD_CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: 'identify', state }).toString();
    res.writeHead(302, { Location: auth.href });
    return res.end();
  }

  if (p === '/auth/discord/callback' && req.method === 'GET') {
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
      return res.end();
    } catch (e) {
      console.error('OAuth failed:', (e as Error).message);
      res.writeHead(302, { Location: '/?login=failed' });
      return res.end();
    }
  }

  if (p === '/auth/dev' && req.method === 'POST') {
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
    return res.end(JSON.stringify({ ok: true }));
  }

  if (p === '/auth/logout' && req.method === 'POST') {
    res.writeHead(200, { 'Set-Cookie': 'sess=; Path=/; Max-Age=0', 'Content-Type': 'application/json' });
    return res.end('{"ok":true}');
  }

  // ── public API ──
  if (p === '/api/config') return sendJSON(res, 200, {
    discord: DISCORD_ENABLED, devLogin: DEV_LOGIN,
    packCost: PACK_COST, packSize: PACK_SIZE, daily: DAILY_NEUROS,
    moderation: MODERATION, foilChance: FOIL_CHANCE, foilMult: FOIL_MULT,
    battle: { moves: battle.MOVES, cycle: battle.CYCLE },
  });
  if (p === '/api/catalog') {
    const cards = allCards().map((c) => ({ ...c, combat: battle.statsFor(c) }));
    return sendJSON(res, 200, { cards, rarities: RARITIES, series: SERIES });
  }

  // the SPA script — public/app.ts with types stripped at serve time
  if (p === '/app.js' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end(appJs());
  }

  // uploaded meme images
  const memeFile = p.match(/^\/memes\/([^/]+)$/);
  if (memeFile) {
    const file = path.join(UPLOAD_DIR, path.basename(decodeURIComponent(memeFile[1]!)));
    return fs.readFile(file, (e, buf) => {
      if (e) { res.writeHead(404); return res.end('not found'); }
      const type = IMAGE_TYPES.find((t) => file.endsWith(t.ext));
      res.writeHead(200, {
        'Content-Type': type ? type.mime : 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=86400, immutable',
      });
      res.end(buf);
    });
  }

  const avatarMatch = p.match(/^\/api\/avatar\/(.+)\.svg$/);
  if (avatarMatch) {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
    return res.end(avatarSVG(decodeURIComponent(avatarMatch[1]!)));
  }

  if (p === '/api/me') {
    if (!me) return sendJSON(res, 200, { user: null });
    return sendJSON(res, 200, { user: {
      ...publicUser(me), neuros: me.neuros,
      dailyReady: Date.now() - me.lastDaily > 20 * 3600e3,
      isAdmin: isAdmin(me),
      modPending: isAdmin(me) ? store.pendingCount() : 0,
    } });
  }

  if (p === '/api/users') {
    const users = store.listUsers().map(publicUser).sort((a, b) => b.cardCount - a.cardCount);
    return sendJSON(res, 200, { users });
  }

  if (p === '/api/leaderboard') {
    // binder value (foils count ×FOIL_MULT) + 100 clout per achievement; bots don't rank
    const board = store.listUsers().filter((u) => !u.bot).map((u) => {
      const insts = store.listByOwner(u.id);
      const value = insts.reduce((s, i) => s + instValue(i), 0);
      const achievements = store.listAchievements(u.id).length;
      return {
        id: u.id, name: u.name, avatar: u.avatar,
        cards: insts.length, unique: new Set(insts.map((i) => i.cardId)).size,
        foils: insts.filter((i) => i.foil).length,
        achievements, score: value + achievements * 100,
      };
    }).sort((a, b) => b.score - a.score);
    return sendJSON(res, 200, { board });
  }

  if (p === '/api/collection') {
    const targetId = url.searchParams.get('user') || me?.id;
    const target = targetId ? store.getUser(targetId) : undefined;
    if (!target) return err(res, 404, 'user not found');
    const cards = store.listByOwner(target.id).map(instOut);
    const showcase = (JSON.parse(target.showcase || '[]') as string[]).filter((id) => {
      const inst = store.getInstance(id);
      return inst && inst.ownerId === target.id; // drop pins for cards that changed hands
    });
    return sendJSON(res, 200, { user: publicUser(target), cards, showcase });
  }

  // static frontend is public; everything below requires login
  if (!p.startsWith('/api/') && !p.startsWith('/auth/')) return serveStatic(res, p);
  if (!me) return err(res, 401, 'login required');

  if (p === '/api/daily' && req.method === 'POST') {
    if (Date.now() - me.lastDaily < 20 * 3600e3) return err(res, 429, 'Daily neuros already claimed. Come back later!');
    store.claimDaily(me.id, me.neuros + DAILY_NEUROS, Date.now());
    const unlocked = checkAchievements(me);
    return sendJSON(res, 200, { neuros: store.getUser(me.id)!.neuros, gained: DAILY_NEUROS, unlocked: unlocked.map(achOut) });
  }

  if (p === '/api/achievements' && req.method === 'GET') {
    const unlocked = Object.fromEntries(store.listAchievements(me.id).map((a) => [a.achId, a.unlockedAt]));
    return sendJSON(res, 200, { defs: ACHIEVEMENTS.map(achOut), unlocked });
  }

  if (p === '/api/packs/open' && req.method === 'POST') {
    if (me.neuros < PACK_COST) return err(res, 400, `Not enough neuros — a pack costs ${PACK_COST}.`);
    store.setNeuros(me.id, me.neuros - PACK_COST);
    store.bumpStat(me.id, 'packs');
    const pulls = openPackFor(me);
    const unlocked = checkAchievements(me);
    return sendJSON(res, 200, { neuros: store.getUser(me.id)!.neuros, cards: pulls.map(instOut), unlocked: unlocked.map(achOut) });
  }

  const sellMatch = p.match(/^\/api\/cards\/([^/]+)\/sell$/);
  if (sellMatch && req.method === 'POST') {
    const inst = store.getInstance(sellMatch[1]!);
    if (!inst || inst.ownerId !== me.id) return err(res, 404, 'card not found in your binder');
    if (store.lockedInstanceIds().has(inst.id)) return err(res, 400, 'card is locked in a pending trade or market listing');
    const value = instValue(inst);
    store.deleteInstance(inst.id);
    store.setNeuros(me.id, me.neuros + value);
    store.bumpStat(me.id, 'recycled');
    const unlocked = checkAchievements(me);
    return sendJSON(res, 200, { neuros: store.getUser(me.id)!.neuros, gained: value, unlocked: unlocked.map(achOut) });
  }

  // ── meme submission portal ──
  if (p === '/api/memes' && req.method === 'POST') {
    if (store.pendingCountBy(me.id) >= MAX_PENDING_PER_USER)
      return err(res, 429, `You already have ${MAX_PENDING_PER_USER} memes waiting for review — patience, swarm member.`);
    let body;
    try { body = await readBody(req, Math.ceil(MAX_MEME_BYTES * 1.4) + 4096); } // base64 overhead
    catch { return err(res, 413, `Meme too large — max ${MAX_MEME_BYTES / 1024 / 1024}MB.`); }

    const name = String(body.name || '').trim().slice(0, 48);
    if (!name) return err(res, 400, 'give your meme a name');
    const dataUrl = String(body.data || '');
    const b64 = dataUrl.replace(/^data:[^,]*,/, '');
    let buf: Buffer;
    try { buf = Buffer.from(b64, 'base64'); } catch { return err(res, 400, 'bad image data'); }
    if (buf.length < 100) return err(res, 400, 'bad image data');
    if (buf.length > MAX_MEME_BYTES) return err(res, 413, `Meme too large — max ${MAX_MEME_BYTES / 1024 / 1024}MB.`);
    const type = IMAGE_TYPES.find((t) => t.match(buf));
    if (!type) return err(res, 400, 'unsupported format — use PNG, JPEG, GIF, or WEBP');

    const hash = crypto.createHash('sha1').update(buf).digest('hex');
    const id = 'm_' + hash.slice(0, 16);
    if (store.getMeme(id)) return err(res, 409, 'this exact meme was already submitted');

    const file = `${hash.slice(0, 20)}${type.ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
    const rarity = rarityFromHash(hash);
    const status: MemeStatus = MODERATION ? 'pending' : 'approved';
    store.createMeme({ id, name, file, rarity, submitterId: me.id, status });
    if (status === 'approved') for (let i = 0; i < APPROVAL_COPIES; i++) store.grantCard(me.id, id);
    const unlocked = status === 'approved' ? checkAchievements(me) : [];
    return sendJSON(res, 200, { id, rarity, status,
      neuros: store.getUser(me.id)!.neuros, unlocked: unlocked.map(achOut),
      note: status === 'approved'
        ? `Minted instantly as a ${rarity} card — ${APPROVAL_COPIES} copies are in your binder!`
        : 'Submitted for review. A moderator will take a look.' });
  }

  if (p === '/api/memes/mine' && req.method === 'GET') {
    return sendJSON(res, 200, { memes: store.memesBySubmitter(me.id) });
  }

  if (p === '/api/memes/queue' && req.method === 'GET') {
    if (!isAdmin(me)) return err(res, 403, 'moderators only');
    return sendJSON(res, 200, { memes: store.memesByStatus('pending') });
  }

  const memeAction = p.match(/^\/api\/memes\/([^/]+)\/(approve|reject)$/);
  if (memeAction && req.method === 'POST') {
    if (!isAdmin(me)) return err(res, 403, 'moderators only');
    const meme = store.getMeme(memeAction[1]!);
    if (!meme) return err(res, 404, 'meme not found');
    if (meme.status !== 'pending') return err(res, 400, 'already reviewed');
    if (memeAction[2] === 'approve') {
      store.resolveMeme(meme.id, 'approved');
      for (let i = 0; i < APPROVAL_COPIES; i++) store.grantCard(meme.submitterId, meme.id);
      checkAchievements(store.getUser(meme.submitterId)!); // Meme Lord etc. pay out even without a toast
    } else {
      store.resolveMeme(meme.id, 'rejected');
      fs.unlink(path.join(UPLOAD_DIR, meme.file), () => {});
    }
    return sendJSON(res, 200, { ok: true, status: memeAction[2] === 'approve' ? 'approved' : 'rejected' });
  }

  // ── trades ──
  if (p === '/api/trades' && req.method === 'GET') {
    const mine = store.listTradesFor(me.id).map(tradeOut);
    const names: Record<string, { name: string; avatar: string }> = {};
    for (const t of mine) {
      for (const id of [t.fromId, t.toId]) {
        if (names[id]) continue;
        const u = store.getUser(id);
        if (u) names[id] = { name: u.name, avatar: u.avatar };
      }
    }
    return sendJSON(res, 200, { trades: mine, users: names });
  }

  if (p === '/api/trades' && req.method === 'POST') {
    const { toId, offer = [], request = [], message = '' } = await readBody(req);
    const target = store.getUser(toId);
    if (!target || target.id === me.id) return err(res, 400, 'invalid trade partner');
    if (!offer.length || !request.length) return err(res, 400, 'both sides of the trade need at least one card');
    if (offer.length > 6 || request.length > 6) return err(res, 400, 'max 6 cards per side');
    for (const id of offer) {
      const inst = store.getInstance(id);
      if (!inst || inst.ownerId !== me.id) return err(res, 400, 'you can only offer cards you own');
    }
    for (const id of request) {
      const inst = store.getInstance(id);
      if (!inst || inst.ownerId !== target.id) return err(res, 400, 'requested cards must belong to the trade partner');
    }
    const locked = store.lockedInstanceIds();
    if ([...offer, ...request].some((id) => locked.has(id))) return err(res, 400, 'one of these cards is locked in another pending trade');

    let trade = store.createTrade({
      fromId: me.id, toId: target.id,
      offer: [...new Set(offer as string[])], request: [...new Set(request as string[])],
      message: String(message).slice(0, 200),
    });
    let unlocked: Achievement[] = [];
    if (target.bot) {
      trade = botConsiderTrade(trade);
      if (trade.status === 'accepted') unlocked = tradeExecuted(trade)[me.id]!;
    }
    return sendJSON(res, 200, { trade: tradeOut(trade), unlocked: unlocked.map(achOut), neuros: store.getUser(me.id)!.neuros });
  }

  const tradeAction = p.match(/^\/api\/trades\/([^/]+)\/(accept|decline|cancel)$/);
  if (tradeAction && req.method === 'POST') {
    const [, id, action] = tradeAction;
    const t = store.getTrade(id!);
    if (!t) return err(res, 404, 'trade not found');
    if (t.status !== 'pending') return err(res, 400, 'trade already resolved');
    if (action === 'cancel' && t.fromId !== me.id) return err(res, 403, 'only the sender can cancel');
    if ((action === 'accept' || action === 'decline') && t.toId !== me.id) return err(res, 403, 'only the recipient can respond');

    let unlocked: Achievement[] = [];
    if (action === 'accept') {
      // re-validate ownership at accept time
      const owns = (cid: string, uid: string) => { const i = store.getInstance(cid); return i && i.ownerId === uid; };
      const ok = t.offer.every((cid) => owns(cid, t.fromId)) && t.request.every((cid) => owns(cid, t.toId));
      if (!ok) { store.resolveTrade(t.id, 'expired'); return err(res, 409, 'a card in this trade changed hands — trade expired'); }
      store.executeTrade(t);
      unlocked = tradeExecuted(t)[me.id]!;
    } else {
      store.resolveTrade(t.id, action === 'decline' ? 'declined' : 'cancelled');
    }
    return sendJSON(res, 200, { trade: tradeOut(store.getTrade(id!)!), unlocked: unlocked.map(achOut), neuros: store.getUser(me.id)!.neuros });
  }

  // ── battles ──
  if (p === '/api/battles' && req.method === 'GET') {
    const mine = store.listBattlesFor(me.id).map(battleOut);
    const names: Record<string, { name: string; avatar: string; bot: boolean }> = {};
    for (const b of mine) {
      for (const id of [b.fromId, b.toId]) {
        if (names[id]) continue;
        const u = store.getUser(id);
        if (u) names[id] = { name: u.name, avatar: u.avatar, bot: Boolean(u.bot) };
      }
    }
    return sendJSON(res, 200, { battles: mine, users: names });
  }

  if (p === '/api/battles' && req.method === 'POST') {
    const { toId, team, wager = 0 } = await readBody(req);
    const target = store.getUser(toId);
    if (!target || target.id === me.id) return err(res, 400, 'invalid opponent');
    const w = Math.floor(Number(wager)) || 0;
    if (w < 0 || w > MAX_WAGER) return err(res, 400, `wager must be 0–${MAX_WAGER} neuros`);
    if (me.neuros < w) return err(res, 400, 'you cannot stake neuros you do not have');
    const myTeam = buildTeam(me, team);
    if (!myTeam) return err(res, 400, 'pick exactly 3 different cards you own');

    const b = store.createBattle({
      fromId: me.id, toId: target.id, wager: w, status: 'pending',
      state: {
        teams: { [me.id]: myTeam, [target.id]: null },
        active: { [me.id]: 0, [target.id]: 0 },
        turn: null,
        log: [`${me.name} challenges ${target.name}${w ? ` for ⚡${w}` : ''}!`],
      },
    });

    let unlocked: Achievement[] = [];
    if (target.bot) {
      const botIds = botTeamIds(target);
      if (!botIds || target.neuros < w) {
        b.status = 'declined';
        battle.log(b.state, `${target.name} ducks out of the challenge. 🐔`);
      } else {
        store.setNeuros(me.id, me.neuros - w);
        store.setNeuros(target.id, target.neuros - w);
        activateBattle(b, buildTeam(target, botIds)!);
        const finished = runBotTurns(b);
        if (finished) unlocked = finished[me.id]!;
      }
      store.saveBattle(b);
    }
    return sendJSON(res, 200, { battle: battleOut(b), unlocked: unlocked.map(achOut), neuros: store.getUser(me.id)!.neuros });
  }

  const battleGet = p.match(/^\/api\/battles\/([^/]+)$/);
  if (battleGet && req.method === 'GET') {
    const b = store.getBattle(battleGet[1]!);
    if (!b || (b.fromId !== me.id && b.toId !== me.id)) return err(res, 404, 'battle not found');
    const names: Record<string, { name: string; avatar: string; bot: boolean }> = {};
    for (const id of [b.fromId, b.toId]) {
      const u = store.getUser(id);
      if (u) names[id] = { name: u.name, avatar: u.avatar, bot: Boolean(u.bot) };
    }
    return sendJSON(res, 200, { battle: battleOut(b), users: names });
  }

  const battleAction = p.match(/^\/api\/battles\/([^/]+)\/(accept|decline|cancel|move)$/);
  if (battleAction && req.method === 'POST') {
    const [, id, action] = battleAction;
    const b = store.getBattle(id!);
    if (!b || (b.fromId !== me.id && b.toId !== me.id)) return err(res, 404, 'battle not found');
    let unlocked: Achievement[] = [];

    if (action === 'accept' || action === 'decline') {
      if (b.status !== 'pending') return err(res, 400, 'battle already started or resolved');
      if (b.toId !== me.id) return err(res, 403, 'only the challenged player can respond');
      if (action === 'decline') {
        b.status = 'declined';
      } else {
        const { team } = await readBody(req);
        const myTeam = buildTeam(me, team);
        if (!myTeam) return err(res, 400, 'pick exactly 3 different cards you own');
        if (me.neuros < b.wager) return err(res, 400, `you need ⚡${b.wager} to match the wager`);
        const challenger = store.getUser(b.fromId)!;
        if (challenger.neuros < b.wager) {
          b.status = 'cancelled';
          battle.log(b.state, 'Challenge fizzled — the challenger spent their stake.');
          store.saveBattle(b);
          return err(res, 409, 'the challenger no longer has the wagered neuros');
        }
        store.setNeuros(me.id, me.neuros - b.wager);
        store.setNeuros(challenger.id, challenger.neuros - b.wager);
        activateBattle(b, myTeam);
      }
    } else if (action === 'cancel') {
      if (b.status !== 'pending') return err(res, 400, 'battle already started or resolved');
      if (b.fromId !== me.id) return err(res, 403, 'only the challenger can cancel');
      b.status = 'cancelled';
    } else { // move
      if (b.status !== 'active') return err(res, 400, 'battle is not active');
      const body = await readBody(req);
      const oppId = me.id === b.fromId ? b.toId : b.fromId;
      if (body.type === 'forfeit') {
        battle.log(b.state, `${me.name} forfeits. 🏳️`);
        unlocked = finishBattle(b, oppId)[me.id]!;
      } else {
        if (b.state.turn !== me.id) return err(res, 400, 'not your turn');
        if (body.type === 'swap') {
          const idx = Number(body.index);
          const team = b.state.teams[me.id];
          if (!team || !Number.isInteger(idx) || !team[idx] || team[idx].hp <= 0 || idx === b.state.active[me.id])
            return err(res, 400, 'invalid swap');
          b.state.active[me.id] = idx;
          battle.log(b.state, `${me.name} swaps in ${team[idx].name}!`);
          b.state.turn = oppId;
        } else if (body.type === 'attack') {
          const moveIdx = body.move === 1 ? 1 : 0;
          const wiped = battle.attack(b.state, me.id, oppId, moveIdx);
          if (wiped) unlocked = finishBattle(b, me.id)[me.id]!;
          else b.state.turn = oppId;
        } else {
          return err(res, 400, 'unknown move');
        }
        if (b.status === 'active') {
          const finished = runBotTurns(b);
          if (finished) unlocked = finished[me.id]!;
        }
      }
    }
    store.saveBattle(b);
    return sendJSON(res, 200, { battle: battleOut(b), unlocked: unlocked.map(achOut), neuros: store.getUser(me.id)!.neuros });
  }

  // ── marketplace ──
  if (p === '/api/market' && req.method === 'GET') {
    const listings = store.activeListings().flatMap((l) => {
      const inst = store.getInstance(l.instanceId);
      return inst && inst.ownerId === l.sellerId
        ? [{ id: l.id, price: l.price, sellerId: l.sellerId, sellerName: l.sellerName, sellerAvatar: l.sellerAvatar, createdAt: l.createdAt, card: instOut(inst) }]
        : [];
    });
    return sendJSON(res, 200, { listings });
  }

  if (p === '/api/market' && req.method === 'POST') {
    const { instanceId, price } = await readBody(req);
    const inst = store.getInstance(String(instanceId || ''));
    if (!inst || inst.ownerId !== me.id) return err(res, 404, 'card not found in your binder');
    if (store.lockedInstanceIds().has(inst.id)) return err(res, 400, 'card is already listed or locked in a trade');
    const pr = Math.floor(Number(price));
    if (!Number.isFinite(pr) || pr < 1 || pr > 100000) return err(res, 400, 'price must be 1–100000 neuros');
    const listing = store.createListing({ instanceId: inst.id, sellerId: me.id, price: pr });
    return sendJSON(res, 200, { listing });
  }

  const marketAction = p.match(/^\/api\/market\/([^/]+)\/(buy|cancel)$/);
  if (marketAction && req.method === 'POST') {
    const l = store.getListing(marketAction[1]!);
    if (!l || l.status !== 'active') return err(res, 404, 'listing not found');
    if (marketAction[2] === 'cancel') {
      if (l.sellerId !== me.id) return err(res, 403, 'not your listing');
      store.resolveListing(l.id, 'cancelled');
      return sendJSON(res, 200, { ok: true });
    }
    if (l.sellerId === me.id) return err(res, 400, 'that is your own listing');
    if (me.neuros < l.price) return err(res, 400, `not enough neuros — this card costs ⚡${l.price}`);
    const inst = store.getInstance(l.instanceId);
    if (!inst || inst.ownerId !== l.sellerId) {
      store.resolveListing(l.id, 'cancelled');
      return err(res, 409, 'that card is gone — listing removed');
    }
    const seller = store.getUser(l.sellerId)!;
    store.transferInstance(inst.id, me.id);
    store.setNeuros(me.id, me.neuros - l.price);
    store.setNeuros(seller.id, seller.neuros + l.price);
    store.resolveListing(l.id, 'sold', me.id);
    store.bumpStat(seller.id, 'marketSales');
    checkAchievements(store.getUser(seller.id)!);
    const unlocked = checkAchievements(me);
    return sendJSON(res, 200, { ok: true, neuros: store.getUser(me.id)!.neuros, unlocked: unlocked.map(achOut) });
  }

  // ── auction house ──
  const MIN_AUCTION_HOURS = 1, MAX_AUCTION_HOURS = 168; // 1 week cap

  function auctionOut(a: AuctionRow) {
    return {
      id: a.id, sellerId: a.sellerId, sellerName: a.sellerName, sellerAvatar: a.sellerAvatar,
      startingBid: a.startingBid, currentBid: a.currentBid, bidCount: a.bidCount,
      currentBidderId: a.currentBidderId,
      currentBidderName: a.bidderName || null,
      endsAt: a.endsAt, createdAt: a.createdAt,
      card: instOut(store.getInstance(a.instanceId) || { id: a.instanceId, cardId: 'retired', ownerId: a.sellerId, obtainedAt: a.createdAt, foil: 0 }),
    };
  }

  if (p === '/api/market/auctions' && req.method === 'GET') {
    store.resolveExpiredAuctions();
    return sendJSON(res, 200, { auctions: store.activeAuctions().map(auctionOut) });
  }

  if (p === '/api/market/auctions' && req.method === 'POST') {
    store.resolveExpiredAuctions();
    const { instanceId, startingBid, durationHours } = await readBody(req);
    const inst = store.getInstance(instanceId);
    if (!inst || inst.ownerId !== me.id) return err(res, 404, 'card not found in your binder');
    if (store.lockedInstanceIds().has(inst.id)) return err(res, 400, 'card is already listed, auctioned, or locked in a trade');
    const bid = Math.floor(Number(startingBid));
    if (!Number.isFinite(bid) || bid < 1 || bid > 100000) return err(res, 400, 'starting bid must be 1–100000 neuros');
    const hours = Math.floor(Number(durationHours));
    if (!Number.isFinite(hours) || hours < MIN_AUCTION_HOURS || hours > MAX_AUCTION_HOURS)
      return err(res, 400, `duration must be ${MIN_AUCTION_HOURS}–${MAX_AUCTION_HOURS} hours`);
    const auction = store.createAuction({ instanceId: inst.id, sellerId: me.id, startingBid: bid, durationHours: hours });
    return sendJSON(res, 200, { auction: auctionOut({ ...auction, sellerName: me.name, sellerAvatar: me.avatar, bidCount: 0 }) });
  }

  const auctionAction = p.match(/^\/api\/market\/auctions\/([^/]+)\/(bid|cancel)$/);
  if (auctionAction && req.method === 'POST') {
    store.resolveExpiredAuctions();
    const [, id, action] = auctionAction;
    if (action === 'cancel') {
      const a = store.getAuction(id);
      if (!a || a.status !== 'active') return err(res, 404, 'auction not found');
      if (a.sellerId !== me.id) return err(res, 403, 'not your auction');
      try { store.cancelAuction(id); }
      catch (e) { return err(res, 400, (e as Error).message); }
      return sendJSON(res, 200, { ok: true });
    }
    const { amount } = await readBody(req);
    const bidAmount = Math.floor(Number(amount));
    if (!Number.isFinite(bidAmount) || bidAmount < 1) return err(res, 400, 'invalid bid amount');
    try {
      store.placeBid(id, me.id, bidAmount);
    } catch (e) { return err(res, 400, (e as Error).message); }
    return sendJSON(res, 200, { ok: true, neuros: store.getUser(me.id)!.neuros, auction: auctionOut(store.activeAuctions().find((a) => a.id === id)!) });
  }

  // ── showcase (pinned cards on your public binder) ──
  if (p === '/api/showcase' && req.method === 'POST') {
    const { instanceIds } = await readBody(req);
    if (!Array.isArray(instanceIds)) return err(res, 400, 'instanceIds required');
    const clean = [...new Set(instanceIds as string[])].slice(0, 6);
    for (const id of clean) {
      const inst = store.getInstance(id);
      if (!inst || inst.ownerId !== me.id) return err(res, 400, 'you can only pin cards you own');
    }
    store.setShowcase(me.id, clean);
    return sendJSON(res, 200, { ok: true, showcase: clean });
  }

  // ── meme of the week ──
  if (p === '/api/vote' && req.method === 'GET') {
    resolveWeeklyVote();
    const week = weekKey();
    const counts = Object.fromEntries(store.votesForWeek(week).map((r) => [r.memeId, r.n]));
    const candidates = store.memesByStatus('approved')
      .map((m) => ({ id: m.id, name: m.name, file: m.file, rarity: m.rarity, submitterId: m.submitterId, submitterName: m.submitterName, votes: counts[m.id] || 0 }))
      .sort((a, b) => b.votes - a.votes)
      .slice(0, 30);
    let lastWinner: { week: string; name: string; file: string; rarity: Rarity; submitterName: string } | null = null;
    const row = store.latestWinner();
    if (row) {
      const m = store.getMeme(row.memeId);
      const u = store.getUser(row.submitterId);
      if (m) lastWinner = { week: row.week, name: m.name, file: m.file, rarity: m.rarity, submitterName: u ? u.name : '???' };
    }
    return sendJSON(res, 200, { week, candidates, myVote: store.myVote(week, me.id), lastWinner });
  }

  if (p === '/api/vote' && req.method === 'POST') {
    resolveWeeklyVote();
    const { memeId } = await readBody(req);
    const meme = store.getMeme(String(memeId || ''));
    if (!meme || meme.status !== 'approved') return err(res, 404, 'meme not found');
    if (meme.submitterId === me.id) return err(res, 400, 'no voting for your own meme, gremlin');
    store.castVote(weekKey(), me.id, meme.id);
    return sendJSON(res, 200, { ok: true, myVote: meme.id });
  }

  if (p.startsWith('/api/') || p.startsWith('/auth/')) return err(res, 404, 'no such endpoint');
  return serveStatic(res, p);
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
