export function buildCambridgeDictionaryUrl(lemma: string) {
  return `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(
    lemma,
  )}`;
}

export function buildDictionaryApiUrl(lemma: string) {
  return `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(lemma)}`;
}
