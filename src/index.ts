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

/**
 * Protected-range widget building blocks (non-editable, non-deletable widgets).
 * Hosts supply the range computation and the `WidgetType`; this wires up
 * display, atomicity, and deletion protection — kept in `src/` (unlike
 * presentation-layer recipes, see recipes/README.md) because it must
 * interoperate with the session's own transaction guards.
 */
export {
  protectedActiveMatchField,
  protectedAtomicField,
  protectedDecorationField,
  protectedWidgetExtension,
  preventProtectedDeletionFilter,
  setProtectedActiveMatch,
} from "./view/widgets/protected.js";
export type { ProtectedRange, ProtectedWidgetFactory } from "./view/widgets/protected.js";

export { findChips } from "./core/chips.js";
export type { ChipSpan } from "./core/chips.js";
export { isExactChipDelete } from "./view/guards/chips.js";
export { insertListPrefix, setHeadingLevel, toggleWrapSelection } from "./view/commands.js";
export { blockIndexAtOffset, bodyBlockStarts } from "./core/block-offsets.js";
export { unfoldOverlappingFolds } from "./view/unfold.js";
export { paddedVisibleRanges } from "./view/viewport.js";
export { intervalsOverlap, scrollElementIntoViewIfNeeded } from "./view/scrollport.js";
export { wysiwygGuards, headingMarkers, maskBackslashRanges } from "./view/guards/wysiwyg.js";
export { extraLockedRanges } from "./view/guards/locked-ranges.js";
export { parkSelectionInState } from "./view/guards/park-selection.js";
export { projectTree, frontmatterRanges } from "./core/tree.js";
export { findHtmlComments } from "./core/html-comments.js";
export { findInlineMarks, inlineDelimiterRanges } from "./core/inline-markers.js";

export type {
  CoordRect,
  CreateSessionOptions,
  CreateViewOptions,
  ForeignTimelineCommand,
  IncludeMode,
  InlineRefStyle,
  PluginContribution,
  PluginSlot,
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
