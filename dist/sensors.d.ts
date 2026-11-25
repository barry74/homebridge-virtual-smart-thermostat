import type { Logging } from 'homebridge';
export interface ClimateReading {
    temperature?: number;
    humidity?: number;
    source?: string;
}
export declare function listHomebridgeClimateSensors(storagePath: string): string[];
export declare function readHomebridgeSensor(storagePath: string, sensorName: string): ClimateReading | undefined;
export interface ShellyAuth {
    user?: string;
    password?: string;
}
export declare function readShellyClimate(host: string, sensor?: string, auth?: ShellyAuth): Promise<ClimateReading>;
export declare function readHttpClimate(url: string, jsonPath?: string): Promise<ClimateReading>;
export declare function logAvailableSensors(log: Logging, storagePath: string): void;
