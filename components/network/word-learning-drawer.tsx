import { useId, useState, type KeyboardEvent } from "react";

import type { LearningSource, WordLearningProfile } from "@/lib/content/word-learning";
import { buildWordLearningDrawerModel } from "./word-learning-drawer-model";

const SF = "var(--font-atlas-serif), Georgia, serif";
const SS = "var(--font-atlas-sans), system-ui, sans-serif";
const MN = "var(--font-atlas-mono), ui-monospace, monospace";

const CONNECTION_TONES: Record<string, string> = {
  synonym: "#8FE3C0",
  antonym: "#E8A89F",
  intensity: "#F2D9A0",
  collocation: "#94A0B4",
  builds_on: "#CBB9E9",
  advanced_form: "#CBB9E9",
  morphological: "#9FC4E8",
};
const CONNECTION_MARKS: Record<string, string> = {
  advanced_form: "↑",
  builds_on: "↓",
  synonym: "=",
  antonym: "≠",
  intensity: "±",
  collocation: "+",
  morphological: "~",
};

type Tab = "meaning" | "use" | "connect";
type AudioRegion = "uk" | "us" | "any";

export type WordLearningTab = Tab;

export function tabNavigationForKey(
  current: WordLearningTab,
  key: string,
  tabsId: string,
): { next: WordLearningTab; focusId: string } | null {
  const tabs: WordLearningTab[] = ["meaning", "use", "connect"];
  const index = tabs.indexOf(current);
  let nextIndex: number | null = null;
  if (key === "ArrowRight" || key === "ArrowDown") nextIndex = (index + 1) % tabs.length;
  if (key === "ArrowLeft" || key === "ArrowUp") nextIndex = (index - 1 + tabs.length) % tabs.length;
  if (key === "Home") nextIndex = 0;
  if (key === "End") nextIndex = tabs.length - 1;
  if (nextIndex === null) return null;
  const next = tabs[nextIndex];
  return { next, focusId: `${tabsId}-${next}` };
}

export type WordLearningTabKeyEvent = {
  key: string;
  preventDefault: () => void;
};

export function handleWordLearningTabKey(
  event: WordLearningTabKeyEvent,
  current: WordLearningTab,
  tabsId: string,
  setTab: (tab: WordLearningTab) => void,
  focusTab: (focusId: string) => void,
): boolean {
  const navigation = tabNavigationForKey(current, event.key, tabsId);
  if (!navigation) return false;
  event.preventDefault();
  setTab(navigation.next);
  focusTab(navigation.focusId);
  return true;
}

type WordLearningDrawerProps = {
  profile: WordLearningProfile | null;
  display: string;
  partOfSpeech: string | null;
  loadState: "loading" | "ready" | "error";
  errorMessage: string | null;
  chart: { name: string; hue: string; glyph: string };
  held: boolean;
  solid: boolean;
  xp: number | null;
  rarity: { word: string; dot: string; text: string };
  onClose: () => void;
  onRetry: () => void;
  onNavigate: (lemma: string) => void;
  selectedSenseId: string | null;
  onSelectSense: (senseId: string) => void;
  onOpenQuiz: () => void;
  onCompose: () => void;
  onSpeak: () => void;
  onPlayAudio: (region: AudioRegion) => void;
  displayConnection: (lemma: string) => string;
};

const buttonStyle = {
  minHeight: 44,
  borderRadius: 12,
  cursor: "pointer",
} as const;

function sourceLabel(source: "wiki" | "dictionaryapi") {
  return source === "dictionaryapi" ? "Free Dictionary" : "Wiki";
}

function connectionButtonStyle(type: string, held: boolean) {
  const advanced = type === "advanced_form";
  return {
    ...buttonStyle,
    alignSelf: "flex-start",
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "7px 11px",
    border: `1px solid ${held ? "rgba(143,227,192,.3)" : advanced ? "rgba(203,185,233,.32)" : "rgba(241,238,230,.12)"}`,
    background: held ? "rgba(143,227,192,.09)" : advanced ? "rgba(203,185,233,.1)" : "rgba(241,238,230,.04)",
    color: held ? "#8FE3C0" : advanced ? "#CBB9E9" : "#F1EEE6",
    font: `500 13px/1 ${SS}`,
  } as const;
}

