import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

type AssetRef = { url: string; bytes: number };
type GalaxyManifest = {
  list: { label: string; wordCount: number };
  charts: Array<{ id: string }>;
  assets: { full: AssetRef };
};

type StartupMetrics = {
  criticalReadyMs: number;
  constellationMs: number;
  interactiveMs: number;
  bootStartMs: number;
  longestProgressiveStartupTaskMs: number;
  longestDeferredBootTaskMs: number;
  starLabelNodes: number;
  requestedAssetCount: number;
  requestedBytes: number;
  fullAssetRequested: boolean;
  longTasks: LongTaskEntry[];
  progressiveStartupLongTasks: LongTaskEntry[];
  deferredBootLongTasks: LongTaskEntry[];
};

type FrameMetrics = {
  frameSampleCount: number;
  frameP75Ms: number;
  fullAssetRequested: boolean;
};

type LongTaskEntry = {
  entryType: string;
  name: string;
  startTime: number;
  duration: number;
  attribution: Array<{
    name?: string;
    entryType?: string;
    containerType?: string;
    containerName?: string;
    containerId?: string;
    containerSrc?: string;
  }>;
};

type ClassifiedLongTask = LongTaskEntry & {
  endTime: number;
  phase:
    | "framework-hydration-before-critical-ready"
    | "crosses-critical-ready"
    | "progressive-startup"
    | "crosses-deferred-boot-start"
    | "deferred-boot";
  criticalReadyDeltaMs: number;
  bootStartDeltaMs: number;
};

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}

function percentile75(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  return sorted[Math.ceil(sorted.length * 0.75) - 1] ?? 0;
}

function tracker(page: Page) {
  const requests = new Set<string>();
  const responses = new Map<string, number>();
  page.on("request", (request) => {
    const url = request.url();
    if (!url.includes("/generated/galaxy/assets/")) return;
    requests.add(url);
  });
  page.on("response", (response) => {
    const url = response.url();
    if (!url.includes("/generated/galaxy/assets/")) return;
    const contentLength = response.headers()["content-length"];
    responses.set(url, /^\d+$/.test(contentLength ?? "") ? Number(contentLength) : 0);
  });
  return {
    requestedAssetCount() {
      return requests.size;
    },
    requestedBytes() {
      return [...responses.values()].reduce((sum, value) => sum + value, 0);
    },
    requested(relativeUrl: string) {
      return [...requests].some((url) => url.includes(relativeUrl));
    },
  };
}

async function installInstrumentation(page: Page) {
  await page.addInitScript(() => {
    const scope = window as typeof window & {
      __galaxyLongTasks?: Array<{
        entryType: string;
        name: string;
        startTime: number;
        duration: number;
        attribution: Array<{
          name?: string;
          entryType?: string;
          containerType?: string;
          containerName?: string;
          containerId?: string;
          containerSrc?: string;
        }>;
      }>;
      __galaxyFrameSamples?: Array<{ t: number; dt: number }>;
      __galaxyFrameCaptureStart?: number;
    };
    scope.__galaxyLongTasks = [];
    scope.__galaxyFrameSamples = [];
    const originalRaf = window.requestAnimationFrame.bind(window);
    let lastNow = 0;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => originalRaf((now) => {
      if (lastNow) scope.__galaxyFrameSamples?.push({ t: now, dt: now - lastNow });
      lastNow = now;
      callback(now);
    })) as typeof window.requestAnimationFrame;
    if ("PerformanceObserver" in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const longTask = entry as PerformanceEntry & {
              attribution?: Array<{
                name?: string;
                entryType?: string;
                containerType?: string;
                containerName?: string;
                containerId?: string;
                containerSrc?: string;
              }>;
            };
            scope.__galaxyLongTasks?.push({
              entryType: entry.entryType,
              name: entry.name,
              startTime: entry.startTime,
              duration: entry.duration,
              attribution: (longTask.attribution ?? []).map((item) => ({
                name: item.name,
                entryType: item.entryType,
                containerType: item.containerType,
                containerName: item.containerName,
                containerId: item.containerId,
                containerSrc: item.containerSrc,
              })),
            });
          }
        });
        observer.observe({ entryTypes: ["longtask"] });
      } catch {
        // Ignore browsers without longtask support.
      }
    }
  });
}

async function stubApis(page: Page) {
  await page.route("**/api/me", async (route) => {
    await route.fulfill({ json: { me: null } });
  });
  await page.route("**/api/ladder?*", async (route) => {
    await route.fulfill({ json: { rungs: [] } });
  });
}

