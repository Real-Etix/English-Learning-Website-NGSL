"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Write a short story using academic vocabulary",
  "Quiz me on 5 business words",
  "What's an advanced word for “happy”?",
];

/** Minimal **bold** rendering so the tutor's highlighted words stand out. */
function renderContent(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-sky-700">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function AiChat() {
  const pathname = usePathname();
  const listSlug = pathname?.match(/^\/network\/([a-z]+)/)?.[1] ?? "ngsl";

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || loading) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, listSlug }),
      });
      const data = await res.json();
      setMessages((m) => [
        ...m,
        { role: "assistant", content: res.ok ? data.reply : data.error ?? "Something went wrong." },
      ]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Network error — please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Launcher */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close assistant" : "Open assistant"}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-cyan-500 text-2xl text-white shadow-lg transition hover:bg-cyan-600"
      >
        {open ? "✕" : "✨"}
      </button>

      {open && (
        <div className="fixed bottom-24 right-5 z-50 flex h-[70vh] max-h-[600px] w-[min(92vw,400px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">Vocabulary Assistant</div>
            <div className="text-xs text-slate-500">Ask for practice, stories, or word help</div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-slate-500">Try one of these:</p>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-sky-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-6 ${
                  m.role === "user"
                    ? "ml-auto bg-cyan-500 text-white"
                    : "mr-auto whitespace-pre-wrap bg-slate-100 text-slate-800"
                }`}
              >
                {m.role === "assistant" ? renderContent(m.content) : m.content}
              </div>
            ))}
            {loading && (
              <div className="mr-auto rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate-500">
                Thinking…
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-end gap-2 border-t border-slate-100 p-3"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              placeholder="Ask anything about vocabulary…"
              className="max-h-28 flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-cyan-400"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-600 disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
