import { createHash } from 'node:crypto';
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

export interface ShellyAuth {
  user?: string;
  password?: string;
}

type SensorMode = 'auto' | 'external' | 'internal' | 'id';

interface SensorChoice {
  mode: SensorMode;
  id?: string;
}

interface ShellyProbe {
  id: string;
  temperature?: number;
  humidity?: number;
}

export async function readShellyClimate(host: string, sensor?: string, auth?: ShellyAuth): Promise<ClimateReading> {
  const base = host.startsWith('http://') || host.startsWith('https://') ? host.replace(/\/+$/, '') : `http://${host}`;
  const choice = parseSensorChoice(sensor);

  try {
    const gen2 = await fetchJson(`${base}/rpc/Shelly.GetStatus`, auth);
    const fromGen2 = parseShellyGen2(gen2, choice);
    if (fromGen2.temperature !== undefined) {
      return { ...fromGen2, source: `shelly:${base}${fromGen2.source ? `:${fromGen2.source}` : ''}` };
    }
  } catch {
    // Probeer gen1 (Shelly Uni) hieronder.
  }

  const gen1 = await fetchJson(`${base}/status`, auth);
  const fromGen1 = parseShellyGen1(gen1, choice);
  return { ...fromGen1, source: `shelly:${base}${fromGen1.source ? `:${fromGen1.source}` : ''}` };
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

function parseSensorChoice(sensor?: string): SensorChoice {
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

function isPlausibleTemperature(value: number | undefined): value is number {
  return value !== undefined && value > -50 && value < 125;
}

function parseShellyGen2(data: unknown, choice: SensorChoice): ClimateReading {
  if (!data || typeof data !== 'object') {
    return {};
  }
  const obj = data as Record<string, unknown>;
  const external: ShellyProbe[] = [];
  const internal: ShellyProbe[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const block = value as Record<string, unknown>;
    if (key.startsWith('temperature:')) {
      const id = key.slice('temperature:'.length);
      const humidityBlock = obj[`humidity:${id}`];
      const entry: ShellyProbe = {
        id,
        temperature: numeric(block.tC ?? block.t_c ?? block.value),
        humidity: humidityBlock && typeof humidityBlock === 'object'
          ? numeric((humidityBlock as Record<string, unknown>).rh ?? (humidityBlock as Record<string, unknown>).value)
          : undefined,
      };
      // Shelly Add-on probes beginnen bij id 100. temperature:0 is vaak de chiptemperatuur.
      if (Number(id) >= 100) {
        external.push(entry);
      } else {
        internal.push(entry);
      }
    }
    if (key.startsWith('switch:') || key.startsWith('cover:')) {
      const nested = block.temperature;
      if (nested && typeof nested === 'object') {
        internal.push({
          id: key,
          temperature: numeric((nested as Record<string, unknown>).tC ?? (nested as Record<string, unknown>).t_c),
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

function parseShellyGen1(data: unknown, choice: SensorChoice): ClimateReading {
  if (!data || typeof data !== 'object') {
    return {};
  }
  const obj = data as Record<string, unknown>;
  const external: ShellyProbe[] = [];
  const temps = obj.ext_temperature && typeof obj.ext_temperature === 'object'
    ? obj.ext_temperature as Record<string, unknown>
    : {};
  const hums = obj.ext_humidity && typeof obj.ext_humidity === 'object'
    ? obj.ext_humidity as Record<string, unknown>
    : {};

  for (const [id, value] of Object.entries(temps)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const block = value as Record<string, unknown>;
    const humidityBlock = hums[id];
    const humidity = humidityBlock && typeof humidityBlock === 'object'
      ? numeric((humidityBlock as Record<string, unknown>).hum ?? (humidityBlock as Record<string, unknown>).value)
      : undefined;
    const temperature = numeric(block.tC ?? block.t_c ?? block.value);
    external.push({ id, temperature, humidity });
    if (typeof block.hwID === 'string' && block.hwID) {
      external.push({ id: block.hwID.toLowerCase(), temperature, humidity });
    }
  }

  const tmp = obj.tmp && typeof obj.tmp === 'object' ? obj.tmp as Record<string, unknown> : undefined;
  const hum = obj.hum && typeof obj.hum === 'object' ? obj.hum as Record<string, unknown> : undefined;
  const internal: ShellyProbe[] = [{
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

function pickShellySensor(
  all: ShellyProbe[],
  external: ShellyProbe[],
  internal: ShellyProbe[],
  choice: SensorChoice,
): ShellyProbe | undefined {
  const valid = (items: ShellyProbe[]) => items.filter((item) => isPlausibleTemperature(item.temperature));

  if (choice.mode === 'id' && choice.id) {
    const wanted = choice.id.toLowerCase();
    return valid(all).find((item) => item.id.toLowerCase() === wanted)
      ?? valid(all).find((item) => item.id.toLowerCase().includes(wanted));
  }
  if (choice.mode === 'internal') {
    return valid(internal)[0];
  }
  // auto en external: Shelly Uni-probes en Add-on (id >= 100) eerst, nooit de hete relaischip.
  return valid(external)[0] ?? (choice.mode === 'auto' ? valid(internal)[0] : undefined);
}

async function fetchJson(url: string, auth?: ShellyAuth): Promise<unknown> {
  const headers: Record<string, string> = {};
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

function digestHeader(challenge: string, method: string, url: string, user: string, password: string): string {
  const fields = Object.fromEntries(
    [...challenge.matchAll(/(\w+)=(?:"([^"]+)"|([^,\s]+))/g)].map((match) => [match[1], match[2] ?? match[3]]),
  );
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

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex');
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
