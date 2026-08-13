# shared-state (V-S)

One `EditorState`, N `EditorView`s. `createSharedStateSync` owns the state, mounts
views with per-view pending bindings (presentation/scope — not in state), and fans
out transactions: origin `update(trs)` first (CodeMirror split pattern). Pointer
selections assign the end state to siblings via `setState` so CM6 does not write
the caret into an unfocused view.

Guards and scope decorations live under `src/view/**`. This engine is not covered by
the Phase 0 gate (`SPEC.md` § 16.1); the gate uses one `EditorState` per view.
