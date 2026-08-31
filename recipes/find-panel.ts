/**
 * Recipe: generic Ctrl+F / Ctrl+R find & replace panel.
 *
 * Presentation-layer code — deliberately lives outside `synoptic-editor`'s
 * published `src/` (which stays UI-opinion-free); see recipes/README.md.
 * Wired into spikes/heading-widgets/main.ts.
 *
 * This module owns only the UI (keybindings, panel DOM, next/prev/replace/replace-all
 * wiring) — it does not know how search or replacement work. Hosts inject a
 * `FindReplaceController` (for example one backed by a session view handle's
 * find / findNext / findPrev / replace / replaceAll methods; see `src/api.ts`)
 * via `findReplaceControllerFacet`. Substring matching and visible-selection
 * behavior live in the controller; this panel just calls it.
 */

import { Facet, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, keymap, showPanel, type Panel } from "@codemirror/view";

export interface FindReplaceController {
  find(query: string): void;
  findNext(): void;
  findPrev(): void;
  replaceCurrent(text: string): void;
  replaceAll(text: string): void;
}

export const findReplaceControllerFacet = Facet.define<
  FindReplaceController,
  FindReplaceController | null
>({
  combine: (v) => v[0] ?? null,
});

type PanelMode = "closed" | "find" | "replace";

const setPanelMode = StateEffect.define<PanelMode>();

const panelModeField = StateField.define<PanelMode>({
  create: () => "closed",
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPanelMode)) return e.value;
    return value;
  },
  provide: (field) =>
    showPanel.from(field, (mode) => (mode === "closed" ? null : createFindReplacePanel)),
});

function openPanel(view: EditorView, mode: "find" | "replace"): boolean {
  view.dispatch({ effects: setPanelMode.of(mode) });
  // Panel DOM mounts synchronously via `showPanel`; focus the query input next tick.
  requestAnimationFrame(() => {
    const input = view.dom.querySelector<HTMLInputElement>(
      ".syn-find-panel input[data-role='query']",
    );
    input?.focus();
    input?.select();
  });
  return true;
}

function closePanel(view: EditorView): boolean {
  if (view.state.field(panelModeField) === "closed") return false;
  view.dispatch({ effects: setPanelMode.of("closed") });
  view.focus();
  return true;
}

function createFindReplacePanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "syn-find-panel";

  const queryInput = document.createElement("input");
  queryInput.type = "text";
  queryInput.dataset.role = "query";
  queryInput.placeholder = "Find";

  const replaceInput = document.createElement("input");
  replaceInput.type = "text";
  replaceInput.dataset.role = "replace";
  replaceInput.placeholder = "Replace";

  const prevBtn = button("↑", "Previous (Shift+Enter)");
  const nextBtn = button("↓", "Next (Enter)");
  const replaceBtn = button("Replace", "Replace current match");
  const replaceAllBtn = button("Replace all", "Replace all matches");
  const closeBtn = button("✕", "Close (Escape)");

  const controllerOf = () => view.state.facet(findReplaceControllerFacet);

  // Escape is handled by the panel-wide keydown listener below (it bubbles from either input).
  queryInput.addEventListener("input", () => controllerOf()?.find(queryInput.value));
  queryInput.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    controllerOf()?.[ev.shiftKey ? "findPrev" : "findNext"]();
  });
  replaceInput.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    controllerOf()?.replaceCurrent(replaceInput.value);
  });
  prevBtn.addEventListener("click", () => controllerOf()?.findPrev());
  nextBtn.addEventListener("click", () => controllerOf()?.findNext());
  replaceBtn.addEventListener("click", () => controllerOf()?.replaceCurrent(replaceInput.value));
  replaceAllBtn.addEventListener("click", () => controllerOf()?.replaceAll(replaceInput.value));
  closeBtn.addEventListener("click", () => closePanel(view));

  const findRow = document.createElement("div");
  findRow.className = "syn-find-row";
  findRow.append(queryInput, prevBtn, nextBtn, closeBtn);

  const replaceRow = document.createElement("div");
  replaceRow.className = "syn-find-row";
  replaceRow.append(replaceInput, replaceBtn, replaceAllBtn);

  /**
   * CM's `keymap` facet only listens on `contentDOM` (the editable text), not
   * `view.dom` as a whole — panel inputs are siblings of contentDOM, so a
   * keydown there never bubbles to it. Mod-f/Mod-r/Escape need their own
   * listener on the panel itself once focus has moved into its inputs
   * (matches how `@codemirror/search`'s built-in panel handles this).
   */
  dom.addEventListener("keydown", (ev) => {
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key.toLowerCase() === "f") {
      ev.preventDefault();
      openPanel(view, "find");
    } else if (mod && ev.key.toLowerCase() === "r") {
      ev.preventDefault();
      openPanel(view, "replace");
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      closePanel(view);
    }
  });

  dom.append(findRow, replaceRow);

  return {
    dom,
    top: true,
    update(update) {
      const mode = update.state.field(panelModeField);
      replaceRow.hidden = mode !== "replace";
    },
  };
}

function button(label: string, title: string): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  el.title = title;
  return el;
}

/** Ctrl/Cmd+F opens find-only; Ctrl/Cmd+R (Alt+R on some hosts) opens find+replace. */
export function findReplaceKeymap(): Extension {
  return keymap.of([
    { key: "Mod-f", preventDefault: true, run: (view) => openPanel(view, "find") },
    { key: "Mod-r", preventDefault: true, run: (view) => openPanel(view, "replace") },
    { key: "Escape", run: closePanel },
  ]);
}

export function findReplacePanel(controller: FindReplaceController): Extension {
  return [panelModeField, findReplaceControllerFacet.of(controller), findReplaceKeymap()];
}
