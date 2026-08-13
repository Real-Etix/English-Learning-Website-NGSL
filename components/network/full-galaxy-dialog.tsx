"use client";

import { useEffect, useRef } from "react";

import type { FullModeState } from "./galaxy/full-mode-state";

const SF = "var(--font-atlas-serif), Georgia, serif";
const SS = "var(--font-atlas-sans), system-ui, sans-serif";
const MN = "var(--font-atlas-mono), ui-monospace, monospace";

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.ceil(bytes / 1_000)} KB`;
  return `${bytes} bytes`;
}

function progressText(state: Extract<FullModeState, { phase: "loading" }>, wordCount: number): string {
  if (state.stage === "preparing") return `Preparing ${wordCount.toLocaleString()} stars…`;
  const amount = state.total
    ? `${Math.min(100, Math.round((state.loaded / state.total) * 100))}%`
    : formatBytes(state.loaded);
  return `Downloading full galaxy… ${amount}`;
}

export function FullGalaxyDialog({
  listLabel,
  wordCount,
  bytes,
  state,
  onConfirm,
  onCancel,
  onRetry,
  onReturn,
}: {
  listLabel: string;
  wordCount: number;
  bytes: number;
  state: FullModeState;
  onConfirm: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onReturn: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (state.phase === "idle") return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (state.phase === "ready") onReturn();
        else onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      if (focusable.length === 0) {
        event.preventDefault();
        headingRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [onCancel, onReturn, state.phase]);

  if (state.phase === "idle") return null;

  const heading = state.phase === "confirm"
    ? `Load the complete ${listLabel} galaxy?`
    : state.phase === "loading"
      ? `Loading the complete ${listLabel} galaxy`
      : state.phase === "error"
        ? "The complete galaxy could not be loaded"
        : `Complete ${listLabel} galaxy`;
  const primaryStyle = {
    padding: "11px 17px",
    border: "none",
    borderRadius: 11,
    background: "linear-gradient(96deg,#BFD9F2,#8FE3C0)",
    color: "#0A1020",
    cursor: "pointer",
    font: `600 13px/1 ${SS}`,
  } as const;
  const secondaryStyle = {
    padding: "10px 16px",
    border: "1px solid rgba(241,238,230,.14)",
    borderRadius: 11,
    background: "rgba(241,238,230,.04)",
    color: "#A9B2C0",
    cursor: "pointer",
    font: `600 13px/1 ${SS}`,
  } as const;

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 90, display: "grid", placeItems: "center", padding: 20, background: "rgba(4,7,14,.68)", backdropFilter: "blur(8px)" }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="full-galaxy-heading"
        style={{ width: "min(100%,520px)", padding: 28, borderRadius: 20, background: "rgba(11,16,31,.98)", border: "1px solid rgba(191,217,242,.2)", boxShadow: "0 30px 90px rgba(0,0,0,.72)" }}>
        <p style={{ margin: 0, font: `600 9.5px/1 ${MN}`, letterSpacing: ".22em", textTransform: "uppercase", color: "#6B7789" }}>Optional full-list mode</p>
        <h2 ref={headingRef} id="full-galaxy-heading" tabIndex={-1}
          style={{ margin: "13px 0 0", font: `400 34px/1.12 ${SF}`, letterSpacing: "-.01em", color: "#F1EEE6", outline: "none" }}>
          {heading}
        </h2>

        {state.phase === "confirm" && (
          <>
            <p style={{ margin: "15px 0 0", font: `500 14px/1.5 ${MN}`, color: "#BFD9F2" }}>
              {wordCount.toLocaleString()} stars · approximately {formatBytes(bytes)}
            </p>
            <p style={{ margin: "12px 0 0", font: `400 14px/1.65 ${SS}`, color: "#A9B2C0" }}>
              This may take several seconds and could run slowly on mobile devices.
            </p>
          </>
        )}

        {state.phase === "loading" && (
          <div aria-live="polite" style={{ marginTop: 18, padding: "14px 16px", borderRadius: 12, background: "rgba(191,217,242,.07)", border: "1px solid rgba(191,217,242,.14)" }}>
            <p style={{ margin: 0, font: `500 13px/1.5 ${MN}`, color: "#BFD9F2" }}>{progressText(state, wordCount)}</p>
            <p style={{ margin: "7px 0 0", font: `400 12px/1.55 ${SS}`, color: "#6B7789" }}>The constellation remains available if you cancel.</p>
          </div>
        )}

        {state.phase === "error" && (
          <p role="alert" style={{ margin: "16px 0 0", padding: "13px 15px", borderRadius: 12, background: "rgba(232,168,159,.08)", border: "1px solid rgba(232,168,159,.22)", font: `400 13px/1.6 ${SS}`, color: "#E8A89F" }}>
            {state.message}
          </p>
        )}

        {state.phase === "ready" && (
          <p aria-live="polite" style={{ margin: "16px 0 0", font: `400 15px/1.65 ${SS}`, color: "#A9B2C0" }}>
            All {wordCount.toLocaleString()} stars are ready. Return whenever you want the lighter chart-constellation view.
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, flexWrap: "wrap", marginTop: 22 }}>
          {state.phase === "confirm" && <button onClick={onCancel} style={secondaryStyle}>Cancel</button>}
          {state.phase === "confirm" && <button onClick={onConfirm} style={primaryStyle}>Load full galaxy</button>}
          {state.phase === "loading" && <button onClick={onCancel} style={secondaryStyle}>Cancel</button>}
          {state.phase === "error" && <button onClick={onCancel} style={secondaryStyle}>Cancel</button>}
          {state.phase === "error" && <button onClick={onRetry} style={primaryStyle}>Retry</button>}
          {state.phase === "ready" && <button onClick={onReturn} style={primaryStyle}>Return to constellation view</button>}
        </div>
      </div>
    </div>
  );
}
