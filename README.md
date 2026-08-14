# Synoptic Editor

Multi-view markdown editing core: one document, many synchronized views (source and
WYSIWYG), shared undo/redo and search across them. Built on CodeMirror 6. Domain-agnostic —
structure comes from a host-supplied schema, not baked-in headings. No bundled application
UI; this package is the editor, not a product.

## Install

The package is not published to npm yet. From a clone:

```sh
npm install
npm run build
```

Hosts import the package root and, optionally, the default widget CSS:

```ts
import { createSession, createTimeline } from "synoptic-editor";
import "synoptic-editor/theme.css";
```

The public contract is `SPEC.md` § 12. Internals (`src/session.ts`, `src/core/**`,
`src/view/**`) are not a host API.

## Quick start

```ts
import { createSession } from "synoptic-editor";

const schema = {
  levels: [
    { rank: 0, id: "level-0", headingDepth: 1 },
    { rank: 1, id: "level-1", headingDepth: 2 },
  ],
  idField: "id",
};

const session = createSession({
  doc: "---\nid: n0\n---\n\n# Root\n\nBody.\n",
  schema,
  policy: { pillFields: ["note"], frontmatterInWysiwyg: "form" },
});

const view = session.createView({
  scope: { nodeId: "n0", include: "subtree" },
  presentation: "wysiwyg",
});
view.mount(document.getElementById("editor")!);

session.subscribe((event) => {
  if (event.type === "scopeLost") session.view(event.viewId)?.destroy();
});
```

A working host (tree, two views, find, undo) lives in [`examples/host/`](./examples/host/).
Run `npm run example:host` and open the printed URL.

## What the host owns

Navigation chrome, search bars, undo buttons, and tabs sit **outside** the component
(`SPEC.md` § 13.2). They read `session.tree`, `isDirty`, `activeNode`, `visibleNode` and
write through `view.navigateTo`, `session.undo`, `view.find`, `session.apply`. They do not
keep a parallel copy of the document.

Shared undo across editor and host actions: create a timeline, pass it in, then push
foreign entries on that same object — never call undo on the timeline itself.

```ts
import { createSession, createTimeline } from "synoptic-editor";

const timeline = createTimeline();
const session = createSession({ doc, schema, timeline });
timeline.pushForeign({
  apply: () => { /* host action */ },
  revert: () => { /* inverse */ },
  reveal: () => { /* bring the entity into view */ },
});
session.undo();
```

## Documents

| File | Purpose |
| ---- | ------- |
| [`SPEC.md`](./SPEC.md) | Requirements (German; English translation is O3) |
| [`AGENTS.md`](./AGENTS.md) | Ground rules for anyone working in this repo |
| [`SETUP.md`](./SETUP.md) | Layout, tests, and how spec rules map to tests |

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

Read `SPEC.md` and `AGENTS.md` before proposing changes. New behaviour starts as a named
rule in `SPEC.md`, then code.
