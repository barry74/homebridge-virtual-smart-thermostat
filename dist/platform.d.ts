import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';
export declare class VirtualSmartThermostatPlatform implements DynamicPlatformPlugin {
    readonly log: Logging;
    readonly config: PlatformConfig;
    readonly api: API;
    readonly Service: typeof Service;
    readonly Characteristic: typeof Characteristic;
    readonly accessories: Map<string, PlatformAccessory<import("homebridge").UnknownContext>>;
    private readonly handlers;
    private webhookServer?;
    private pollTimer?;
    constructor(log: Logging, config: PlatformConfig, api: API);
    configureAccessory(accessory: PlatformAccessory): void;
    private pluginConfig;
    private discoverDevices;
    private startServices;
    private pollAll;
    private applyTemperature;
    private readClimate;
}
