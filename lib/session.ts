// Sessions are encrypted stateless cookies managed by @hono/session.

import { useSession, type SessionEnv } from '@hono/session';
import type { Context } from 'hono';
import store from '../db.ts';
import type { UserRow } from '../db.ts';
import { SESSION_SECRET } from './config.ts';

export interface SessionData extends Record<string, unknown> {
  uid: string;
}

export type AppEnv = SessionEnv<SessionData>;
export type AppContext = Context<AppEnv>;

export const sessionMiddleware = useSession<SessionData>({
  secret: SESSION_SECRET,
  duration: { absolute: 30 * 86400 },
});

export async function readSession(c: AppContext): Promise<UserRow | null> {
  const data = await c.var.session.get();
  return data?.uid ? store.getUser(data.uid) || null : null;
}

export async function startSession(c: AppContext, uid: string): Promise<void> {
  await c.var.session.update({ uid });
}

export function clearSession(c: AppContext): void {
  c.var.session.delete();
}
