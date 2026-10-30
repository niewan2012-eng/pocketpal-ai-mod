/**
 * Screen-off survival, on top of the foreground service in
 * `android/.../KeepAliveService.kt`.
 *
 * Android needs three things to keep working with the screen off, and none of
 * them is a JS timer: a foreground service (otherwise Doze freezes the process),
 * a partial wake lock (otherwise the CPU sleeps) and a high-performance Wi-Fi
 * lock (otherwise the radio drops to power save and the LAN API server's
 * connections time out). The native side holds all three; this module owns the
 * user's preference and the reasons something asked for it.
 *
 * Reasons are ref-counted the way `modelStore.disableAutoRelease` is: the user's
 * switch and the API server can each want it on without one turning it off
 * under the other.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import NativeKeepAlive from '../specs/NativeKeepAlive';

const PREF_KEY = 'keepAlive.userEnabled';

/** Who wants it on right now. */
const reasons = new Set<string>();

let available = NativeKeepAlive != null;
let running = false;

export function isSupported(): boolean {
  return available;
}

export function isRunning(): boolean {
  return running;
}

/** True when the user's switch is on (independent of who else asked). */
export async function isUserEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PREF_KEY)) === 'true';
  } catch {
    return false;
  }
}

async function apply(): Promise<void> {
  if (!available) {
    return;
  }
  const wanted = reasons.size > 0;
  if (wanted === running) {
    return;
  }
  try {
    if (wanted) {
      await NativeKeepAlive!.start();
      running = true;
      console.log('[keepAlive] started', Array.from(reasons));
    } else {
      await NativeKeepAlive!.stop();
      running = false;
      console.log('[keepAlive] stopped');
    }
  } catch (err) {
    // Android 12+ refuses a foreground service start from the background; the
    // switch is best-effort by design, and the UI reads `isRunning()` back.
    console.warn('[keepAlive] change failed:', err);
    available = false;
  }
}

/** Turn it on for `reason`; persisted only for the user's own switch. */
export async function enable(reason: string): Promise<void> {
  reasons.add(reason);
  if (reason === 'user') {
    AsyncStorage.setItem(PREF_KEY, 'true').catch(() => {});
  }
  await apply();
}

export async function disable(reason: string): Promise<void> {
  reasons.delete(reason);
  if (reason === 'user') {
    AsyncStorage.setItem(PREF_KEY, 'false').catch(() => {});
  }
  await apply();
}

/** Restore the user's switch at launch, if it was left on. */
export async function restore(): Promise<void> {
  if (!available) {
    return;
  }
  if (await isUserEnabled()) {
    await enable('user');
  }
}

/** Whether Doze may still freeze the process; the user grants this in Settings. */
export async function isIgnoringBatteryOptimizations(): Promise<boolean> {
  try {
    return (await NativeKeepAlive?.isIgnoringBatteryOptimizations()) ?? false;
  } catch {
    return false;
  }
}

export async function requestIgnoreBatteryOptimizations(): Promise<boolean> {
  try {
    return (
      (await NativeKeepAlive?.requestIgnoreBatteryOptimizations()) ?? false
    );
  } catch {
    return false;
  }
}
