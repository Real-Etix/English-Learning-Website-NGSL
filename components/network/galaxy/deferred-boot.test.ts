import { describe, expect, it, vi } from "vitest";

import {
  GALAXY_BOOT_START_MARK,
  GALAXY_CONSTELLATION_VISIBLE_MARK,
  GALAXY_CRITICAL_READY_MARK,
  GALAXY_INTERACTIVE_MARK,
  GALAXY_RENDERER_VISIBLE_MARK,
  markGalaxyBootStart,
  markGalaxyConstellationVisible,
  markGalaxyCriticalReady,
  markGalaxyInteractive,
  markGalaxyRendererVisible,
  scheduleDeferredEngineBoot,
} from "./deferred-boot";

describe("galaxy lifecycle marks", () => {
  it("records the critical shell boundary without collapsing later lifecycle marks", () => {
    const marks: string[] = [];
    const performanceLike = {
      getEntriesByName: (name: string) => marks.filter((mark) => mark === name).map((name) => ({ name })),
      mark: (name: string) => { marks.push(name); },
    };

    markGalaxyCriticalReady(performanceLike);
    markGalaxyCriticalReady(performanceLike);

    expect(marks).toEqual([GALAXY_CRITICAL_READY_MARK]);
  });

  it("records interactive, constellation-visible, and renderer-visible as separate idempotent boundaries", () => {
    const marks: string[] = [];
    const performanceLike = {
      getEntriesByName: (name: string) => marks.filter((mark) => mark === name).map((name) => ({ name })),
      mark: (name: string) => { marks.push(name); },
    };

    markGalaxyInteractive(performanceLike);
    markGalaxyInteractive(performanceLike);
    markGalaxyConstellationVisible(performanceLike);
    markGalaxyConstellationVisible(performanceLike);
    markGalaxyRendererVisible(performanceLike);
    markGalaxyRendererVisible(performanceLike);

    expect(marks).toEqual([
      GALAXY_INTERACTIVE_MARK,
      GALAXY_CONSTELLATION_VISIBLE_MARK,
      GALAXY_RENDERER_VISIBLE_MARK,
    ]);
  });

  it("records the deferred boot boundary once", () => {
    const marks: string[] = [];
    const performanceLike = {
      getEntriesByName: (name: string) => marks.filter((mark) => mark === name).map((name) => ({ name })),
      mark: (name: string) => { marks.push(name); },
    };

    markGalaxyBootStart(performanceLike);
    markGalaxyBootStart(performanceLike);

    expect(marks).toEqual([GALAXY_BOOT_START_MARK]);
  });
});

describe("scheduleDeferredEngineBoot", () => {
  it("waits for the startup delay and an idle slice before booting the engine", () => {
    vi.useFakeTimers();
    const boot = vi.fn();

    const cancel = scheduleDeferredEngineBoot(boot, {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      requestIdleCallback: (callback) => globalThis.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 12 }), 0),
      cancelIdleCallback: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
    });

    vi.advanceTimersByTime(749);
    expect(boot).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(boot).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();
    expect(boot).toHaveBeenCalledTimes(1);

    cancel();
    vi.useRealTimers();
  });

  it("cancels pending deferred boots during route/list cleanup", () => {
    vi.useFakeTimers();
    const boot = vi.fn();
    const cancel = scheduleDeferredEngineBoot(boot);

    cancel();
    vi.advanceTimersByTime(2_000);

    expect(boot).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
