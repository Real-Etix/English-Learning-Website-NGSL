import type { ImportedWord, LearningListSlug } from "@/lib/types";

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function toNumber(value: string | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/^\uFEFF/, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeLemma(value: string) {
  return value.toLowerCase().trim();
}

export function parseTeachingForms(raw: string) {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("##"));

  const formsByLemma = new Map<string, string[]>();

  for (const line of lines) {
    const cells = splitCsvLine(line)
      .map((cell) => cell.trim())
      .filter(Boolean);

    if (cells.length === 0) {
      continue;
    }

    const headword = normalizeLemma(cells[0]);
    const uniqueForms = Array.from(
      new Set(cells.map((cell) => normalizeLemma(cell)).filter(Boolean)),
    );
    formsByLemma.set(headword, uniqueForms);
  }

  return formsByLemma;
}

function findHeaderIndex(lines: string[]) {
  return lines.findIndex((line) => {
    const normalized = line.replace(/^\uFEFF/, "").toLowerCase();
    return normalized.startsWith("lemma,") || normalized.startsWith("word,");
  });
}

export function parseStatsCsv(raw: string, slug: LearningListSlug) {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const headerIndex = findHeaderIndex(lines);

  if (headerIndex === -1) {
    throw new Error(`Could not find stats header for list "${slug}"`);
  }

  const header = splitCsvLine(lines[headerIndex]).map((cell) =>
    cell.replace(/^\uFEFF/, "").trim(),
  );

  const wordColumnIndex = header.findIndex((cell) =>
    ["word", "lemma"].includes(cell.toLowerCase()),
  );
  const rankColumnIndex = header.findIndex((cell) =>
    cell.toLowerCase().includes("rank"),
  );
  const bandColumnIndex = header.findIndex((cell) =>
    cell.toLowerCase() === "band",
  );
  const sfiColumnIndex = header.findIndex((cell) => cell.toLowerCase() === "sfi");
  const frequencyColumnIndex = header.findIndex((cell) => {
    const normalized = cell.toLowerCase();
    return normalized === "u" || normalized.includes("(u)") || normalized.includes("frequency");
  });

  return lines.slice(headerIndex + 1).flatMap((line) => {
    const cells = splitCsvLine(line);
    const lemma = cells[wordColumnIndex]?.replace(/^\uFEFF/, "").trim();

    if (!lemma) {
      return [];
    }

    const normalizedLemma = normalizeLemma(lemma);

    return [
      {
        lemma,
        normalizedLemma,
        rank: toNumber(cells[rankColumnIndex]),
        band: bandColumnIndex === -1 ? null : toNumber(cells[bandColumnIndex]),
        sfi: sfiColumnIndex === -1 ? null : toNumber(cells[sfiColumnIndex]),
        frequency:
          frequencyColumnIndex === -1 ? null : toNumber(cells[frequencyColumnIndex]),
        forms: [normalizedLemma],
      } satisfies ImportedWord,
    ];
  });
}

export function mergeFormsIntoWords(
  words: ImportedWord[],
  formsByLemma: Map<string, string[]>,
) {
  return words.map((word) => ({
    ...word,
    forms: formsByLemma.get(word.normalizedLemma) ?? word.forms,
  }));
}
