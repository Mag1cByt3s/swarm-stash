// A tiny path router so routes read as a declarative table instead of one
// long if-chain. Patterns are plain paths with :param segments, e.g.
//
//   r.userPost('/api/trades/:id/:action', handler)
//
// get/post register public routes; userGet/userPost require a logged-in user
// (the dispatcher answers 401 before the handler runs), so those handlers can
// rely on ctx.me being set.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { UserRow } from '../db.ts';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  me: UserRow | null;
}
// What userGet/userPost handlers receive: `me` is guaranteed.
export interface AuthCtx extends Ctx { me: UserRow }

type Handler = (ctx: Ctx) => unknown;

interface Route { method: string; parts: string[]; auth: boolean; handler: Handler }

export class Router {
  private routes: Route[] = [];

  get(path: string, handler: (ctx: Ctx) => unknown): void { this.add('GET', path, false, handler); }
  post(path: string, handler: (ctx: Ctx) => unknown): void { this.add('POST', path, false, handler); }
  userGet(path: string, handler: (ctx: AuthCtx) => unknown): void { this.add('GET', path, true, handler as Handler); }
  userPost(path: string, handler: (ctx: AuthCtx) => unknown): void { this.add('POST', path, true, handler as Handler); }

  private add(method: string, path: string, auth: boolean, handler: Handler): void {
    this.routes.push({ method, parts: path.split('/'), auth, handler });
  }

  // First registered match wins; register specific paths before :param ones.
  match(method: string, pathname: string): { auth: boolean; handler: Handler; params: Record<string, string> } | null {
    const parts = pathname.split('/');
    outer: for (const r of this.routes) {
      if (r.method !== method || r.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      for (let i = 0; i < parts.length; i++) {
        const pattern = r.parts[i]!;
        if (pattern.startsWith(':')) params[pattern.slice(1)] = decodeURIComponent(parts[i]!);
        else if (pattern !== parts[i]) continue outer;
      }
      return { auth: r.auth, handler: r.handler, params };
    }
    return null;
  }
}
