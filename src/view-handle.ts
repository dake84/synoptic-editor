/**
 * View handle (SPEC.md § 12). The public type is in api.ts; this adds harness-only fields.
 */

import type { EditorView } from "@codemirror/view";
import type { ViewHandle as PublicViewHandle, ViewRestoreState, ViewScope, ReplaceAllResult } from "./api.js";

export type { ViewRestoreState, ViewScope, ReplaceAllResult };

export interface ViewHandle extends PublicViewHandle {
  /** 0-based active hit, or -1 (F3/F10). Harness/tests; not in § 12. */
  readonly findIndex: number;
  readonly findCount: number;
  /** CM6 view — not in § 12. */
  editorView(): EditorView | null;
}
