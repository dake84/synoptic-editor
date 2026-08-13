/**
 * Scroll owner registry (SPEC I4): every scroll change has one owner and a named cause.
 */

export interface ScrollRecord {
  viewId: string;
  cause: string;
  /** Document position used as scroll target, if any. */
  pos: number | null;
  at: number;
}

export class ScrollOwnerLog {
  private last: ScrollRecord | null = null;
  private byView = new Map<string, ScrollRecord>();

  record(viewId: string, cause: string, pos: number | null = null): void {
    if (!cause) throw new Error("scroll cause is required (I4)");
    const rec: ScrollRecord = { viewId, cause, pos, at: Date.now() };
    this.last = rec;
    this.byView.set(viewId, rec);
  }

  lastFor(viewId: string): ScrollRecord | undefined {
    return this.byView.get(viewId);
  }

  latest(): ScrollRecord | null {
    return this.last;
  }
}
