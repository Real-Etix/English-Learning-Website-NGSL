import type { LearningListSlug, WordListMeta } from "@/lib/types";

export interface CatalogEntry extends WordListMeta {
  rawFormsUrl: string;
}

export const listCatalog: Record<LearningListSlug, CatalogEntry> = {
  ngsl: {
    slug: "ngsl",
    title: "New General Service List",
    shortLabel: "NGSL",
    subtitle: "Daily-life English foundations",
    description:
      "Build the high-frequency vocabulary that supports everyday conversations, shows, and general reading.",
    moodHook: "Choose this when you want broad confidence and useful daily vocabulary.",
    accentColor: "from-sky-500/20 via-cyan-400/10 to-blue-500/20",
    sourcePageUrl:
      "https://www.newgeneralservicelist.com/new-general-service-list",
    teachingUrl:
      "https://www.newgeneralservicelist.com/s/NGSL_12_lemmatized_for_teaching.csv",
    rawFormsUrl:
      "https://www.newgeneralservicelist.com/s/NGSL_12_lemmatized_for_teaching.csv",
    statsUrl: "https://www.newgeneralservicelist.com/s/NGSL_12_stats.csv",
    license: "CC BY-SA 4.0",
  },
  toeic: {
    slug: "toeic",
    title: "TOEIC Service List",
    shortLabel: "TOEIC",
    subtitle: "Test-prep vocabulary for workplace listening and reading",
    description:
      "Focus on the vocabulary that appears in TOEIC-style business and office contexts.",
    moodHook: "Choose this when you need score-focused practice and business scenarios.",
    accentColor: "from-amber-500/20 via-orange-400/10 to-yellow-500/20",
    sourcePageUrl: "https://www.newgeneralservicelist.com/toeic-service-list",
    teachingUrl:
      "https://www.newgeneralservicelist.com/s/TSL_12_lemmatized_for_teaching.csv",
    rawFormsUrl:
      "https://www.newgeneralservicelist.com/s/TSL_12_lemmatized_for_teaching.csv",
    statsUrl: "https://www.newgeneralservicelist.com/s/TSL_12_stats.csv",
    license: "CC BY-SA 4.0",
  },
  business: {
    slug: "business",
    title: "Business Service List",
    shortLabel: "Business",
    subtitle: "Real-world business English beyond test prep",
    description:
      "Study the language of meetings, finance, operations, and professional communication.",
    moodHook: "Choose this when you want workplace fluency, not just exam vocabulary.",
    accentColor: "from-emerald-500/20 via-green-400/10 to-teal-500/20",
    sourcePageUrl:
      "https://www.newgeneralservicelist.com/business-service-list",
    teachingUrl:
      "https://www.newgeneralservicelist.com/s/BSL_120_lemmatized_for_teaching.csv",
    rawFormsUrl:
      "https://www.newgeneralservicelist.com/s/BSL_120_lemmatized_for_teaching.csv",
    statsUrl: "https://www.newgeneralservicelist.com/s/BSL_120_stats.csv",
    license: "CC BY-SA 4.0",
  },
  academic: {
    slug: "academic",
    title: "New Academic Word List",
    shortLabel: "Academic",
    subtitle: "Vocabulary for lectures, papers, and research writing",
    description:
      "Practice the words that show up in academic texts, abstracts, and classroom discussion.",
    moodHook: "Choose this when you are reading, researching, or writing for school.",
    accentColor: "from-violet-500/20 via-fuchsia-400/10 to-purple-500/20",
    sourcePageUrl:
      "https://www.newgeneralservicelist.com/new-general-service-list-1",
    teachingUrl:
      "https://www.newgeneralservicelist.com/s/NAWL_12_lemmatized_for_teaching.csv",
    rawFormsUrl:
      "https://www.newgeneralservicelist.com/s/NAWL_12_lemmatized_for_teaching.csv",
    statsUrl: "https://www.newgeneralservicelist.com/s/NAWL_12_stats.csv",
    license: "CC BY-SA 4.0",
  },
  fitness: {
    slug: "fitness",
    title: "Fitness English List",
    shortLabel: "Fitness",
    subtitle: "Vocabulary for gym, wellness, and coaching contexts",
    description:
      "Learn the language used in training plans, exercise guidance, recovery, and nutrition.",
    moodHook: "Choose this when you want energetic, lifestyle-focused English practice.",
    accentColor: "from-rose-500/20 via-pink-400/10 to-red-500/20",
    sourcePageUrl: "https://www.newgeneralservicelist.com/fitness-english-list",
    teachingUrl:
      "https://www.newgeneralservicelist.com/s/FEL_12_lemmatized_for_teaching.txt",
    rawFormsUrl:
      "https://www.newgeneralservicelist.com/s/FEL_12_lemmatized_for_research.csv",
    statsUrl: "https://www.newgeneralservicelist.com/s/FEL_12_stats.csv",
    license: "CC BY-SA 4.0",
  },
};

export const moodToList: Record<string, LearningListSlug> = {
  focused: "ngsl",
  career: "business",
  study: "academic",
  energized: "fitness",
  curious: "toeic",
};

export const allLists = Object.values(listCatalog);
