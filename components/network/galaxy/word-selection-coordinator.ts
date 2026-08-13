type WordSelectionCoordinatorInput = {
  openWord: (lemma: string) => Promise<boolean>;
  commitWord: (lemma: string) => void;
};

export class WordSelectionCoordinator {
  private readonly openWord: WordSelectionCoordinatorInput["openWord"];
  private readonly commitWord: WordSelectionCoordinatorInput["commitWord"];
  private readonly listeners = new Set<(lemma: string | null) => void>();
  private revision = 0;
  private retryLemma: string | null = null;

  constructor(input: WordSelectionCoordinatorInput) {
    this.openWord = input.openWord;
    this.commitWord = input.commitWord;
  }

  select(lemma: string): Promise<boolean> {
    return this.begin(lemma);
  }

  retryPending(): Promise<boolean> {
    const lemma = this.retryLemma;
    return lemma ? this.begin(lemma) : Promise.resolve(false);
  }

  pendingRetryLemma(): string | null {
    return this.retryLemma;
  }

  subscribe(listener: (lemma: string | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.retryLemma);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.revision += 1;
    this.updateRetryLemma(null);
  }

  private async begin(lemma: string): Promise<boolean> {
    const revision = ++this.revision;
    this.updateRetryLemma(null);
    let opened = false;
    try {
      opened = await this.openWord(lemma);
    } catch {
      // Treat an unexpected flight rejection like any other retryable failure.
    }
    if (revision !== this.revision) return false;
    if (!opened) {
      this.updateRetryLemma(lemma);
      return false;
    }
    this.commitWord(lemma);
    return true;
  }

  private updateRetryLemma(lemma: string | null): void {
    if (this.retryLemma === lemma) return;
    this.retryLemma = lemma;
    for (const listener of this.listeners) listener(lemma);
  }
}
