const HEAT = 1;
const COOL = 2;
const AUTO = 3;
export class VirtualThermostatAccessory {
    platform;
    accessory;
    device;
    service;
    info;
    heaterSwitch;
    coolerSwitch;
    heatState;
    currentTemperature = 20;
    currentHumidity;
    targetTemperature;
    targetState = 0;
    currentState = 0;
    lastOnAt = 0;
    lastOffAt = 0;
    heaterOn = false;
    coolerOn = false;
    constructor(platform, accessory, device) {
        this.platform = platform;
        this.accessory = accessory;
        this.device = device;
        this.targetTemperature = device.defaultTarget ?? 20;
        const saved = accessory.context.state;
        if (typeof saved?.targetTemperature === 'number') {
            this.targetTemperature = saved.targetTemperature;
        }
        if (typeof saved?.targetState === 'number') {
            this.targetState = saved.targetState;
        }
        if (typeof saved?.currentTemperature === 'number') {
            this.currentTemperature = saved.currentTemperature;
        }
        this.info = this.accessory.getService(this.platform.Service.AccessoryInformation)
            || this.accessory.addService(this.platform.Service.AccessoryInformation);
        this.info
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Virtual Smart Thermostat')
            .setCharacteristic(this.platform.Characteristic.Model, 'Virtual Thermostat')
            .setCharacteristic(this.platform.Characteristic.SerialNumber, device.id);
        this.service = this.accessory.getService(this.platform.Service.Thermostat)
            || this.accessory.addService(this.platform.Service.Thermostat, device.name);
        this.service.setCharacteristic(this.platform.Characteristic.Name, device.name);
        const min = device.minTemp ?? 10;
        const max = device.maxTemp ?? 30;
        const step = device.minStep ?? 0.5;
        this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
            .setProps({ minValue: -20, maxValue: 60, minStep: 0.1 })
            .onGet(() => this.currentTemperature);
        this.service.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
            .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
            .onGet(() => this.currentHumidity ?? 0);
        this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
            .setProps({ minValue: min, maxValue: max, minStep: step })
            .onGet(() => this.targetTemperature)
            .onSet(async (value) => {
            this.targetTemperature = Number(value);
            this.persist();
            this.platform.log.info(`${device.name}: target ${this.targetTemperature}°C`);
            await this.evaluate();
        });
        const modes = this.visibleModes();
        if (!modes.includes(this.targetState)) {
            this.targetState = modes.includes(HEAT) ? HEAT : modes[0];
            this.persist();
        }
        this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
            .setProps({ validValues: modes })
            .onGet(() => this.currentState);
        this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
            .setProps({ validValues: modes })
            .onGet(() => this.targetState)
            .onSet(async (value) => {
            const next = Number(value);
            this.targetState = modes.includes(next) ? next : modes[0];
            this.persist();
            this.platform.log.info(`${device.name}: mode ${this.modeName(this.targetState)}`);
            await this.evaluate();
        });
        this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
            .onGet(() => this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS)
            .onSet(async () => undefined);
        if (device.showHeaterSwitch === true) {
            this.heaterSwitch = this.serviceBySubtype(this.platform.Service.Switch, 'heater', `${device.name} kachel`);
            this.heaterSwitch.setCharacteristic(this.platform.Characteristic.Name, `${device.name} kachel`);
            this.heaterSwitch.getCharacteristic(this.platform.Characteristic.On)
                .onGet(() => this.heaterOn)
                .onSet(async (value) => {
                this.heaterOn = Boolean(value);
                this.updateHeatState();
                await this.setAppliancesOfType('heater', this.heaterOn);
            });
        }
        else {
            this.removeBySubtype('heater');
        }
        if (device.showCoolerSwitch === true) {
            this.coolerSwitch = this.serviceBySubtype(this.platform.Service.Switch, 'cooler', `${device.name} koeling`);
            this.coolerSwitch.setCharacteristic(this.platform.Characteristic.Name, `${device.name} koeling`);
            this.coolerSwitch.getCharacteristic(this.platform.Characteristic.On)
                .onGet(() => this.coolerOn)
                .onSet(async (value) => {
                this.coolerOn = Boolean(value);
                await this.setAppliancesOfType('cooler', this.coolerOn);
            });
        }
        else {
            this.removeBySubtype('cooler');
        }
        this.heatState = this.serviceBySubtype(this.platform.Service.OccupancySensor, 'heat-state', `${device.name} heat`);
        this.heatState.setCharacteristic(this.platform.Characteristic.Name, `${device.name} heat`);
        this.heatState.getCharacteristic(this.platform.Characteristic.OccupancyDetected)
            .onGet(() => this.heaterOn
            ? this.platform.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
            : this.platform.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
        this.removeBySubtype('tv-heat');
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.currentTemperature);
        this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, this.targetTemperature);
        this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, this.targetState);
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.currentState);
    }
    get id() {
        return this.device.id;
    }
    async setClimate(temperature, humidity) {
        if (typeof temperature === 'number' && Number.isFinite(temperature)) {
            this.currentTemperature = Math.round(temperature * 10) / 10;
            this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.currentTemperature);
        }
        if (typeof humidity === 'number' && Number.isFinite(humidity)) {
            this.currentHumidity = Math.round(humidity);
            this.service.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, this.currentHumidity);
        }
        this.persist();
        await this.evaluate();
    }
    async setCurrentTemperature(value) {
        await this.setClimate(value);
    }
    async evaluate() {
        const temp = this.currentTemperature;
        const target = this.targetTemperature;
        const hysteresis = this.device.hysteresis ?? 0.5;
        const now = Date.now();
        const minOn = (this.device.minOnSeconds ?? 60) * 1000;
        const minOff = (this.device.minOffSeconds ?? 60) * 1000;
        let desiredHeat = false;
        let desiredCool = false;
        if (this.targetState === HEAT || this.targetState === AUTO) {
            if (this.heaterOn) {
                desiredHeat = temp < target;
            }
            else {
                desiredHeat = temp <= target - hysteresis;
            }
        }
        if (this.targetState === COOL || this.targetState === AUTO) {
            if (this.coolerOn) {
                desiredCool = temp > target;
            }
            else {
                desiredCool = temp >= target + hysteresis;
            }
        }
        if (desiredHeat && desiredCool) {
            desiredCool = false;
        }
        const heatLocked = this.heaterOn ? now - this.lastOnAt < minOn : now - this.lastOffAt < minOff;
        const coolLocked = this.coolerOn ? now - this.lastOnAt < minOn : now - this.lastOffAt < minOff;
        if (desiredHeat !== this.heaterOn && !heatLocked) {
            await this.setHeater(desiredHeat);
        }
        if (desiredCool !== this.coolerOn && !coolLocked) {
            await this.setCooler(desiredCool);
        }
        if (this.heaterOn) {
            this.currentState = this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
        }
        else if (this.coolerOn) {
            this.currentState = this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
        }
        else {
            this.currentState = this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
        }
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.currentState);
    }
    async setHeater(on) {
        this.heaterOn = on;
        this.touchTiming(on);
        this.heaterSwitch?.updateCharacteristic(this.platform.Characteristic.On, on);
        this.updateHeatState();
        await this.setAppliancesOfType('heater', on);
        this.platform.log.info(`${this.device.name}: heat ${on ? 'on' : 'off'}`);
    }
    async setCooler(on) {
        this.coolerOn = on;
        this.touchTiming(on);
        this.coolerSwitch?.updateCharacteristic(this.platform.Characteristic.On, on);
        await this.setAppliancesOfType('cooler', on);
        this.platform.log.info(`${this.device.name}: koeling ${on ? 'AAN' : 'UIT'}`);
    }
    updateHeatState() {
        this.heatState?.updateCharacteristic(this.platform.Characteristic.OccupancyDetected, this.heaterOn
            ? this.platform.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
            : this.platform.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    }
    touchTiming(on) {
        if (on) {
            this.lastOnAt = Date.now();
        }
        else {
            this.lastOffAt = Date.now();
        }
    }
    async setAppliancesOfType(type, on) {
        const appliances = (this.device.appliances ?? []).filter((item) => item.type === type);
        for (const appliance of appliances) {
            await this.controlAppliance(appliance, on);
        }
    }
    async controlAppliance(appliance, on) {
        if (appliance.controlType !== 'webhook') {
            return;
        }
        const url = on
            ? (appliance.webhookOn ?? appliance.webhook)
            : (appliance.webhookOff ?? appliance.webhook);
        if (!url) {
            this.platform.log.warn(`Geen webhook voor ${appliance.name}`);
            return;
        }
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: appliance.name, type: appliance.type, state: on }),
                signal: AbortSignal.timeout(8000),
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
        }
        catch (error) {
            this.platform.log.error(`Webhook ${appliance.name} mislukt:`, error);
        }
    }
    persist() {
        this.accessory.context.state = {
            targetTemperature: this.targetTemperature,
            targetState: this.targetState,
            currentTemperature: this.currentTemperature,
        };
    }
    serviceBySubtype(serviceType, subtype, displayName) {
        const existing = this.accessory.services.find((service) => service.subtype === subtype);
        if (existing) {
            existing.displayName = displayName;
            return existing;
        }
        return this.accessory.addService(serviceType, displayName, subtype);
    }
    removeBySubtype(subtype) {
        const existing = this.accessory.services.find((service) => service.subtype === subtype);
        if (existing) {
            this.accessory.removeService(existing);
        }
    }
    visibleModes() {
        const off = this.platform.Characteristic.TargetHeatingCoolingState.OFF;
        const heat = this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
        const cool = this.platform.Characteristic.TargetHeatingCoolingState.COOL;
        const auto = this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
        const listed = (this.device.modes ?? []).map((mode) => mode.toLowerCase());
        const enabled = (name, flag, fallback) => listed.length > 0 ? listed.includes(name) : (flag ?? fallback);
        const modes = [
            enabled('off', this.device.showModeOff, true) ? off : undefined,
            enabled('heat', this.device.showModeHeat, true) ? heat : undefined,
            enabled('cool', this.device.showModeCool, false) ? cool : undefined,
            enabled('auto', this.device.showModeAuto, false) ? auto : undefined,
        ].filter((value) => value !== undefined);
        return modes.length > 0 ? modes : [off];
    }
    modeName(state) {
        switch (state) {
            case HEAT:
                return 'HEAT';
            case COOL:
                return 'COOL';
            case AUTO:
                return 'AUTO';
            default:
                return 'OFF';
        }
    }
}
