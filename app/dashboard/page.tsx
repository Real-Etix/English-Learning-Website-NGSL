import { MasteryChart } from "@/components/dashboard/mastery-chart";
import { RecommendNext } from "@/components/dashboard/recommend-next";
import { getAllLists } from "@/lib/content/content-service";

export default function DashboardPage() {
  const lists = getAllLists().map((list) => ({
    slug: list.slug,
    title: list.title,
    wordCount: list.wordCount,
    moodHook: list.moodHook,
  }));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
        <div className="text-xs uppercase tracking-[0.2em] text-cyan-700">
          Learning dashboard
        </div>
        <h1 className="mt-3 text-4xl font-semibold text-slate-900">
          Track learned words and decide what to practice next
        </h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">
          Your progress is saved in the browser so you can keep building mastery list
          by list while experimenting with different moods and study goals.
        </p>
      </section>

      <RecommendNext lists={lists} />
      <MasteryChart lists={lists} />
    </div>
  );
}
