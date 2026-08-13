export type FullModeState =
  | { phase: "idle" }
  | { phase: "confirm" }
  | { phase: "loading"; stage: "downloading" | "preparing"; loaded: number; total: number | null }
  | { phase: "ready" }
  | { phase: "error"; message: string };

export type FullModeEvent =
  | { type: "open" }
  | { type: "confirm" }
  | { type: "progress"; stage: "downloading" | "preparing"; loaded: number; total: number | null }
  | { type: "ready" }
  | { type: "fail"; message: string }
  | { type: "cancel" }
  | { type: "exit" };

export const initialFullModeState: FullModeState = { phase: "idle" };

export function reduceFullMode(state: FullModeState, event: FullModeEvent): FullModeState {
  if (event.type === "cancel" || event.type === "exit") return initialFullModeState;
  if (event.type === "open") return state.phase === "idle" ? { phase: "confirm" } : state;
  if (event.type === "confirm") {
    return state.phase === "confirm" || state.phase === "error"
      ? { phase: "loading", stage: "downloading", loaded: 0, total: null }
      : state;
  }
  if (event.type === "progress") {
    return state.phase === "loading"
      ? { phase: "loading", stage: event.stage, loaded: event.loaded, total: event.total }
      : state;
  }
  if (event.type === "ready") return state.phase === "loading" ? { phase: "ready" } : state;
  if (event.type === "fail") return state.phase === "loading" ? { phase: "error", message: event.message } : state;
  return state;
}
