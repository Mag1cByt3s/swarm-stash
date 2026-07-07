// The meme portal: player submissions, the moderation queue, and the weekly
// Meme of the Week vote (winner gets neuros + a permanent rarity upgrade).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import store from '../db.ts';
import type { MemeStatus } from '../db.ts';
import type { Rarity } from '../catalog.ts';
import {
  MODERATION, isAdmin, UPLOAD_DIR, IMAGE_TYPES,
  MAX_MEME_BYTES, MAX_PENDING_PER_USER, APPROVAL_COPIES,
} from '../lib/config.ts';
import { sendJSON, err, readBody } from '../lib/http.ts';
import { rarityFromHash } from '../lib/cardpool.ts';
import { checkAchievements, achOut } from '../lib/progress.ts';
import type { Router } from '../lib/router.ts';

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

export function memeRoutes(r: Router): void {
  r.userPost('/api/memes', async ({ req, res, me }) => {
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
    sendJSON(res, 200, { id, rarity, status,
      neuros: store.getUser(me.id)!.neuros, unlocked: unlocked.map(achOut),
      note: status === 'approved'
        ? `Minted instantly as a ${rarity} card — ${APPROVAL_COPIES} copies are in your binder!`
        : 'Submitted for review. A moderator will take a look.' });
  });

  r.userGet('/api/memes/mine', ({ res, me }) => {
    sendJSON(res, 200, { memes: store.memesBySubmitter(me.id) });
  });

  r.userGet('/api/memes/queue', ({ res, me }) => {
    if (!isAdmin(me)) return err(res, 403, 'moderators only');
    sendJSON(res, 200, { memes: store.memesByStatus('pending') });
  });

  r.userPost('/api/memes/:id/:action', ({ res, me, params }) => {
    if (params.action !== 'approve' && params.action !== 'reject') return err(res, 404, 'no such endpoint');
    if (!isAdmin(me)) return err(res, 403, 'moderators only');
    const meme = store.getMeme(params.id!);
    if (!meme) return err(res, 404, 'meme not found');
    if (meme.status !== 'pending') return err(res, 400, 'already reviewed');
    if (params.action === 'approve') {
      store.resolveMeme(meme.id, 'approved');
      for (let i = 0; i < APPROVAL_COPIES; i++) store.grantCard(meme.submitterId, meme.id);
      checkAchievements(store.getUser(meme.submitterId)!); // Meme Lord etc. pay out even without a toast
    } else {
      store.resolveMeme(meme.id, 'rejected');
      fs.unlink(path.join(UPLOAD_DIR, meme.file), () => {});
    }
    sendJSON(res, 200, { ok: true, status: params.action === 'approve' ? 'approved' : 'rejected' });
  });

  // ── meme of the week ──
  r.userGet('/api/vote', ({ res, me }) => {
    resolveWeeklyVote();
    const week = weekKey();
    const counts = Object.fromEntries(store.votesForWeek(week).map((row) => [row.memeId, row.n]));
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
    sendJSON(res, 200, { week, candidates, myVote: store.myVote(week, me.id), lastWinner });
  });

  r.userPost('/api/vote', async ({ req, res, me }) => {
    resolveWeeklyVote();
    const { memeId } = await readBody(req);
    const meme = store.getMeme(String(memeId || ''));
    if (!meme || meme.status !== 'approved') return err(res, 404, 'meme not found');
    if (meme.submitterId === me.id) return err(res, 400, 'no voting for your own meme, gremlin');
    store.castVote(weekKey(), me.id, meme.id);
    sendJSON(res, 200, { ok: true, myVote: meme.id });
  });
}
