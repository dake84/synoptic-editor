# Synoptic Editor

Multi-view markdown editing core: one document, many synchronized views (source and
WYSIWYG), shared undo/redo and search across them. Built on CodeMirror 6. Domain-agnostic —
structure comes from a host-supplied schema, not baked-in headings. No bundled UI; bring
your own host.

## Status

**Sync architecture verified** (G1–G3 — see `SPEC.md` § 16.1): a canonical `EditorState`
with no view, one `EditorState` per view, document-only forwarding, no selection forwarding.
Evidence lives in `spikes/phase-0/` and `tests/behaviour/phase-0-gate.spec.ts`; the same
pattern CodeMirror's own split-view example and Yjs' `y-codemirror` binding use — a shared
`EditorState` across views was considered and dropped (`SPEC.md` § 11). The production sync
engine is being rebuilt against this verified shape. Not a usable package yet.

The full requirements live in [`SPEC.md`](./SPEC.md).

## Why

Most editors force a choice: one engine per representation (source vs. rich text), one view
per open document, undo scoped to a single editor instance. Synoptic starts from a different
premise — a markdown document is the only truth, and any number of views (source, WYSIWYG,
structural) render and edit it simultaneously, always in sync, on one shared undo timeline
that also covers non-text actions the host defines.

See `SPEC.md` § 1.1 for the assumption everything else in this project follows from.

## Documents

| File | Purpose |
| ---- | ------- |
| [`SPEC.md`](./SPEC.md) | The single source of requirements — read this first |
| [`AGENTS.md`](./AGENTS.md) | Ground rules for anyone — human or AI agent — working in this repo |
| [`SETUP.md`](./SETUP.md) | Repository layout, test strategy, and how spec rules map to tests |

## Design in one paragraph

A `Session` holds one `Document` (a markdown string), a `Tree` projected from it, one
`Timeline` for undo/redo (text and non-text actions alike), and `TrackedPosition`s for
anything that must survive edits — scroll, caret, host annotations. Any number of `View`s
attach to a session, each with its own scope (which node, how much of its subtree), its own
presentation (source or wysiwyg), and its own scroll position — synchronized on the document,
independent on everything else. Underneath, each view is backed by its own CM6 `EditorState`,
forwarded from a canonical state the session owns — see `SPEC.md` § 11.

## License

MIT — see [`LICENSE`](./LICENSE).

## Contributing

The sync architecture is settled; the engine implementing it is being rebuilt. If you're
interested, open an issue; please read `SPEC.md` and `AGENTS.md` before proposing anything.
