import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { buildWordLearningProfile } from "../../lib/content/word-learning";
import { toLegacyPage } from "../../lib/vocabulary/legacy-profile-adapter";
import { VocabularyRecordSchema } from "../../lib/vocabulary/schema";
import { shardIdForLemma } from "../../lib/vocabulary/shards";

const manifest = JSON.parse(fs.readFileSync("public/generated/galaxy/manifests/all.json", "utf8"));
for (const lemma of ["pressup", "doppelgnger", "catabolic", "entrepreneurialism"]) {
  const shard = JSON.parse(fs.readFileSync(`data/generated/vocabulary/words-${shardIdForLemma(lemma)}.json`, "utf8"));
  const record = VocabularyRecordSchema.parse(shard[lemma]);
  const learning = buildWordLearningProfile(record, null);
  for (const width of [1280, 390]) {
    test(`${lemma}: corrected display and composed definition retain claim identity (${width}px)`, async ({ page }, info) => {
      test.setTimeout(45000);
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript(() => localStorage.setItem("staratlas.local", JSON.stringify({ introDone: true })));
      const claims: unknown[] = [];
      // Exercise generated artifacts/UI without dictionary, paid API or DB writes.
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
      await page.getByRole("textbox", { name: `Search ${manifest.list.label} stars` }).fill(record.display);
      const literal = record.display.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      await page.getByRole("button", { name: new RegExp(`^${literal}`) }).first().click();
      const drawer = page.getByRole("complementary", { name: "Word learning drawer" });
      await expect(drawer.getByText(record.display, { exact: true }).first()).toBeVisible();
      await expect(drawer.getByText(learning.senses[0].definition, { exact: true })).toBeVisible();
      await expect(page.getByText("Limited examples · meaning reviewed.", { exact: false })).toBeVisible();
      await expect.poll(async () => {
        const box = await drawer.boundingBox();
        return !!box && box.x >= -1 && box.x + box.width <= width + 1;
      }).toBe(true);
      await page.screenshot({ path: info.outputPath(`definition-${width}.png`) });
      await page.getByRole("button", { name: "Check what you know, then claim it" }).click();
      await expect(page.getByRole("heading").filter({ hasText: learning.senses[0].definition })).toBeVisible();
      const answer = page.getByRole("textbox", { name: "Your answer" });
      if (await answer.isVisible()) {
        await answer.fill(record.display);
        await page.getByRole("button", { name: "Check", exact: true }).click();
      } else await page.getByRole("button", { name: `· ${record.display}`, exact: true }).click();
      await page.getByRole("button", { name: "Keep exploring" }).click();
      expect(claims).toEqual([{ lemma, senseId: learning.senses[0].id }]);
      await page.getByRole("tab", { name: "Use", exact: true }).click();
      await expect(page.getByRole("button", { name: "Use it in a sentence", exact: false })).toBeDisabled();
    });
  }
}
