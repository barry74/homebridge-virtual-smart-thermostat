import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logging } from 'homebridge';

export type TempHandler = (id: string, value: number) => void;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parseIdAndValue(input: Record<string, unknown>, query: URLSearchParams): { id?: string; value?: unknown } {
  return {
    id: (input.id as string | undefined) ?? query.get('id') ?? undefined,
    value: input.value ?? input.temperature ?? query.get('value') ?? query.get('temperature'),
  };
}

export function startWebhookServer(
  port: number,
  log: Logging,
  onTemperature: TempHandler,
): http.Server {
  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        sendJson(res, 400, { error: 'Bad request' });
        return;
      }

      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const path = url.pathname.replace(/\/+$/, '') || '/';

      if (req.method === 'GET' && (path === '/' || path === '/status' || path === '/health')) {
        sendJson(res, 200, { ok: true, service: 'homebridge-virtual-smart-thermostat' });
        return;
      }

      if (req.method !== 'POST' && req.method !== 'PUT') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }

      const raw = await readBody(req);
      let parsed: Record<string, unknown> = {};
      if (raw.trim()) {
        try {
          parsed = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'Invalid JSON' });
          return;
        }
      }

      const { id, value } = parseIdAndValue(parsed, url.searchParams);
      if (!id) {
        sendJson(res, 400, { error: 'Missing id' });
        return;
      }

      if (path === '/temperature' || path === '/temp') {
        const temp = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(temp)) {
          sendJson(res, 400, { error: 'Invalid temperature' });
          return;
        }
        onTemperature(id, temp);
        sendJson(res, 200, { ok: true, id, temperature: temp });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      log.error('Webhook error:', error);
      sendJson(res, 500, { error: 'Internal error' });
    }
  });

  server.listen(port, '0.0.0.0', () => {
    log.info(`Webhook server listening on port ${port}`);
    log.info(`POST /temperature  { "id": "<thermostat-id>", "value": 19.5 }`);
  });

  server.on('error', (error) => {
    log.error(`Webhook server failed on port ${port}:`, error);
  });

  return server;
}

export async function fetchTemperature(url: string, jsonPath?: string): Promise<number | undefined> {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json') || jsonPath) {
    const data: unknown = await response.json();
    const raw = jsonPath ? readPath(data, jsonPath) : data;
    const value = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }

  const text = (await response.text()).trim();
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

function readPath(data: unknown, path: string): unknown {
  const parts = path.replace(/^\$\.?/, '').split('.').filter(Boolean);
  let current: unknown = data;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
