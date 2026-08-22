export type TokenUsage = { inputTokens: number; outputTokens: number };

export type TokenBudgetOptions = {
  maxInputTokens: number;
  maxOutputTokens: number;
};

type Reservation = {
  reserved: TokenUsage;
  actual: TokenUsage | null;
};

function validUsage(usage: TokenUsage): boolean {
  return Number.isFinite(usage.inputTokens)
    && Number.isFinite(usage.outputTokens)
    && usage.inputTokens >= 0
    && usage.outputTokens >= 0;
}

/**
 * Tracks conservative pre-call reservations and settles each request to its
 * actual provider usage once. Request IDs make retries idempotent.
 */
export class TokenBudget {
  private readonly reservations = new Map<string, Reservation>();

  constructor(private readonly ceilings: TokenBudgetOptions) {
    if (
      !Number.isFinite(ceilings.maxInputTokens)
      || !Number.isFinite(ceilings.maxOutputTokens)
      || ceilings.maxInputTokens < 0
      || ceilings.maxOutputTokens < 0
    ) throw new Error("Token budget ceilings must be non-negative finite values");
  }

  reserve(requestId: string, estimated: TokenUsage): boolean {
    if (!requestId || !validUsage(estimated)) return false;
    if (this.reservations.has(requestId)) return true;

    const remaining = this.remaining();
    if (estimated.inputTokens > remaining.inputTokens || estimated.outputTokens > remaining.outputTokens) return false;
    this.reservations.set(requestId, { reserved: estimated, actual: null });
    return true;
  }

  recordActual(requestId: string, actual: TokenUsage): boolean {
    const reservation = this.reservations.get(requestId);
    if (!reservation || !validUsage(actual)) return false;
    if (reservation.actual !== null) return true;
    reservation.actual = actual;
    return true;
  }

  remaining(): TokenUsage {
    let inputTokens = this.ceilings.maxInputTokens;
    let outputTokens = this.ceilings.maxOutputTokens;
    for (const reservation of this.reservations.values()) {
      const usage = reservation.actual ?? reservation.reserved;
      inputTokens -= usage.inputTokens;
      outputTokens -= usage.outputTokens;
    }
    return { inputTokens, outputTokens };
  }

  exhausted(): boolean {
    const remaining = this.remaining();
    return remaining.inputTokens <= 0 || remaining.outputTokens <= 0;
  }
}