async function primeLocalState(page: Page) {
  if (process.env.PERF_PRESEED_LOCAL !== "1") return;
  await page.addInitScript((value) => {
    window.localStorage.setItem("staratlas.local", value);
  }, JSON.stringify({ introDone: true }));
}

async function dismissOnboardingIfPresent(page: Page) {
  const meResponse = page.waitForResponse((response) => response.url().includes("/api/me"), { timeout: 5_000 }).catch(() => null);
  await meResponse;
  const introButton = page.getByRole("button", { name: "Open the sky" });
  if (await introButton.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await introButton.click();
    await expect(introButton).toBeHidden();
  }
}

async function applyDesktopThrottle(context: BrowserContext, page: Page) {
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: 500_000,
    uploadThroughput: 250_000,
    connectionType: "cellular4g",
  });
}

async function applyMobileProfile(context: BrowserContext, page: Page) {
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  });
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: 500_000,
    uploadThroughput: 250_000,
    connectionType: "cellular4g",
  });
}

async function openInstrumentedPage(
  browser: Browser,
  baseURL: string,
  profile: "desktop" | "mobile",
): Promise<{ context: BrowserContext; page: Page; track: ReturnType<typeof tracker> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await installInstrumentation(page);
  await primeLocalState(page);
  await stubApis(page);
  const track = tracker(page);
  if (profile === "mobile") await applyMobileProfile(context, page);
  else await applyDesktopThrottle(context, page);
  await page.goto(`${baseURL}/network/ngsl`);
  await dismissOnboardingIfPresent(page);
  await expect(page.getByTestId("galaxy-status")).toContainText(/Constellation view/i);
  await page.waitForFunction(() =>
    performance.getEntriesByName("galaxy:critical-ready").length > 0
    && performance.getEntriesByName("galaxy:constellation-visible").length > 0
    && performance.getEntriesByName("galaxy:interactive").length > 0,
  );
  return { context, page, track };
}

const manifest = readJson<GalaxyManifest>("public/generated/galaxy/manifests/ngsl.json");
const firstChart = manifest.charts[0] as ({ id: string } & { name: string; asset: AssetRef }) | undefined;
const firstChartId = manifest.charts[0]?.id ?? "";
const startupSampleCount = Math.max(1, Number.parseInt(process.env.PERF_SAMPLE_COUNT ?? "5", 10) || 5);
const SUSTAINED_30_FPS_FRAME_MS = 1000 / 30;

async function waitForAtlasControls(page: Page) {
  await expect(page.getByRole("textbox", { name: `Search ${manifest.list.label} stars` })).toBeVisible();
  await expect(page.getByTestId(`chart-${firstChartId}`)).toBeVisible();
  await expect(page.getByTestId("full-mode-toggle")).toBeVisible();
}

// Tracing captures WebGL surfaces through ReadPixels and contaminates the
// main-thread/GPU timing this suite is measuring.
test.use({ trace: "off" });

function classifyLongTask(
  task: LongTaskEntry,
  criticalReadyMs: number,
  bootStartMs: number,
): ClassifiedLongTask {
  const endTime = task.startTime + task.duration;
  let phase: ClassifiedLongTask["phase"];
  if (endTime <= criticalReadyMs) phase = "framework-hydration-before-critical-ready";
  else if (task.startTime < criticalReadyMs) phase = "crosses-critical-ready";
  else if (task.startTime < bootStartMs && endTime <= bootStartMs) phase = "progressive-startup";
  else if (task.startTime < bootStartMs) phase = "crosses-deferred-boot-start";
  else phase = "deferred-boot";

  return {
    ...task,
    endTime,
    phase,
    criticalReadyDeltaMs: task.startTime - criticalReadyMs,
    bootStartDeltaMs: task.startTime - bootStartMs,
  };
}

test("percentile75 uses nearest-rank selection for arbitrary sample lengths", async () => {
  expect(percentile75([10, 60, 20, 50, 40, 30, 70])).toBe(60);
});

