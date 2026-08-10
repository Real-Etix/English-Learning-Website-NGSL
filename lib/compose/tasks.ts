/**
 * Star Atlas — sentence composition tasks (ported from the handoff's
 * sentence-grader.js). Production evidence, not recognition: the learner writes
 * with the word AND one graph neighbour, and the EDGE TYPE decides what kind of
 * sentence is asked for. Grading is cheapest-first: a deterministic gate, then
 * an offline heuristic, then (server-side) a model.
 */

// Relations worth composing with, best first. Synonym/morphological are absent:
// forcing two synonyms into one sentence teaches redundancy.
const PRIORITY: Record<string, number> = { antonym: 0, intensity: 1, advanced_form: 2, builds_on: 3, collocation: 4 };
const SUFFIX = ["s", "es", "ed", "d", "ing", "er", "r", "ly", "ness", "ion", "al"];

export type ComposeMode = "single" | "pair";
export type ComposeTask = {
  lemma: string; relation: string; taskId: string; label: string; kicker: string;
  mode: ComposeMode; tip: string; ask: string; first: string; second: string;
  partner: string; gloss: string | null; required: [string, string];
  // definitions carried along so the server grader can judge sense without re-reading
  defs: [string, string];
};
export type Verdict = {
  pass: boolean; relationUsed: boolean; misusedWord: string | null;
  hint: string | null; note: string | null; source: "offline" | "model";
};
export type Gate = { ok: true } | { ok: false; msg: string };

export type PartnerInfo = {
  lemma: string; display: string; def: string; tier: "core" | "advanced";
  rank: number | null; type: string; gloss: string | null; dir: "out" | "in";
};
export type TargetInfo = { lemma: string; display: string; def: string; tier: "core" | "advanced"; rank: number | null };

const norm = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").replace(/\s+/g, " ").trim();
const words = (s: string) => norm(s).split(" ").filter(Boolean);

/** Inflection-tolerant match, so "exhaled" counts as "exhale". */
export function matchesLemma(token: string, lemma: string): boolean {
  const t = token.toLowerCase(), l = lemma.toLowerCase();
  if (t === l) return true;
  if (t.indexOf(l) === 0 && SUFFIX.indexOf(t.slice(l.length)) >= 0) return true;
  if (l.slice(-1) === "e") {
    const stem = l.slice(0, -1);
    if (t === stem + "ing" || t === stem + "ed" || t === stem + "es") return true;
  }
  if (l.slice(-1) === "y") {
    const st = l.slice(0, -1);
    if (t === st + "ies" || t === st + "ied" || t === st + "ier") return true;
  }
  if (l.length > 2 && /[bcdfglmnprstz]$/.test(l)) {
    const dbl = l + l.slice(-1);
    if (t === dbl + "ing" || t === dbl + "ed") return true;
  }
  return false;
}

export function contains(text: string, lemma: string): boolean {
  return words(text).some((w) => matchesLemma(w, lemma));
}
function indexOfLemma(text: string, lemma: string): number {
  const ws = words(text);
  for (let i = 0; i < ws.length; i++) if (matchesLemma(ws[i], lemma)) return i;
  return -1;
}

type TaskSpec = { id: string; label: string; kicker: string; mode: ComposeMode; ask: (a: string, b: string) => string; tip: string };
const TASKS: Record<string, TaskSpec> = {
  antonym: {
    id: "contrast", label: "Contrast", kicker: "Write the contrast", mode: "single",
    ask: (a, b) => `Use ${a} and ${b} in one sentence that shows they pull against each other.`,
    tip: "A contrast needs a hinge — but, whereas, while, instead of, rather than.",
  },
  intensity: {
    id: "grade", label: "Grade it", kicker: "Show the difference in degree", mode: "single",
    ask: (a, b) => `Write one sentence using ${a} and ${b} that makes clear which one is stronger.`,
    tip: "Say how they differ in degree, not just that both exist.",
  },
  advanced_form: {
    id: "upgrade", label: "Upgrade", kicker: "Say it plainly, then sharpen it", mode: "pair",
    ask: (a, b) => `First write a sentence using ${a}. Then rewrite the same idea using ${b}.`,
    tip: "The second sentence should mean the same thing, said more precisely.",
  },
  builds_on: {
    id: "distinguish", label: "Distinguish", kicker: "Draw the boundary", mode: "pair",
    ask: (a, b) => `Write one sentence using ${a}, then one using ${b}, so the difference between them is clear.`,
    tip: "Two separate sentences. Make the boundary visible.",
  },
  collocation: {
    id: "pair", label: "Pair it", kicker: "Put them together naturally", mode: "single",
    ask: (a, b) => `Write one natural sentence that uses ${a} and ${b} together.`,
    tip: "It should read like something a person would actually say.",
  },
};