export function WordLearningDrawer({
  profile,
  display,
  partOfSpeech,
  loadState,
  errorMessage,
  chart,
  held,
  solid,
  xp,
  rarity,
  onClose,
  onRetry,
  onNavigate,
  selectedSenseId,
  onSelectSense,
  onOpenQuiz,
  onCompose,
  onSpeak,
  onPlayAudio,
  displayConnection,
}: WordLearningDrawerProps) {
  const [tab, setTab] = useState<Tab>("meaning");
  const tabsId = useId();
  const model = profile ? buildWordLearningDrawerModel(profile) : null;
  const selectedSense = profile?.senses.find((sense) => sense.id === selectedSenseId)
    ?? model?.primarySense
    ?? null;
  const selectedSenseCanClaim = selectedSense?.canClaim ?? profile?.canClaim ?? false;
  const selectedSenseBlockReason = selectedSense?.claimBlockReason ?? profile?.claimBlockReason ?? null;
  const selectedExamples = selectedSense?.example
    ? [{ text: selectedSense.example, source: selectedSense.source }]
    : [];
  const tabs: { id: Tab; label: string }[] = [
    { id: "meaning", label: "Meaning" },
    { id: "use", label: "Use" },
    { id: "connect", label: "Connect" },
  ];

  function handleTabKeys(event: KeyboardEvent<HTMLButtonElement>, current: Tab) {
    handleWordLearningTabKey(
      event,
      current,
      tabsId,
      setTab,
      (focusId) => document.getElementById(focusId)?.focus(),
    );
  }

  return (
    <aside aria-label="Word learning drawer" style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "min(100vw, 420px)", pointerEvents: "auto", display: "flex", flexDirection: "column", background: "rgba(9,13,25,.94)", borderLeft: "1px solid rgba(241,238,230,.1)", backdropFilter: "blur(22px)", boxShadow: "-24px 0 60px rgba(0,0,0,.45)", animation: "slideIn .26s cubic-bezier(.2,.8,.2,1) both", zIndex: 35 }}>
      <style>{`.word-learning-drawer-focus:focus-visible { outline: 2px solid #BFD9F2; outline-offset: 2px; }`}</style>
      {profile && model ? (
        <>
          <header style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "18px 18px 14px", borderBottom: "1px solid rgba(241,238,230,.08)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ display: "grid", placeItems: "center", width: 20, height: 20, borderRadius: 6, font: `400 10px/1 ${MN}`, background: "rgba(241,238,230,.07)", color: chart.hue }}>{chart.glyph}</span>
                <span style={{ font: `500 9.5px/1 ${MN}`, letterSpacing: ".16em", textTransform: "uppercase", color: chart.hue }}>{chart.name}</span>
              </div>
              <h2 style={{ margin: "9px 0 0", font: `400 38px/1.02 ${SF}`, letterSpacing: "-.01em", color: "#F1EEE6" }}>{profile.display}</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                {profile.pronunciation.ipa && <span style={{ font: `400 12px/1 ${MN}`, color: "#BFD9F2" }}>{profile.pronunciation.ipa}</span>}
                <span style={{ padding: "3px 8px", borderRadius: 999, border: "1px solid rgba(241,238,230,.12)", font: `400 10.5px/1 ${MN}`, color: "#94A0B4" }}>{profile.partOfSpeech}</span>
                <span style={{ padding: "3px 8px", borderRadius: 999, background: profile.evidence === "ai-draft" ? "rgba(232,168,159,.13)" : "rgba(143,227,192,.11)", font: `500 10px/1 ${MN}`, letterSpacing: ".08em", textTransform: "uppercase", color: profile.evidence === "ai-draft" ? "#E8A89F" : "#8FE3C0" }}>{profile.evidenceLabel}</span>
                {profile.tier === "advanced" && <span style={{ padding: "3px 8px", borderRadius: 999, background: "rgba(203,185,233,.16)", font: `500 10px/1 ${MN}`, letterSpacing: ".08em", textTransform: "uppercase", color: "#CBB9E9" }}>advanced</span>}
              </div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 10 }}>
                {model.audio.uk && <button className="word-learning-drawer-focus" type="button" onClick={() => onPlayAudio("uk")} style={{ ...buttonStyle, minHeight: 32, padding: "4px 9px", border: "1px solid rgba(241,238,230,.12)", background: "rgba(241,238,230,.04)", color: "#BFD9F2", font: `400 11px/1 ${SS}` }}>◂)) UK</button>}
                {model.audio.us && <button className="word-learning-drawer-focus" type="button" onClick={() => onPlayAudio("us")} style={{ ...buttonStyle, minHeight: 32, padding: "4px 9px", border: "1px solid rgba(241,238,230,.12)", background: "rgba(241,238,230,.04)", color: "#BFD9F2", font: `400 11px/1 ${SS}` }}>◂)) US</button>}
                {!model.audio.uk && !model.audio.us && model.audio.any && <button className="word-learning-drawer-focus" type="button" onClick={() => onPlayAudio("any")} style={{ ...buttonStyle, minHeight: 32, padding: "4px 9px", border: "1px solid rgba(241,238,230,.12)", background: "rgba(241,238,230,.04)", color: "#BFD9F2", font: `400 11px/1 ${SS}` }}>◂)) audio</button>}
                {!model.audio.available && <button className="word-learning-drawer-focus" type="button" onClick={onSpeak} style={{ ...buttonStyle, minHeight: 32, padding: "4px 9px", border: "1px solid rgba(241,238,230,.12)", background: "rgba(241,238,230,.04)", color: "#BFD9F2", font: `400 11px/1 ${SS}` }}>◂)) say it</button>}
              </div>
            </div>
            <button className="word-learning-drawer-focus" type="button" onClick={onClose} aria-label="Close word learning drawer" style={{ ...buttonStyle, flex: "none", width: 44, height: 44, display: "grid", placeItems: "center", border: "1px solid rgba(241,238,230,.1)", background: "none", color: "#94A0B4", fontSize: 13 }}>✕</button>
          </header>

          <div role="tablist" aria-label="Word learning sections" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, padding: "10px 18px", borderBottom: "1px solid rgba(241,238,230,.08)" }}>
            {tabs.map((item) => {
              const selected = item.id === tab;
              return <button key={item.id} id={`${tabsId}-${item.id}`} className="word-learning-drawer-focus" type="button" role="tab" aria-selected={selected} aria-controls={`${tabsId}-${item.id}-panel`} tabIndex={selected ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={(event) => handleTabKeys(event, item.id)} style={{ ...buttonStyle, padding: "8px 6px", border: `1px solid ${selected ? "rgba(191,217,242,.4)" : "rgba(241,238,230,.1)"}`, background: selected ? "rgba(191,217,242,.12)" : "rgba(241,238,230,.03)", color: selected ? "#F1EEE6" : "#94A0B4", font: `600 12px/1 ${SS}` }}>{item.label}</button>;
            })}
          </div>

          {tabs.map((item) => {
            const selected = item.id === tab;
            return <div key={item.id} id={`${tabsId}-${item.id}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${item.id}`} hidden={!selected} aria-hidden={!selected} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 18px 22px", display: "flex", flexDirection: "column", gap: 18 }}>
            {item.id === "meaning" && (
              <>
                {profile.evidence === "ai-draft" && <p style={{ margin: 0, padding: "11px 13px", borderRadius: 10, border: "1px solid rgba(232,168,159,.25)", background: "rgba(232,168,159,.07)", font: `400 12px/1.55 ${SS}`, color: "#E8A89F" }}>This meaning is an AI draft, not a sourced dictionary meaning.</p>}
                {model.primarySense ? <Sense sense={model.primarySense} primary selected={selectedSense?.id === model.primarySense.id} onSelect={onSelectSense} /> : <EmptyState>There is no meaning available for this word yet.</EmptyState>}
                {model.otherSenses.length > 0 && <section aria-label="Additional meanings" style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                  <h3 style={{ margin: 0, font: `600 9.5px/1 ${MN}`, letterSpacing: ".18em", textTransform: "uppercase", color: "#94A0B4" }}>Other meanings</h3>
                  {model.otherSenses.map((sense) => <Sense key={sense.id} sense={sense} selected={selectedSense?.id === sense.id} onSelect={onSelectSense} />)}
                </section>}
              </>
            )}

            {item.id === "use" && (
              <>
                {selectedExamples.length > 0 ? <section aria-label="Examples" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <h3 style={{ margin: 0, font: `600 9.5px/1 ${MN}`, letterSpacing: ".18em", textTransform: "uppercase", color: "#94A0B4" }}>Examples</h3>
                  {selectedExamples.map((example, index) => <blockquote key={`${example.text}-${index}`} style={{ margin: 0, padding: "13px 15px", borderLeft: "2px solid rgba(191,217,242,.4)", background: "rgba(191,217,242,.05)", borderRadius: "0 10px 10px 0" }}><p style={{ margin: 0, font: `italic 400 15px/1.65 ${SF}`, color: "#D8D3C8" }}>{example.text}</p><footer style={{ marginTop: 8, font: `500 9.5px/1 ${MN}`, letterSpacing: ".12em", textTransform: "uppercase", color: "#6B7789" }}>{sourceLabel(example.source)}</footer></blockquote>)}
                </section> : <EmptyState>Usage examples have not been authored for this word yet.</EmptyState>}
                <UsageSection title="Patterns" label="Usage patterns" items={model.usage.patterns} empty="No reviewed usage patterns yet.">
                  {model.usage.patterns.map((pattern, index) => <section key={`${pattern.pattern}-${index}`} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 13px", borderRadius: 10, background: "rgba(241,238,230,.04)" }}>
                    <p style={{ margin: 0, font: `600 14px/1.45 ${SS}`, color: "#E8E4DA" }}>{pattern.pattern}</p>
                    <p style={{ margin: 0, font: `400 13px/1.6 ${SS}`, color: "#D8D3C8" }}>{pattern.explanation}</p>
                    {pattern.examples.map((example, exampleIndex) => <div key={`${example.text}-${exampleIndex}`} style={{ display: "flex", flexDirection: "column", gap: 5 }}><p style={{ margin: 0, font: `italic 400 13px/1.6 ${SF}`, color: "#D8D3C8" }}>{example.text}</p>{example.sources.length > 0 && <SourceAttribution sources={example.sources} />}</div>)}
                    <SourceAttribution sources={pattern.sources} />
                  </section>)}
                </UsageSection>
                <UsageSection title="Common phrases" label="Collocation phrases" items={model.usage.collocations} empty="No reviewed collocation phrases yet.">
                  {model.usage.collocations.map((collocation, index) => <section key={`${collocation.phrase}-${index}`} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 13px", borderRadius: 10, background: "rgba(241,238,230,.04)" }}><p style={{ margin: 0, font: `600 14px/1.45 ${SS}`, color: "#E8E4DA" }}>{collocation.phrase}</p>{collocation.explanation && <p style={{ margin: 0, font: `400 13px/1.6 ${SS}`, color: "#D8D3C8" }}>{collocation.explanation}</p>}<SourceAttribution sources={collocation.sources} /></section>)}
                </UsageSection>
                <UsageSection title="Watch out" label="Common mistakes" items={model.usage.commonMistakes} empty="No reviewed common mistakes yet.">
                  {model.usage.commonMistakes.map((mistake, index) => <section key={`${mistake.incorrect}-${index}`} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 13px", borderRadius: 10, background: "rgba(232,168,159,.06)" }}><p style={{ margin: 0, font: `400 13px/1.6 ${SS}`, color: "#E8A89F" }}>{mistake.incorrect}</p><p style={{ margin: 0, font: `600 13px/1.6 ${SS}`, color: "#8FE3C0" }}>{mistake.correction}</p><p style={{ margin: 0, font: `400 13px/1.6 ${SS}`, color: "#D8D3C8" }}>{mistake.explanation}</p><SourceAttribution sources={mistake.sources} /></section>)}
                </UsageSection>
                {profile.forms.length > 0 && <section aria-label="Forms"><h3 style={{ margin: "0 0 9px", font: `600 9.5px/1 ${MN}`, letterSpacing: ".18em", textTransform: "uppercase", color: "#94A0B4" }}>Forms</h3><div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>{profile.forms.map((form) => <span key={form} style={{ padding: "6px 9px", borderRadius: 999, border: "1px solid rgba(241,238,230,.12)", background: "rgba(241,238,230,.04)", font: `400 12px/1 ${SS}`, color: "#D8D3C8" }}>{form}</span>)}</div></section>}
                {profile.usageNote && <section aria-label="Usage note"><h3 style={{ margin: "0 0 9px", font: `600 9.5px/1 ${MN}`, letterSpacing: ".18em", textTransform: "uppercase", color: "#94A0B4" }}>Usage note</h3><p style={{ margin: 0, font: `400 14px/1.6 ${SS}`, color: "#D8D3C8" }}>{profile.usageNote}</p></section>}
                {held && <button className="word-learning-drawer-focus" type="button" onClick={onCompose} style={{ ...buttonStyle, width: "100%", padding: 12, border: `1px solid ${solid ? "rgba(143,227,192,.3)" : "rgba(203,185,233,.32)"}`, background: solid ? "rgba(143,227,192,.12)" : "rgba(203,185,233,.14)", color: solid ? "#8FE3C0" : "#CBB9E9", font: `600 13px/1 ${SS}` }}>{solid ? "◆ Used in a sentence" : "✎ Use it in a sentence"}</button>}
              </>
            )}

            {item.id === "connect" && (
              <>
                {model.explainedGroups.length > 0 ? model.explainedGroups.map((group) => <section key={group.type}><ConnectionHeading group={group} /><div style={{ display: "flex", flexDirection: "column", gap: 9 }}>{group.items.map((connection, index) => <div key={`${connection.target}-${index}`} style={{ display: "flex", flexDirection: "column", gap: 4 }}><button className="word-learning-drawer-focus" type="button" onClick={() => onNavigate(connection.target)} style={connectionButtonStyle(connection.type, false)}><span>{displayConnection(connection.target)}</span><span style={{ font: `400 10px/1 ${MN}`, opacity: .65 }}>{CONNECTION_MARKS[connection.type] ?? "·"}</span></button><p style={{ margin: 0, paddingLeft: 2, font: `400 12px/1.6 ${SS}`, color: "#94A0B4" }}>{connection.gloss}</p></div>)}</div></section>) : <EmptyState>No explained connections have been authored for this word yet.</EmptyState>}
                {model.unreviewedCount > 0 && <details style={{ paddingTop: 2 }}><summary className="word-learning-drawer-focus" style={{ ...buttonStyle, display: "flex", alignItems: "center", color: "#94A0B4", font: `500 12px/1 ${SS}` }}>Unreviewed map links ({model.unreviewedCount})</summary><div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 11 }}>{model.unreviewedGroups.flatMap((group) => group.items.map((connection, index) => <button key={`${group.type}-${connection.target}-${index}`} className="word-learning-drawer-focus" type="button" onClick={() => onNavigate(connection.target)} style={connectionButtonStyle(connection.type, false)}><span>{displayConnection(connection.target)}</span><span style={{ font: `400 10px/1 ${MN}`, opacity: .65 }}>{CONNECTION_MARKS[connection.type] ?? "·"}</span></button>))}</div></details>}
              </>
            )}

            <div style={{ marginTop: "auto", paddingTop: 14, borderTop: "1px solid rgba(241,238,230,.08)", display: "flex", flexDirection: "column", gap: 9 }}>
              <button className="word-learning-drawer-focus" type="button" onClick={onOpenQuiz} disabled={held || !selectedSenseCanClaim} style={{ ...buttonStyle, width: "100%", padding: 12, border: `1px solid ${held ? "rgba(143,227,192,.28)" : !selectedSenseCanClaim ? "rgba(232,168,159,.28)" : "transparent"}`, cursor: held || !selectedSenseCanClaim ? "default" : "pointer", background: held ? "rgba(143,227,192,.1)" : !selectedSenseCanClaim ? "rgba(232,168,159,.08)" : "linear-gradient(96deg,#BFD9F2,#8FE3C0)", color: held ? "#8FE3C0" : !selectedSenseCanClaim ? "#E8A89F" : "#0A1020", font: `600 13px/1 ${SS}` }}>{held ? "✓ Held — this star is yours" : "Check what you know, then claim it"}</button>
              {!held && !selectedSenseCanClaim && selectedSenseBlockReason && <p style={{ margin: 0, font: `400 11.5px/1.55 ${SS}`, color: "#E8A89F" }}>{selectedSenseBlockReason}</p>}
              <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", fontSize: 11.5, color: "#6B7789" }}><span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: rarity.dot }} /><span style={{ color: rarity.dot, fontWeight: 500 }}>{rarity.word}</span><span>{rarity.text}</span></span>{xp !== null && <span style={{ font: `500 10.5px/1 ${MN}`, color: "#F2D9A0" }}>+{xp} xp</span>}</div>
            </div>
            </div>;
          })}
        </>
      ) : <UnavailableDrawer display={display} partOfSpeech={partOfSpeech} loadState={loadState} errorMessage={errorMessage} chart={chart} held={held} solid={solid} xp={xp} rarity={rarity} onClose={onClose} onRetry={onRetry} onCompose={onCompose} />}
    </aside>
  );
}

