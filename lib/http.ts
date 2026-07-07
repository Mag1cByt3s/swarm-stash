// Small HTTP helpers shared by every route: JSON responses and body parsing.

import type { IncomingMessage, ServerResponse } from 'node:http';

export function sendJSON(res: ServerResponse, status: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

export const err = (res: ServerResponse, status: number, message: string): void =>
  sendJSON(res, status, { error: message });

// Bodies are small JSON blobs of varying shape; routes validate what they use.
export function readBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > maxBytes) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}
