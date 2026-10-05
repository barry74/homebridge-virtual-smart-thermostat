import http from 'node:http';
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}
function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
}
function parseIdAndValue(input, query) {
    return {
        id: input.id ?? query.get('id') ?? undefined,
        value: input.value ?? input.temperature ?? input.active ?? query.get('value') ?? query.get('temperature') ?? query.get('active'),
    };
}
export function startWebhookServer(port, log, onTemperature, onTv) {
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
            let parsed = {};
            if (raw.trim()) {
                try {
                    parsed = JSON.parse(raw);
                }
                catch {
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
        }
        catch (error) {
            log.error('Webhook error:', error);
            sendJson(res, 500, { error: 'Internal error' });
        }
    });
    server.listen(port, '0.0.0.0', () => {
        log.info(`Webhook server listening on port ${port}`);
        log.info('POST /temperature  { "id": "<thermostat-id>", "value": 19.5 }');
        log.info('POST /temperature  { "id": "<thermostat-id>", "value": 19.5 }');
    });
    server.on('error', (error) => {
        log.error(`Webhook server failed on port ${port}:`, error);
    });
    return server;
}
export async function fetchTemperature(url, jsonPath) {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${url}`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json') || jsonPath) {
        const data = await response.json();
        const raw = jsonPath ? readPath(data, jsonPath) : data;
        const value = typeof raw === 'number' ? raw : Number(raw);
        return Number.isFinite(value) ? value : undefined;
    }
    const text = (await response.text()).trim();
    const value = Number(text);
    return Number.isFinite(value) ? value : undefined;
}
function readPath(data, path) {
    const parts = path.replace(/^\$\.?/, '').split('.').filter(Boolean);
    let current = data;
    for (const part of parts) {
        if (current === null || current === undefined || typeof current !== 'object') {
            return undefined;
        }
        current = current[part];
    }
    return current;
}
