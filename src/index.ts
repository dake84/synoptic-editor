/**
 * Public API surface (SPEC.md § 12). Single export point (F5 / SETUP check-export-surface).
 */

export { createSession, Session } from "./session.js";
export type { CreateSessionOptions, Policy, SessionListener } from "./session.js";
export { ViewHandle } from "./view-handle.js";
export type {
  IncludeMode,
  Presentation,
  ViewOptions,
  ViewRestoreState,
} from "./view-handle.js";
export type { StructureAction } from "./core/structure.js";
export type {
  Range,
  StructureLevel,
  StructureSchema,
  Tree,
  TreeNode,
} from "./core/types.js";
export type { SyncVariant } from "./sync/index.js";
export type { TrackedPositionId } from "./core/tracked-position.js";
