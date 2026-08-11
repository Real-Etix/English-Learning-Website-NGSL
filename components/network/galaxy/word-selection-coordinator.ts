type WordSelectionCoordinatorInput = {
  openWord: (lemma: string) => Promise<boolean>;
  commitWord: (lemma: string) => void;
};

export class WordSelectionCoordinator {
  private readonly openWord: WordSelectionCoordinatorInput["openWord"];
  private readonly commitWord: WordSelectionCoordinatorInput["commitWord"];
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

  clear(): void {
    this.revision += 1;
    this.retryLemma = null;
  }

  private async begin(lemma: string): Promise<boolean> {
    const revision = ++this.revision;
    this.retryLemma = null;
    let opened = false;
    try {
      opened = await this.openWord(lemma);
    } catch {
      // Treat an unexpected flight rejection like any other retryable failure.
    }
    if (revision !== this.revision) return false;
    if (!opened) {
      this.retryLemma = lemma;
      return false;
    }
    this.commitWord(lemma);
    return true;
  }
}
