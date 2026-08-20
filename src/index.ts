/**
 * Package root (SPEC.md § 12). The only module hosts should import.
 */

import type { CreateSessionOptions, Session, Timeline } from "./api.js";
import { createTimeline as createTimelineImpl } from "./core/timeline.js";
import { createSession as createSessionImpl } from "./session.js";
import type { Extension } from "@codemirror/state";
import { extraLockedGuards as extraLockedEditGuards } from "./view/guards/locked-ranges.js";
import { extraLockedParkFilter } from "./view/guards/park-selection.js";

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
export {
  coveredByHostBlockReplace,
  hostBlockReplaceRanges,
  overlapsHostBlockReplace,
} from "./view/host-block-replace.js";

export { findChips } from "./core/chips.js";
export type { ChipSpan } from "./core/chips.js";
export { isExactChipDelete } from "./view/guards/chips.js";
export { insertListPrefix, setHeadingLevel, toggleWrapSelection } from "./view/commands.js";
export { unfoldOverlappingFolds } from "./view/unfold.js";
export { paddedVisibleRanges } from "./view/viewport.js";
export { intervalsOverlap, scrollElementIntoViewIfNeeded } from "./view/scrollport.js";
export { wysiwygGuards, headingMarkers, maskBackslashRanges, frontmatterLockFilter } from "./view/guards/wysiwyg.js";
export { structureJoinFilter } from "./view/guards/structure-join.js";
export { headingUnitGuards, headingUnitAtBoundary } from "./view/guards/heading-units.js";
export { hiddenFrontmatterGuards } from "./view/frontmatter-hide.js";
export {
  extraAtomicRanges,
  extraLockedRanges,
  hostWriteAnnotation,
} from "./view/guards/locked-ranges.js";
export { extraLockedParkFilter } from "./view/guards/park-selection.js";
export function extraLockedGuards(opts?: { park?: boolean }): Extension {
  const edit = extraLockedEditGuards();
  if (opts?.park === false) return edit;
  return [edit, extraLockedParkFilter()];
}
export { parkSelectionInState } from "./view/guards/park-selection.js";
export { projectTree, frontmatterRanges, paddedFrontmatterRanges, hiddenFrontmatterRanges, headingUnitRanges } from "./core/tree.js";
export { findHtmlComments } from "./core/html-comments.js";
export { findInlineMarks, inlineDelimiterRanges } from "./core/inline-markers.js";
export { findInDocument } from "./core/search.js";

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
  FindMatchOptions,
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
