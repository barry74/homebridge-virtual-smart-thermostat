import { VirtualSmartThermostatPlatform } from './platform.js';
import { PLATFORM_NAME } from './settings.js';
export default (api) => {
    api.registerPlatform(PLATFORM_NAME, VirtualSmartThermostatPlatform);
};
