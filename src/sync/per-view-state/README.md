# per-view-state (V-M)

Placeholder for the Multi-Instance synchronization core: one `EditorState` per view,
`ChangeSet` forwarding. The Phase 0 spike (`spikes/phase-0/`) uses this construction;
Phase 1 lands the engine here (`SPEC.md` § 16.1).

V-S (`../shared-state/`) remains a documented alternative (`SPEC.md` § 11.2). It is not
the Phase 1 default and is not covered by the gate.
