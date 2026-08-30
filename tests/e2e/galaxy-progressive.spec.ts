import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

type AssetRef = { url: string; bytes: number };
type GalaxyChart = { id: string; name: string; wordCount: number; asset: AssetRef };
type GalaxyManifest = {
  list: { label: string; chartCount: number; wordCount: number };
  charts: GalaxyChart[];
  assets: { searchIndex: AssetRef; full: AssetRef };
};
type SearchEntry = { lemma: string; display: string; chartId: string; normalized: string };
type CollectionSummary = {
  slug: string;
  displayName: string | null;
  lemmas: string[];
  usedLemmas: string[];
  decayedCount: number;
  wordCount: number;
  totalXp: number;
  level: number;
  badges: unknown[];
};

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function galaxyTracker(page: Page) {
  const urls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/generated/galaxy/assets/")) urls.push(request.url());
  });
  return {
    urls,
    requested(relativeUrl: string) {
      return urls.some((url) => url.includes(relativeUrl));
    },
    requestedCount(relativeUrl: string) {
      return urls.filter((url) => url.includes(relativeUrl)).length;
    },
  };
}

function buildCollectionSummary(
  lemmas: string[],
  overrides: Partial<CollectionSummary> = {},
): CollectionSummary {
  const totalXp = overrides.totalXp ?? Math.max(40, lemmas.length * 20);
  return {
    slug: overrides.slug ?? "fixture-owner",
    displayName: overrides.displayName ?? "Fixture Owner",
    lemmas,
    usedLemmas: overrides.usedLemmas ?? [],
    decayedCount: overrides.decayedCount ?? 0,
    wordCount: overrides.wordCount ?? lemmas.length,
    totalXp,
    level: overrides.level ?? Math.max(1, Math.floor(totalXp / 100) + 1),
    badges: overrides.badges ?? [],
  };
}

function findSearchPrefixWithMultipleMatches(entries: SearchEntry[]): string {
  for (const length of [2, 1, 3, 4]) {
    for (const entry of entries) {
      const prefix = entry.normalized.slice(0, length);
      if (!prefix) continue;
      const prefixMatches = entries.filter((candidate) => candidate.normalized.startsWith(prefix));
      if (prefixMatches.length >= 2) return prefix;
    }
  }
  throw new Error("Expected at least one multi-result search prefix");
}

async function stubCommonApis(
  page: Page,
  {
    listLabel = "NGSL",
    me = null,
  }: {
    listLabel?: string;
    me?: CollectionSummary | null;
  } = {},
) {
  await page.route("**/api/me", async (route) => {
    await route.fulfill({ json: { me } });
  });
  await page.route("**/api/ladder?*", async (route) => {
    await route.fulfill({
      json: {
        rungs: [
          {
            from: "plain",
            fromDisplay: "plain",
            fromChartId: "simple",
            to: "subtle",
            toDisplay: "subtle",
            toChartId: "complex",
            baseHeld: false,
            type: "advanced_form",
          },
        ],
      },
    });
  });
  await page.route("**/api/run?*", async (route) => {
    await route.fulfill({
      json: {
        stops: [
          { lemma: "abandon", display: "abandon", chartId: "from" },
          { lemma: "system", display: "system", chartId: "system" },
          { lemma: "family", display: "family", chartId: "family" },
        ],
        route: ["abandon", "system", "family"],
        day: "2026-08-13",
        listLabel,
      },
    });
  });
}

async function gotoNgsl(
  page: Page,
  options?: {
    me?: CollectionSummary | null;
  },
) {
  await stubCommonApis(page, options);
  await page.goto("/network/ngsl");
  await dismissOnboardingIfPresent(page);
  await expect(page.getByTestId("galaxy-status")).toContainText(/Constellation view/i);
  await waitForAtlasControls(page);
}

