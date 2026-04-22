import Link from "next/link";

import { moodToList } from "@/lib/ngsl/list-catalog";
import type { MoodSlug } from "@/lib/types";

const moodCards: Array<{
  slug: MoodSlug;
  title: string;
  description: string;
}> = [
  {
    slug: "focused",
    title: "Focused",
    description: "Start with broad NGSL practice and sharpen your listening basics.",
  },
  {
    slug: "career",
    title: "Career",
    description: "Jump into business vocabulary for meetings, email, and teamwork.",
  },
  {
    slug: "study",
    title: "Study",
    description: "Practice academic words for lectures, papers, and presentations.",
  },
  {
    slug: "energized",
    title: "Energized",
    description: "Use fitness and lifestyle vocabulary when you want active topics.",
  },
  {
    slug: "curious",
    title: "Curious",
    description: "Switch into TOEIC-style contexts for travel, office, and test prep.",
  },
];

export function MoodSelector() {
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {moodCards.map((mood) => (
        <Link
          key={mood.slug}
          href={`/learn/${moodToList[mood.slug]}?mood=${mood.slug}`}
          className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-cyan-400 hover:bg-cyan-50"
        >
          <div className="text-xs uppercase tracking-[0.2em] text-cyan-700">{mood.title}</div>
          <p className="mt-3 text-sm leading-6 text-slate-600">{mood.description}</p>
        </Link>
      ))}
    </div>
  );
}
