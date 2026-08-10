"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { toAtlas, type AtlasChart, type AtlasWord } from "@/components/network/galaxy/atlas";
import { StarEngine } from "@/components/network/galaxy/engine";
import { wordXp } from "@/lib/collection/xp";
import type { ComposeTask, Verdict } from "@/lib/compose/tasks";
import type { CollectionSummary, WordRarity } from "@/lib/collection/service";
import type { LiteGraph, WikiPage } from "@/lib/wiki/parse-wiki";
import type { WordDetail } from "@/lib/content/word-detail";

/* ============================================================================
   Star Atlas — a faithful rebuild of the design-handoff prototype.
   Full-screen dark observatory: header · mounted sky · galaxy HUD · drawer ·
   quiz · your space · log. Wired to the ported StarEngine and the app's APIs.
   ========================================================================== */

// Prototype typeface system, surfaced as CSS variables by the page.
const SF = "var(--font-atlas-serif), Georgia, serif";
const SS = "var(--font-atlas-sans), system-ui, sans-serif";
const MN = "var(--font-atlas-mono), ui-monospace, monospace";

const CHART_TONE: Record<string, string> = {
  synonym: "#8FE3C0", antonym: "#E8A89F", intensity: "#F2D9A0", collocation: "#94A0B4",
  builds_on: "#CBB9E9", advanced_form: "#CBB9E9", morphological: "#9FC4E8",
};
const CONN_LABEL: Record<string, string> = {
  advanced_form: "Level up to", builds_on: "Builds on", synonym: "Means about the same",
  antonym: "Means the opposite", intensity: "Stronger / weaker", collocation: "Goes with",
  morphological: "Word family",
};
const CONN_ORDER = ["advanced_form", "builds_on", "intensity", "synonym", "antonym", "morphological", "collocation"];
const MARK: Record<string, string> = {
  advanced_form: "↑", builds_on: "↓", synonym: "=", antonym: "≠", intensity: "±", collocation: "+", morphological: "~",
};

const BOARD_SEED: [string, number, number][] = [
  ["quiet-heron-214", 4120, 96], ["cosmic-lynx-77", 3480, 84], ["bold-orca-512", 2905, 71],
  ["astral-moth-160", 2440, 63], ["keen-falcon-38", 1980, 55], ["swift-ibis-402", 1610, 47],
  ["lucky-otter-9", 1245, 39], ["bright-crane-331", 980, 32], ["calm-raven-118", 720, 25],
  ["wild-koala-604", 505, 19], ["brave-fox-250", 340, 14], ["stellar-wolf-88", 190, 9],
];

// The vocabulary lists you can chart. Each is its own static /network/[slug] sky.
const LISTS: { slug: string; label: string }[] = [
  { slug: "ngsl", label: "NGSL" },
  { slug: "toeic", label: "TOEIC" },
  { slug: "business", label: "Business" },
  { slug: "academic", label: "Academic" },
  { slug: "fitness", label: "Fitness" },
  { slug: "all", label: "All words" },
];

const MODE_DEFS: [string, string, string, string][] = [
  ["chart", "◇", "Chart", "Wander the charts. Click any star, read it, pass one quick check and it lights up for good."],
  ["run", "▲", "Run", "A handful of stars picked for today, one per chart. Clear them in order to keep your streak alive."],
  ["ladder", "↑", "Ladder", "Only the level-up links are lit. Climb from a word you hold to the sharper word a native would reach for."],
];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const levelForXp = (xp: number) => 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 50));
const xpForLevel = (level: number) => 50 * (level - 1) ** 2;
const norm = (s: string) => String(s || "").trim().toLowerCase().replace(/[^a-z]/g, "");
function hash(str: string) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed: number) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

type WordResponse = { page: WikiPage; detail: WordDetail | null; rarity: WordRarity | null };
type QuizKind = "type" | "word";
type QuizState = {
  kind: QuizKind; lemma: string; prompt: string; sentence?: string; answer: string;
  options?: { id: string; text: string }[]; input: string;
  revealed: boolean; correct: boolean; attempts: number; wrong?: string | null; nudge?: boolean;
};
type Toast = { glyph: string; text: string; sub: string; tone: "mint" | "gold" };
type ComposeState = { task: ComposeTask; text: string; text2: string; verdict: Verdict | null; gate: string | null; busy: boolean; attempts: number; tried: string[] };