function UnavailableDrawer({
  display,
  partOfSpeech,
  loadState,
  errorMessage,
  chart,
  held,
  solid,
  xp,
  rarity,
  onClose,
  onRetry,
  onCompose,
}: Pick<WordLearningDrawerProps, "display" | "partOfSpeech" | "loadState" | "errorMessage" | "chart" | "held" | "solid" | "xp" | "rarity" | "onClose" | "onRetry" | "onCompose">) {
  const failed = loadState === "error";
  return <>
    <header style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "18px 18px 14px", borderBottom: "1px solid rgba(241,238,230,.08)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ display: "grid", placeItems: "center", width: 20, height: 20, borderRadius: 6, font: `400 10px/1 ${MN}`, background: "rgba(241,238,230,.07)", color: chart.hue }}>{chart.glyph}</span>
          <span style={{ font: `500 9.5px/1 ${MN}`, letterSpacing: ".16em", textTransform: "uppercase", color: chart.hue }}>{chart.name}</span>
        </div>
        <h2 style={{ margin: "9px 0 0", font: `400 38px/1.02 ${SF}`, letterSpacing: "-.01em", color: "#F1EEE6" }}>{display}</h2>
        {partOfSpeech && <div style={{ marginTop: 8 }}><span style={{ padding: "3px 8px", borderRadius: 999, border: "1px solid rgba(241,238,230,.12)", font: `400 10.5px/1 ${MN}`, color: "#94A0B4" }}>{partOfSpeech}</span></div>}
      </div>
      <button className="word-learning-drawer-focus" type="button" onClick={onClose} aria-label="Close word learning drawer" style={{ ...buttonStyle, flex: "none", width: 44, height: 44, display: "grid", placeItems: "center", border: "1px solid rgba(241,238,230,.1)", background: "none", color: "#94A0B4", fontSize: 13 }}>✕</button>
    </header>
    <div aria-live="polite" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "22px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
      <EmptyState>{failed ? errorMessage ?? "Learning details could not be loaded for this star." : "Reading this star’s learning details…"}</EmptyState>
      {failed && <button className="word-learning-drawer-focus" type="button" onClick={onRetry} style={{ ...buttonStyle, alignSelf: "flex-start", padding: "9px 13px", border: "1px solid rgba(191,217,242,.34)", background: "rgba(191,217,242,.1)", color: "#BFD9F2", font: `600 12px/1 ${SS}` }}>Retry learning details</button>}
      <div style={{ marginTop: "auto", paddingTop: 14, borderTop: "1px solid rgba(241,238,230,.08)", display: "flex", flexDirection: "column", gap: 9 }}>
        {held && <button className="word-learning-drawer-focus" type="button" onClick={onCompose} style={{ ...buttonStyle, width: "100%", padding: 12, border: `1px solid ${solid ? "rgba(143,227,192,.3)" : "rgba(203,185,233,.32)"}`, background: solid ? "rgba(143,227,192,.12)" : "rgba(203,185,233,.14)", color: solid ? "#8FE3C0" : "#CBB9E9", font: `600 13px/1 ${SS}` }}>{solid ? "◆ Used in a sentence" : "✎ Use it in a sentence"}</button>}
        {!held && <button type="button" disabled style={{ ...buttonStyle, width: "100%", padding: 12, border: "1px solid rgba(232,168,159,.22)", background: "rgba(232,168,159,.06)", color: "#E8A89F", cursor: "default", font: `600 13px/1 ${SS}` }}>Learning details are needed to claim this star</button>}
        <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", fontSize: 11.5, color: "#6B7789" }}><span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: rarity.dot }} /><span style={{ color: rarity.dot, fontWeight: 500 }}>{rarity.word}</span><span>{rarity.text}</span></span>{xp !== null && <span style={{ font: `500 10.5px/1 ${MN}`, color: "#F2D9A0" }}>+{xp} xp</span>}</div>
      </div>
    </div>
  </>;
}

