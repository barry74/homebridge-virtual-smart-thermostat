import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const CURRENT_TEMPERATURE_UUID = '00000011-0000-1000-8000-0026BB765291';
const CURRENT_HUMIDITY_UUID = '00000010-0000-1000-8000-0026BB765291';
const TEMPERATURE_SENSOR_UUID = '0000008a-0000-1000-8000-0026BB765291';
const THERMOSTAT_UUID = '0000004a-0000-1000-8000-0026BB765291';
const HUMIDITY_SENSOR_UUID = '00000082-0000-1000-8000-0026BB765291';

function normalize(value) {
    return value.trim().toLowerCase();
}
function uuidOf(value) {
    return (value ?? '').toLowerCase();
}
function numeric(value) {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function characteristicValue(service, uuid) {
    const match = (service.characteristics ?? []).find((item) => uuidOf(item.UUID).startsWith(uuid));
    return numeric(match?.value);
}
export function listHomebridgeClimateSensors(storagePath) {
    const accessories = readCachedAccessories(storagePath);
    const names = new Set();
    for (const accessory of accessories) {
        for (const service of accessory.services ?? []) {
            const serviceUuid = uuidOf(service.UUID);
            if (serviceUuid.startsWith(TEMPERATURE_SENSOR_UUID)
                || serviceUuid.startsWith(THERMOSTAT_UUID)
                || characteristicValue(service, CURRENT_TEMPERATURE_UUID) !== undefined) {
                if (accessory.displayName) {
                    names.add(accessory.displayName);
                }
                if (service.displayName) {
                    names.add(service.displayName);
                }
            }
        }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
}
export function readHomebridgeSensor(storagePath, sensorName) {
    const wanted = normalize(sensorName);
    const accessories = readCachedAccessories(storagePath);
    const matches = [];
    for (const accessory of accessories) {
        const accessoryName = accessory.displayName ?? '';
        let temperature;
        let humidity;
        for (const service of accessory.services ?? []) {
            const serviceName = service.displayName ?? '';
            const serviceUuid = uuidOf(service.UUID);
            const temp = characteristicValue(service, CURRENT_TEMPERATURE_UUID);
            const hum = characteristicValue(service, CURRENT_HUMIDITY_UUID);
            if (temp !== undefined) {
                temperature = temp;
            }
            if (hum !== undefined) {
                humidity = hum;
            }
            const nameHit = normalize(accessoryName) === wanted || normalize(serviceName) === wanted;
            if (nameHit && (temp !== undefined || serviceUuid.startsWith(TEMPERATURE_SENSOR_UUID) || serviceUuid.startsWith(THERMOSTAT_UUID) || serviceUuid.startsWith(HUMIDITY_SENSOR_UUID))) {
                matches.push({
                    temperature: temp ?? temperature,
                    humidity: hum ?? humidity,
                    source: `homebridge:${accessoryName}`,
                });
            }
        }
        if (normalize(accessoryName) === wanted && (temperature !== undefined || humidity !== undefined)) {
            matches.push({
                temperature,
                humidity,
                source: `homebridge:${accessoryName}`,
            });
        }
    }
    return matches.find((item) => item.temperature !== undefined) ?? matches[0];
}
function readCachedAccessories(storagePath) {
    const filePath = path.join(storagePath, 'accessories', 'cachedAccessories');
    if (!fs.existsSync(filePath)) {
        return [];
    }
    try {
        const raw = fs.readFileSync(filePath);
        const parsed = JSON.parse(raw.toString('utf8'));
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
export async function readShellyClimate(host, sensor, auth) {
    const base = host.startsWith('http://') || host.startsWith('https://') ? host.replace(/\/+$/, '') : `http://${host}`;
    const choice = parseSensorChoice(sensor);
    try {
        const gen2 = await fetchJson(`${base}/rpc/Shelly.GetStatus`, auth);
        const fromGen2 = parseShellyGen2(gen2, choice);
        if (fromGen2.temperature !== undefined) {
            return { ...fromGen2, source: `shelly:${base}${fromGen2.source ? `:${fromGen2.source}` : ''}` };
        }
    }
    catch {
        // Probeer gen1 (Shelly Uni) hieronder.
    }
    const gen1 = await fetchJson(`${base}/status`, auth);
    const fromGen1 = parseShellyGen1(gen1, choice);
    return { ...fromGen1, source: `shelly:${base}${fromGen1.source ? `:${fromGen1.source}` : ''}` };
}
export async function readHttpClimate(url, jsonPath) {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${url}`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json') || jsonPath) {
        const data = await response.json();
        const raw = jsonPath ? readPath(data, jsonPath) : data;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            const obj = raw;
            return {
                temperature: numeric(obj.temperature ?? obj.temp ?? obj.tC ?? obj.value),
                humidity: numeric(obj.humidity ?? obj.hum ?? obj.rh),
                source: url,
            };
        }
        return { temperature: numeric(raw), source: url };
    }
    return { temperature: numeric((await response.text()).trim()), source: url };
}
export function logAvailableSensors(log, storagePath) {
    const names = listHomebridgeClimateSensors(storagePath);
    if (names.length === 0) {
        log.warn('Geen temperatuursensors gevonden in de Homebridge-cache. Staat de Shelly in Homebridge, of alleen in Apple Home?');
        return;
    }
    log.info(`Beschikbare temperatuursensors: ${names.join(', ')}`);
}
function parseSensorChoice(sensor) {
    const raw = (sensor ?? '').trim().toLowerCase();
    if (!raw || raw === 'auto') {
        return { mode: 'auto' };
    }
    if (raw === 'addon' || raw === 'add-on' || raw === 'external' || raw === 'ext' || raw === 'uni') {
        return { mode: 'external' };
    }
    if (raw === 'internal' || raw === 'device' || raw === 'chip') {
        return { mode: 'internal' };
    }
    return { mode: 'id', id: raw };
}
function isPlausibleTemperature(value) {
    return value !== undefined && value > -50 && value < 125;
}
function parseShellyGen2(data, choice) {
    if (!data || typeof data !== 'object') {
        return {};
    }
    const obj = data;
    const external = [];
    const internal = [];
    for (const [key, value] of Object.entries(obj)) {
        if (!value || typeof value !== 'object') {
            continue;
        }
        const block = value;
        if (key.startsWith('temperature:')) {
            const id = key.slice('temperature:'.length);
            const humidityBlock = obj[`humidity:${id}`];
            const entry = {
                id,
                temperature: numeric(block.tC ?? block.t_c ?? block.value),
                humidity: humidityBlock && typeof humidityBlock === 'object'
                    ? numeric(humidityBlock.rh ?? humidityBlock.value)
                    : undefined,
            };
            if (Number(id) >= 100) {
                external.push(entry);
            }
            else {
                internal.push(entry);
            }
        }
        if (key.startsWith('switch:') || key.startsWith('cover:')) {
            const nested = block.temperature;
            if (nested && typeof nested === 'object') {
                internal.push({
                    id: key,
                    temperature: numeric(nested.tC ?? nested.t_c),
                });
            }
        }
    }
    const picked = pickShellySensor([...external, ...internal], external, internal, choice);
    if (!picked) {
        return {};
    }
    return {
        temperature: picked.temperature,
        humidity: picked.humidity,
        source: `addon:${picked.id}`,
    };
}
function parseShellyGen1(data, choice) {
    if (!data || typeof data !== 'object') {
        return {};
    }
    const obj = data;
    const external = [];
    const temps = obj.ext_temperature && typeof obj.ext_temperature === 'object' ? obj.ext_temperature : {};
    const hums = obj.ext_humidity && typeof obj.ext_humidity === 'object' ? obj.ext_humidity : {};
    for (const [id, value] of Object.entries(temps)) {
        if (!value || typeof value !== 'object') {
            continue;
        }
        const block = value;
        const humidityBlock = hums[id];
        const humidity = humidityBlock && typeof humidityBlock === 'object'
            ? numeric(humidityBlock.hum ?? humidityBlock.value)
            : undefined;
        const temperature = numeric(block.tC ?? block.t_c ?? block.value);
        external.push({ id, temperature, humidity });
        if (typeof block.hwID === 'string' && block.hwID) {
            external.push({ id: block.hwID.toLowerCase(), temperature, humidity });
        }
    }
    const tmp = obj.tmp && typeof obj.tmp === 'object' ? obj.tmp : undefined;
    const hum = obj.hum && typeof obj.hum === 'object' ? obj.hum : undefined;
    const internal = [{
            id: 'internal',
            temperature: numeric(tmp?.value ?? tmp?.tC ?? obj.temperature),
            humidity: numeric(hum?.value ?? obj.humidity),
        }];
    const picked = pickShellySensor([...external, ...internal], external, internal, choice);
    if (!picked) {
        return {};
    }
    return {
        temperature: picked.temperature,
        humidity: picked.humidity,
        source: `uni:${picked.id}`,
    };
}
function pickShellySensor(all, external, internal, choice) {
    const valid = (items) => items.filter((item) => isPlausibleTemperature(item.temperature));
    if (choice.mode === 'id' && choice.id) {
        const wanted = choice.id.toLowerCase();
        return valid(all).find((item) => item.id.toLowerCase() === wanted)
            ?? valid(all).find((item) => item.id.toLowerCase().includes(wanted));
    }
    if (choice.mode === 'internal') {
        return valid(internal)[0];
    }
    return valid(external)[0] ?? (choice.mode === 'auto' ? valid(internal)[0] : undefined);
}
async function fetchJson(url, auth) {
    const headers = {};
    if (auth?.user) {
        headers.Authorization = `Basic ${Buffer.from(`${auth.user}:${auth.password ?? ''}`).toString('base64')}`;
    }
    let response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (response.status === 401 && auth?.user) {
        const challenge = response.headers.get('www-authenticate') ?? '';
        if (challenge.toLowerCase().includes('digest')) {
            response = await fetch(url, {
                headers: { Authorization: digestHeader(challenge, 'GET', url, auth.user, auth.password ?? '') },
                signal: AbortSignal.timeout(8000),
            });
        }
    }
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${url}`);
    }
    return response.json();
}
function digestHeader(challenge, method, url, user, password) {
    const fields = Object.fromEntries([...challenge.matchAll(/(\w+)=(?:"([^"]+)"|([^,\s]+))/g)].map((match) => [match[1], match[2] ?? match[3]]));
    const realm = fields.realm ?? '';
    const nonce = fields.nonce ?? '';
    const qop = (fields.qop ?? 'auth').split(',')[0].trim();
    const opaque = fields.opaque;
    const uri = new URL(url).pathname + new URL(url).search;
    const nc = '00000001';
    const cnonce = Math.random().toString(16).slice(2, 10);
    const ha1 = md5(`${user}:${realm}:${password}`);
    const ha2 = md5(`${method}:${uri}`);
    const response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
    const parts = [
        `username="${user}"`,
        `realm="${realm}"`,
        `nonce="${nonce}"`,
        `uri="${uri}"`,
        `algorithm=MD5`,
        `qop=${qop}`,
        `nc=${nc}`,
        `cnonce="${cnonce}"`,
        `response="${response}"`,
    ];
    if (opaque) {
        parts.push(`opaque="${opaque}"`);
    }
    return `Digest ${parts.join(', ')}`;
}
function md5(value) {
    return createHash('md5').update(value).digest('hex');
}
function readPath(data, pathName) {
    const parts = pathName.replace(/^\$\.?/, '').split('.').filter(Boolean);
    let current = data;
    for (const part of parts) {
        if (current === null || current === undefined || typeof current !== 'object') {
            return undefined;
        }
        current = current[part];
    }
    return current;
}
