import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

/**
 * Screen-off survival: a foreground service plus a partial wake lock and a
 * high-performance Wi-Fi lock, so inference continues and the LAN API server
 * keeps its connections. Starting it always shows a notification, which is what
 * Android requires in exchange.
 */
export interface Spec extends TurboModule {
  start(): Promise<boolean>;
  stop(): Promise<boolean>;
  isIgnoringBatteryOptimizations(): Promise<boolean>;
  requestIgnoreBatteryOptimizations(): Promise<boolean>;
}

export default TurboModuleRegistry.get<Spec>('KeepAliveModule');