export function StarAtlas({ graph, listSlug }: { graph: LiteGraph; listSlug: string }) {
  // ---- client atlas model (from the pre-generated lite graph) ----
  const atlas = useMemo(() => {
    const data = toAtlas(graph);
    const byLemma = new Map<string, AtlasWord>();
    for (const w of data.words) byLemma.set(w.lemma, w);
    const chartById = new Map<string, AtlasChart>();
    for (const c of data.charts) chartById.set(c.id, c);
    const wordsByChart = new Map<string, AtlasWord[]>();
    for (const w of data.words) {
      const arr = wordsByChart.get(w.chart) ?? [];
      arr.push(w);
      wordsByChart.set(w.chart, arr);
    }
    // Every real chart (Louvain communities are already coherent + ≥5 words),
    // biggest first — the rail scrolls, no cap. "drift" field stars aren't a chart.
    const listedCharts = data.charts
      .filter((c) => c.id !== "drift" && (wordsByChart.get(c.id)?.length ?? 0) > 0)
      .sort((a, b) => (wordsByChart.get(b.id)?.length ?? 0) - (wordsByChart.get(a.id)?.length ?? 0));
    return { data, byLemma, chartById, wordsByChart, listedCharts };
  }, [graph]);

  // ---- state ----
  const [view, setView] = useState<"galaxy" | "space" | "board">("galaxy");
  const [mode, setMode] = useState<"chart" | "run" | "ladder">("chart");
  const [chart, setChart] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [me, setMe] = useState<CollectionSummary | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [searchFocus, setSearchFocus] = useState(false);
  const [listMenuOpen, setListMenuOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [zoom, setZoom] = useState<"galaxy" | "cluster" | "star">("galaxy");
  const [narrow, setNarrow] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [dev, setDev] = useState(false); // ?dev=1 author overlay
  const [quiz, setQuiz] = useState<QuizState | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [intro, setIntro] = useState(false);
  const [streak, setStreak] = useState(0);
  // tonight's run
  const [runStarted, setRunStarted] = useState(false);
  const [runSeconds, setRunSeconds] = useState(0);
  // composition: words you've produced (solid stars), plus the open task
  const [used, setUsed] = useState<Set<string>>(new Set());
  const [compose, setCompose] = useState<ComposeState | null>(null);
  // detail data for the focused star
  const [wordData, setWordData] = useState<WordResponse | null>(null);
  // tutor
  const [chatOpen, setChatOpen] = useState(false);
  const [chatLog, setChatLog] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<StarEngine | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringIdx = useRef<number | null>(null);
  const router = useRouter();
  const currentList = LISTS.find((l) => l.slug === listSlug) ?? { slug: listSlug, label: listSlug.toUpperCase() };

  const persistLocal = useCallback((patch: Record<string, unknown>) => {
    try {
      const cur = JSON.parse(localStorage.getItem("staratlas.local") || "{}");
      localStorage.setItem("staratlas.local", JSON.stringify({ ...cur, ...patch }));
    } catch { /* ignore */ }
  }, []);

  const showToast = useCallback((t: Toast) => {
    setToast(t);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  // ---- selection ----
  const select = useCallback((lemma: string | null) => {
    if (!lemma) {
      setFocus(null);
      const e = engineRef.current;
      if (e) { e.setPanelOffset(narrow ? 0 : -272); e.clearFocus(); }
      return;
    }
    setFocus(lemma);
    setTrail((prev) => prev.filter((x) => x !== lemma).concat([lemma]).slice(-5));
    setQ("");
    setSearchFocus(false);
    setRailOpen(false);
    const e = engineRef.current;
    if (e) { e.setPanelOffset(narrow ? 0 : 420); e.focusStar(lemma, { keepCamera: false }); }
  }, [narrow]);

  // ---- engine mount ----
  useEffect(() => {
    if (!hostRef.current) return;
    const engine = new StarEngine(hostRef.current, atlas.data, {
      onSelect: (lemma) => select(lemma),
      onZoomLevel: (level) => setZoom(level as "galaxy" | "cluster" | "star"),
    });
    engineRef.current = engine;
    return () => { engine.dispose(); engineRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atlas]);

  // push claimed / used / mode / chart / route / offset to the engine
  useEffect(() => { engineRef.current?.setClaimed(owned); }, [owned]);
  useEffect(() => { engineRef.current?.setUsed(used); }, [used]);
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.setMode(mode);
    if (mode === "chart") e.setChart(chart);
    else e.setChart(null);
  }, [mode, chart]);

  // responsive
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 860);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // author overlay toggle (?dev=1) — client-only URL read, must run post-mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setDev(new URLSearchParams(window.location.search).get("dev") === "1"); } catch { /* ignore */ }
  }, []);

  // load the visitor's collection (and the local streak / intro-seen flag)
  useEffect(() => {
    let alive = true;
    let local: { streak?: number; introDone?: boolean; runDay?: string; runStarted?: boolean; runSeconds?: number; used?: string[] } = {};
    try { local = JSON.parse(localStorage.getItem("staratlas.local") || "null") || {}; } catch { /* private mode */ }
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { me: CollectionSummary | null } | null) => {
        if (!alive) return;
        if (local.streak) setStreak(local.streak);
        // resume today's run; a new day starts fresh
        if (local.runDay === runDay) { setRunStarted(!!local.runStarted); setRunSeconds(local.runSeconds || 0); }
        if (d?.me) { setMe(d.me); setOwned(new Set(d.me.lemmas)); setUsed(new Set(d.me.usedLemmas ?? [])); setIntro(d.me.lemmas.length === 0 && !local.introDone); }
        else setIntro(!local.introDone);
      })
      .catch(() => {})
      .finally(() => alive && setMeLoaded(true));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // fetch detail for the focused star (loading is derived from whether the
  // fetched data matches the current focus, so no synchronous reset is needed)
  useEffect(() => {
    if (!focus) return;
    let alive = true;
    fetch(`/api/word/${encodeURIComponent(focus)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: WordResponse | null) => { if (alive && d) setWordData(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [focus]);
  const wordReady = !!focus && wordData?.page?.lemma === focus;


  // ---- claiming ----
  const doClaim = useCallback((lemma: string) => {
    setOwned((prev) => new Set(prev).add(lemma)); // optimistic
    fetch("/api/collect", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lemma }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { added?: boolean; xp?: number; summary?: CollectionSummary } | null) => {
        if (!d?.summary) return;
        const before = me?.level ?? 1;
        setMe(d.summary);
        setOwned(new Set(d.summary.lemmas));
        // streak: one claim a day keeps it alive
        const today = new Date().toISOString().slice(0, 10);
        let nextStreak = streak;
        try {
          const cur = JSON.parse(localStorage.getItem("staratlas.local") || "{}");
          if (cur.lastDay !== today) {
            const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
            nextStreak = cur.lastDay === y ? (cur.streak || 0) + 1 : 1;
            setStreak(nextStreak);
            persistLocal({ streak: nextStreak, lastDay: today });
          }
        } catch { /* ignore */ }
        const wd = atlas.byLemma.get(lemma);
        let t: Toast = { glyph: "✦", text: `+${d.xp ?? 0} xp`, sub: `${wd?.display ?? lemma} is yours`, tone: "mint" };
        if (d.summary.level > before) t = { glyph: "▲", text: `Level ${d.summary.level}`, sub: "the sky opens a little wider", tone: "gold" };
        showToast(t);
      })
      .catch(() => {});
  }, [me, streak, atlas, showToast, persistLocal]);

  // ---- quiz ----
  const openQuiz = useCallback((lemma: string) => {
    if (owned.has(lemma)) return;
    // Need the word's definition/example — use the already-fetched detail when present.
    const build = (page: WikiPage) => {
      const r = rng(hash(lemma + owned.size));
      const siblings = (atlas.wordsByChart.get(atlas.byLemma.get(lemma)?.chart ?? "") || [])
        .filter((w) => w.lemma !== lemma);
      const others = siblings.sort(() => r() - 0.5).slice(0, 3);
      const ex = page.examples?.[0] || "";
      const canType = ex && ex.toLowerCase().includes(page.display.toLowerCase());
      if (canType) {
        const re = new RegExp(page.display, "i");
        setQuiz({
          kind: "type", lemma, input: "", prompt: "Which word is missing?",
          sentence: ex.replace(re, "———"), answer: page.display, revealed: false, correct: false, attempts: 0,
        });
      } else {
        const opts = others.map((w) => ({ id: w.lemma, text: w.display }))
          .concat([{ id: lemma, text: page.display }]);
        setQuiz({
          kind: "word", lemma, input: "",
          prompt: `${page.definition.charAt(0).toUpperCase()}${page.definition.slice(1)} — which word is it?`,
          options: opts.sort(() => r() - 0.5), answer: lemma, revealed: false, correct: false, attempts: 0,
        });
      }
    };
    if (wordData?.page && wordData.page.lemma === lemma) build(wordData.page);
    else fetch(`/api/word/${encodeURIComponent(lemma)}`).then((r) => (r.ok ? r.json() : null))
      .then((d: WordResponse | null) => { if (d?.page) build(d.page); }).catch(() => {});
  }, [owned, atlas, wordData]);

  const answerChoice = useCallback((id: string) => {
    setQuiz((q0) => {
      if (!q0 || q0.revealed) return q0;
      const ok = id === q0.answer;
      const attempts = q0.attempts + 1;
      if (!ok && attempts < 2) return { ...q0, attempts, wrong: id, nudge: true };
      if (ok) doClaim(q0.lemma);
      return { ...q0, attempts, revealed: true, correct: ok, wrong: ok ? null : id };
    });
  }, [doClaim]);

  const submitType = useCallback(() => {
    setQuiz((q0) => {
      if (!q0 || q0.revealed) return q0;
      const ok = norm(q0.input) === norm(q0.answer);
      const attempts = q0.attempts + 1;
      if (!ok && attempts < 2) return { ...q0, attempts, nudge: true };
      if (ok) doClaim(q0.lemma);
      return { ...q0, attempts, revealed: true, correct: ok };
    });
  }, [doClaim]);

  // keyboard navigation (arrows walk the link ring, Esc lets go, Enter opens check)
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (view !== "galaxy") return;
      const tag = (ev.target as HTMLElement)?.tagName || "";
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      if (quiz) { if (ev.key === "Escape") { ev.preventDefault(); setQuiz(null); } return; }
      if (ev.key === "Escape") {
        ev.preventDefault();
        if (focus) select(null);
        else if (chart) { setChart(null); }
        return;
      }
      if (typing || !focus) return;
      const nb = atlas.data.adj[focus] || [];
      if (ev.key === "Enter") { ev.preventDefault(); openQuiz(focus); return; }
      if (ev.key === "ArrowUp") {
        const up = nb.find((x) => x.type === "advanced_form");
        if (up) { ev.preventDefault(); select(up.lemma); }
        return;
      }
      if ((ev.key === "ArrowLeft" || ev.key === "ArrowRight") && nb.length) {
        ev.preventDefault();
        const i = ringIdx.current == null ? 0 : ringIdx.current;
        const next = (i + (ev.key === "ArrowRight" ? 1 : -1) + nb.length) % nb.length;
        ringIdx.current = next;
        select(nb[next].lemma);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, quiz, focus, chart, select, atlas, openQuiz, doClaim]);

  // ---- tutor ----
  const sendChat = useCallback((preset?: string) => {
    const text = String(preset ?? chatInput).trim();
    if (!text || chatBusy) return;
    const log = chatLog.concat([{ role: "user" as const, text }]);
    setChatLog(log);
    setChatInput("");
    setChatBusy(true);
    setChatError(null);
    fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: log.map((m) => ({ role: m.role, content: m.text })), listSlug, lemma: focus }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "The tutor is unavailable right now.");
        return d as { reply?: string; text?: string };
      })
      .then((d) => setChatLog((prev) => prev.concat([{ role: "assistant", text: d.reply || d.text || "" }])))
      .catch((e) => setChatError(e.message))
      .finally(() => setChatBusy(false));
  }, [chatInput, chatBusy, chatLog, listSlug, focus]);

  // ---- chart / mode actions ----
  const pickChart = useCallback((id: string) => {
    const next = chart === id ? null : id;
    setChart(next);
    setFocus(null);
    const e = engineRef.current;
    if (e) { e.setPanelOffset(narrow ? 0 : -272); e.clearFocus(); e.setChart(next); }
  }, [chart, narrow]);

  const setModeTo = useCallback((m: "chart" | "run" | "ladder") => {
    setMode(m); setChart(null); setFocus(null);
    const e = engineRef.current;
    if (e) { e.setPanelOffset(narrow ? 0 : -272); e.clearFocus(); e.setChart(null); if (m !== "chart") e.resetView(); }
  }, [narrow]);

  const resetView = useCallback(() => {
    setChart(null); setFocus(null); setRailOpen(false);
    const e = engineRef.current;
    if (e) { e.setPanelOffset(narrow ? 0 : -272); e.resetView(); }
  }, [narrow]);

  const speak = useCallback(() => {
    if (!focus || !window.speechSynthesis) return;
    const wd = atlas.byLemma.get(focus);
    const u = new SpeechSynthesisUtterance(wd?.display ?? focus);
    u.rate = 0.85; u.lang = "en-GB";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }, [focus, atlas]);

  // ---- derived view models ----
  const level = me?.level ?? 1;
  const totalXp = me?.totalXp ?? 0;
  const base = xpForLevel(level), nextLv = xpForLevel(level + 1);
  const levelPct = Math.max(4, Math.round(((totalXp - base) / Math.max(1, nextLv - base)) * 100));

  const chartStats = useMemo(() => atlas.listedCharts.map((ch) => {
    const words = atlas.wordsByChart.get(ch.id) || [];
    const got = words.filter((w) => owned.has(w.lemma)).length;
    return { ch, total: words.length, got, pct: Math.round((got / Math.max(1, words.length)) * 100), done: words.length > 0 && got === words.length };
  }), [atlas, owned]);
  const chartsDone = chartStats.filter((c) => c.done).length;

  // search
  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [] as AtlasWord[];
    const ex: AtlasWord[] = [], st: AtlasWord[] = [], ct: AtlasWord[] = [];
    for (const w of atlas.data.words) {
      const d = w.display.toLowerCase();
      if (d === query) ex.push(w); else if (d.startsWith(query)) st.push(w); else if (d.includes(query)) ct.push(w);
    }
    return ex.concat(st, ct).slice(0, 7);
  }, [q, atlas]);

  // Tonight's run — one star per chart, stable for the local day. The route is
  // generated server-side (authoritative) with a client fallback so it always works.
  const runDay = new Date().toISOString().slice(0, 10);
  const localRoute = useMemo(() => {
    const r = rng(hash("run" + runDay + listSlug));
    const order = atlas.listedCharts.map((c) => c.id).sort(() => r() - 0.5);
    const pick: string[] = [];
    for (const id of order) {
      const pool = (atlas.wordsByChart.get(id) || []).filter((w) => w.degree > 0);
      if (!pool.length) continue;
      pick.push(pool[Math.floor(r() * pool.length)].lemma);
      if (pick.length >= 8) break;
    }
    return pick;
  }, [atlas, listSlug, runDay]);
  const [serverRoute, setServerRoute] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setServerRoute(null);
    fetch(`/api/run?list=${encodeURIComponent(listSlug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { route?: string[] } | null) => { if (alive && d?.route?.length) setServerRoute(d.route.filter((l) => atlas.byLemma.has(l))); })
      .catch(() => {});
    return () => { alive = false; };
  }, [listSlug, atlas]);
  const route = serverRoute ?? localRoute;
  const runDone = route.filter((l) => owned.has(l)).length;
  const runComplete = route.length > 0 && runDone === route.length;

  // ladder rungs — scored: climbs you've earned (base held) first, then by how
  // much of a level-up the target is (advanced tier, then how central it is).
  const rungs = useMemo(() => {
    const seen = new Set<string>();
    const scored: { from: string; to: string; hint: string; to_lemma: string; owned: boolean; score: number }[] = [];
    for (const ed of atlas.data.edges) {
      if (ed.type !== "advanced_form" && ed.type !== "builds_on") continue;
      const from = ed.type === "advanced_form" ? ed.source : ed.target;
      const to = ed.type === "advanced_form" ? ed.target : ed.source;
      if (owned.has(to) || seen.has(to)) continue;
      const fw = atlas.byLemma.get(from), tw = atlas.byLemma.get(to);
      if (!fw || !tw) continue;
      seen.add(to);
      const baseHeld = owned.has(from);
      const score = (baseHeld ? 100 : 0) + (tw.tier === "advanced" ? 20 : 0) + Math.min(10, tw.degree);
      scored.push({
        from: fw.display, to: tw.display, to_lemma: to, owned: baseHeld, score,
        hint: baseHeld ? `You hold “${fw.display}” — reach for “${tw.display}”.` : `Hold “${fw.display}” first, then climb to “${tw.display}”.`,
      });
    }
    scored.sort((a, b) => b.score - a.score);
    const earned = scored.filter((r) => r.owned);
    return { list: (earned.length ? earned : scored).slice(0, 7), hasEarned: earned.length > 0 };
  }, [atlas, owned]);

  // Begin the run, or fly to the next unclaimed stop.
  const runAction = useCallback(() => {
    if (runComplete) return;
    const next = route.find((l) => !owned.has(l));
    if (!runStarted) {
      setRunStarted(true);
      persistLocal({ runDay, runStarted: true, runSeconds });
    }
    if (next) select(next);
  }, [runComplete, route, owned, runStarted, runDay, runSeconds, persistLocal, select]);

  // ---- composition (production evidence) ----
  const openCompose = useCallback((lemma: string, avoid: string[] = []) => {
    if (!owned.has(lemma)) return;
    setCompose({ task: null as unknown as ComposeTask, text: "", text2: "", verdict: null, gate: null, busy: true, attempts: 0, tried: avoid });
    fetch("/api/compose", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "task", lemma, claimed: Array.from(owned), avoid }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { task: ComposeTask | null } | null) => {
        if (!d?.task) { setCompose(null); showToast({ glyph: "·", text: "No pairing yet", sub: "this star needs more links first", tone: "mint" }); return; }
        setCompose({ task: d.task, text: "", text2: "", verdict: null, gate: null, busy: false, attempts: 0, tried: avoid.concat([d.task.partner]) });
      })
      .catch(() => setCompose(null));
  }, [owned, showToast]);

  const markUsed = useCallback((lemma: string) => {
    setUsed((prev) => new Set(prev).add(lemma)); // optimistic
    fetch("/api/use", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lemma }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { bonus?: number; summary?: CollectionSummary } | null) => {
        if (d?.summary) { setMe(d.summary); setOwned(new Set(d.summary.lemmas)); setUsed(new Set(d.summary.usedLemmas)); }
        const wd = atlas.byLemma.get(lemma);
        showToast({ glyph: "◆", text: d?.bonus ? `+${d.bonus} xp · used it` : "Used it", sub: `${wd?.display ?? lemma} is solid now`, tone: "gold" });
      })
      .catch(() => {});
  }, [atlas, showToast]);

  const submitCompose = useCallback(() => {
    setCompose((c) => {
      if (!c || c.busy || !c.task) return c;
      const cur = { ...c, busy: true };
      fetch("/api/compose", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "grade", task: c.task, text: c.text, text2: c.text2, example: wordData?.page?.examples?.[0] ?? null }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { ok?: boolean; gate?: string; verdict?: Verdict } | null) => {
          if (!d) { setCompose((x) => (x ? { ...x, busy: false } : x)); return; }
          if (d.ok === false && d.gate) { setCompose((x) => (x ? { ...x, busy: false, gate: d.gate!, verdict: null } : x)); return; }
          const verdict = d.verdict ?? null;
          setCompose((x) => (x ? { ...x, busy: false, gate: null, verdict, attempts: x.attempts + 1 } : x));
          if (verdict?.pass && c.task) markUsed(c.task.lemma);
        })
        .catch(() => setCompose((x) => (x ? { ...x, busy: false } : x)));
      return cur;
    });
  }, [wordData, markUsed]);

  // gold route polyline: lit only in run mode
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    if (mode === "run") e.setRoute(route, runDone);
    else e.setRoute([], 0);
  }, [mode, route, runDone]);

  // run clock — ticks while a run is underway and not yet complete
  useEffect(() => {
    if (!runStarted || runComplete) return;
    const t = setInterval(() => setRunSeconds((s) => {
      const n = s + 1;
      if (n % 5 === 0) persistLocal({ runDay, runStarted: true, runSeconds: n });
      return n;
    }), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runStarted, runComplete]);

  // run completion — fires once when the last stop is claimed during a run
  const runDoneRef = useRef(false);
  useEffect(() => {
    if (runComplete && runStarted && !runDoneRef.current) {
      runDoneRef.current = true;
      showToast({ glyph: "▲", text: "Run complete", sub: `day ${streak} of your streak`, tone: "gold" });
    }
    if (!runComplete) runDoneRef.current = false;
  }, [runComplete, runStarted, streak, showToast]);

  // detail drawer view model (from fetched wordData)
  const drawer = useMemo(() => {
    if (!focus) return null;
    const wd = atlas.byLemma.get(focus);
    // Use the per-list chart the galaxy/rail show, not the page's global frontmatter chart.
    const chartMeta = wd ? atlas.chartById.get(wd.chart) : null;
    const page = wordData?.page;
    const held = owned.has(focus);
    const rarity = wordData?.rarity;
    const percent = rarity?.percent ?? 0;
    const rarityWord = percent <= 12 ? "Rare" : percent <= 40 ? "Uncommon" : "Common";
    const xp = page ? wordXp({ tier: page.tier, sfi: page.sfi }) : 0;
    const grouped: Record<string, WikiPage["connections"]> = {};
    for (const c of page?.connections || []) (grouped[c.type] = grouped[c.type] || []).push(c);
    const connGroups = CONN_ORDER.filter((t) => grouped[t]).map((t) => ({
      type: t, label: CONN_LABEL[t] || t, tone: CHART_TONE[t] || "#94A0B4",
      items: grouped[t].map((c) => ({
        lemma: c.target, display: atlas.byLemma.get(c.target)?.display ?? c.target,
        mark: MARK[t] || "·", gloss: c.gloss || "", held: owned.has(c.target), type: t,
      })),
    }));
    return {
      display: wd?.display ?? page?.display ?? focus,
      ipa: wordData?.detail?.ipa ?? "",
      pos: wd?.pos ?? page?.pos ?? "",
      def: page?.definition ?? "",
      ex: page?.examples?.[0] ?? "",
      isAdvanced: (wd?.tier ?? page?.tier) === "advanced",
      chartName: chartMeta?.name ?? "", chartHue: chartMeta?.hue ?? "#94A0B4", chartGlyph: chartMeta?.glyph ?? "◇",
      held, solid: used.has(focus), xp, rarityWord,
      rarityDot: percent <= 12 ? "#F2D9A0" : percent <= 40 ? "#BFD9F2" : "#94A0B4",
      rarityText: `${percent}% of explorers hold it`,
      connGroups,
    };
  }, [focus, wordData, atlas, owned, used]);

  const modeBlurb = chart ? (atlas.chartById.get(chart)?.blurb ?? "") : (MODE_DEFS.find((m) => m[0] === mode) || MODE_DEFS[0])[3];
  const usedCount = used.size;
  const legend = [
    { dot: "#BFD9F2", label: "core word", n: atlas.data.words.filter((w) => w.tier === "core").length },
    { dot: "#CBB9E9", label: "advanced", n: atlas.data.words.filter((w) => w.tier === "advanced").length },
    { dot: "#F2D9A0", label: "hub — many links", n: atlas.data.words.filter((w) => w.degree >= 8).length },
    { dot: "#7ACBA9", label: "held — you recognised it", n: owned.size - usedCount },
    { dot: "#BDFFE0", label: "solid — you used it", n: usedCount },
  ];

  const boardRows = useMemo(() => BOARD_SEED.map(([name, xp, words]) => ({ name, xp, words, you: false }))
    .concat([{ name: "you", xp: totalXp, words: owned.size, you: true }])
    .sort((a, b) => b.xp - a.xp)
    .map((row, i) => ({
      rank: i + 1, name: row.you ? "You" : row.name,
      detail: plural(row.words, "star", "stars") + " held", level: levelForXp(row.xp),
      xp: row.xp.toLocaleString() + " xp", you: row.you,
    })), [totalXp, owned]);

  const railX = (narrow ? !railOpen : !!focus) ? "-284px" : "0px";
  const barLeft = narrow || focus ? "16px" : "286px";
  const barRight = !narrow && focus ? "436px" : "16px";
  const zoomLabel = zoom === "galaxy" ? "wide" : zoom === "cluster" ? "chart" : "close";

  // ============================ RENDER ============================
  return (
    <div style={{ position: "absolute", inset: 0, background: "#070B16", color: "#F1EEE6", overflow: "hidden", fontFamily: SS }}>
      {/* ---------- HEADER ---------- */}
      <header style={{ position: "absolute", top: 0, left: 0, right: 0, height: 57, zIndex: 40, display: "flex", alignItems: "center", gap: 16, padding: "0 16px", borderBottom: "1px solid rgba(241,238,230,.09)", background: "rgba(7,11,22,.72)", backdropFilter: "blur(14px)" }}>
        <button onClick={() => setView("galaxy")} style={{ display: "flex", alignItems: "baseline", gap: 9, background: "none", border: "none", padding: 0, cursor: "pointer", color: "#F1EEE6", textAlign: "left" }}>
          <span style={{ font: `400 21px/1 ${SF}`, letterSpacing: ".01em" }}>Star Atlas</span>
          <span style={{ font: `500 9px/1 ${MN}`, letterSpacing: ".2em", color: "#6B7789", textTransform: "uppercase" }}>obs.</span>
        </button>

        {/* List switcher — each list is its own sky */}
        <div style={{ position: "relative", flex: "none" }}>
          <button onClick={() => setListMenuOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 11px", border: `1px solid ${listMenuOpen ? "rgba(191,217,242,.32)" : "rgba(241,238,230,.1)"}`, borderRadius: 999, background: listMenuOpen ? "rgba(191,217,242,.12)" : "rgba(241,238,230,.05)", color: "#F1EEE6", cursor: "pointer", font: `500 12px/1 ${SS}` }}>
            <span style={{ font: `500 9px/1 ${MN}`, letterSpacing: ".16em", color: "#6B7789", textTransform: "uppercase" }}>List</span>
            <span>{currentList.label}</span>
            <span style={{ font: `400 9px/1 ${MN}`, color: "#6B7789" }}>▾</span>
          </button>
          {listMenuOpen && (
            <>
              <button aria-label="Close list menu" onClick={() => setListMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 44, border: "none", background: "transparent", cursor: "default" }} />
              <ul style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, minWidth: 180, margin: 0, padding: 5, listStyle: "none", borderRadius: 12, border: "1px solid rgba(241,238,230,.1)", background: "rgba(10,15,28,.97)", backdropFilter: "blur(18px)", boxShadow: "0 22px 50px rgba(0,0,0,.6)", zIndex: 45, animation: "riseIn .16s ease both" }}>
                {LISTS.map((l) => (
                  <li key={l.slug}>
                    <button onClick={() => { setListMenuOpen(false); if (l.slug !== listSlug) router.push(`/network/${l.slug}`); }} style={{ display: "flex", width: "100%", alignItems: "center", gap: 9, padding: "8px 11px", border: "none", borderRadius: 9, background: l.slug === listSlug ? "rgba(191,217,242,.12)" : "transparent", color: l.slug === listSlug ? "#BFD9F2" : "#F1EEE6", cursor: "pointer", textAlign: "left", font: `500 13px/1 ${SS}` }}>
                      <span style={{ width: 6, height: 6, borderRadius: 999, flex: "none", background: l.slug === listSlug ? "#8FE3C0" : "rgba(241,238,230,.2)" }} />
                      <span>{l.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <nav style={{ display: "flex", gap: 2, padding: 3, borderRadius: 999, background: "rgba(241,238,230,.05)", border: "1px solid rgba(241,238,230,.07)" }}>
          {([["galaxy", "Sky"], ["space", "Your space"], ["board", "Log"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setView(id)} style={{ padding: "6px 13px", border: "none", borderRadius: 999, cursor: "pointer", font: `500 12.5px/1 ${SS}`, letterSpacing: ".01em", transition: "background .18s ease, color .18s ease", background: view === id ? "rgba(241,238,230,.11)" : "transparent", color: view === id ? "#F1EEE6" : "#94A0B4" }}>{label}</button>
          ))}
        </nav>

        <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "center" }}>
          <div style={{ position: "relative", width: "100%", maxWidth: 340 }}>
            <input value={q} onChange={(e) => { setQ(e.target.value); setSearchFocus(true); }} onFocus={() => setSearchFocus(true)} onBlur={() => setTimeout(() => setSearchFocus(false), 160)}
              onKeyDown={(e) => { if (e.key === "Enter" && results[0]) { e.preventDefault(); select(results[0].lemma); } if (e.key === "Escape") { setQ(""); setSearchFocus(false); } }}
              placeholder={`Search ${atlas.data.words.length.toLocaleString()} stars…`}
              style={{ width: "100%", padding: "8px 13px 8px 32px", borderRadius: 999, border: "1px solid rgba(241,238,230,.11)", background: "rgba(241,238,230,.05)", color: "#F1EEE6", fontSize: 13, outline: "none" }} />
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", font: `400 12px/1 ${MN}`, color: "#6B7789", pointerEvents: "none" }}>⌕</span>
            {searchFocus && results.length > 0 && (
              <ul style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, margin: 0, padding: 5, listStyle: "none", borderRadius: 14, border: "1px solid rgba(241,238,230,.1)", background: "rgba(10,15,28,.97)", backdropFilter: "blur(18px)", boxShadow: "0 22px 50px rgba(0,0,0,.6)", maxHeight: 320, overflowY: "auto", animation: "riseIn .16s ease both" }}>
                {results.map((w) => (
                  <li key={w.lemma}>
                    <button onMouseDown={(e) => { e.preventDefault(); select(w.lemma); }} style={{ display: "flex", width: "100%", alignItems: "center", gap: 9, padding: "8px 10px", border: "none", borderRadius: 10, background: "transparent", color: "#F1EEE6", cursor: "pointer", textAlign: "left", fontSize: 13 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 999, flex: "none", background: owned.has(w.lemma) ? "#8FE3C0" : w.tier === "advanced" ? "#CBB9E9" : w.degree >= 8 ? "#F2D9A0" : "#BFD9F2" }} />
                      <span style={{ flex: 1 }}>{w.display}</span>
                      <span style={{ font: `400 10.5px/1 ${MN}`, color: "#6B7789" }}>{owned.has(w.lemma) ? "held" : w.pos}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, flex: "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }} title="Days in a row with at least one star claimed">
            <span style={{ font: `400 13px/1 ${MN}`, color: "#F2D9A0" }}>▲</span>
            <span style={{ font: `600 13px/1 ${MN}`, color: "#F1EEE6" }}>{streak}</span>
            <span style={{ font: `400 10px/1 ${MN}`, letterSpacing: ".14em", color: "#6B7789", textTransform: "uppercase" }}>day</span>
          </div>
          <button onClick={() => setChatOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 12px", border: `1px solid ${chatOpen ? "rgba(191,217,242,.32)" : "rgba(241,238,230,.1)"}`, borderRadius: 999, background: chatOpen ? "rgba(191,217,242,.14)" : "rgba(241,238,230,.04)", color: chatOpen ? "#F1EEE6" : "#94A0B4", cursor: "pointer", font: `500 12px/1 ${SS}` }}>
            <span style={{ font: `400 12px/1 ${MN}` }}>✳</span><span>Tutor</span>
          </button>
          <div style={{ width: 1, height: 22, background: "rgba(241,238,230,.1)" }} />
          <button onClick={() => setView("space")} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 6px 5px 5px", border: "1px solid rgba(241,238,230,.1)", borderRadius: 999, background: "rgba(241,238,230,.04)", cursor: "pointer", color: "#F1EEE6" }}>
            <span style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 999, background: "rgba(191,217,242,.14)", font: `600 11px/1 ${MN}`, color: "#BFD9F2" }}>{level}</span>
            <span style={{ display: "flex", flexDirection: "column", gap: 3, paddingRight: 6 }}>
              <span style={{ font: `500 10px/1 ${MN}`, letterSpacing: ".1em", color: "#94A0B4", textTransform: "uppercase" }}>{totalXp} xp</span>
              <span style={{ width: 64, height: 3, borderRadius: 999, background: "rgba(241,238,230,.11)", overflow: "hidden", display: "block" }}>
                <span style={{ display: "block", height: "100%", borderRadius: 999, background: "linear-gradient(90deg,#BFD9F2,#8FE3C0)", width: `${levelPct}%`, transition: "width .5s cubic-bezier(.2,.8,.2,1)" }} />
              </span>
            </span>
          </button>
        </div>
      </header>

      {/* ---------- MOUNTED SKY ---------- */}
      <div style={{ position: "absolute", top: 57, left: 0, right: 0, bottom: 0, zIndex: 0, opacity: view === "galaxy" ? 1 : 0, pointerEvents: view === "galaxy" ? "auto" : "none", transition: "opacity .32s ease" }}>
        <div ref={hostRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(120% 90% at 50% 45%,transparent 40%,rgba(7,11,22,.55) 100%)" }} />
      </div>

      {/* ---------- TUTOR ---------- */}
      {chatOpen && (
        <Tutor focusName={drawer?.display ?? null} chartName={chart ? atlas.chartById.get(chart)?.name ?? null : null}
          log={chatLog} busy={chatBusy} error={chatError} input={chatInput}
          onInput={setChatInput} onSend={sendChat} onClose={() => setChatOpen(false)} />
      )}

      {/* ---------- GALAXY HUD ---------- */}
      {view === "galaxy" && (
        <main style={{ position: "absolute", top: 57, left: 0, right: 0, bottom: 0, zIndex: 1, overflow: "hidden", pointerEvents: "none" }}>
          {narrow && (
            <button onClick={() => setRailOpen((v) => !v)} style={{ position: "absolute", left: 12, top: 12, zIndex: 26, pointerEvents: "auto", display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", border: "1px solid rgba(241,238,230,.12)", borderRadius: 999, background: "rgba(10,15,28,.9)", color: "#F1EEE6", cursor: "pointer", font: `500 12.5px/1 ${SS}`, backdropFilter: "blur(14px)" }}>
              <span style={{ font: `400 12px/1 ${MN}`, color: "#BFD9F2" }}>{railOpen ? "✕" : "◇"}</span>
              <span>{railOpen ? "Close" : mode === "run" ? "Tonight's run" : mode === "ladder" ? "Ladder" : "Charts"}</span>
            </button>
          )}

          {/* LEFT RAIL */}
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 272, zIndex: 25, display: "flex", flexDirection: "column", gap: 10, padding: 14, paddingTop: narrow ? 60 : 14, overflowY: "auto", pointerEvents: "none", transform: `translateX(${railX})`, transition: "transform .3s cubic-bezier(.2,.8,.2,1)" }}>
            <div style={{ pointerEvents: "auto", display: "flex", gap: 3, padding: 3, borderRadius: 12, background: "rgba(10,15,28,.86)", border: "1px solid rgba(241,238,230,.1)", backdropFilter: "blur(16px)" }}>
              {MODE_DEFS.map(([id, glyph, label]) => (
                <button key={id} onClick={() => setModeTo(id as "chart" | "run" | "ladder")} style={{ flex: 1, padding: "8px 4px 7px", border: "none", borderRadius: 9, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, transition: "background .18s ease", background: mode === id ? "rgba(241,238,230,.12)" : "transparent" }}>
                  <span style={{ font: `400 14px/1 ${MN}`, color: mode === id ? "#F1EEE6" : "#6B7789" }}>{glyph}</span>
                  <span style={{ font: `600 9.5px/1 ${MN}`, letterSpacing: ".12em", textTransform: "uppercase", color: mode === id ? "#F1EEE6" : "#6B7789" }}>{label}</span>
                </button>
              ))}
            </div>

            <p style={{ pointerEvents: "auto", margin: 0, padding: "10px 12px", borderRadius: 12, background: "rgba(10,15,28,.8)", border: "1px solid rgba(241,238,230,.08)", backdropFilter: "blur(16px)", fontSize: 12, lineHeight: 1.55, color: "#94A0B4" }}>{modeBlurb}</p>

            {mode === "chart" && (
              <div style={{ pointerEvents: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "0 3px 2px" }}>
                  <span style={{ font: `600 9.5px/1 ${MN}`, letterSpacing: ".18em", textTransform: "uppercase", color: "#6B7789" }}>Charts</span>
                  <span style={{ font: `500 10.5px/1 ${MN}`, color: "#94A0B4" }}>{chartsDone} sealed</span>
                </div>
                {chartStats.map(({ ch, total, got, pct, done }) => (
                  <button key={ch.id} onClick={() => pickChart(ch.id)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 11px", border: `1px solid ${chart === ch.id ? "rgba(241,238,230,.26)" : done ? "rgba(242,217,160,.26)" : "rgba(241,238,230,.08)"}`, borderRadius: 12, background: chart === ch.id ? "rgba(241,238,230,.1)" : "rgba(10,15,28,.82)", cursor: "pointer", textAlign: "left", backdropFilter: "blur(16px)", transition: "background .18s ease, border-color .18s ease" }}>
                    <span style={{ display: "grid", placeItems: "center", width: 24, height: 24, flex: "none", borderRadius: 7, font: `400 12px/1 ${MN}`, background: "rgba(241,238,230,.07)", color: ch.hue }}>{ch.glyph}</span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
                        <span style={{ font: `500 12.5px/1.2 ${SS}`, color: "#F1EEE6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ch.name}</span>
                        <span style={{ font: `500 10px/1 ${MN}`, color: done ? "#F2D9A0" : got ? "#8FE3C0" : "#6B7789" }}>{done ? "sealed" : `${got}/${total}`}</span>
                      </span>
                      <span style={{ display: "block", height: 2.5, borderRadius: 999, background: "rgba(241,238,230,.1)", overflow: "hidden" }}>
                        <span style={{ display: "block", height: "100%", borderRadius: 999, background: ch.hue, width: `${pct}%`, transition: "width .6s cubic-bezier(.2,.8,.2,1)" }} />
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {mode === "run" && (
              <div style={{ pointerEvents: "auto", padding: 13, borderRadius: 14, background: "rgba(10,15,28,.86)", border: "1px solid rgba(242,217,160,.2)", backdropFilter: "blur(16px)" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ font: `600 9.5px/1 ${MN}`, letterSpacing: ".18em", textTransform: "uppercase", color: "#F2D9A0" }}>Tonight&apos;s run</span>
                  <span style={{ font: `500 11px/1 ${MN}`, color: "#94A0B4" }}>{runStarted ? `${String(Math.floor(runSeconds / 60)).padStart(2, "0")}:${String(runSeconds % 60).padStart(2, "0")}` : "not started"}</span>
                </div>
                <p style={{ margin: "0 0 11px", font: `400 20px/1.25 ${SF}`, color: "#F1EEE6" }}>{runComplete ? "Tonight's run is done." : runStarted ? `${runDone} of ${route.length} charted.` : `${route.length} stars, one per chart.`}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {route.map((lemma, i) => {
                    const w = atlas.byLemma.get(lemma); const done = owned.has(lemma);
                    const current = !done && route.slice(0, i).every((l) => owned.has(l));
                    return (
                      <button key={lemma} onClick={() => select(lemma)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 8px", border: "none", borderRadius: 8, background: current ? "rgba(242,217,160,.1)" : "transparent", cursor: "pointer", textAlign: "left" }}>
                        <span style={{ display: "grid", placeItems: "center", width: 18, height: 18, flex: "none", borderRadius: 999, font: `600 9.5px/1 ${MN}`, background: done ? "rgba(143,227,192,.18)" : current ? "rgba(242,217,160,.2)" : "transparent", color: done ? "#8FE3C0" : current ? "#F2D9A0" : "#6B7789", border: `1px solid ${done ? "rgba(143,227,192,.4)" : current ? "rgba(242,217,160,.5)" : "rgba(241,238,230,.14)"}` }}>{done ? "✓" : i + 1}</span>
                        <span style={{ flex: 1, font: `500 12.5px/1 ${SS}`, color: done ? "#8FE3C0" : current ? "#F1EEE6" : "#94A0B4" }}>{w?.display ?? lemma}</span>
                        <span style={{ font: `400 10px/1 ${MN}`, color: "#6B7789" }}>{atlas.chartById.get(w?.chart ?? "")?.glyph}</span>
                      </button>
                    );
                  })}
                </div>
                <button onClick={runAction} style={{ width: "100%", marginTop: 11, padding: 9, border: "none", borderRadius: 10, cursor: runComplete ? "default" : "pointer", font: `600 12px/1 ${SS}`, letterSpacing: ".02em", background: runComplete ? "rgba(241,238,230,.07)" : "linear-gradient(96deg,#F2D9A0,#E8C79F)", color: runComplete ? "#6B7789" : "#0A1020" }}>{runComplete ? "Come back tomorrow" : runStarted ? "Go to the next star" : "Begin the run"}</button>
              </div>
            )}

            {mode === "ladder" && (
              <div style={{ pointerEvents: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "0 3px 2px" }}>
                  <span style={{ font: `600 9.5px/1 ${MN}`, letterSpacing: ".18em", textTransform: "uppercase", color: "#6B7789" }}>{rungs.hasEarned ? "Ready to climb" : "Climbs to aim for"}</span>
                </div>
                {rungs.list.length === 0 ? (
                  <p style={{ margin: 0, padding: 12, borderRadius: 12, background: "rgba(10,15,28,.82)", border: "1px dashed rgba(241,238,230,.14)", fontSize: 12, lineHeight: 1.6, color: "#94A0B4" }}>Once you hold the plain word on the left, this list narrows to climbs you have actually earned.</p>
                ) : rungs.list.map((rung) => (
                  <button key={rung.to_lemma} onClick={() => select(rung.to_lemma)} style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%", padding: "9px 11px", border: "1px solid rgba(203,185,233,.16)", borderRadius: 12, background: "rgba(10,15,28,.82)", cursor: "pointer", textAlign: "left", backdropFilter: "blur(16px)" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 7, font: `500 12.5px/1 ${SS}`, color: "#94A0B4" }}>
                      <span style={{ color: "#F1EEE6" }}>{rung.from}</span>
                      <span style={{ font: `400 11px/1 ${MN}`, color: "#CBB9E9" }}>→</span>
                      <span style={{ color: "#CBB9E9", fontWeight: 600 }}>{rung.to}</span>
                    </span>
                    <span style={{ font: `400 11px/1.5 ${SS}`, color: "#6B7789" }}>{rung.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* BOTTOM BAR */}
          <div style={{ position: "absolute", left: barLeft, right: barRight, bottom: 14, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, pointerEvents: "none", zIndex: 20 }}>
            <div style={{ pointerEvents: "auto", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", maxWidth: "60%" }}>
              {trail.length > 0 && <span style={{ font: `600 9px/1 ${MN}`, letterSpacing: ".18em", textTransform: "uppercase", color: "#6B7789", paddingRight: 2 }}>Path</span>}
              {trail.map((l) => (
                <button key={l} onClick={() => select(l)} style={{ padding: "5px 10px", border: `1px solid ${l === focus ? "rgba(191,217,242,.35)" : "rgba(241,238,230,.1)"}`, borderRadius: 999, background: l === focus ? "rgba(191,217,242,.14)" : "rgba(10,15,28,.86)", color: l === focus ? "#F1EEE6" : "#94A0B4", cursor: "pointer", font: `500 11.5px/1 ${SS}` }}>{atlas.byLemma.get(l)?.display ?? l}</button>
              ))}
            </div>
            <div style={{ pointerEvents: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              {mode === "run" && !narrow && (
                <span style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 12px", border: "1px solid rgba(242,217,160,.26)", borderRadius: 999, background: "rgba(10,15,28,.86)", backdropFilter: "blur(14px)" }}>
                  <span style={{ font: `400 11px/1 ${MN}`, color: "#F2D9A0" }}>▲</span>
                  <span style={{ font: `600 11px/1 ${MN}`, color: "#F1EEE6" }}>{route.filter((l) => owned.has(l)).length} / {route.length}</span>
                </span>
              )}
              <button onClick={() => setKeyOpen((v) => !v)} style={{ padding: "6px 11px", border: "1px solid rgba(241,238,230,.1)", borderRadius: 999, background: "rgba(10,15,28,.86)", color: "#94A0B4", cursor: "pointer", font: `500 11px/1 ${SS}`, backdropFilter: "blur(14px)" }}>Key</button>
              <button onClick={resetView} style={{ padding: "6px 11px", border: "1px solid rgba(241,238,230,.1)", borderRadius: 999, background: "rgba(10,15,28,.86)", color: "#94A0B4", cursor: "pointer", font: `500 11px/1 ${SS}`, backdropFilter: "blur(14px)" }}>Reset view</button>
              <span style={{ padding: "6px 11px", borderRadius: 999, background: "rgba(10,15,28,.7)", font: `500 10px/1 ${MN}`, letterSpacing: ".14em", textTransform: "uppercase", color: "#6B7789", backdropFilter: "blur(14px)" }}>{zoomLabel}</span>
            </div>
          </div>

          {keyOpen && (
            <div style={{ position: "absolute", right: 16, bottom: 60, width: 224, padding: 13, pointerEvents: "auto", borderRadius: 14, background: "rgba(10,15,28,.95)", border: "1px solid rgba(241,238,230,.1)", backdropFilter: "blur(18px)", boxShadow: "0 22px 50px rgba(0,0,0,.6)", animation: "riseIn .18s ease both", zIndex: 30 }}>
              <p style={{ margin: "0 0 9px", font: `600 9.5px/1 ${MN}`, letterSpacing: ".18em", textTransform: "uppercase", color: "#6B7789" }}>Reading the sky</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {legend.map((l) => (
                  <span key={l.label} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 11.5, color: "#94A0B4" }}>
                    <span style={{ width: 9, height: 9, flex: "none", borderRadius: 999, background: l.dot, boxShadow: `0 0 9px ${l.dot}` }} />
                    <span style={{ color: "#F1EEE6" }}>{l.label}</span>
                    <span style={{ marginLeft: "auto", font: `400 10px/1 ${MN}` }}>{l.n}</span>
                  </span>
                ))}
              </div>
              <p style={{ margin: "11px 0 0", paddingTop: 10, borderTop: "1px solid rgba(241,238,230,.08)", fontSize: 11, lineHeight: 1.6, color: "#6B7789" }}>Drag to orbit · scroll to zoom · click a star. Arrow keys walk between linked words, Esc lets go.</p>
            </div>
          )}

          {/* DETAIL DRAWER */}
          {focus && (
            <aside style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "min(100%,420px)", pointerEvents: "auto", display: "flex", flexDirection: "column", background: "rgba(9,13,25,.94)", borderLeft: "1px solid rgba(241,238,230,.1)", backdropFilter: "blur(22px)", boxShadow: "-24px 0 60px rgba(0,0,0,.45)", animation: "slideIn .26s cubic-bezier(.2,.8,.2,1) both", zIndex: 35 }}>
              {drawer && wordReady ? (
                <>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "18px 18px 14px", borderBottom: "1px solid rgba(241,238,230,.08)" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ display: "grid", placeItems: "center", width: 20, height: 20, borderRadius: 6, font: `400 10px/1 ${MN}`, background: "rgba(241,238,230,.07)", color: drawer.chartHue }}>{drawer.chartGlyph}</span>
                        <span style={{ font: `500 9.5px/1 ${MN}`, letterSpacing: ".16em", textTransform: "uppercase", color: drawer.chartHue }}>{drawer.chartName}</span>
                      </div>
                      <h2 style={{ margin: "9px 0 0", font: `400 38px/1.02 ${SF}`, letterSpacing: "-.01em", color: "#F1EEE6" }}>{drawer.display}</h2>
                      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", marginTop: 8 }}>
                        {drawer.ipa && <span style={{ font: `400 12px/1 ${MN}`, color: "#BFD9F2" }}>{drawer.ipa}</span>}
                        <span style={{ padding: "3px 8px", borderRadius: 999, border: "1px solid rgba(241,238,230,.12)", font: `400 10.5px/1 ${MN}`, color: "#94A0B4" }}>{drawer.pos}</span>
                        {drawer.isAdvanced && <span style={{ padding: "3px 8px", borderRadius: 999, background: "rgba(203,185,233,.16)", font: `500 10.5px/1 ${MN}`, letterSpacing: ".08em", textTransform: "uppercase", color: "#CBB9E9" }}>advanced</span>}
                        <button onClick={speak} style={{ padding: "3px 9px", border: "1px solid rgba(241,238,230,.12)", borderRadius: 999, background: "rgba(241,238,230,.04)", color: "#BFD9F2", cursor: "pointer", font: `400 11px/1.4 ${SS}` }}>◂)) say it</button>
                      </div>
                    </div>
                    <button onClick={() => select(null)} aria-label="Close" style={{ flex: "none", width: 28, height: 28, display: "grid", placeItems: "center", border: "1px solid rgba(241,238,230,.1)", borderRadius: 999, background: "none", color: "#94A0B4", cursor: "pointer", fontSize: 13 }}>✕</button>
                  </div>

                  <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 18px 22px", display: "flex", flexDirection: "column", gap: 18 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                      <button onClick={() => { if (!drawer.held) openQuiz(focus); }} style={{ width: "100%", padding: 12, border: `1px solid ${drawer.held ? "rgba(143,227,192,.28)" : "transparent"}`, borderRadius: 13, cursor: drawer.held ? "default" : "pointer", font: `600 13px/1 ${SS}`, letterSpacing: ".01em", background: drawer.held ? "rgba(143,227,192,.1)" : "linear-gradient(96deg,#BFD9F2,#8FE3C0)", color: drawer.held ? "#8FE3C0" : "#0A1020", transition: "opacity .2s ease" }}>{drawer.held ? "✓ Held — this star is yours" : "Check what you know, then claim it"}</button>

                      {drawer.held && (
                        <>
                          <button onClick={() => { if (!drawer.solid) openCompose(focus); }} style={{ width: "100%", padding: 12, border: `1px solid ${drawer.solid ? "rgba(143,227,192,.3)" : "rgba(203,185,233,.32)"}`, borderRadius: 13, cursor: drawer.solid ? "default" : "pointer", font: `600 13px/1 ${SS}`, background: drawer.solid ? "rgba(143,227,192,.12)" : "rgba(203,185,233,.14)", color: drawer.solid ? "#8FE3C0" : "#CBB9E9", display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
                            <span style={{ font: `400 13px/1 ${MN}` }}>{drawer.solid ? "◆" : "✎"}</span>
                            <span>{drawer.solid ? "Used in a sentence" : "Use it in a sentence"}</span>
                          </button>
                          <p style={{ margin: 0, font: `400 11.5px/1.6 ${SS}`, color: "#6B7789" }}>{drawer.solid ? "Solid star — you produced it, not just recognised it." : "Held means you recognised it. Solid means you produced it."}</p>
                        </>
                      )}

                      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", fontSize: 11.5, color: "#6B7789" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 6, height: 6, borderRadius: 999, background: drawer.rarityDot }} />
                          <span style={{ color: drawer.rarityDot, fontWeight: 500 }}>{drawer.rarityWord}</span>
                          <span>{drawer.rarityText}</span>
                        </span>
                        <span style={{ font: `500 10.5px/1 ${MN}`, color: "#F2D9A0" }}>+{drawer.xp} xp</span>
                      </div>
                    </div>

                    {drawer.def && <p style={{ margin: 0, font: `400 16.5px/1.62 ${SS}`, color: "#E8E4DA" }}>{drawer.def}</p>}

                    {drawer.ex && (
                      <div style={{ padding: "13px 15px", borderLeft: "2px solid rgba(191,217,242,.4)", background: "rgba(191,217,242,.05)", borderRadius: "0 10px 10px 0" }}>
                        <p style={{ margin: 0, font: `italic 400 15px/1.65 ${SF}`, color: "#D8D3C8" }}>{drawer.ex}</p>
                      </div>
                    )}

                    {drawer.connGroups.map((g) => (
                      <section key={g.type}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 9 }}>
                          <h3 style={{ margin: 0, font: `600 9.5px/1 ${MN}`, letterSpacing: ".18em", textTransform: "uppercase", color: g.tone }}>{g.label}</h3>
                          <span style={{ flex: 1, height: 1, background: "rgba(241,238,230,.08)" }} />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {g.items.map((c, idx) => (
                            <div key={c.lemma + idx} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <button onClick={() => select(c.lemma)} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 7, padding: "5px 11px", border: `1px solid ${c.held ? "rgba(143,227,192,.3)" : c.type === "advanced_form" ? "rgba(203,185,233,.32)" : "rgba(241,238,230,.12)"}`, borderRadius: 999, background: c.held ? "rgba(143,227,192,.09)" : c.type === "advanced_form" ? "rgba(203,185,233,.1)" : "rgba(241,238,230,.04)", color: c.held ? "#8FE3C0" : c.type === "advanced_form" ? "#CBB9E9" : "#F1EEE6", cursor: "pointer", font: `500 13px/1 ${SS}` }}>
                                <span>{c.display}</span>
                                <span style={{ font: `400 10px/1 ${MN}`, opacity: .65 }}>{c.mark}</span>
                              </button>
                              {c.gloss && <p style={{ margin: 0, paddingLeft: 2, font: `400 12px/1.6 ${SS}`, color: "#94A0B4" }}>{c.gloss}</p>}
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}

                    <p style={{ margin: 0, paddingTop: 14, borderTop: "1px solid rgba(241,238,230,.08)", font: `400 11.5px/1.6 ${SS}`, color: "#6B7789" }}>← → walks the ring of linked stars · ↑ climbs to the advanced form · Enter opens the check</p>
                  </div>
                </>
              ) : (
                <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#6B7789" }}>Reading the star…</div>
              )}
            </aside>
          )}

          {/* FIRST-RUN INTRO */}
          {intro && (
            <div style={{ position: "absolute", inset: 0, zIndex: 70, pointerEvents: "auto", display: "grid", placeItems: "center", padding: 24, background: "rgba(4,7,14,.8)", backdropFilter: "blur(10px)", animation: "fadeIn .2s ease both" }}>
              <div style={{ width: "min(100%,560px)", padding: 34, borderRadius: 22, background: "rgba(11,16,31,.97)", border: "1px solid rgba(241,238,230,.12)", boxShadow: "0 30px 90px rgba(0,0,0,.7)", animation: "riseIn .28s cubic-bezier(.2,.8,.2,1) both" }}>
                <p style={{ margin: 0, font: `600 9.5px/1 ${MN}`, letterSpacing: ".24em", textTransform: "uppercase", color: "#6B7789" }}>Star Atlas · Observatory</p>
                <h2 style={{ margin: "14px 0 0", font: `400 40px/1.1 ${SF}`, letterSpacing: "-.015em", color: "#F1EEE6" }}>Every word you own becomes a star you can see.</h2>
                <p style={{ margin: "16px 0 0", font: `400 15.5px/1.7 ${SS}`, color: "#A9B2C0" }}>{atlas.data.words.length.toLocaleString()} English words, arranged into charts by what they mean. Claiming a star takes one quick check — get it right and it lights up for good.</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "22px 0 24px" }}>
                  {[["1", "Find a star", "the charts sit apart in the sky. Zoom into one and the words name themselves."], ["2", "Pass the check", "one question — a meaning, a word, or a missing word in a sentence. Two tries."], ["3", "Watch it light", "held stars glow mint and ring. Seal a chart to finish it."]].map(([n, title, body]) => (
                    <div key={n} style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
                      <span style={{ flex: "none", display: "grid", placeItems: "center", width: 24, height: 24, borderRadius: 999, background: "rgba(191,217,242,.12)", font: `500 11px/1 ${MN}`, color: "#BFD9F2" }}>{n}</span>
                      <p style={{ margin: "1px 0 0", font: `400 14px/1.6 ${SS}`, color: "#C6C1B6" }}><b style={{ color: "#F1EEE6", fontWeight: 600 }}>{title}</b> — {body}</p>
                    </div>
                  ))}
                </div>
                <button onClick={() => { setIntro(false); persistLocal({ introDone: true }); }} style={{ width: "100%", padding: 14, border: "none", borderRadius: 13, cursor: "pointer", font: `600 14px/1 ${SS}`, background: "linear-gradient(96deg,#BFD9F2,#8FE3C0)", color: "#0A1020" }}>Open the sky</button>
              </div>
            </div>
          )}

          {/* TOAST */}
          {toast && (
            <div style={{ position: "absolute", left: "50%", bottom: 76, transform: "translateX(-50%)", zIndex: 55, display: "flex", alignItems: "center", gap: 11, padding: "11px 18px", borderRadius: 999, background: toast.tone === "gold" ? "rgba(30,25,14,.92)" : "rgba(12,26,22,.92)", border: `1px solid ${toast.tone === "gold" ? "rgba(242,217,160,.34)" : "rgba(143,227,192,.3)"}`, boxShadow: "0 18px 44px rgba(0,0,0,.5)", backdropFilter: "blur(16px)", animation: "tickUp .22s cubic-bezier(.2,.8,.2,1) both", pointerEvents: "none" }}>
              <span style={{ font: `400 14px/1 ${MN}`, color: toast.tone === "gold" ? "#F2D9A0" : "#8FE3C0" }}>{toast.glyph}</span>
              <span style={{ font: `600 13.5px/1 ${SS}`, color: "#F1EEE6" }}>{toast.text}</span>
              <span style={{ font: `400 12px/1 ${SS}`, color: "#94A0B4" }}>{toast.sub}</span>
            </div>
          )}
        </main>
      )}

      {/* QUIZ (shared across galaxy) */}
      {quiz && (
        <QuizModal quiz={quiz} atlas={atlas} onClose={() => setQuiz(null)}
          onInput={(v) => setQuiz((q0) => (q0 ? { ...q0, input: v } : q0))}
          onChoice={answerChoice} onSubmitType={submitType} />
      )}

      {compose && (
        <ComposeModal compose={compose} onClose={() => setCompose(null)}
          onInput={(v) => setCompose((c) => (c ? { ...c, text: v, gate: null } : c))}
          onInput2={(v) => setCompose((c) => (c ? { ...c, text2: v, gate: null } : c))}
          onSubmit={submitCompose}
          onRevise={() => setCompose((c) => (c ? { ...c, verdict: null } : c))}
          onSwap={() => { if (compose.task) openCompose(compose.task.lemma, compose.tried); }} />
      )}

      {/* ---------- YOUR SPACE ---------- */}
      {view === "space" && (
        <SpaceView me={me} owned={owned} used={used} streak={streak} atlas={atlas} chartStats={chartStats} chartsDone={chartsDone}
          onOpenGalaxy={() => setView("galaxy")}
          onPickChart={(id) => { setView("galaxy"); setMode("chart"); setTimeout(() => pickChart(id), 60); }}
          onSelect={(l) => { setView("galaxy"); setTimeout(() => select(l), 60); }}
          onRestored={(m) => { setMe(m); setOwned(new Set(m.lemmas)); }} />
      )}

      {/* ---------- LOG / LEADERBOARD ---------- */}
      {view === "board" && <BoardView rows={boardRows} />}

      {!meLoaded && view === "galaxy" && (
        <div style={{ position: "absolute", inset: "57px 0 0 0", zIndex: 2, display: "grid", placeItems: "center", color: "#6B7789", fontSize: 13, pointerEvents: "none" }}>Charting the sky…</div>
      )}

      {/* ?dev=1 author overlay */}
      {dev && (
        <div style={{ position: "absolute", right: 12, bottom: 60, zIndex: 80, maxWidth: 260, padding: "10px 12px", borderRadius: 10, background: "rgba(4,7,14,.86)", border: "1px solid rgba(242,217,160,.28)", backdropFilter: "blur(10px)", font: `400 10.5px/1.7 ${MN}`, color: "#94A0B4", pointerEvents: "none" }}>
          <div style={{ color: "#F2D9A0", letterSpacing: ".16em", textTransform: "uppercase", marginBottom: 4 }}>author · {listSlug}</div>
          <div>{atlas.data.words.length} words · {atlas.data.edges.length} edges</div>
          <div>{atlas.listedCharts.length} charts · {atlas.data.words.filter((w) => w.chart === "drift").length} drift</div>
          <div>zoom {zoom} · mode {mode}{chart ? ` · chart ${chart}` : ""}</div>
          <div>run {route.length} stops · {serverRoute ? "server" : "local"}</div>
          {focus && atlas.byLemma.has(focus) && (
            <div style={{ color: "#BFD9F2", marginTop: 4 }}>★ {focus} · {atlas.byLemma.get(focus)!.chart} · {atlas.byLemma.get(focus)!.tier} · deg {atlas.byLemma.get(focus)!.degree} · rank {atlas.byLemma.get(focus)!.rank ?? "—"}{used.has(focus) ? " · solid" : owned.has(focus) ? " · held" : ""}</div>
          )}
        </div>
      )}

      {/* keyframes the prototype relies on */}
      <style>{`
        @keyframes riseIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideIn { from { opacity: 0; transform: translateX(26px); } to { opacity: 1; transform: none; } }
        @keyframes tickUp { from { opacity: 0; transform: translate(-50%, 8px) scale(.96); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
        .atlas-scroll::-webkit-scrollbar { width: 5px; height: 5px; }
        .atlas-scroll::-webkit-scrollbar-thumb { background: rgba(241,238,230,.10); border-radius: 8px; }
      `}</style>
    </div>
  );
}

/* ============================ SUB-VIEWS ============================ */

type AtlasModel = {
  data: ReturnType<typeof toAtlas>;
  byLemma: Map<string, AtlasWord>;
  chartById: Map<string, AtlasChart>;
  wordsByChart: Map<string, AtlasWord[]>;
  listedCharts: AtlasChart[];
};

function QuizModal({ quiz, atlas, onClose, onInput, onChoice, onSubmitType }: {
  quiz: QuizState; atlas: AtlasModel; onClose: () => void;
  onInput: (v: string) => void; onChoice: (id: string) => void; onSubmitType: () => void;
}) {
  const target = atlas.byLemma.get(quiz.lemma);
  const isType = quiz.kind === "type";
  const tone = quiz.revealed ? (quiz.correct ? "#8FE3C0" : "#E8A89F") : "#BFD9F2";
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 60, pointerEvents: "auto", display: "grid", placeItems: "center", padding: 20, background: "rgba(4,7,14,.72)", backdropFilter: "blur(8px)", animation: "fadeIn .18s ease both" }}>
      <div style={{ width: "min(100%,520px)", maxHeight: "100%", overflowY: "auto", padding: 24, borderRadius: 20, background: "rgba(11,16,31,.97)", border: "1px solid rgba(241,238,230,.12)", boxShadow: "0 30px 90px rgba(0,0,0,.7)", animation: "riseIn .22s cubic-bezier(.2,.8,.2,1) both" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 5 }}>
          <span style={{ font: `600 9.5px/1 ${MN}`, letterSpacing: ".2em", textTransform: "uppercase", color: tone }}>{isType ? "Listen to the sentence" : "Word check"}</span>
          <button onClick={onClose} style={{ width: 26, height: 26, display: "grid", placeItems: "center", border: "1px solid rgba(241,238,230,.1)", borderRadius: 999, background: "none", color: "#94A0B4", cursor: "pointer", fontSize: 12 }}>✕</button>
        </div>
        <h3 style={{ margin: "0 0 18px", font: `400 26px/1.25 ${SF}`, color: "#F1EEE6" }}>{quiz.prompt}</h3>

        {isType ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0, padding: "15px 17px", borderRadius: 12, background: "rgba(191,217,242,.06)", borderLeft: "2px solid rgba(191,217,242,.4)", font: `italic 400 16px/1.65 ${SF}`, color: "#D8D3C8" }}>{quiz.sentence}</p>
            <input value={quiz.input} onChange={(e) => onInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSubmitType(); } }} placeholder="type the missing word" autoFocus
              style={{ width: "100%", padding: "13px 15px", borderRadius: 12, border: `1px solid ${quiz.revealed ? (quiz.correct ? "rgba(143,227,192,.5)" : "rgba(232,168,159,.5)") : quiz.nudge ? "rgba(242,217,160,.5)" : "rgba(241,238,230,.14)"}`, background: "rgba(241,238,230,.05)", color: "#F1EEE6", font: `400 16px/1 ${SS}`, outline: "none" }} />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(quiz.options || []).map((o) => {
              const isAnswer = o.id === quiz.answer, isWrong = quiz.wrong === o.id;
              let border = "rgba(241,238,230,.11)", bg = "rgba(241,238,230,.03)", fg = "#E8E4DA", markBorder = "rgba(241,238,230,.18)", markFg = "#6B7789", mark = "·";
              if (quiz.revealed && isAnswer) { border = "rgba(143,227,192,.45)"; bg = "rgba(143,227,192,.1)"; fg = "#F1EEE6"; markBorder = "rgba(143,227,192,.6)"; markFg = "#8FE3C0"; mark = "✓"; }
              else if (isWrong) { border = "rgba(232,168,159,.4)"; bg = "rgba(232,168,159,.08)"; fg = "#C6C1B6"; markBorder = "rgba(232,168,159,.5)"; markFg = "#E8A89F"; mark = "✕"; }
              return (
                <button key={o.id} onClick={() => onChoice(o.id)} disabled={quiz.revealed} style={{ display: "flex", alignItems: "flex-start", gap: 12, width: "100%", padding: "13px 15px", border: `1px solid ${border}`, borderRadius: 13, background: bg, color: fg, cursor: quiz.revealed ? "default" : "pointer", textAlign: "left", font: `400 14.5px/1.55 ${SS}`, transition: "background .16s ease, border-color .16s ease" }}>
                  <span style={{ flex: "none", display: "grid", placeItems: "center", width: 21, height: 21, marginTop: 1, borderRadius: 999, border: `1px solid ${markBorder}`, font: `500 10px/1 ${MN}`, color: markFg }}>{mark}</span>
                  <span style={{ flex: 1 }}>{o.text}</span>
                </button>
              );
            })}
          </div>
        )}

        {quiz.revealed && (
          <div style={{ marginTop: 16, padding: "15px 17px", borderRadius: 13, background: quiz.correct ? "rgba(143,227,192,.08)" : "rgba(232,168,159,.07)", border: `1px solid ${quiz.correct ? "rgba(143,227,192,.24)" : "rgba(232,168,159,.24)"}` }}>
            <p style={{ margin: "0 0 6px", font: `600 12px/1 ${SS}`, color: quiz.correct ? "#8FE3C0" : "#E8A89F" }}>{quiz.correct ? "Claimed." : `The answer was “${target?.display ?? quiz.answer}”.`}</p>
          </div>
        )}

        <div style={{ display: "flex", gap: 9, marginTop: 18 }}>
          <button onClick={() => { if (quiz.revealed) onClose(); else if (isType) onSubmitType(); }} style={{ flex: 1, padding: 12, border: "none", borderRadius: 12, cursor: "pointer", font: `600 13px/1 ${SS}`, background: quiz.revealed ? "rgba(241,238,230,.1)" : isType ? "linear-gradient(96deg,#BFD9F2,#8FE3C0)" : "rgba(241,238,230,.07)", color: quiz.revealed ? "#F1EEE6" : isType ? "#0A1020" : "#6B7789" }}>{quiz.revealed ? (quiz.correct ? "Keep exploring" : "Got it — I'll come back") : isType ? "Check" : "Choose an answer"}</button>
          {!quiz.revealed && <button onClick={onClose} style={{ padding: "12px 16px", border: "1px solid rgba(241,238,230,.12)", borderRadius: 12, background: "none", color: "#94A0B4", cursor: "pointer", font: `500 13px/1 ${SS}` }}>Later</button>}
        </div>
      </div>
    </div>
  );
}

function ComposeModal({ compose, onClose, onInput, onInput2, onSubmit, onRevise, onSwap }: {
  compose: ComposeState; onClose: () => void;
  onInput: (v: string) => void; onInput2: (v: string) => void;
  onSubmit: () => void; onRevise: () => void; onSwap: () => void;
}) {
  const { task, verdict: v, gate: g, busy } = compose;
  const pair = task?.mode === "pair";
  const failed = !!v && !v.pass;
  const stuck = failed && compose.attempts >= 3;
  const primaryLabel = busy ? "Checking…" : v?.pass ? "Done" : stuck ? "Leave it for now" : v ? "Revise it" : g ? "Try again" : "Check my sentence";
  const onPrimary = () => { if (busy) return; if (v?.pass || stuck) onClose(); else if (v) onRevise(); else onSubmit(); };
  const fb = g
    ? { title: "Not yet", body: g, bg: "rgba(242,217,160,.07)", border: "rgba(242,217,160,.22)", fg: "#F2D9A0" }
    : v ? (v.pass
      ? { title: "Accepted.", body: v.hint || "You used both words and the relation reads.", bg: "rgba(143,227,192,.08)", border: "rgba(143,227,192,.24)", fg: "#8FE3C0" }
      : { title: "Close, but the relation isn't there yet.", body: v.hint || "Try again.", bg: "rgba(232,168,159,.07)", border: "rgba(232,168,159,.24)", fg: "#E8A89F" })
      : null;

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 62, pointerEvents: "auto", display: "grid", placeItems: "center", padding: 20, background: "rgba(4,7,14,.74)", backdropFilter: "blur(8px)", animation: "fadeIn .18s ease both" }}>
      <div className="atlas-scroll" style={{ width: "min(100%,560px)", maxHeight: "100%", overflowY: "auto", padding: 24, borderRadius: 20, background: "rgba(11,16,31,.97)", border: "1px solid rgba(241,238,230,.12)", boxShadow: "0 30px 90px rgba(0,0,0,.7)", animation: "riseIn .22s cubic-bezier(.2,.8,.2,1) both" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ padding: "3px 9px", borderRadius: 999, background: "rgba(203,185,233,.16)", font: `600 9px/1.5 ${MN}`, letterSpacing: ".16em", textTransform: "uppercase", color: "#CBB9E9" }}>{task?.label ?? "Compose"}</span>
            <span style={{ font: `600 9.5px/1 ${MN}`, letterSpacing: ".18em", textTransform: "uppercase", color: "#6B7789" }}>{task?.kicker ?? ""}</span>
          </span>
          <button onClick={onClose} style={{ width: 26, height: 26, display: "grid", placeItems: "center", border: "1px solid rgba(241,238,230,.1)", borderRadius: 999, background: "none", color: "#94A0B4", cursor: "pointer", fontSize: 12 }}>✕</button>
        </div>

        {!task ? (
          <p style={{ margin: "12px 0", font: `400 15px/1.6 ${SS}`, color: "#94A0B4" }}>Finding a good pairing…</p>
        ) : (
          <>
            <h3 style={{ margin: "0 0 14px", font: `400 25px/1.3 ${SF}`, color: "#F1EEE6" }}>{task.ask}</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", marginBottom: 14 }}>
              <span style={{ padding: "5px 12px", borderRadius: 999, border: "1px solid rgba(191,217,242,.3)", background: "rgba(191,217,242,.08)", font: `500 13px/1 ${SS}`, color: "#BFD9F2" }}>{task.first}</span>
              <span style={{ font: `400 12px/1 ${MN}`, color: "#6B7789" }}>{pair ? "→" : "+"}</span>
              <span style={{ padding: "5px 12px", borderRadius: 999, border: "1px solid rgba(203,185,233,.3)", background: "rgba(203,185,233,.09)", font: `500 13px/1 ${SS}`, color: "#CBB9E9" }}>{task.second}</span>
            </div>
            {task.gloss && <p style={{ margin: "0 0 14px", padding: "12px 15px", borderRadius: 11, background: "rgba(203,185,233,.06)", borderLeft: "2px solid rgba(203,185,233,.35)", font: `400 13px/1.65 ${SS}`, color: "#C6C1B6" }}>{task.gloss}</p>}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <textarea value={compose.text} onChange={(e) => onInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit(); } }} placeholder={pair ? `Sentence one — using “${task.first}”` : "Your sentence…"} rows={pair ? 2 : 3}
                style={{ width: "100%", padding: "13px 15px", borderRadius: 12, border: `1px solid ${g ? "rgba(242,217,160,.5)" : v ? (v.pass ? "rgba(143,227,192,.45)" : "rgba(232,168,159,.4)") : "rgba(241,238,230,.14)"}`, background: "rgba(241,238,230,.05)", color: "#F1EEE6", font: `400 15.5px/1.6 ${SS}`, outline: "none", resize: "vertical" }} />
              {pair && (
                <textarea value={compose.text2} onChange={(e) => onInput2(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit(); } }} placeholder={`Sentence two — using “${task.second}”`} rows={2}
                  style={{ width: "100%", padding: "13px 15px", borderRadius: 12, border: `1px solid ${g ? "rgba(242,217,160,.5)" : "rgba(241,238,230,.14)"}`, background: "rgba(241,238,230,.05)", color: "#F1EEE6", font: `400 15.5px/1.6 ${SS}`, outline: "none", resize: "vertical" }} />
              )}
            </div>
            <p style={{ margin: "10px 0 0", font: `400 11.5px/1.6 ${SS}`, color: "#6B7789" }}>{task.tip}</p>

            {fb && (
              <div style={{ marginTop: 15, padding: "14px 16px", borderRadius: 13, background: fb.bg, border: `1px solid ${fb.border}` }}>
                <p style={{ margin: "0 0 5px", font: `600 12px/1 ${SS}`, color: fb.fg }}>{fb.title}</p>
                <p style={{ margin: 0, font: `400 13.5px/1.65 ${SS}`, color: "#C6C1B6" }}>{fb.body}</p>
                {v?.note && <p style={{ margin: "8px 0 0", font: `400 10.5px/1.5 ${MN}`, color: "#6B7789" }}>{v.note}</p>}
              </div>
            )}

            <div style={{ display: "flex", gap: 9, marginTop: 18 }}>
              <button onClick={onPrimary} style={{ flex: 1, padding: 12, border: "none", borderRadius: 12, cursor: busy ? "progress" : "pointer", font: `600 13px/1 ${SS}`, background: busy ? "rgba(241,238,230,.07)" : v?.pass ? "rgba(143,227,192,.16)" : "linear-gradient(96deg,#CBB9E9,#BFD9F2)", color: busy ? "#6B7789" : v?.pass ? "#8FE3C0" : "#0A1020" }}>{primaryLabel}</button>
              <button onClick={onClose} style={{ padding: "12px 16px", border: "1px solid rgba(241,238,230,.12)", borderRadius: 12, background: "none", color: "#94A0B4", cursor: "pointer", font: `500 13px/1 ${SS}` }}>{v?.pass ? "Close" : "Later"}</button>
            </div>
            {!v && compose.tried.length < 3 && (
              <button onClick={onSwap} style={{ width: "100%", marginTop: 9, padding: 9, border: "1px dashed rgba(241,238,230,.14)", borderRadius: 11, background: "none", color: "#6B7789", cursor: "pointer", font: `500 11.5px/1 ${SS}` }}>Give me a different pairing</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Tutor({ focusName, chartName, log, busy, error, input, onInput, onSend, onClose }: {
  focusName: string | null; chartName: string | null;
  log: { role: "user" | "assistant"; text: string }[]; busy: boolean; error: string | null; input: string;
  onInput: (v: string) => void; onSend: (preset?: string) => void; onClose: () => void;
}) {
  const chips = focusName
    ? [`What does “${focusName}” really mean?`, `Use “${focusName}” in a sentence`, `A more advanced word than “${focusName}”`]
    : ["How do these charts fit together?", "Which word should I learn first?", "Explain the rarest words here"];
  return (
    <aside style={{ position: "absolute", right: 0, top: 57, bottom: 0, width: "min(100%,404px)", zIndex: 50, display: "flex", flexDirection: "column", background: "rgba(9,13,25,.97)", borderLeft: "1px solid rgba(241,238,230,.1)", backdropFilter: "blur(22px)", boxShadow: "-24px 0 60px rgba(0,0,0,.5)", animation: "slideIn .26s cubic-bezier(.2,.8,.2,1) both" }}>
      <div style={{ flex: "none", display: "flex", alignItems: "flex-start", gap: 12, padding: "16px 18px 13px", borderBottom: "1px solid rgba(241,238,230,.08)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, font: `600 9.5px/1 ${MN}`, letterSpacing: ".2em", textTransform: "uppercase", color: "#6B7789" }}>Tutor</p>
          <p style={{ margin: "7px 0 0", font: `400 21px/1.2 ${SF}`, color: "#F1EEE6" }}>{focusName || chartName || "Ask about any star"}</p>
          <p style={{ margin: "6px 0 0", font: `400 11.5px/1.5 ${SS}`, color: "#6B7789" }}>{focusName ? "Grounded in this star, its links and their notes." : chartName ? "Grounded in this chart." : "Open a star and the tutor reads it with you."}</p>
        </div>
        <button onClick={onClose} aria-label="Close tutor" style={{ flex: "none", width: 28, height: 28, display: "grid", placeItems: "center", border: "1px solid rgba(241,238,230,.1)", borderRadius: 999, background: "none", color: "#94A0B4", cursor: "pointer", fontSize: 13 }}>✕</button>
      </div>

      <div className="atlas-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        {log.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: m.role === "user" ? "86%" : "100%", padding: m.role === "user" ? "10px 14px" : "12px 15px", borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px", background: m.role === "user" ? "rgba(191,217,242,.9)" : "rgba(241,238,230,.04)", border: `1px solid ${m.role === "user" ? "transparent" : "rgba(241,238,230,.08)"}` }}>
            <p style={{ margin: 0, font: `400 14px/1.68 ${SS}`, color: m.role === "user" ? "#0A1020" : "#E8E4DA", whiteSpace: "pre-wrap" }}>{m.text}</p>
          </div>
        ))}
        {busy && <div style={{ alignSelf: "flex-start", padding: "10px 14px", borderRadius: "14px 14px 14px 4px", background: "rgba(241,238,230,.04)", border: "1px solid rgba(241,238,230,.08)" }}><span style={{ font: `400 13px/1 ${MN}`, color: "#6B7789" }}>thinking…</span></div>}
        {error && <div style={{ padding: "12px 15px", borderRadius: 12, background: "rgba(232,168,159,.07)", border: "1px solid rgba(232,168,159,.22)" }}><p style={{ margin: 0, font: `400 13px/1.6 ${SS}`, color: "#E8A89F" }}>{error}</p></div>}
        {log.length === 0 && !busy && (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <p style={{ margin: "0 0 3px", font: `600 9.5px/1 ${MN}`, letterSpacing: ".18em", textTransform: "uppercase", color: "#6B7789" }}>Try asking</p>
            {chips.map((c) => (
              <button key={c} onClick={() => onSend(c)} style={{ textAlign: "left", padding: "11px 14px", border: "1px solid rgba(241,238,230,.1)", borderRadius: 12, background: "rgba(241,238,230,.03)", color: "#C6C1B6", cursor: "pointer", font: `400 13.5px/1.5 ${SS}` }}>{c}</button>
            ))}
          </div>
        )}
      </div>

      <div style={{ flex: "none", padding: "13px 16px 16px", borderTop: "1px solid rgba(241,238,230,.08)", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <textarea value={input} onChange={(e) => onInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }} placeholder={focusName ? `Ask about “${focusName}”…` : "Ask the tutor…"} rows={2}
            style={{ flex: 1, padding: "11px 13px", borderRadius: 12, border: "1px solid rgba(241,238,230,.13)", background: "rgba(241,238,230,.05)", color: "#F1EEE6", font: `400 14px/1.55 ${SS}`, outline: "none", resize: "none" }} />
          <button onClick={() => onSend()} style={{ flex: "none", width: 40, height: 40, display: "grid", placeItems: "center", border: "none", borderRadius: 12, cursor: input.trim() && !busy ? "pointer" : "default", background: input.trim() && !busy ? "linear-gradient(96deg,#BFD9F2,#8FE3C0)" : "rgba(241,238,230,.06)", color: input.trim() && !busy ? "#0A1020" : "#4C5768", font: `400 15px/1 ${MN}` }}>↑</button>
        </div>
        <p style={{ margin: 0, font: `400 10.5px/1.5 ${MN}`, color: "#4C5768" }}>Enter to send · Shift+Enter for a new line · it reads the star you have open</p>
      </div>
    </aside>
  );
}

function SpaceView({ me, owned, used, streak, atlas, chartStats, chartsDone, onOpenGalaxy, onPickChart, onSelect, onRestored }: {
  me: CollectionSummary | null; owned: Set<string>; used: Set<string>; streak: number; atlas: AtlasModel;
  chartStats: { ch: AtlasChart; total: number; got: number; pct: number; done: boolean }[]; chartsDone: number;
  onOpenGalaxy: () => void; onPickChart: (id: string) => void; onSelect: (l: string) => void;
  onRestored: (m: CollectionSummary) => void;
}) {
  const totalXp = me?.totalXp ?? 0;
  const level = me?.level ?? 1;
  const nextLv = xpForLevel(level + 1);
  const held = Array.from(owned).reverse();
  const advCount = held.filter((l) => atlas.byLemma.get(l)?.tier === "advanced").length;

  // Frequency-band coverage: how much of each rarity tier you hold.
  const BANDS: [string, number, number][] = [
    ["Everyday (top 1k)", 1, 1000], ["Common (1k–2.5k)", 1001, 2500],
    ["Wider (2.5k–5k)", 2501, 5000], ["Advanced / rare", 5001, Infinity],
  ];
  const coverage = BANDS.map(([label, lo, hi]) => {
    let total = 0, got = 0;
    for (const w of atlas.data.words) {
      const rk = w.rank ?? (w.tier === "advanced" ? 9999 : 6000);
      if (rk < lo || rk > hi) continue;
      total++;
      if (owned.has(w.lemma)) got++;
    }
    return { label, total, got, pct: total ? Math.round((got / total) * 100) : 0 };
  }).filter((b) => b.total > 0);
  const badges: [string, string, boolean, string][] = [
    ["First Light", "✦", owned.size >= 1, "1 star"],
    ["Constellation", "◈", owned.size >= 25, "25 stars"],
    ["Collector", "◉", owned.size >= 100, "100 stars"],
    ["Rare Hunter", "◇", advCount >= 10, "10 advanced"],
    ["Chart Sealed", "▣", chartsDone >= 1, "finish a chart"],
    ["Seven Nights", "▲", streak >= 7, "7-day streak"],
  ];
  const stats: [string, string, string][] = [
    [String(owned.size), owned.size === 1 ? "star held" : "stars held", "#7ACBA9"],
    [String(used.size), "used in a sentence", "#BDFFE0"],
    [String(totalXp), "experience", "#F2D9A0"],
    [String(streak), "night streak", "#BFD9F2"],
  ];
  return (
    <main className="atlas-scroll" style={{ position: "absolute", top: 57, left: 0, right: 0, bottom: 0, zIndex: 2, overflowY: "auto", background: "radial-gradient(90% 60% at 50% 0%,#0C1327 0%,#070B16 70%)" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "44px 24px 80px", display: "flex", flexDirection: "column", gap: 40 }}>
        <section style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 26 }}>
          <div style={{ minWidth: 280 }}>
            <p style={{ margin: 0, font: `600 9.5px/1 ${MN}`, letterSpacing: ".24em", textTransform: "uppercase", color: "#6B7789" }}>Your space</p>
            <h1 style={{ margin: "12px 0 0", font: `400 46px/1.05 ${SF}`, letterSpacing: "-.015em", color: "#F1EEE6" }}>{owned.size ? `Level ${level}, ${plural(owned.size, "star", "stars")} held` : "An empty sky"}</h1>
            <p style={{ margin: "12px 0 0", font: `400 15px/1.65 ${SS}`, color: "#A9B2C0" }}>{owned.size ? `You are ${Math.max(0, nextLv - totalXp)} xp from level ${level + 1}. ${streak > 1 ? `${streak} nights in a row.` : streak === 1 ? "Your streak starts tonight — come back tomorrow to keep it." : "Come back tomorrow to start a streak."}` : "Claim your first star and this page fills in."}</p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {stats.map(([value, label, tone]) => (
              <div key={label} style={{ minWidth: 112, padding: "15px 17px", borderRadius: 15, background: "rgba(241,238,230,.04)", border: "1px solid rgba(241,238,230,.09)" }}>
                <p style={{ margin: 0, font: `400 30px/1 ${SF}`, color: tone }}>{value}</p>
                <p style={{ margin: "8px 0 0", font: `500 9.5px/1 ${MN}`, letterSpacing: ".14em", textTransform: "uppercase", color: "#6B7789" }}>{label}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
            <h2 style={{ margin: 0, font: `600 9.5px/1 ${MN}`, letterSpacing: ".18em", textTransform: "uppercase", color: "#6B7789" }}>Charts</h2>
            <span style={{ font: `500 11px/1 ${MN}`, color: "#94A0B4" }}>{chartsDone} sealed</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(228px,1fr))", gap: 11 }}>
            {chartStats.map(({ ch, total, got, pct, done }) => (
              <button key={ch.id} onClick={() => onPickChart(ch.id)} style={{ display: "flex", flexDirection: "column", gap: 11, padding: 17, border: `1px solid ${done ? "rgba(242,217,160,.26)" : "rgba(241,238,230,.08)"}`, borderRadius: 16, background: done ? "rgba(242,217,160,.05)" : "rgba(241,238,230,.03)", cursor: "pointer", textAlign: "left" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 8, font: `400 13px/1 ${MN}`, background: "rgba(241,238,230,.07)", color: ch.hue }}>{ch.glyph}</span>
                  <span style={{ flex: 1, font: `500 14px/1.2 ${SS}`, color: "#F1EEE6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ch.name}</span>
                  <span style={{ font: `500 11px/1 ${MN}`, color: done ? "#F2D9A0" : got ? "#8FE3C0" : "#6B7789" }}>{done ? "sealed" : `${got}/${total}`}</span>
                </span>
                <span style={{ display: "block", height: 3, borderRadius: 999, background: "rgba(241,238,230,.1)", overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", borderRadius: 999, background: ch.hue, width: `${pct}%` }} />
                </span>
                <span style={{ font: `400 12px/1.55 ${SS}`, color: "#94A0B4" }}>{ch.blurb}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 style={{ margin: "0 0 14px", font: `600 9.5px/1 ${MN}`, letterSpacing: ".18em", textTransform: "uppercase", color: "#6B7789" }}>Marks earned</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
            {badges.map(([label, glyph, earned, req]) => (
              <span key={label} style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 15px", border: `1px solid ${earned ? "rgba(242,217,160,.3)" : "rgba(241,238,230,.09)"}`, borderRadius: 999, background: earned ? "rgba(242,217,160,.09)" : "rgba(241,238,230,.03)" }}>
                <span style={{ font: `400 13px/1 ${MN}`, color: earned ? "#F2D9A0" : "#4C5768" }}>{glyph}</span>
                <span style={{ font: `500 12.5px/1 ${SS}`, color: earned ? "#F1EEE6" : "#6B7789" }}>{label}</span>
                <span style={{ font: `400 10.5px/1 ${MN}`, color: "#6B7789" }}>{earned ? "earned" : req}</span>
              </span>
            ))}
          </div>
        </section>

        <section>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
            <h2 style={{ margin: 0, font: `600 9.5px/1 ${MN}`, letterSpacing: ".18em", textTransform: "uppercase", color: "#6B7789" }}>Stars you hold</h2>
            <span style={{ font: `500 11px/1 ${MN}`, color: "#94A0B4" }}>{owned.size} of {atlas.data.words.length.toLocaleString()}</span>
          </div>
          {owned.size > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {held.map((l) => {
                const w = atlas.byLemma.get(l);
                return (
                  <button key={l} onClick={() => onSelect(l)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 13px", border: "1px solid rgba(143,227,192,.2)", borderRadius: 999, background: "rgba(143,227,192,.07)", cursor: "pointer" }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: atlas.chartById.get(w?.chart ?? "")?.hue ?? "#8FE3C0" }} />
                    <span style={{ font: `500 13px/1 ${SS}`, color: "#F1EEE6" }}>{w?.display ?? l}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: 34, borderRadius: 16, border: "1px dashed rgba(241,238,230,.14)", textAlign: "center" }}>
              <p style={{ margin: "0 0 16px", font: `400 15px/1.6 ${SS}`, color: "#94A0B4" }}>Nothing claimed yet. The sky is waiting.</p>
              <button onClick={onOpenGalaxy} style={{ padding: "11px 22px", border: "none", borderRadius: 11, cursor: "pointer", font: `600 13px/1 ${SS}`, background: "linear-gradient(96deg,#BFD9F2,#8FE3C0)", color: "#0A1020" }}>Open the sky</button>
            </div>
          )}
        </section>

        {/* Frequency coverage */}
        <section>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
            <h2 style={{ margin: 0, font: `600 9.5px/1 ${MN}`, letterSpacing: ".18em", textTransform: "uppercase", color: "#6B7789" }}>Coverage</h2>
            <span style={{ font: `500 11px/1 ${MN}`, color: "#94A0B4" }}>how much of each frequency band you hold</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {coverage.map((b) => (
              <div key={b.label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                  <span style={{ font: `500 12.5px/1 ${SS}`, color: "#E8E4DA" }}>{b.label}</span>
                  <span style={{ font: `500 11px/1 ${MN}`, color: b.got ? "#8FE3C0" : "#6B7789" }}>{b.got} / {b.total}</span>
                </div>
                <span style={{ display: "block", height: 5, borderRadius: 999, background: "rgba(241,238,230,.08)", overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", borderRadius: 999, background: "linear-gradient(90deg,#BFD9F2,#8FE3C0)", width: `${b.pct}%` }} />
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Space key */}
        <section style={{ paddingTop: 26, borderTop: "1px solid rgba(241,238,230,.08)" }}>
          <h2 style={{ margin: "0 0 14px", font: `600 9.5px/1 ${MN}`, letterSpacing: ".18em", textTransform: "uppercase", color: "#6B7789" }}>Space key</h2>
          <SpaceKeyCard heldCount={owned.size} onRestored={onRestored} />
        </section>
      </div>
    </main>
  );
}

function SpaceKeyCard({ heldCount, onRestored }: { heldCount: number; onRestored: (m: CollectionSummary) => void }) {
  const [key, setKey] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [restoreInput, setRestoreInput] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const reveal = () => {
    setRevealed((v) => !v);
    if (!key) fetch("/api/space").then((r) => (r.ok ? r.json() : null)).then((d: { key?: string } | null) => d?.key && setKey(d.key)).catch(() => {});
  };
  const copy = async () => {
    let k = key;
    if (!k) { const d = await fetch("/api/space").then((r) => (r.ok ? r.json() : null)).catch(() => null); k = d?.key ?? null; setKey(k); }
    if (!k) return;
    try { await navigator.clipboard.writeText(k); setCopied(true); setRevealed(true); setTimeout(() => setCopied(false), 1600); } catch { /* blocked */ }
  };
  const restore = () => {
    const k = restoreInput.trim();
    if (!k || busy) return;
    setBusy(true); setMsg(null);
    fetch("/api/space", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: k }) })
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
      .then(({ ok, d }) => {
        if (!ok || !d?.me) { setMsg({ text: d?.error || "That key doesn't match any space.", ok: false }); return; }
        onRestored(d.me);
        setRestoreInput("");
        setMsg({ text: `Restored ${d.me.lemmas.length} stars and ${d.me.totalXp} xp. This device now matches that space.`, ok: true });
      })
      .catch(() => setMsg({ text: "Couldn't reach the server to check that key.", ok: false }))
      .finally(() => setBusy(false));
  };

  const dots = "•".repeat(34);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 11 }}>
      <div style={{ padding: 17, borderRadius: 16, background: "rgba(241,238,230,.03)", border: "1px solid rgba(241,238,230,.09)" }}>
        <p style={{ margin: 0, font: `400 13px/1.65 ${SS}`, color: "#A9B2C0" }}>There is no login. This key <em>is</em> your space — it carries every star you hold. Save it to pick up on another device. Anyone holding it can open your space, so keep it private.</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 13 }}>
          <code style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "9px 11px", borderRadius: 9, background: "rgba(0,0,0,.35)", font: `400 11.5px/1.4 ${MN}`, color: "#BFD9F2" }}>{revealed ? (key ?? "…") : dots}</code>
          <button onClick={reveal} style={{ flex: "none", padding: "8px 11px", border: "1px solid rgba(241,238,230,.14)", borderRadius: 9, background: "none", color: "#94A0B4", cursor: "pointer", font: `500 11.5px/1 ${SS}` }}>{revealed ? "Hide" : "Reveal"}</button>
          <button onClick={copy} style={{ flex: "none", padding: "8px 13px", border: "none", borderRadius: 9, background: copied ? "#8FE3C0" : "#BFD9F2", color: "#0A1020", cursor: "pointer", font: `600 11.5px/1 ${SS}` }}>{copied ? "Copied ✓" : "Copy"}</button>
        </div>
        <p style={{ margin: "10px 0 0", font: `400 10.5px/1.5 ${MN}`, color: "#4C5768" }}>Holds {heldCount} {heldCount === 1 ? "star" : "stars"} · keep it somewhere safe</p>
      </div>

      <div style={{ padding: 17, borderRadius: 16, background: "rgba(241,238,230,.03)", border: "1px solid rgba(241,238,230,.09)" }}>
        <p style={{ margin: "0 0 11px", font: `400 13px/1.65 ${SS}`, color: "#A9B2C0" }}>Restore a space — paste a key from another device. This replaces what is on this one.</p>
        <textarea value={restoreInput} onChange={(e) => { setRestoreInput(e.target.value); setMsg(null); }} placeholder="paste your space key…" rows={2}
          style={{ width: "100%", padding: "11px 13px", borderRadius: 11, border: `1px solid ${msg && !msg.ok ? "rgba(232,168,159,.4)" : "rgba(241,238,230,.13)"}`, background: "rgba(241,238,230,.05)", color: "#F1EEE6", font: `400 12px/1.5 ${MN}`, outline: "none", resize: "vertical" }} />
        <button onClick={restore} style={{ width: "100%", marginTop: 10, padding: 10, border: "none", borderRadius: 10, cursor: restoreInput.trim() && !busy ? "pointer" : "default", font: `600 12.5px/1 ${SS}`, background: restoreInput.trim() && !busy ? "rgba(191,217,242,.16)" : "rgba(241,238,230,.05)", color: restoreInput.trim() && !busy ? "#BFD9F2" : "#4C5768" }}>{busy ? "Checking…" : "Restore this space"}</button>
        {msg && <p style={{ margin: "11px 0 0", padding: "10px 13px", borderRadius: 10, background: msg.ok ? "rgba(143,227,192,.08)" : "rgba(232,168,159,.07)", border: `1px solid ${msg.ok ? "rgba(143,227,192,.24)" : "rgba(232,168,159,.22)"}`, font: `400 12.5px/1.6 ${SS}`, color: msg.ok ? "#8FE3C0" : "#E8A89F" }}>{msg.text}</p>}
      </div>
    </div>
  );
}

function BoardView({ rows }: { rows: { rank: number; name: string; detail: string; level: number; xp: string; you: boolean }[] }) {
  return (
    <main className="atlas-scroll" style={{ position: "absolute", top: 57, left: 0, right: 0, bottom: 0, zIndex: 2, overflowY: "auto", background: "radial-gradient(90% 60% at 50% 0%,#0C1327 0%,#070B16 70%)" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "44px 24px 80px" }}>
        <p style={{ margin: 0, font: `600 9.5px/1 ${MN}`, letterSpacing: ".24em", textTransform: "uppercase", color: "#6B7789" }}>Observatory log</p>
        <h1 style={{ margin: "12px 0 0", font: `400 46px/1.05 ${SF}`, letterSpacing: "-.015em", color: "#F1EEE6" }}>Who has charted the most sky</h1>
        <p style={{ margin: "12px 0 32px", font: `400 15px/1.65 ${SS}`, color: "#A9B2C0" }}>Ranked by experience, which favours rare and advanced words over easy ones.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {rows.map((b) => (
            <div key={b.rank} style={{ display: "flex", alignItems: "center", gap: 15, padding: "14px 17px", border: `1px solid ${b.you ? "rgba(191,217,242,.3)" : "rgba(241,238,230,.07)"}`, borderRadius: 14, background: b.you ? "rgba(191,217,242,.09)" : "rgba(241,238,230,.03)" }}>
              <span style={{ width: 26, flex: "none", font: `400 17px/1 ${SF}`, color: b.you ? "#BFD9F2" : "#6B7789" }}>{b.rank}</span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ font: `500 14.5px/1 ${SS}`, color: "#F1EEE6" }}>{b.name}</span>
                <span style={{ font: `400 11.5px/1 ${MN}`, color: "#6B7789" }}>{b.detail}</span>
              </span>
              <span style={{ flex: "none", display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 999, background: "rgba(191,217,242,.1)", font: `500 12px/1 ${MN}`, color: "#BFD9F2" }}>{b.level}</span>
              <span style={{ flex: "none", width: 74, textAlign: "right", font: `500 13.5px/1 ${MN}`, color: "#F2D9A0" }}>{b.xp}</span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
