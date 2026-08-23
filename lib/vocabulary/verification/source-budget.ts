export class SourceRequestBudget {
  private readonly requestIds = new Set<string>();

  constructor(private readonly ceiling: number) {
    if (!Number.isInteger(ceiling) || ceiling < 0) {
      throw new Error("source request ceiling must be a non-negative integer");
    }
  }

  reserve(requestId: string): boolean {
    if (this.requestIds.has(requestId)) return true;
    if (this.requestIds.size >= this.ceiling) return false;
    this.requestIds.add(requestId);
    return true;
  }

  remaining(): number {
    return this.ceiling - this.requestIds.size;
  }

  used(): number {
    return this.requestIds.size;
  }
}