/**
 * Choose the task for a word: one neighbour, picked by relation quality then by
 * how usable the partner is as scaffolding. `claimed` lowers priority of words
 * you already hold; `avoid` skips partners already tried.
 */
export function pickTask(target: TargetInfo, neighbours: PartnerInfo[], claimed: Set<string>, avoid: string[]): ComposeTask | null {
  let best: PartnerInfo | null = null, bestScore = Infinity;
  for (const link of neighbours) {
    if (!(link.type in PRIORITY)) continue;
    if (!link.def) continue;
    if (avoid.indexOf(link.lemma) >= 0) continue;
    let score = PRIORITY[link.type] * 100;
    if (link.tier === "advanced") score += 34;
    if (link.rank == null) score += 12;
    if (claimed.has(link.lemma)) score -= 22;
    if (link.gloss) score -= 14;
    if (score < bestScore) { bestScore = score; best = link; }
  }
  if (!best) return null;

  const spec = TASKS[best.type];
  let a: { lemma: string; display: string; def: string }, b: { lemma: string; display: string; def: string };
  if (best.type === "advanced_form" || best.type === "builds_on") {
    const plainIsTarget = best.dir === "out";
    a = plainIsTarget ? target : best;
    b = plainIsTarget ? best : target;
  } else {
    a = target; b = best;
  }
  return {
    lemma: target.lemma, relation: best.type, taskId: spec.id, label: spec.label,
    kicker: spec.kicker, mode: spec.mode, tip: spec.tip,
    ask: spec.ask(`“${a.display}”`, `“${b.display}”`),
    first: a.display, second: b.display, partner: best.lemma, gloss: best.gloss || null,
    required: [a.lemma, b.lemma], defs: [a.def, b.def],
  };
}

const CONTRAST = ["but", "however", "whereas", "while", "yet", "although", "though", "instead", "rather", "unlike", "not", "never"];
const DEGREE = ["more", "less", "than", "even", "far", "much", "slightly", "only", "just", "beyond", "barely", "deeper", "harder", "stronger", "worse", "milder"];
function hasAny(text: string, list: string[]): boolean {
  return words(text).some((w) => list.indexOf(w) >= 0 || (/er$/.test(w) && w.length > 4));
}

/** Free checks — reject the obvious before a single token is spent. */
export function gate(task: ComposeTask, text: string, text2: string, example?: string | null): Gate {
  const one = String(text || "").trim();
  const two = String(text2 || "").trim();
  const pair = task.mode === "pair";

  if (one.length < 12) return { ok: false, msg: "Write a full sentence first." };
  if (pair && two.length < 12) return { ok: false, msg: "The second sentence is still empty." };

  for (let i = 0; i < task.required.length; i++) {
    const need = task.required[i];
    const where = pair ? (i === 0 ? one : two) : one;
    if (!contains(where, need)) {
      return { ok: false, msg: pair ? `Sentence ${i + 1} needs to use “${need}”.` : `You haven't used “${need}” yet.` };
    }
  }

  const all = pair ? one + " " + two : one;
  if (words(all).length < (pair ? 12 : 7)) return { ok: false, msg: "Too short to show you can use it — add a few more words." };

  const content = words(one).filter((w) => w.length > 2 && !task.required.some((r) => matchesLemma(w, r)));
  if (content.length < 3) return { ok: false, msg: "That reads like a list. Put the words into a real sentence." };

  if (!pair) {
    const enders = (one.match(/[.!?]/g) || []).length;
    const trailing = /[.!?]\s*$/.test(one) ? 1 : 0;
    if (enders - trailing > 0) return { ok: false, msg: "Keep it to one sentence." };
  }

  if (example) {
    const ex = norm(example), mine = norm(one);
    if (mine.length > 10 && (ex.indexOf(mine) >= 0 || mine.indexOf(ex) >= 0)) {
      return { ok: false, msg: "That's the example sentence. Write your own." };
    }
  }

  if (pair && task.relation === "advanced_form") {
    if (contains(two, task.required[0]) && !contains(two, task.required[1])) {
      return { ok: false, msg: `The rewrite should use “${task.required[1]}”, not the plain word.` };
    }
    const w1 = words(one), w2 = words(two);
    let overlap = 0;
    for (const w of w1) if (w.length > 3 && w2.indexOf(w) >= 0) overlap += 1;
    if (overlap < 2) return { ok: false, msg: "The rewrite should express the same idea, not a new one." };
  }

  return { ok: true };
}

