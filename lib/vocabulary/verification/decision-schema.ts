import { z } from "zod";

/** The judge can select only from facts supplied in its request. */
export const SenseSelectionDecisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("selected"),
    senseId: z.string().min(1),
    exampleId: z.string().min(1).nullable(),
  }).strict(),
  z.object({
    decision: z.literal("ambiguous"),
    senseId: z.null(),
    exampleId: z.null(),
  }).strict(),
]);

export const RelationshipDecisionSchema = z.object({
  decision: z.enum(["supported", "unsupported", "ambiguous"]),
  candidateSenseId: z.string().min(1),
  coreLemma: z.string().min(1),
}).strict();
