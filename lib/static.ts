// The one public-file rule Hono's static middleware does not cover for this app:
// browser modules live as TypeScript in public/js/*.ts, so serve them with types
// stripped at request time. Normal public assets are served by Hono's
// @hono/node-server/serve-static middleware.

import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import type { Context } from 'hono';
import { ROOT } from './config.ts';

export const PUBLIC_DIR = path.join(ROOT, 'public');

// Stripped modules are cached until the source changes (mtime), so each file
// strips once per edit, not once per request.
const stripCache = new Map<string, { mtimeMs: number; code: string }>();
function strippedTs(file: string): string | null {
  try {
    const { mtimeMs } = fs.statSync(file);
    const hit = stripCache.get(file);
    if (hit && hit.mtimeMs === mtimeMs) return hit.code;
    const code = stripTypeScriptTypes(fs.readFileSync(file, 'utf8'));
    stripCache.set(file, { mtimeMs, code });
    return code;
  } catch { return null; }
}

export function serveStrippedTypeScript(c: Context): Response {
  const url = new URL(c.req.url);
  const file = path.normalize(path.join(PUBLIC_DIR, url.pathname));
  if (!file.startsWith(PUBLIC_DIR) || !file.endsWith('.ts')) {
    return c.text('not found', 404);
  }
  const code = strippedTs(file);
  if (code === null) return c.text('not found', 404);
  return new Response(code, { headers: { 'Content-Type': 'text/javascript' } });
}
