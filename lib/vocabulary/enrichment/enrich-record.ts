import type { WordDetail } from "../../content/word-detail";
import { VocabularyRecordSchema, type ContentSourceRef, type VocabularyRecord, type VocabularySense } from "../schema";
import { isFactualSourceId } from "../source-evidence";
import { normalizeVocabularyLemma } from "../shards";
import { importDictionaryDetail, type DictionaryImportSource } from "./dictionary-import";
import { VocabularyEnrichmentProposalSchema, type VocabularyEnrichmentProposal } from "./proposal-schema";

export type FactualEnrichmentDetail = {
  detail: WordDetail;
  source: DictionaryImportSource;
  /** All known public targets accepted for learner-facing connections. */
  knownPublicTargets?: readonly string[];
  /** Only public core words may satisfy an advanced record's anchor requirement. */
  knownPublicCoreTargets: readonly string[];
};

export type EnrichmentDecision = {
  record: VocabularyRecord;
  changed: boolean;
  factualImportCount: number;
  reviewProposalCount: number;
  reviewable: boolean;
  rejections: string[];
};

const llmSource = (): ContentSourceRef => ({
  sourceId: "llm",
  externalId: null,
  url: null,
  retrievedAt: null,
  contentHash: null,
});

function hasFactualSource(sources: readonly ContentSourceRef[]): boolean {
  return sources.some((source) => isFactualSourceId(source.sourceId));
}

function hasFactualSenseAndExample(sense: VocabularySense): boolean {
  return Boolean(sense.definition.trim())
    && hasFactualSource(sense.sources)
    && sense.examples.some((example) => Boolean(example.text.trim()) && hasFactualSource(example.sources));
}

function hasExplainedCoreAnchor(record: VocabularyRecord, publicCoreTargets: Set<string>): boolean {
  return record.connections.some((connection) =>
    connection.type === "builds_on"
    && Boolean(connection.gloss?.trim())
    && publicCoreTargets.has(normalizeVocabularyLemma(connection.target)),
  );
}

function reviewableAdvancedRecord(record: VocabularyRecord, publicCoreTargets: Set<string>): boolean {
  return record.senses.some(hasFactualSenseAndExample) && hasExplainedCoreAnchor(record, publicCoreTargets);
}

/**
 * Combines trusted dictionary imports with untrusted LLM learner guidance.
 * It is deterministic and side-effect free: callers own fetching, reporting,
 * and persistence.
 */
export function enrichRecord(
  record: VocabularyRecord,
  factualDetail: FactualEnrichmentDetail,
  llmProposal: unknown,
): EnrichmentDecision {
  const imported = importDictionaryDetail(record, factualDetail.detail, factualDetail.source);
  let next = imported.record;
  const factualImportCount = Math.max(0, next.senses.length - record.senses.length);
  const rejections: string[] = [];
  let reviewProposalCount = 0;

  const parsed = VocabularyEnrichmentProposalSchema.safeParse(llmProposal);
  if (!parsed.success) {
    rejections.push("invalid LLM proposal");
  } else {
    const proposal: VocabularyEnrichmentProposal = parsed.data;
    for (const guidance of proposal.usagePatterns ?? []) {
      const sense = next.senses.find((candidate) => candidate.id === guidance.senseId);
      if (!sense) {
        rejections.push(`unknown sense: ${guidance.senseId}`);
        continue;
      }
      if (sense.usagePatterns.some((pattern) => pattern.pattern === guidance.pattern && pattern.explanation === guidance.explanation)) {
        rejections.push("duplicate usage pattern");
        continue;
      }
      next = VocabularyRecordSchema.parse({
        ...next,
        senses: next.senses.map((candidate) => candidate.id === guidance.senseId ? {
          ...candidate,
          usagePatterns: [...candidate.usagePatterns, {
            pattern: guidance.pattern,
            explanation: guidance.explanation,
            examples: [],
            sources: [llmSource()],
            status: "review",
          }],
        } : candidate),
      });
      reviewProposalCount += 1;
    }

    const publicTargets = new Set((factualDetail.knownPublicTargets ?? factualDetail.knownPublicCoreTargets)
      .map(normalizeVocabularyLemma));
    for (const guidance of proposal.connections ?? []) {
      const target = normalizeVocabularyLemma(guidance.target);
      if (!publicTargets.has(target)) {
        rejections.push(`unknown target: ${target}`);
        continue;
      }
      if (next.connections.some((connection) => connection.target === target && connection.type === guidance.type)) {
        rejections.push("duplicate connection");
        continue;
      }
      next = VocabularyRecordSchema.parse({
        ...next,
        connections: [...next.connections, {
          target,
          type: guidance.type,
          gloss: guidance.gloss,
          sources: [llmSource()],
          status: "unreviewed",
        }],
      });
      reviewProposalCount += 1;
    }
  }

  const publicCoreTargets = new Set(factualDetail.knownPublicCoreTargets.map(normalizeVocabularyLemma));
  const reviewable = next.tier !== "advanced" || reviewableAdvancedRecord(next, publicCoreTargets);
  if (next.tier === "advanced") {
    if (reviewable && next.publicationStatus === "hidden") {
      next = VocabularyRecordSchema.parse({ ...next, publicationStatus: "review", status: "enriched" });
    } else if (!reviewable && next.publicationStatus !== "hidden") {
      next = VocabularyRecordSchema.parse({ ...next, publicationStatus: "hidden" });
    }
  }

  return {
    record: next,
    changed: JSON.stringify(record) !== JSON.stringify(next),
    factualImportCount,
    reviewProposalCount,
    reviewable,
    rejections,
  };
}
