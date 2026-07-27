/**
 * Grammar / function words that carry structure, not lexical meaning.
 * These have no useful "advanced form" (can→tin, there→yonder is noise), so the
 * enrichment pass skips them. Complements data/function-words.ts (articles, basic
 * pronouns/preps) with modals, wh-words, quantifiers, and grammatical adverbs.
 */
export const grammarStopwords = new Set<string>([
  // modals / auxiliaries
  "can", "could", "will", "would", "shall", "should", "may", "might", "must",
  "ought", "need", "dare", "used",
  // wh-words
  "when", "where", "why", "how", "what", "who", "whom", "whose", "which",
  "whatever", "whoever", "whenever", "wherever", "whichever", "whomever",
  // pro-forms / quantifiers
  "someone", "somebody", "something", "sometime", "somewhere",
  "anyone", "anybody", "anything", "anywhere",
  "everyone", "everybody", "everything", "everywhere",
  "nobody", "nothing", "nowhere", "none",
  "both", "either", "neither", "each", "every", "all", "some", "any",
  "another", "other", "such", "same", "more", "most", "less", "least",
  "many", "much", "few", "several", "enough",
  // grammatical / degree adverbs and connectives
  "there", "here", "then", "than", "thus", "hence", "therefore", "however",
  "moreover", "otherwise", "nevertheless", "meanwhile", "besides", "instead",
  "anyway", "indeed", "perhaps", "maybe", "very", "too", "quite", "rather",
  "just", "only", "even", "still", "yet", "already", "almost", "nearly",
  "always", "never", "often", "sometimes", "usually", "again", "once",
  "ever", "also", "else", "so", "about",
]);

export const CONTENT_POS = new Set(["noun", "verb", "adjective", "adverb"]);
