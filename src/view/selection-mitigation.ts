/**
 * Selection mitigation (§ 11.2): state selection follows focused view;
 * other views keep last caret for restore / passive decoration (Slice 3: restore on focus).
 */

export class SelectionMitigation {
  private enabled: boolean;
  private lastCaret = new Map<string, number>();
  private focusedId: string | null = null;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setFocused(viewId: string): void {
    this.focusedId = viewId;
  }

  focused(): string | null {
    return this.focusedId;
  }

  remember(viewId: string, head: number): void {
    this.lastCaret.set(viewId, head);
  }

  last(viewId: string): number | undefined {
    return this.lastCaret.get(viewId);
  }
}
