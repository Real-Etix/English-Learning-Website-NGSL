export const DEFERRED_ENGINE_BOOT_DELAY_MS = 750;
export const GALAXY_CRITICAL_READY_MARK = "galaxy:critical-ready";
export const GALAXY_BOOT_START_MARK = "galaxy:boot-start";
export const GALAXY_INTERACTIVE_MARK = "galaxy:interactive";
export const GALAXY_CONSTELLATION_VISIBLE_MARK = "galaxy:constellation-visible";

type TimerId = ReturnType<typeof globalThis.setTimeout>;
type FrameId = number;
type IdleId = unknown;

export type PerformanceMarker = {
  getEntriesByName: (name: string) => ArrayLike<unknown>;
  mark: (name: string) => void;
};

export type DeferredBootScheduler = {
  setTimeout: (callback: () => void, delayMs?: number) => TimerId;
  clearTimeout: (handle: TimerId) => void;
  requestAnimationFrame?: (callback: FrameRequestCallback) => FrameId;
  cancelAnimationFrame?: (handle: FrameId) => void;
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => IdleId;
  cancelIdleCallback?: (handle: IdleId) => void;
};

function defaultScheduler(): DeferredBootScheduler {
  return {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    requestAnimationFrame: typeof globalThis.requestAnimationFrame === "function"
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : undefined,
    cancelAnimationFrame: typeof globalThis.cancelAnimationFrame === "function"
      ? globalThis.cancelAnimationFrame.bind(globalThis)
      : undefined,
    requestIdleCallback: typeof globalThis.requestIdleCallback === "function"
      ? globalThis.requestIdleCallback.bind(globalThis)
      : undefined,
    cancelIdleCallback: typeof globalThis.cancelIdleCallback === "function"
      ? (handle) => globalThis.cancelIdleCallback(handle as number)
      : undefined,
  };
}

export function markLifecycleOnce(name: string, marker: PerformanceMarker = performance): void {
  if (marker.getEntriesByName(name).length > 0) return;
  marker.mark(name);
}

export function markGalaxyCriticalReady(marker: PerformanceMarker = performance): void {
  markLifecycleOnce(GALAXY_CRITICAL_READY_MARK, marker);
  markLifecycleOnce(GALAXY_INTERACTIVE_MARK, marker);
  markLifecycleOnce(GALAXY_CONSTELLATION_VISIBLE_MARK, marker);
}

export function markGalaxyBootStart(marker: PerformanceMarker = performance): void {
  markLifecycleOnce(GALAXY_BOOT_START_MARK, marker);
}

export function scheduleDeferredEngineBoot(
  callback: () => void,
  scheduler: DeferredBootScheduler = defaultScheduler(),
  delayMs = DEFERRED_ENGINE_BOOT_DELAY_MS,
): () => void {
  let cancelled = false;
  let booted = false;
  let timer: TimerId | null = null;
  let frame: FrameId | null = null;
  let idle: IdleId | null = null;

  const bootOnce = () => {
    if (cancelled || booted) return;
    booted = true;
    markGalaxyBootStart();
    callback();
  };

  const scheduleBootSlice = () => {
    if (cancelled) return;
    if (scheduler.requestIdleCallback) {
      idle = scheduler.requestIdleCallback(() => {
        idle = null;
        bootOnce();
      }, { timeout: 1_000 });
      return;
    }
    if (scheduler.requestAnimationFrame) {
      frame = scheduler.requestAnimationFrame(() => {
        frame = null;
        timer = scheduler.setTimeout(() => {
          timer = null;
          bootOnce();
        }, 0);
      });
      return;
    }
    timer = scheduler.setTimeout(() => {
      timer = null;
      bootOnce();
    }, 0);
  };

  timer = scheduler.setTimeout(() => {
    timer = null;
    scheduleBootSlice();
  }, delayMs);

  return () => {
    cancelled = true;
    if (timer !== null) scheduler.clearTimeout(timer);
    if (frame !== null && scheduler.cancelAnimationFrame) scheduler.cancelAnimationFrame(frame);
    if (idle !== null && scheduler.cancelIdleCallback) scheduler.cancelIdleCallback(idle);
    timer = null;
    frame = null;
    idle = null;
  };
}
