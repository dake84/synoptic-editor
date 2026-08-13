# per-view-state (V-M) — not built yet

This directory is intentionally empty. It marks where the Multi-Instance
synchronization core (one `EditorState` per view, `ChangeSet` forwarding) would
live if it is ever needed.

It is **not** planned work. `SPEC.md` § 16 builds V-S (`../shared-state/`) first,
behind a risk gate (§ 16.1, G1–G3) and absolute performance budgets (§ 16.2,
B1–B4). V-M is only built if the gate fails or a budget is missed — see B3/B4.

Keeping this directory present, rather than deleting it, keeps the fallback
line visible instead of forgotten.
