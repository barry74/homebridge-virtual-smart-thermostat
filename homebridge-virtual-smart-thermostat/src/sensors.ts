import fs from 'node:fs';
import path from 'node:path';
import type { Logging } from 'homebridge';

const CURRENT_TEMPERATURE_UUID = '00000011-0000-1000-8000-0026BB765291';
const CURRENT_HUMIDITY_UUID = '00000010-0000-1000-8000-0026BB765291';
const TEMPERATURE_SENSOR_UUID = '0000008a-0000-1000-8000-0026BB765291';
const THERMOSTAT_UUID = '0000004a-0000-1000-8000-0026BB765291';
const HUMIDITY_SENSOR_UUID = '00000082-0000-1000-8000-0026BB765291';

export interface ClimateReading {
  temperature?: number;
  humidity?: number;
  source?: string;
}

interface CachedCharacteristic {
  displayName?: string;
  UUID?: string;
  value?: unknown;
}

interface CachedService {
  displayName?: string;
  UUID?: string;
  characteristics?: CachedCharacteristic[];
}

interface CachedAccessory {
  displayName?: string;
  UUID?: string;
  services?: CachedService[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function uuidOf(value?: string): string {
  return (value ?? '').toLowerCase();
}

function numeric(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function characteristicValue(service: CachedService, uuid: string): number | undefined {
  const match = (service.characteristics ?? []).find((item) => uuidOf(item.UUID).startsWith(uuid));
  return numeric(match?.value);
}

export function listHomebridgeClimateSensors(storagePath: string): string[] {
  const accessories = readCachedAccessories(storagePath);
  const names = new Set<string>();
  for (const accessory of accessories) {
    for (const service of accessory.services ?? []) {
      const serviceUuid = uuidOf(service.UUID);
      if (
        serviceUuid.startsWith(TEMPERATURE_SENSOR_UUID)
        || serviceUuid.startsWith(THERMOSTAT_UUID)
        || characteristicValue(service, CURRENT_TEMPERATURE_UUID) !== undefined
      ) {
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

export function readHomebridgeSensor(storagePath: string, sensorName: string): ClimateReading | undefined {
  const wanted = normalize(sensorName);
  const accessories = readCachedAccessories(storagePath);
  const matches: ClimateReading[] = [];

  for (const accessory of accessories) {
    const accessoryName = accessory.displayName ?? '';
    let temperature: number | undefined;
    let humidity: number | undefined;

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

function readCachedAccessories(storagePath: string): CachedAccessory[] {
  const filePath = path.join(storagePath, 'accessories', 'cachedAccessories');
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath);
    const parsed = JSON.parse(raw.toString('utf8')) as CachedAccessory[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function readShellyClimate(host: string): Promise<ClimateReading> {
  const base = host.startsWith('http://') || host.startsWith('https://') ? host.replace(/\/+$/, '') : `http://${host}`;

  try {
    const gen2 = await fetchJson(`${base}/rpc/Shelly.GetStatus`);
    const fromGen2 = parseShellyGen2(gen2);
    if (fromGen2.temperature !== undefined) {
      return { ...fromGen2, source: `shelly:${base}` };
    }
  } catch {
    // Probeer gen1 hieronder.
  }

  const gen1 = await fetchJson(`${base}/status`);
  return { ...parseShellyGen1(gen1), source: `shelly:${base}` };
}

export async function readHttpClimate(url: string, jsonPath?: string): Promise<ClimateReading> {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json') || jsonPath) {
    const data: unknown = await response.json();
    const raw = jsonPath ? readPath(data, jsonPath) : data;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const obj = raw as Record<string, unknown>;
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

export function logAvailableSensors(log: Logging, storagePath: string): void {
  const names = listHomebridgeClimateSensors(storagePath);
  if (names.length === 0) {
    log.warn('Geen temperatuursensors gevonden in de Homebridge-cache. Staat de Shelly in Homebridge, of alleen in Apple Home?');
    return;
  }
  log.info(`Beschikbare temperatuursensors: ${names.join(', ')}`);
}

function parseShellyGen2(data: unknown): ClimateReading {
  if (!data || typeof data !== 'object') {
    return {};
  }
  const obj = data as Record<string, unknown>;
  let temperature: number | undefined;
  let humidity: number | undefined;
  for (const [key, value] of Object.entries(obj)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const block = value as Record<string, unknown>;
    if (key.startsWith('temperature:') || key === 'temperature:0') {
      temperature = numeric(block.tC ?? block.t_c ?? block.value);
    }
    if (key.startsWith('humidity:') || key === 'humidity:0') {
      humidity = numeric(block.rh ?? block.value);
    }
  }
  return { temperature, humidity };
}

function parseShellyGen1(data: unknown): ClimateReading {
  if (!data || typeof data !== 'object') {
    return {};
  }
  const obj = data as Record<string, unknown>;
  const tmp = obj.tmp && typeof obj.tmp === 'object' ? obj.tmp as Record<string, unknown> : undefined;
  const hum = obj.hum && typeof obj.hum === 'object' ? obj.hum as Record<string, unknown> : undefined;
  const ext = obj.ext_temperature && typeof obj.ext_temperature === 'object'
    ? Object.values(obj.ext_temperature as Record<string, unknown>)[0]
    : undefined;
  const extObj = ext && typeof ext === 'object' ? ext as Record<string, unknown> : undefined;
  return {
    temperature: numeric(tmp?.value ?? tmp?.tC ?? obj.temperature ?? extObj?.tC),
    humidity: numeric(hum?.value ?? obj.humidity),
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return response.json();
}

function readPath(data: unknown, pathName: string): unknown {
  const parts = pathName.replace(/^\$\.?/, '').split('.').filter(Boolean);
  let current: unknown = data;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
