import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { buildWordLearningProfile } from "../../lib/content/word-learning";
import { toLegacyPage } from "../../lib/vocabulary/legacy-profile-adapter";
import { VocabularyRecordSchema } from "../../lib/vocabulary/schema";
import { shardIdForLemma } from "../../lib/vocabulary/shards";

const manifest = JSON.parse(fs.readFileSync("public/generated/galaxy/manifests/all.json", "utf8"));
for (const lemma of ["absorbedly", "indebted", "miscible"]) {
const shard = JSON.parse(fs.readFileSync(`data/generated/vocabulary/words-${shardIdForLemma(lemma)}.json`, "utf8"));
const record = VocabularyRecordSchema.parse(shard[lemma]);
const learning = buildWordLearningProfile(record, null);

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`${lemma}: meaning-only release can be claimed without unlocking practice (${viewport.width}px)`, async ({ page }, testInfo) => {
    test.setTimeout(45000);
    await page.setViewportSize(viewport);
    await page.addInitScript(() => localStorage.setItem("staratlas.local", JSON.stringify({ introDone: true })));
    const claims: unknown[] = [];
    // Local artifact/UI integration only: no dictionary, LLM or database writes.
    await page.route("**/api/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === `/api/word/${lemma}`) return route.fulfill({ json: { page: toLegacyPage(record, []), detail: null, learning, rarity: null } });
      if (pathname === "/api/me") return route.fulfill({ json: { me: null } });
      if (pathname === "/api/collect") {
        claims.push(route.request().postDataJSON());
        return route.fulfill({ json: { added: true, xp: 40, summary: { slug: "fixture", displayName: null, lemmas: [lemma], usedLemmas: [], wordCount: 1, totalXp: 40, level: 1, badges: [], decayedCount: 0 } } });
      }
      return route.fulfill({ json: { rungs: [], stops: [], route: [] } });
    });
    await page.goto("/network/all");
    await page.getByRole("textbox", { name: `Search ${manifest.list.label} stars` }).fill(lemma);
    await page.getByRole("button", { name: new RegExp(`^${lemma}\\b`) }).first().click();
    await expect(page.getByText("Limited examples · meaning reviewed.", { exact: false })).toBeVisible();
    if (learning.senses[0]?.labels?.length) {
      await expect(page.getByRole("note", { name: "Usage labels" })).toHaveText(`Usage: ${learning.senses[0].labels.join(" · ")}`);
    }
    await expect.poll(async () => {
      const box = await page.getByRole("complementary", { name: "Word learning drawer" }).boundingBox();
      return !!box && box.x >= -1 && box.x + box.width <= viewport.width + 1;
    }).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`meaning-${viewport.width}.png`) });
    await page.getByRole("button", { name: "Check what you know, then claim it" }).click();
    await expect(page.getByRole("heading").filter({ hasText: learning.senses[0]!.definition })).toBeVisible();
    const input = page.getByRole("textbox", { name: "Your answer" });
    if (await input.isVisible()) {
      await input.fill(lemma);
      await page.getByRole("button", { name: "Check", exact: true }).click();
    } else await page.getByRole("button", { name: `· ${lemma}`, exact: true }).click();
    await page.getByRole("button", { name: "Keep exploring" }).click();
    expect(claims).toEqual([{ lemma, senseId: learning.senses[0]!.id }]);
    await page.getByRole("tab", { name: "Use", exact: true }).click();
    await expect(page.getByRole("button", { name: "Use it in a sentence", exact: false })).toBeDisabled();
    await expect(page.getByText("Sentence practice needs a reviewed, sourced example.", { exact: true })).toBeVisible();
    // Released words are discoverable without promoting unreviewed connections.
    const search = JSON.parse(fs.readFileSync(path.join("public", manifest.assets.searchIndex.url), "utf8"));
    expect(search.entries.some((entry: { lemma: string }) => entry.lemma === lemma)).toBe(true);
  });
}
}
