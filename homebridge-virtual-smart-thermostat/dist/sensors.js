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
export async function readShellyClimate(host) {
    const base = host.startsWith('http://') || host.startsWith('https://') ? host.replace(/\/+$/, '') : `http://${host}`;
    try {
        const gen2 = await fetchJson(`${base}/rpc/Shelly.GetStatus`);
        const fromGen2 = parseShellyGen2(gen2);
        if (fromGen2.temperature !== undefined) {
            return { ...fromGen2, source: `shelly:${base}` };
        }
    }
    catch {
        // Probeer gen1.
    }
    const gen1 = await fetchJson(`${base}/status`);
    return { ...parseShellyGen1(gen1), source: `shelly:${base}` };
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
function parseShellyGen2(data) {
    if (!data || typeof data !== 'object') {
        return {};
    }
    const obj = data;
    let temperature;
    let humidity;
    for (const [key, value] of Object.entries(obj)) {
        if (!value || typeof value !== 'object') {
            continue;
        }
        const block = value;
        if (key.startsWith('temperature:') || key === 'temperature:0') {
            temperature = numeric(block.tC ?? block.t_c ?? block.value);
        }
        if (key.startsWith('humidity:') || key === 'humidity:0') {
            humidity = numeric(block.rh ?? block.value);
        }
    }
    return { temperature, humidity };
}
function parseShellyGen1(data) {
    if (!data || typeof data !== 'object') {
        return {};
    }
    const obj = data;
    const tmp = obj.tmp && typeof obj.tmp === 'object' ? obj.tmp : undefined;
    const hum = obj.hum && typeof obj.hum === 'object' ? obj.hum : undefined;
    const ext = obj.ext_temperature && typeof obj.ext_temperature === 'object'
        ? Object.values(obj.ext_temperature)[0]
        : undefined;
    const extObj = ext && typeof ext === 'object' ? ext : undefined;
    return {
        temperature: numeric(tmp?.value ?? tmp?.tC ?? obj.temperature ?? extObj?.tC),
        humidity: numeric(hum?.value ?? obj.humidity),
    };
}
async function fetchJson(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${url}`);
    }
    return response.json();
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
