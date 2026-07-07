// Sessions: a stateless HMAC-signed cookie carrying the user id + expiry.

import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import store from '../db.ts';
import type { UserRow } from '../db.ts';
import { SESSION_SECRET } from './config.ts';

const b64u = (buf: string | Buffer): string => Buffer.from(buf).toString('base64url');
const sign = (data: string): string => crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');

export function makeSession(uid: string): string {
  const payload = b64u(JSON.stringify({ uid, exp: Date.now() + 30 * 864e5 }));
  return `${payload}.${sign(payload)}`;
}

export function readSession(req: IncomingMessage): UserRow | null {
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

export const sessionCookie = (token: string): string =>
  `sess=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`;

export const clearSessionCookie = 'sess=; Path=/; Max-Age=0';
