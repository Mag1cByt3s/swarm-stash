// Static file serving for the SPA, including the one special case: the
// frontend source is TypeScript (public/app.ts); browsers can't run it, so
// /app.js serves it with the types stripped — the same machinery Node uses to
// run server.ts, no build step and no committed artifact.

import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import type { ServerResponse } from 'node:http';
import { ROOT } from './config.ts';
import { err } from './http.ts';

const PUBLIC_DIR = path.join(ROOT, 'public');

const MIME: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

// Cached until the file changes (mtime), so it strips once per edit, not per request.
let appJsCache: { mtimeMs: number; code: string } | null = null;
export function appJs(): string {
  const src = path.join(PUBLIC_DIR, 'app.ts');
  const { mtimeMs } = fs.statSync(src);
  if (!appJsCache || appJsCache.mtimeMs !== mtimeMs) {
    appJsCache = { mtimeMs, code: stripTypeScriptTypes(fs.readFileSync(src, 'utf8')) };
  }
  return appJsCache.code;
}

export function serveStatic(res: ServerResponse, urlPath: string): void {
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC_DIR)) return err(res, 403, 'forbidden');
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
