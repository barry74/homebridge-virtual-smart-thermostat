import { VirtualThermostatAccessory } from './platformAccessory.js';
import { startWebhookServer } from './http.js';
import { logAvailableSensors, readHomebridgeSensor, readHttpClimate, readShellyClimate } from './sensors.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
export class VirtualSmartThermostatPlatform {
    log;
    config;
    api;
    Service;
    Characteristic;
    accessories = new Map();
    handlers = new Map();
    webhookServer;
    pollTimer;
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.Service = api.hap.Service;
        this.Characteristic = api.hap.Characteristic;
        this.log.info('Virtual Smart Thermostat gestart');
        this.api.on('didFinishLaunching', () => {
            this.discoverDevices();
            this.startServices();
        });
        this.api.on('shutdown', () => {
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
            }
            this.webhookServer?.close();
        });
    }
    configureAccessory(accessory) {
        this.log.info('Accessoire uit cache:', accessory.displayName);
        this.accessories.set(accessory.UUID, accessory);
    }
    pluginConfig() {
        return this.config;
    }
    discoverDevices() {
        const thermostats = this.pluginConfig().thermostats ?? [];
        const seen = [];
        for (const device of thermostats) {
            if (!device.id || !device.name) {
                this.log.warn('Thermostaat overgeslagen: id en name zijn verplicht');
                continue;
            }
            const uuid = this.api.hap.uuid.generate(`vst.${device.id}`);
            seen.push(uuid);
            const existing = this.accessories.get(uuid);
            if (existing) {
                existing.displayName = device.name;
                existing.context.device = device;
                this.api.updatePlatformAccessories([existing]);
                this.handlers.set(device.id, new VirtualThermostatAccessory(this, existing, device));
                this.log.info('Bestaande thermostaat hersteld:', device.name);
            }
            else {
                const accessory = new this.api.platformAccessory(device.name, uuid);
                accessory.context.device = device;
                this.handlers.set(device.id, new VirtualThermostatAccessory(this, accessory, device));
                this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
                this.accessories.set(uuid, accessory);
                this.log.info('Nieuwe thermostaat toegevoegd:', device.name);
            }
        }
        for (const [uuid, accessory] of this.accessories) {
            if (!seen.includes(uuid)) {
                this.log.info('Verwijder oude thermostaat uit cache:', accessory.displayName);
                this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
                this.accessories.delete(uuid);
            }
        }
    }
    startServices() {
        const cfg = this.pluginConfig();
        const port = cfg.webhookPort ?? 18081;
        logAvailableSensors(this.log, this.api.user.storagePath());
        this.webhookServer = startWebhookServer(port, this.log, (id, value) => {
            void this.applyTemperature(id, value);
        });
        const interval = Math.max(15, cfg.pollInterval ?? 60) * 1000;
        void this.pollAll();
        this.pollTimer = setInterval(() => {
            void this.pollAll();
        }, interval);
    }
    async pollAll() {
        const storagePath = this.api.user.storagePath();
        for (const handler of this.handlers.values()) {
            const device = handler.device;
            try {
                const reading = await this.readClimate(device, storagePath);
                if (reading?.temperature !== undefined || reading?.humidity !== undefined) {
                    await handler.setClimate(reading.temperature, reading.humidity);
                    if (reading.source && reading.temperature !== undefined) {
                        this.log.debug(`${device.name}: ${reading.temperature}°C via ${reading.source}`);
                    }
                }
                else if (device.temperatureSensor || device.shellyHost || device.temperatureUrl) {
                    this.log.warn(`${device.name}: geen temperatuur gevonden voor sensor "${device.temperatureSensor ?? device.shellyHost ?? device.temperatureUrl}"`);
                }
            }
            catch (error) {
                this.log.error(`${device.name}: temperatuur ophalen mislukt:`, error);
            }
        }
        for (const handler of this.handlers.values()) {
            await handler.evaluate();
        }
    }
    async applyTemperature(id, value) {
        const handler = this.handlers.get(id);
        if (!handler) {
            this.log.warn(`Onbekende thermostaat-id voor temperatuur: ${id}`);
            return;
        }
        this.log.info(`${handler.device.name}: temperatuur via webhook ${value}°C`);
        await handler.setCurrentTemperature(value);
    }
    async readClimate(device, storagePath) {
        if (device.shellyHost) {
            return readShellyClimate(device.shellyHost);
        }
        if (device.temperatureUrl) {
            return readHttpClimate(device.temperatureUrl, device.temperatureJsonPath);
        }
        if (device.temperatureSensor) {
            const looksLikeHost = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(device.temperatureSensor)
                || device.temperatureSensor.includes('.')
                || device.temperatureSensor.startsWith('http');
            if (looksLikeHost && !device.temperatureSensor.includes(' ')) {
                try {
                    return await readShellyClimate(device.temperatureSensor);
                }
                catch {
                    // Val terug op Homebridge-sensornaam.
                }
            }
            return readHomebridgeSensor(storagePath, device.temperatureSensor);
        }
        return undefined;
    }
}