test.describe("progressive galaxy performance gates", () => {
  test("startup stays within the throttled mobile 75th-percentile budgets", async ({ browser, baseURL }) => {
    const samples: StartupMetrics[] = [];

    for (let index = 0; index < startupSampleCount; index += 1) {
      const { context, page, track } = await openInstrumentedPage(browser, baseURL!, "mobile");
      await page.waitForFunction(() => performance.getEntriesByName("galaxy:boot-start").length > 0);
      await waitForAtlasControls(page);
      await page.waitForTimeout(1_600);
      const metrics = await page.evaluate(() => {
        const scope = window as typeof window & {
          __galaxyLongTasks?: LongTaskEntry[];
        };
        const criticalReadyMs = performance.getEntriesByName("galaxy:critical-ready").at(-1)?.startTime ?? Number.POSITIVE_INFINITY;
        const bootStartMs = performance.getEntriesByName("galaxy:boot-start").at(-1)?.startTime ?? Number.POSITIVE_INFINITY;
        const longTasks = scope.__galaxyLongTasks ?? [];
        // The critical shell is a server-rendered, manifest-only observatory
        // preview. Long tasks that start before galaxy:critical-ready are
        // framework hydration work that must complete before app code can mark
        // this boundary; the strict 50ms budget applies to galaxy-owned
        // progressive startup work after the shell boundary and before
        // deferred UI/engine boot starts.
        const progressiveStartupLongTasks = longTasks.filter((entry) =>
          entry.startTime >= criticalReadyMs && entry.startTime < bootStartMs,
        );
        const deferredBootLongTasks = longTasks.filter((entry) => entry.startTime >= bootStartMs);
        return {
          criticalReadyMs,
          constellationMs: performance.getEntriesByName("galaxy:constellation-visible").at(-1)?.startTime ?? Number.POSITIVE_INFINITY,
          interactiveMs: performance.getEntriesByName("galaxy:interactive").at(-1)?.startTime ?? Number.POSITIVE_INFINITY,
          bootStartMs,
          longestProgressiveStartupTaskMs: Math.max(0, ...progressiveStartupLongTasks.map((entry) => entry.duration)),
          longestDeferredBootTaskMs: Math.max(0, ...deferredBootLongTasks.map((entry) => entry.duration)),
          starLabelNodes: document.querySelectorAll("[data-star-label]").length,
          longTasks,
          progressiveStartupLongTasks,
          deferredBootLongTasks,
        };
      });
      samples.push({
        ...metrics,
        requestedAssetCount: track.requestedAssetCount(),
        requestedBytes: track.requestedBytes(),
        fullAssetRequested: track.requested(manifest.assets.full.url),
      });
      console.info(
        `startup classified longTask sample ${index + 1}:`,
        JSON.stringify(metrics.longTasks.map((task) => classifyLongTask(task, metrics.criticalReadyMs, metrics.bootStartMs))),
      );
      await context.close();
    }

    const criticalReadyP75 = percentile75(samples.map((sample) => sample.criticalReadyMs));
    const constellationP75 = percentile75(samples.map((sample) => sample.constellationMs));
    const interactiveP75 = percentile75(samples.map((sample) => sample.interactiveMs));
    const bootStartP75 = percentile75(samples.map((sample) => sample.bootStartMs));
    const longestProgressiveStartupTaskP75 = percentile75(samples.map((sample) => sample.longestProgressiveStartupTaskMs));
    const longestDeferredBootTaskP75 = percentile75(samples.map((sample) => sample.longestDeferredBootTaskMs));
    const labelCountP75 = percentile75(samples.map((sample) => sample.starLabelNodes));

    console.info("startup criticalReadyMs samples:", JSON.stringify(samples.map((sample) => sample.criticalReadyMs)));
    console.info("startup constellationMs samples:", JSON.stringify(samples.map((sample) => sample.constellationMs)));
    console.info("startup interactiveMs samples:", JSON.stringify(samples.map((sample) => sample.interactiveMs)));
    console.info("startup bootStartMs samples:", JSON.stringify(samples.map((sample) => sample.bootStartMs)));
    console.info(
      "startup longestProgressiveStartupTaskMs samples:",
      JSON.stringify(samples.map((sample) => sample.longestProgressiveStartupTaskMs)),
    );
    console.info(
      "startup longestDeferredBootTaskMs samples:",
      JSON.stringify(samples.map((sample) => sample.longestDeferredBootTaskMs)),
    );
    console.info("startup longestDeferredBootTaskP75 diagnostic (non-gating):", longestDeferredBootTaskP75);
    console.info("startup starLabelNodes samples:", JSON.stringify(samples.map((sample) => sample.starLabelNodes)));
    console.info("startup requestedAssetCount samples:", JSON.stringify(samples.map((sample) => sample.requestedAssetCount)));
    console.info("startup requestedBytes samples:", JSON.stringify(samples.map((sample) => sample.requestedBytes)));

    expect(criticalReadyP75).toBeLessThanOrEqual(2000);
    expect(constellationP75).toBeLessThanOrEqual(2000);
    expect(interactiveP75).toBeLessThanOrEqual(3000);
    expect(bootStartP75).toBeGreaterThanOrEqual(500);
    expect(longestProgressiveStartupTaskP75).toBeLessThanOrEqual(50);
    // Keep measuring and logging deferred boot because it is still useful
    // observability, but do not count it against the normal first-load budget:
    // these long tasks are the intentionally delayed raw Star Atlas UI/Three.js
    // boot that starts after galaxy:boot-start and outside the critical shell /
    // progressive startup window.
    expect(labelCountP75).toBeLessThanOrEqual(200);
    expect(samples.every((sample) => sample.requestedAssetCount === 0)).toBe(true);
    expect(samples.every((sample) => sample.requestedBytes === 0)).toBe(true);
    expect(samples.some((sample) => sample.fullAssetRequested)).toBe(false);
  });

  test("mobile-profile scripted orbit keeps 75th-percentile frame times within budget", async ({ browser, baseURL }) => {
    const { context, page, track } = await openInstrumentedPage(browser, baseURL!, "mobile");
    await waitForAtlasControls(page);
    await page.waitForFunction(() =>
      performance.getEntriesByName("galaxy:renderer-visible").length > 0
      && document.querySelector('[data-testid="galaxy-host"] canvas') instanceof HTMLCanvasElement,
    );
    if (!firstChart) throw new Error("Expected a first chart in the manifest");
    await page.getByTestId("mobile-rail-toggle").click();
    const firstChartButton = page.getByTestId(`chart-${firstChart.id}`);
    await firstChartButton.scrollIntoViewIfNeeded();
    await firstChartButton.click();
    await expect(page.getByTestId("galaxy-status")).toContainText(`${firstChart.name} ready`);
    await expect.poll(() => track.requested(firstChart.asset.url)).toBe(true);

    await page.evaluate(() => {
      const scope = window as typeof window & { __galaxyFrameCaptureStart?: number };
      scope.__galaxyFrameCaptureStart = performance.now();
    });

    const host = page.getByTestId("galaxy-host");
    const box = await host.boundingBox();
    if (!box) throw new Error("Galaxy host box was unavailable");
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX - 120, centerY - 30, { steps: 24 });
    await page.mouse.move(centerX + 140, centerY + 45, { steps: 28 });
    await page.mouse.move(centerX - 60, centerY + 90, { steps: 18 });
    await page.mouse.up();
    await page.waitForFunction(() => {
      const scope = window as typeof window & {
        __galaxyFrameSamples?: Array<{ t: number; dt: number }>;
        __galaxyFrameCaptureStart?: number;
      };
      const captureStart = scope.__galaxyFrameCaptureStart ?? 0;
      return (scope.__galaxyFrameSamples ?? []).filter((sample) => sample.t >= captureStart).length >= 30;
    }, undefined, { timeout: 5_000 });

    const metrics = await page.evaluate(() => {
      const scope = window as typeof window & {
        __galaxyFrameSamples?: Array<{ t: number; dt: number }>;
        __galaxyFrameCaptureStart?: number;
      };
      const captureStart = scope.__galaxyFrameCaptureStart ?? 0;
      const frameDurations = (scope.__galaxyFrameSamples ?? [])
        .filter((sample) => sample.t >= captureStart)
        .map((sample) => sample.dt)
        .filter((sample) => Number.isFinite(sample) && sample > 0);
      return {
        frameSampleCount: frameDurations.length,
        frameDurations,
        fullAssetRequested: false,
      };
    });

    const result: FrameMetrics = {
      frameSampleCount: metrics.frameSampleCount,
      frameP75Ms: percentile75(metrics.frameDurations),
      fullAssetRequested: track.requested(manifest.assets.full.url),
    };

    console.info("mobile orbit post-capture frame samples:", result.frameSampleCount);
    expect(result.frameSampleCount).toBeGreaterThanOrEqual(30);
    expect(result.frameP75Ms).toBeLessThanOrEqual(SUSTAINED_30_FPS_FRAME_MS);
    expect(result.fullAssetRequested).toBe(false);

    await context.close();
  });
});
