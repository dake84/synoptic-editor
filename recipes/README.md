# Recipes

Presentation-layer patterns for `synoptic-editor` hosts. This directory is a
separate, unpublished package (`recipes/package.json`) — deliberately outside
`src/` (which stays UI-opinion-free and is what `tsconfig.build.json` ships as
`dist/`). Recipes are runnable code, wired into `spikes/heading-widgets` as
the worked example; fork or copy them, they carry no compatibility promise.

**Rule of thumb for where new code goes**: if it needs to interoperate with
the session's own transaction guards/atomic ranges to be *correct* (not just
to look a certain way), it belongs in `src/view/`. If it's DOM, CSS, button
labels, or how a controller happens to be wired to `ViewHandle` — it's host
opinion and belongs here.

## 1. Protected (non-editable) widgets

**Mechanics** (stays in `src/`, exported from the package root):
[`src/view/widgets/protected.ts`](../src/view/widgets/protected.ts)

A protected widget is a document range that:
- renders as a `Decoration.replace` block widget (`contenteditable="false"` is the widget's own DOM concern, not this module's)
- is atomic (`EditorView.atomicRanges`) — caret cannot land inside it
- rejects pure deletions (Backspace, Delete, cut) that touch it, via `EditorState.transactionFilter` — but **lets replacement edits through** (typing over a selection, Find & Replace), so the widget's underlying text can still change

You bring: a `StateField<ProtectedRange[]>` (how you compute the ranges — e.g.
from heading positions in a structure tree) and a `ProtectedWidgetFactory`
(`(doc, range, activeMatch) => WidgetType`). `protectedWidgetExtension(rangesField, widgetFor)`
wires the three behaviors together and installs `protectedActiveMatchField` for you.

**Recipe** (this package, DOM/CSS): [`protected-heading-widget.ts`](./protected-heading-widget.ts)
— wraps a schema's heading lines. `protectedHeadingExtension(schema)` returns
`{ extension, rangesField }`; **keep the `rangesField` reference** if you need
to read current ranges back out of state later (e.g. to test whether a find
hit landed inside one) — `StateField.define` mints a new field identity on
every call, so a second call with the same schema is a *different* field.

## 2. Ctrl+F / Ctrl+R find & replace panel

**Recipe**: [`find-panel.ts`](./find-panel.ts) — entirely host opinion (panel
DOM, button labels, keybindings), so it lives here, not in `src/`.

A CM6 `showPanel` extension owning only the UI (Mod-f opens find, Mod-r opens
find+replace, Enter/Shift+Enter step, Escape closes). It knows nothing about
search — it calls a `FindReplaceController` you inject via
`findReplaceControllerFacet`:

```ts
interface FindReplaceController {
  find(query: string): void;
  findNext(): void;
  findPrev(): void;
  replaceCurrent(text: string): void;
  replaceAll(text: string): void;
}
```

**Gotcha**: CM's `keymap` facet only listens on `contentDOM` (the editable
text), not `view.dom` as a whole. Panel `<input>`s are siblings of
`contentDOM`, so once focus moves into them a `keydown` never bubbles to the
keymap handler — Mod-r would silently do nothing if the find panel is already
open and focused. `find-panel.ts` works around this with its own `keydown`
listener on the panel's root `dom` (same approach `@codemirror/search`'s
built-in panel uses).

**Wiring**: [`spikes/heading-widgets/main.ts`](../spikes/heading-widgets/main.ts)
(`findController`) — bridges the panel to `Session`'s existing
`ViewHandle.find/findNext/findPrev/replace/replaceAll` (see `src/api.ts`). For
ordinary prose, `ViewHandle` already sets a real `EditorSelection` on the
active hit (visible natively). A hit that lands inside a protected range
can't be shown that way — there's no text node under a replace decoration to
select — so `main.ts` additionally checks the hit against the protected
`rangesField` and, if it's inside one, dispatches `setProtectedActiveMatch` so
the widget renders its own highlight (see `ProtectedHeadingWidget.toDOM` in
`protected-heading-widget.ts`, and the `.spike-protected-hit` `<mark>` / CSS
in `spikes/heading-widgets/styles.css`).

## Test coverage

Core building blocks (`src/view/widgets/protected.ts`) have unit tests:
[`tests/unit/view/protected-widgets.test.ts`](../tests/unit/view/protected-widgets.test.ts) —
deletion filter (blocked vs. replace-through), atomic range coverage, and the
active-match → widget wiring. Everything in this package (`find-panel.ts`,
the `main.ts` controller glue) is exercised manually in the spike; it doesn't
yet have automated coverage.
