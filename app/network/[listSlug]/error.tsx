"use client";

export default function NetworkError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", padding: 24, background: "#070B16", color: "#F1EEE6", fontFamily: "system-ui, sans-serif" }}>
      <section role="alert" style={{ width: "min(100%,460px)", padding: 28, border: "1px solid rgba(241,238,230,.12)", borderRadius: 18, background: "#0B101F", textAlign: "center" }}>
        <p style={{ margin: 0, color: "#E8A89F", fontSize: 13, letterSpacing: ".12em", textTransform: "uppercase" }}>Star Atlas unavailable</p>
        <h1 style={{ margin: "12px 0 0", fontSize: 30, fontWeight: 500 }}>The constellations could not be charted.</h1>
        <p style={{ margin: "12px 0 20px", color: "#94A0B4", lineHeight: 1.6 }}>Try loading this vocabulary sky again.</p>
        <button onClick={reset} style={{ padding: "11px 20px", border: 0, borderRadius: 10, background: "#BFD9F2", color: "#0A1020", cursor: "pointer", fontWeight: 700 }}>Retry</button>
      </section>
    </main>
  );
}
