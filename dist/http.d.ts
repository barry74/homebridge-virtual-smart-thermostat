import http from 'node:http';
import type { Logging } from 'homebridge';
export type TempHandler = (id: string, value: number) => void;
export declare function startWebhookServer(port: number, log: Logging, onTemperature: TempHandler): http.Server;
export declare function fetchTemperature(url: string, jsonPath?: string): Promise<number | undefined>;