/** Offline verdict — checks the RELATION is expressed, not just that both words appear. */
export function heuristicGrade(task: ComposeTask, text: string, text2: string): Verdict {
  const one = String(text || ""), two = String(text2 || "");
  let relationUsed = true, hint: string | null = null;

  if (task.relation === "antonym" && !hasAny(one, CONTRAST)) {
    relationUsed = false;
    hint = "Both words are there, but nothing sets them against each other. Try a hinge like “but”, “whereas” or “instead of”.";
  }
  if (task.relation === "intensity" && !hasAny(one, DEGREE)) {
    relationUsed = false;
    hint = "You've used both, but not shown which is stronger. Compare them — “more than”, “even”, “only”.";
  }
  if (task.relation === "collocation") {
    const ia = indexOfLemma(one, task.required[0]), ib = indexOfLemma(one, task.required[1]);
    if (ia >= 0 && ib >= 0 && Math.abs(ia - ib) > 9) {
      relationUsed = false;
      hint = "They're both in the sentence but far apart. These two normally sit close together.";
    }
  }
  if (task.relation === "builds_on" && norm(one) === norm(two)) {
    relationUsed = false;
    hint = "The two sentences are the same. Show what separates the words.";
  }

  return {
    pass: relationUsed, relationUsed, misusedWord: null, hint,
    note: relationUsed ? "Checked on this device: both words used, and the relation reads. Grammar was not reviewed." : null,
    source: "offline",
  };
}

export const GRADER_PROMPT = [
  "You grade one short vocabulary exercise from an English learner. Judge USE, not style. Your default is PASS — be generous.",
  "",
  "PASS if the required words are used in ANY standard, natural English sense and the required relation is reasonably expressed.",
  "Accept common collocations, idioms, and standard figurative uses. A word need NOT match the given definition word-for-word — any related standard sense is fine (e.g. 'desert a post' is correct).",
  "Ignore grammar, article, preposition, spelling and punctuation slips entirely — never fail for them.",
  "FAIL only if a required word is used in a clearly WRONG sense, or the relation is plainly absent. When genuinely unsure, PASS.",
  "",
  "Reply with JSON only:",
  '{"pass":boolean,"relationUsed":boolean,"misusedWord":string|null,"hint":string}',
  "hint: one short, encouraging sentence under 25 words. Empty string if pass.",
].join("\n");

export function graderMessage(task: ComposeTask, text: string, text2: string): string {
  const submission = task.mode === "pair" ? [text, text2] : [text];
  return [
    GRADER_PROMPT, "",
    `Task: ${task.taskId} (relation: ${task.relation})`,
    task.gloss ? `Teaching note for this relation: ${task.gloss}` : "",
    "Required words and their intended senses:",
    `- ${task.first}: ${task.defs[0]}`,
    `- ${task.second}: ${task.defs[1]}`,
    "", "Learner submission:",
    submission.map((s, i) => (submission.length > 1 ? `${i + 1}. ` : "") + s).join("\n"),
  ].filter(Boolean).join("\n");
}

export function parseVerdict(reply: string): Verdict | null {
  const t = String(reply || "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const d = JSON.parse(t.slice(a, b + 1));
    return { pass: !!d.pass, relationUsed: d.relationUsed !== false, misusedWord: d.misusedWord || null, hint: d.hint || null, note: null, source: "model" };
  } catch { return null; }
}
