/**
 * Host-facing CM6 re-exports (ADR 0015).
 * Desktop plugins import from `synoptic-editor/cm` — never `@codemirror/*`.
 */

export type { Completion, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
export {
  CompletionContext,
  autocompletion,
  completeFromList,
  snippetCompletion,
} from "@codemirror/autocomplete";

export type { ChangeSpec, Extension, SelectionRange, TransactionSpec } from "@codemirror/state";
export {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  Facet,
  Prec,
  RangeSet,
  RangeSetBuilder,
  RangeValue,
  StateEffect,
  StateField,
  Text,
  Transaction,
} from "@codemirror/state";

export type { DecorationSet, Tooltip, TooltipView, ViewUpdate } from "@codemirror/view";
export {
  Decoration,
  EditorView,
  GutterMarker,
  ViewPlugin,
  WidgetType,
  activateHover,
  closeHoverTooltips,
  gutter,
  hoverTooltip,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";

export {
  cursorCharRight,
  cursorLineBoundaryBackward,
  cursorLineBoundaryForward,
  cursorLineDown,
  cursorLineUp,
  defaultKeymap,
  deleteCharBackward,
  deleteCharForward,
  history,
  historyKeymap,
  indentWithTab,
  insertNewlineAndIndent,
  insertNewlineKeepIndent,
  redo,
  redoDepth,
  selectLineDown,
  undo,
  undoDepth,
} from "@codemirror/commands";

export { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
export { yaml } from "@codemirror/lang-yaml";
export {
  HighlightStyle,
  codeFolding,
  foldEffect,
  foldService,
  foldState,
  syntaxHighlighting,
  syntaxTree,
  unfoldEffect,
} from "@codemirror/language";
export { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
export { SearchQuery, highlightSelectionMatches, searchKeymap } from "@codemirror/search";
