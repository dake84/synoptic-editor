/**
 * Caret / focus trace for V-S diagnosis (SPEC § 11.2).
 * Named cause, one record per event — same discipline as I4 scroll log.
 */

export interface CaretTraceEvent {
  cause: string;
  viewId: string;
  head: number;
  nodeId: string | null;
  inRenderRange: boolean;
  cmHasFocus: boolean;
}

const LIMIT = 12;

export class CaretTrace {
  private events: CaretTraceEvent[] = [];

  record(event: CaretTraceEvent): void {
    if (!event.cause) throw new Error("caret trace requires a named cause");
    this.events.push(event);
    if (this.events.length > LIMIT) this.events.shift();
  }

  latest(): CaretTraceEvent | undefined {
    return this.events[this.events.length - 1];
  }

  all(): readonly CaretTraceEvent[] {
    return this.events;
  }
}
