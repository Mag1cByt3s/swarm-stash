// Small HTTP helpers shared by every route: JSON responses and body parsing.

type HeaderValue = string | number | readonly string[];
type HeaderMap = Record<string, HeaderValue>;
type ResponseBody = ConstructorParameters<typeof Response>[0];

export class ResponseSink {
  status = 200;
  headers = new Headers();
  body: ResponseBody = null;
  headersSent = false;

  writeHead(status: number, headers: HeaderMap = {}): void {
    this.status = status;
    for (const [name, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        for (const item of value) this.headers.append(name, item);
      } else {
        this.headers.set(name, String(value));
      }
    }
    this.headersSent = true;
  }

  setHeader(name: string, value: HeaderValue): void {
    if (Array.isArray(value)) {
      this.headers.delete(name);
      for (const item of value) this.headers.append(name, item);
    } else {
      this.headers.set(name, String(value));
    }
  }

  end(body?: ResponseBody): void {
    this.body = body ?? null;
    this.headersSent = true;
  }

  toResponse(): Response {
    return new Response(this.body, { status: this.status, headers: this.headers });
  }
}

export function sendJSON(res: ResponseSink, status: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

export const err = (res: ResponseSink, status: number, message: string): void =>
  sendJSON(res, status, { error: message });

// Bodies are small JSON blobs of varying shape; routes validate what they use.
export async function readBody(req: Request, maxBytes = 64 * 1024): Promise<any> {
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes) throw new Error('too large');
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error('bad json');
  }
}
