/**
 * Sync factory — selects V-S or V-M. Phase 1 lands per-view-state (SPEC § 16.1).
 */

import { createSharedStateSync } from "./shared-state/engine.js";
import type { SyncEngine, SyncVariant } from "./types.js";

export type {
  SyncEngine,
  SyncVariant,
  SyncListener,
  SharedStateSyncEngine,
  MountEditorOptions,
  EditorTransactionHandler,
} from "./types.js";
export { isSharedStateSync } from "./types.js";

export function createSync(variant: SyncVariant, initialDoc: string): SyncEngine {
  if (variant === "shared-state") {
    return createSharedStateSync(initialDoc);
  }
  throw new Error(
    "per-view-state is not built yet — Phase 1 lands it here (SPEC.md § 16.1)",
  );
}
