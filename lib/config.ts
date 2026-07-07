// All configuration in one place: environment variables, derived flags, and
// the constant tables that shape gameplay limits. Route modules import from
// here instead of reaching into process.env themselves.
//
// NOTE: env.ts (which loads .env) must be imported before this module runs —
// server.ts does that as its very first import.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { UserRow } from '../db.ts';

// Project root — this file lives in lib/, one level below it.
export const ROOT = path.join(import.meta.dirname, '..');

export const PORT = Number(process.env.PORT || 3000);
export const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
export const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
export const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
export const DISCORD_ENABLED = Boolean(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET);
export const DEV_LOGIN = process.env.ALLOW_DEV_LOGIN === '1' || !DISCORD_ENABLED;
export const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
export const REDIRECT_URI = `${BASE_URL}/auth/discord/callback`;

// ─── Meme submission portal ──────────────────────────────────────────────────
// ADMINS: comma-separated Discord user IDs (or dev-login names) who moderate
// submissions. If empty, submissions are auto-approved (fine for local play).
export const ADMINS = (process.env.ADMINS || '').split(',').map((s) => s.trim()).filter(Boolean);
export const MODERATION = ADMINS.length > 0;
export const isAdmin = (u: UserRow | null | undefined): boolean =>
  Boolean(u) && (ADMINS.includes(u!.discordId ?? '') || (!u!.discordId && ADMINS.includes(u!.name)));

export const UPLOAD_DIR = path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'memes');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const MAX_MEME_BYTES = 5 * 1024 * 1024;
export const MAX_PENDING_PER_USER = 3;
export const APPROVAL_COPIES = 2; // copies the submitter receives when their meme is minted

// magic-byte sniffing — only real raster images become cards (no SVG: script risk)
export const IMAGE_TYPES: { ext: string; mime: string; match: (b: Buffer) => boolean }[] = [
  { ext: '.png',  mime: 'image/png',  match: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: '.jpg',  mime: 'image/jpeg', match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.gif',  mime: 'image/gif',  match: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  { ext: '.webp', mime: 'image/webp', match: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];
