export const PLATFORM_NAME = 'VirtualSmartThermostat';
export const PLUGIN_NAME = 'homebridge-virtual-smart-thermostat';

export type ApplianceType = 'heater' | 'cooler';
export type ControlType = 'switch' | 'webhook';

export interface ApplianceConfig {
  name: string;
  type: ApplianceType;
  controlType: ControlType;
  webhookOn?: string;
  webhookOff?: string;
  webhook?: string;
}

export interface ThermostatConfig {
  id: string;
  name: string;
  minTemp?: number;
  maxTemp?: number;
  minStep?: number;
  defaultTarget?: number;
  hysteresis?: number;
  minOnSeconds?: number;
  minOffSeconds?: number;
  temperatureSensor?: string;
  shellyHost?: string;
  temperatureUrl?: string;
  temperatureJsonPath?: string;
  showHeaterSwitch?: boolean;
  showCoolerSwitch?: boolean;
  appliances?: ApplianceConfig[];
}

export interface PluginConfig {
  name?: string;
  pollInterval?: number;
  webhookPort?: number;
  thermostats?: ThermostatConfig[];
}
