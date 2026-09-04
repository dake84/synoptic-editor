/**
 * Debug-only inspect of DirtyState baselines (SPEC.md § 12 — not in the public
 * table). Hosts import `synoptic-editor/debug` from a NODE_ENV !== "production"
 * module. Production hosts must not import this subpath.
 *
 * Also: Host Lab CM6 interaction probe (keydown / update / named filter traces).
 */

import type { Session } from "./api.js";
import type { DirtyInspectNode } from "./core/dirty.js";

export type { DirtyInspectNode };

export {
  createCm6ProbeBridge,
  formatCm6ProbePayload,
  type Cm6ProbeEvent,
  type Cm6ProbeHandler,
} from "./debug/cm6-probe.js";
export {
  filterTraceSink,
  namedChangeFilter,
  namedTransactionFilter,
  type FilterTrace,
  type FilterTraceSink,
} from "./view/guards/filter-trace.js";

/** Well-known symbol Session attaches only when NODE_ENV !== "production". */
export const SYNOPTIC_DEBUG_INSPECT_DIRTY = Symbol.for("synoptic.debug.inspectDirty");

export type DirtyInspect = {
  document: string;
  roots: string[];
  nodes: DirtyInspectNode[];
};

type DebugInspectHandle = Session & {
  [SYNOPTIC_DEBUG_INSPECT_DIRTY]?: () => DirtyInspectNode[];
};

/**
 * Tree + own/subtree baseline vs current. Empty in production (no-op).
 */
export function inspectDirty(session: Session): DirtyInspect {
  if (process.env.NODE_ENV === "production") {
    return { document: "", roots: [], nodes: [] };
  }
  const nodes = (session as DebugInspectHandle)[SYNOPTIC_DEBUG_INSPECT_DIRTY]?.() ?? [];
  return {
    document: session.document,
    roots: [...session.tree.roots],
    nodes,
  };
}
