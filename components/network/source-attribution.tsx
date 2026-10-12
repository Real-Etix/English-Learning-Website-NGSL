import type { LearningSource } from "../../lib/content/word-learning";

function safeLink(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : undefined; }
  catch { return undefined; }
}

export function SourceAttribution({ sources, label = "Source" }: { sources: LearningSource[]; label?: string }) {
  if (!sources.length) return null;
  const unique = [...new Map(sources.map(s => [JSON.stringify([s.sourceId, s.url, s.attribution, s.license]), s])).values()];
  return <div style={{ font: "400 10px/1.6 var(--font-atlas-sans), system-ui, sans-serif", color: "#94A0B4", overflowWrap: "anywhere" }}>
    {label}: {unique.map((source, index) => <span key={index}>
      {index > 0 ? "; " : ""}
      <a href={safeLink(source.url)} target="_blank" rel="noopener noreferrer" style={{ color: "#BFD9F2", textDecoration: "underline" }}>{source.label}</a>
      {source.attribution ? ` · ${source.attribution}` : ""}
      {source.license ? <> · <a href={safeLink(source.licenseUrl)} target="_blank" rel="noopener noreferrer" style={{ color: "#BFD9F2", textDecoration: "underline" }}>{source.license}</a></> : null}
    </span>)}
  </div>;
}
