import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useEffect, useSyncExternalStore } from "react";
import { Platform } from "react-native";

/**
 * Keeps the phone's screen on.
 *
 * Two reasons it can be on: the person switched "מסך דולק" on for the whole
 * app (a per-device preference), or a screen such as cooking mode holds it
 * while mounted. On the web the browser's Screen Wake Lock is used; it is
 * released whenever the app goes to the background or the phone is locked, so
 * it is requested again every time the app becomes visible. (expo-keep-awake
 * requests it once and never again, which is why the screen used to dim.)
 */
const KEY = "kort.screenOn";
const TAG = "kort-screen";

type Sentinel = { released: boolean; release(): Promise<void>; addEventListener(type: "release", cb: () => void): void };
type WakeLockNavigator = Navigator & { wakeLock?: { request(type: "screen"): Promise<Sentinel> } };

const isWeb = Platform.OS === "web" && typeof window !== "undefined";
const nav = isWeb ? (navigator as WakeLockNavigator) : null;

/** Whether this device can keep the screen on at all (old iOS Safari cannot). */
export const screenOnSupported = !isWeb || Boolean(nav?.wakeLock);

let preference = false;
try {
  preference = isWeb && window.localStorage.getItem(KEY) === "1";
} catch {
  /* private mode */
}
let holds = 0;
let sentinel: Sentinel | null = null;
let requesting = false;
const listeners = new Set<() => void>();

const wanted = () => preference || holds > 0;

async function apply() {
  if (!isWeb) {
    try {
      if (wanted()) await activateKeepAwakeAsync(TAG);
      else await deactivateKeepAwake(TAG);
    } catch {
      /* not available in this runtime */
    }
    return;
  }
  if (!nav?.wakeLock) return;
  if (!wanted()) {
    if (sentinel && !sentinel.released) await sentinel.release().catch(() => undefined);
    sentinel = null;
    return;
  }
  if ((sentinel && !sentinel.released) || requesting || document.visibilityState !== "visible") return;
  requesting = true;
  try {
    const s = await nav.wakeLock.request("screen");
    sentinel = s;
    // The browser releases it on its own (background, lock screen); we re-request when visible again.
    s.addEventListener("release", () => {
      if (sentinel === s) sentinel = null;
    });
  } catch {
    /* denied (e.g. low battery); retried on the next interaction */
  } finally {
    requesting = false;
  }
}

if (isWeb) {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void apply();
  });
  // Safari wants a user gesture for the first request after a page load.
  const onTouch = () => {
    void apply();
  };
  document.addEventListener("pointerdown", onTouch, { passive: true });
  document.addEventListener("keydown", onTouch, { passive: true });
  void apply();
}

export function setScreenOn(on: boolean) {
  preference = on;
  try {
    if (isWeb) window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
  void apply();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** The app-wide "screen stays on" switch. */
export function useScreenOn() {
  const on = useSyncExternalStore(subscribe, () => preference, () => false);
  return { on, setOn: setScreenOn, supported: screenOnSupported };
}

/** Keeps the screen on while the calling screen is mounted (cooking mode), whatever the switch says. */
export function useHoldScreenOn() {
  useEffect(() => {
    holds += 1;
    void apply();
    return () => {
      holds -= 1;
      void apply();
    };
  }, []);
}