function Sense({ sense, primary = false, selected, onSelect }: { sense: WordLearningProfile["senses"][number]; primary?: boolean; selected: boolean; onSelect: (senseId: string) => void }) {
  return <button className="word-learning-drawer-focus" type="button" data-sense-id={sense.id} aria-pressed={selected} onClick={() => onSelect(sense.id)} style={{ ...buttonStyle, display: "flex", flexDirection: "column", gap: 8, padding: 11, textAlign: "left", border: `1px solid ${selected ? "rgba(191,217,242,.45)" : "rgba(241,238,230,.1)"}`, background: selected ? "rgba(191,217,242,.09)" : "rgba(241,238,230,.025)", color: "inherit" }}><div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}><span style={{ font: `600 9.5px/1 ${MN}`, letterSpacing: ".18em", textTransform: "uppercase", color: primary ? "#BFD9F2" : "#94A0B4" }}>{primary ? "Primary meaning" : sense.partOfSpeech}</span>{primary && <span style={{ font: `400 10px/1 ${MN}`, color: "#94A0B4" }}>{sense.partOfSpeech}</span>}<span style={{ padding: "3px 7px", borderRadius: 999, background: "rgba(241,238,230,.06)", font: `400 9.5px/1 ${MN}`, color: "#94A0B4" }}>{sourceLabel(sense.source)}</span></div><span style={{ font: `400 ${primary ? "16.5px" : "15px"}/1.62 ${SS}`, color: "#E8E4DA" }}>{sense.definition}</span>{sense.example && <span style={{ font: `italic 400 14px/1.6 ${SF}`, color: "#D8D3C8" }}>{sense.example}</span>}</button>;
}

