/**
 * Package root (SPEC.md § 12). The only module hosts should import.
 */

import type { CreateSessionOptions, Session, Timeline } from "./api.js";
import { createTimeline as createTimelineImpl } from "./core/timeline.js";
import { createSession as createSessionImpl } from "./session.js";

export function createSession(opts: CreateSessionOptions): Session {
  return createSessionImpl(opts);
}

export function createTimeline(): Timeline {
  return createTimelineImpl();
}

export type {
  CreateSessionOptions,
  CreateViewOptions,
  ForeignTimelineCommand,
  IncludeMode,
  InlineRefStyle,
  Policy,
  Presentation,
  Range,
  ReadNode,
  ReplaceAllResult,
  ResolvedTrackedPosition,
  SearchHit,
  SearchHitClass,
  Session,
  SessionEvent,
  StructureAction,
  StructureLevel,
  StructureSchema,
  Timeline,
  TrackedPositionId,
  Tree,
  TreeNode,
  ViewHandle,
  ViewRestoreState,
  ViewScope,
} from "./api.js";
