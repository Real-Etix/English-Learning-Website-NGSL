import type { SourceCredit } from "@/lib/types";

export const sourceCredits = {
  dictionaryApi: {
    id: "dictionaryapi",
    label: "Dictionary API",
    url: "https://dictionaryapi.dev/",
    license: "Free public API",
  },
  tatoeba: {
    id: "tatoeba",
    label: "Tatoeba",
    url: "https://tatoeba.org/",
    license: "CC BY 2.0 FR / CC0 1.0",
  },
  manual: {
    id: "manual",
    label: "Manual curation",
    url: "https://www.newgeneralservicelist.com/new-general-service-list",
    license: "Project-authored content",
  },
  fallback: {
    id: "fallback",
    label: "Local fallback",
    url: "https://www.newgeneralservicelist.com/new-general-service-list",
    license: "Application fallback content",
  },
} satisfies Record<string, SourceCredit>;

export function dedupeSourceCredits(credits: SourceCredit[]) {
  return Array.from(new Map(credits.map((credit) => [credit.id, credit])).values());
}
