import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), mark: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "test-owner" }) }) }));
vi.mock("@/lib/vocabulary/generated-word-store", () => ({ loadGeneratedWord: mocks.load }));
vi.mock("@/lib/collection/service", () => ({ markWordUsed: mocks.mark }));
import { vocabularyRecordFixture } from "@/lib/vocabulary/test-fixtures";
import { meaningReviewSnapshot } from "@/lib/vocabulary/meaning-review";
import { POST } from "./route";

beforeEach(() => { vi.resetAllMocks(); mocks.mark.mockResolvedValue({ used: true, bonus: 8 }); });
it("does not award practice XP for a meaning-only release, even with a direct request", async () => {
  const record = vocabularyRecordFixture();
  const sense = record.senses[0]!;
  sense.examples = [];
  sense.meaningReview = { policy: "limited-examples-v1", reason: "Reviewed meaning", reviewedAt: "2026-10-16T00:00:00.000Z", contentSnapshot: meaningReviewSnapshot(record, sense) };
  mocks.load.mockResolvedValue(record);
  const response = await POST(new Request("http://localhost/api/use", { method: "POST", body: JSON.stringify({ lemma: record.lemma }) }));
  expect(response.status).toBe(409);
  expect(mocks.mark).not.toHaveBeenCalled();
});
it("preserves practice XP for an eligible published sense", async () => {
  const record = vocabularyRecordFixture();
  mocks.load.mockResolvedValue(record);
  const response = await POST(new Request("http://localhost/api/use", { method: "POST", body: JSON.stringify({ lemma: record.lemma, senseId: record.senses[0]!.id }) }));
  expect(response.status).toBe(200);
  expect(mocks.mark).toHaveBeenCalledOnce();
});