async function waitForAtlasControls(page: Page) {
  await expect(page.getByRole("textbox", { name: `Search ${manifest.list.label} stars` })).toBeVisible();
  await expect(page.getByTestId(`chart-${firstChart.id}`)).toBeVisible();
  await expect(page.getByTestId("full-mode-toggle")).toBeVisible();
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

const manifest = readJson<GalaxyManifest>("public/generated/galaxy/manifests/ngsl.json");
const searchCatalog = readJson<{ entries: SearchEntry[] }>(path.join("public", manifest.assets.searchIndex.url));
const firstChart = manifest.charts[0];
const searchWord = searchCatalog.entries.find((entry) => /^[A-Za-z][A-Za-z' -]{4,}$/.test(entry.display) && entry.chartId !== "drift") ?? searchCatalog.entries[0];
const searchWordChart = manifest.charts.find((chart) => chart.id === searchWord.chartId) ?? firstChart;
const keyboardSearchQuery = findSearchPrefixWithMultipleMatches(searchCatalog.entries);
const programWord = searchCatalog.entries.find((entry) => entry.lemma === "program");

test.describe("progressive galaxy browser verification", () => {
  test("normal opening stays manifest-only until chart interaction", async ({ page }) => {
    const tracker = galaxyTracker(page);

    await gotoNgsl(page);

    expect(tracker.urls).toEqual([]);

    await page.getByTestId(`chart-${firstChart.id}`).click();

    await expect(page.getByTestId("galaxy-status")).toContainText(`${firstChart.name} ready`);
    await expect.poll(() => tracker.requested(firstChart.asset.url)).toBe(true);
    expect(tracker.requested(manifest.assets.full.url)).toBe(false);
  });

  test("searching a word flies to its star without requesting the full asset", async ({ page }) => {
    const tracker = galaxyTracker(page);

    await gotoNgsl(page);

    const search = page.getByRole("textbox", { name: `Search ${manifest.list.label} stars` });
    await search.fill(searchWord.display);
    await page.getByRole("button", { name: new RegExp(`^${escapeRegExp(searchWord.display)}\\b`, "i") }).click();

    await expect(page.getByRole("heading", { name: new RegExp(`^${escapeRegExp(searchWord.display)}$`, "i") })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("galaxy-status")).toContainText(`${searchWordChart.name} ready`);
    expect(tracker.requested(searchWordChart.asset.url)).toBe(true);
    expect(tracker.requested(manifest.assets.full.url)).toBe(false);
  });

  test("multiline meanings stay inside their cards in a short drawer", async ({ page }) => {
    test.skip(!programWord, "The NGSL fixture must contain program");
    await page.setViewportSize({ width: 1280, height: 418 });
    await page.route("**/api/word/program", async (route) => {
      await route.fulfill({
        json: {
          page: {
            lemma: "program",
            display: "program",
            tier: "core",
            pos: "noun",
            rank: 100,
            sfi: 60,
            chart: programWord?.chartId ?? null,
            region: null,
            lists: ["ngsl"],
            forms: ["programs"],
            status: "verified",
            sources: ["wordnet"],
            definition: "a series of steps to be carried out or goals to be accomplished",
            usageNote: null,
            examples: [],
            connections: [],
            domains: [],
          },
          detail: null,
          rarity: null,
          learning: {
            lemma: "program",
            display: "program",
            tier: "core",
            partOfSpeech: "noun",
            forms: ["programs"],
            status: "verified",
            sources: ["wordnet"],
            evidence: "verified",
            evidenceLabel: "Verified",
            pronunciation: { ipa: null, audioUk: null, audioUs: null, audioAny: null },
            senses: [
              {
                id: "wiki:0",
                partOfSpeech: "noun",
                definition: "a series of steps to be carried out or goals to be accomplished",
                example: null,
                source: "wiki",
                primary: true,
                canClaim: true,
                claimBlockReason: null,
              },
              {
                id: "dictionaryapi:1",
                partOfSpeech: "noun",
                definition: "A set of structured activities.",
                example: "Our program for today’s exercise class includes swimming and jogging.",
                source: "dictionaryapi",
                primary: false,
                canClaim: true,
                claimBlockReason: null,
              },
            ],
            examples: [],
            usagePatterns: [],
            collocations: [],
            commonMistakes: [],
            usageNote: null,
            connections: [],
            canClaim: true,
            claimBlockReason: null,
          },
        },
      });
    });

    await gotoNgsl(page);
    const search = page.getByRole("textbox", { name: `Search ${manifest.list.label} stars` });
    await search.fill("program");
    await page.getByRole("button", { name: /^program\b/i }).click();

    const drawer = page.getByRole("complementary", { name: "Word learning drawer" });
    const primary = drawer.locator('[data-sense-id="wiki:0"]');
    const otherHeading = drawer.getByRole("heading", { name: "Other meanings" });
    await expect(primary).toBeVisible({ timeout: 10_000 });

    const primaryBox = await primary.boundingBox();
    const otherHeadingBox = await otherHeading.boundingBox();
    expect(primaryBox).not.toBeNull();
    expect(otherHeadingBox).not.toBeNull();
    expect(await primary.evaluate((element) => getComputedStyle(element).flexShrink)).toBe("0");
    expect(primaryBox!.y + primaryBox!.height).toBeLessThanOrEqual(otherHeadingBox!.y);
  });

  test("returning users stay manifest-only until explicitly opening Your Space", async ({ page }) => {
    const tracker = galaxyTracker(page);

    await gotoNgsl(page, {
      me: buildCollectionSummary([searchWord.lemma], { totalXp: 120, level: 2 }),
    });

    expect(tracker.urls).toEqual([]);
    expect(tracker.requested(manifest.assets.searchIndex.url)).toBe(false);

    await page.getByRole("button", { name: /^Your space$/i }).click();

    await expect.poll(() => tracker.requested(manifest.assets.searchIndex.url)).toBe(true);
    expect(tracker.requested(manifest.assets.full.url)).toBe(false);
  });

  test("returning users request the catalog only after explicit search focus", async ({ page }) => {
    const tracker = galaxyTracker(page);

    await gotoNgsl(page, {
      me: buildCollectionSummary([searchWord.lemma], { totalXp: 120, level: 2 }),
    });

    expect(tracker.urls).toEqual([]);
    expect(tracker.requested(manifest.assets.searchIndex.url)).toBe(false);

    await page.getByRole("textbox", { name: `Search ${manifest.list.label} stars` }).focus();

    await expect.poll(() => tracker.requested(manifest.assets.searchIndex.url)).toBe(true);
    expect(tracker.requested(manifest.assets.full.url)).toBe(false);
  });

  test("a one-time chart failure can be retried successfully", async ({ page }) => {
    const tracker = galaxyTracker(page);
    let failOnce = true;

    await page.route(`**${firstChart.asset.url}`, async (route) => {
      if (!failOnce) {
        await route.continue();
        return;
      }
      failOnce = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "temporary failure" }),
      });
    });

    await gotoNgsl(page);

    await page.getByTestId(`chart-${firstChart.id}`).click();
    await expect(page.getByTestId("galaxy-status")).toContainText(`${firstChart.name} could not be loaded.`);

    await page.getByRole("button", { name: "Retry" }).click();

    await expect(page.getByTestId("galaxy-status")).toContainText(`${firstChart.name} ready`);
    expect(failOnce).toBe(false);
    expect(tracker.requestedCount(firstChart.asset.url)).toBeGreaterThanOrEqual(2);
    expect(tracker.requested(manifest.assets.full.url)).toBe(false);
  });

  test("Run and Ladder stay scoped to route data and do not request the full asset", async ({ page }) => {
    const tracker = galaxyTracker(page);

    await gotoNgsl(page);

    await page.getByTestId("mode-run").click();
    await expect(page.getByText("3 stars, one per chart.")).toBeVisible();

    await page.getByTestId("mode-ladder").click();
    await expect(page.getByRole("button", { name: /plain → subtle/i })).toBeVisible();

    expect(tracker.requested(manifest.assets.full.url)).toBe(false);
  });

  test("full mode warns first and cancellation keeps the lighter constellation view", async ({ page }) => {
    const tracker = galaxyTracker(page);

    await gotoNgsl(page);

    await page.getByTestId("full-mode-toggle").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Load the complete NGSL galaxy/i })).toBeVisible();
    await expect(page.getByRole("dialog").getByText(new RegExp(`${manifest.list.wordCount.toLocaleString()} stars.+approximately`, "i"))).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByTestId("galaxy-status")).toContainText(/Constellation view/i);
    expect(tracker.requested(manifest.assets.full.url)).toBe(false);
  });

  test("full mode reports the exact count and returning cleans up back to constellation view", async ({ page }) => {
    const tracker = galaxyTracker(page);

    await gotoNgsl(page);

    await page.getByTestId("full-mode-toggle").click();
    await page.getByRole("button", { name: "Load full galaxy" }).click();

    await expect(page.getByTestId("galaxy-status")).toContainText(
      `Complete ${manifest.list.label} galaxy · ${manifest.list.wordCount.toLocaleString()} stars`,
      { timeout: 120_000 },
    );
    await expect(page.getByTestId("full-mode-toggle")).toContainText(`Return to ${manifest.list.label} constellation view`);
    await expect.poll(() => tracker.requestedCount(manifest.assets.full.url)).toBe(1);

    await page.getByTestId("full-mode-toggle").click();

    await expect(page.getByTestId("galaxy-status")).toContainText(/Constellation view/i);
    await expect(page.getByTestId("full-mode-toggle")).toContainText(`Load full ${manifest.list.label} galaxy`);
    expect(tracker.requestedCount(manifest.assets.full.url)).toBe(1);
  });

  test("the header level shortcut exits full mode before opening Your Space", async ({ page }) => {
    const tracker = galaxyTracker(page);

    await gotoNgsl(page, {
      me: buildCollectionSummary([searchWord.lemma], { totalXp: 120, level: 2 }),
    });

    await page.getByTestId("full-mode-toggle").click();
    await page.getByRole("button", { name: "Load full galaxy" }).click();

    await expect(page.getByTestId("galaxy-status")).toContainText(
      `Complete ${manifest.list.label} galaxy · ${manifest.list.wordCount.toLocaleString()} stars`,
      { timeout: 120_000 },
    );
    await expect.poll(() => tracker.requestedCount(manifest.assets.full.url)).toBe(1);
    expect(tracker.requested(manifest.assets.searchIndex.url)).toBe(false);

    await page.getByRole("button", { name: /120 xp/i }).click();

    await expect.poll(() => tracker.requested(manifest.assets.searchIndex.url)).toBe(true);
    await expect(page.getByRole("heading", { name: /Level 2, 1 star held/i })).toBeVisible();

    await page.getByRole("button", { name: /^Sky$/i }).click();

    await expect(page.getByTestId("galaxy-status")).toContainText(/Constellation view/i);
    await expect(page.getByTestId("full-mode-toggle")).toContainText(`Load full ${manifest.list.label} galaxy`);
    expect(tracker.requestedCount(manifest.assets.full.url)).toBe(1);
  });

  test("fallback charts support keyboard activation", async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext as (
        this: HTMLCanvasElement,
        contextId: string,
        options?: unknown,
      ) => RenderingContext | null;
      HTMLCanvasElement.prototype.getContext = function patchedGetContext(this: HTMLCanvasElement, contextId: string, options?: unknown) {
        if (String(contextId).toLowerCase().includes("webgl")) return null;
        return original.call(this, contextId, options);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });

    await stubCommonApis(page);
    await page.goto("/network/ngsl");
    await dismissOnboardingIfPresent(page);

    const chartTarget = page.locator("[data-fallback-chart]").first();
    await expect(chartTarget).toBeVisible();
    await chartTarget.focus();
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("galaxy-status")).toContainText("Full 3D mode is unavailable in this browser.");
    await expect(page.getByLabel(`${firstChart.name} words`)).toBeVisible();
    await expect(page.getByText(new RegExp(`${escapeRegExp(firstChart.name)} words ready|Loading ${escapeRegExp(firstChart.name)}…`))).toBeVisible();
  });

  test("focused non-first search results can be activated with Enter", async ({ page }) => {
    await gotoNgsl(page);

    const search = page.getByRole("textbox", { name: `Search ${manifest.list.label} stars` });
    await search.fill(keyboardSearchQuery);

    const secondResult = page.locator("[data-search-result]").nth(1);
    await expect(secondResult).toBeVisible();
    const targetLabel = (await secondResult.locator("span").nth(1).textContent())?.trim();
    if (!targetLabel) throw new Error("Second search result did not expose a label");

    await secondResult.focus();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("heading", { name: new RegExp(`^${escapeRegExp(targetLabel)}$`, "i") })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("reduced-motion rendering keeps label transitions disabled", async ({ page }) => {
    await page.addInitScript(() => {
      const original = window.matchMedia?.bind(window);
      window.matchMedia = ((query: string) => {
        if (query === "(prefers-reduced-motion: reduce)") {
          return {
            matches: true,
            media: query,
            onchange: null,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            addListener: () => undefined,
            removeListener: () => undefined,
            dispatchEvent: () => false,
          } as MediaQueryList;
        }
        if (original) return original(query);
        return {
          matches: false,
          media: query,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        } as MediaQueryList;
      }) as typeof window.matchMedia;
    });

    await gotoNgsl(page);

    const firstLabel = page.locator("[data-star-label]").first();
    await expect(firstLabel).toBeAttached();
    expect(await firstLabel.evaluate((element) => (element as HTMLElement).style.transition)).toBe("none");
  });

  test("switching lists opens the new manifest-only route without eagerly loading assets", async ({ page }) => {
    const toeicManifest = readJson<GalaxyManifest>("public/generated/galaxy/manifests/toeic.json");
    const tracker = galaxyTracker(page);

    await gotoNgsl(page);

    expect(tracker.urls).toEqual([]);

    await page.getByTestId("list-switcher").click();
    await page.getByTestId("list-option-toeic").click();

    await expect(page).toHaveURL(/\/network\/toeic$/);
    await expect(page.getByTestId("galaxy-status")).toContainText(
      `Constellation view · ${toeicManifest.list.chartCount} charts · ${toeicManifest.list.wordCount.toLocaleString()} stars`,
    );
    expect(tracker.urls).toEqual([]);
  });
});
