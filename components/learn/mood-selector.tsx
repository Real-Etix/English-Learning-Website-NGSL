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
          className="rounded-3xl border border-white/10 bg-white/5 p-5 transition hover:border-cyan-400/40 hover:bg-cyan-400/10"
        >
          <div className="text-xs uppercase tracking-[0.2em] text-cyan-200">{mood.title}</div>
          <p className="mt-3 text-sm leading-6 text-slate-300">{mood.description}</p>
        </Link>
      ))}
    </div>
  );
}