function ConnectionHeading({ group }: { group: { label: string; type: string } }) {
  return <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 9 }}><h3 style={{ margin: 0, font: `600 9.5px/1 ${MN}`, letterSpacing: ".18em", textTransform: "uppercase", color: CONNECTION_TONES[group.type] ?? "#94A0B4" }}>{group.label}</h3><span style={{ flex: 1, height: 1, background: "rgba(241,238,230,.08)" }} /></div>;
}

function EmptyState({ children }: { children: string }) {
  return <p style={{ margin: 0, padding: "13px 15px", border: "1px dashed rgba(241,238,230,.16)", borderRadius: 12, font: `400 13px/1.6 ${SS}`, color: "#94A0B4" }}>{children}</p>;
}

function UsageSection({
  title,
  label,
  items,
  empty,
  children,
}: {
  title: string;
  label: string;
  items: readonly unknown[];
  empty: string;
  children: React.ReactNode;
}) {
  return <section aria-label={label} style={{ display: "flex", flexDirection: "column", gap: 10 }}><h3 style={{ margin: 0, font: `600 9.5px/1 ${MN}`, letterSpacing: ".18em", textTransform: "uppercase", color: "#94A0B4" }}>{title}</h3>{items.length > 0 ? children : <EmptyState>{empty}</EmptyState>}</section>;
}

function SourceAttribution({ sources }: { sources: LearningSource[] }) {
  return <p style={{ margin: 0, font: `500 9.5px/1.4 ${MN}`, letterSpacing: ".1em", textTransform: "uppercase", color: "#6B7789" }}>Source: {sources.map((source) => source.label).join(", ")}</p>;
}
