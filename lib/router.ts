// A small compatibility layer over Hono so routes keep reading as a
// declarative table, e.g.
//
//   r.userPost('/api/trades/:id/:action', handler)
//
// get/post register public routes; userGet/userPost require a logged-in user,
// so those handlers can rely on ctx.me being set.

import { Hono, type Context as HonoContext } from 'hono';
import type { UserRow } from '../db.ts';
import { readSession } from './session.ts';
import { err, ResponseSink } from './http.ts';

export interface Ctx {
  req: Request;
  res: ResponseSink;
  url: URL;
  params: Record<string, string>;
  me: UserRow | null;
  c: HonoContext;
}
// What userGet/userPost handlers receive: `me` is guaranteed.
export interface AuthCtx extends Ctx { me: UserRow }

type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

export class Router {
  readonly app = new Hono();

  get(path: string, handler: (ctx: Ctx) => unknown): void { this.add('GET', path, false, handler); }
  post(path: string, handler: (ctx: Ctx) => unknown): void { this.add('POST', path, false, handler); }
  userGet(path: string, handler: (ctx: AuthCtx) => unknown): void { this.add('GET', path, true, handler as Handler); }
  userPost(path: string, handler: (ctx: AuthCtx) => unknown): void { this.add('POST', path, true, handler as Handler); }

  private add(method: string, path: string, auth: boolean, handler: Handler): void {
    this.app.on(method, path, async (c) => {
      const me = readSession(c.req.raw);
      const sink = new ResponseSink();
      if (auth && !me) {
        err(sink, 401, 'login required');
        return sink.toResponse();
      }
      const result = await handler({
        req: c.req.raw,
        res: sink,
        url: new URL(c.req.url),
        params: c.req.param(),
        me,
        c,
      });
      if (result instanceof Response) return result;
      if (sink.headersSent) return sink.toResponse();
      return c.notFound();
    });
  }
}
