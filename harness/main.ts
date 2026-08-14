/**
 * Test harness (SPEC.md § 13). Commands, not gestures (I5).
 */

import { EditorSelection } from "@codemirror/state";
import {
  CORPUS_NODE_TARGETS,
  FIXTURE_SCHEMA,
  generateCorpus,
  type CorpusSize,
} from "../tests/fixtures/corpus.js";
import { createSession, type Session, type SessionEvent } from "../src/session.js";
import type { ViewRestoreState } from "../src/view-handle.js";
import type { StructureAction } from "../src/core/structure.js";
import type { IncludeMode, Presentation } from "../src/view/presentation.js";

const DOC = `---
id: n0
note: pinned
extra: not-a-pill
tag: alpha
---

# Root

Root intro with a chip [Alpha]{id=a type=ref} and another [Beta]{id=b type=ref}.

Literal hash in prose looks like this when typed in wysiwyg: \\#tag.

---
id: n1
note: child-note
extra: child-extra
---

## Child

Child body mentions [Gamma]{id=g type=item} once.

More child lines for scroll and search.
Line two.
Line three.

---
id: n2
note: other-note
---

# Other

Other body without chips, only a pill field \`note\`.
`;

let session: Session;
try {
  session = createSession({
    doc: DOC,
    schema: FIXTURE_SCHEMA,
    policy: {
      pillFields: ["note", "tag"],
      frontmatterInWysiwyg: "form",
      structureEditingInWysiwyg: "locked",
    },
  });
} catch (err) {
  document.getElementById("status")!.textContent = `init-error: ${err}`;
  throw err;
}
const events: SessionEvent[] = [];
session.subscribe((e) => events.push(e));

const panes = new Map<string, HTMLElement>();
const wrappers = new Map<string, HTMLElement>();
const savedStates: ViewRestoreState[] = [];
/** Survives paintFactory rebuilds (otherwise find results flash then reset to —). */
let findStatus = "—";
let corpusStatus = "demo";

function pane(id: string): HTMLElement {
  let el = panes.get(id);
  if (el) return el;
  const wrap = document.createElement("div");
  wrap.className = "view-slot";
  wrap.dataset.viewId = id;
  const bar = document.createElement("div");
  bar.className = "view-bar";
  bar.dataset.barFor = id;
  el = document.createElement("div");
  el.className = "pane";
  el.dataset.viewId = id;
  wrap.append(bar, el);
  document.getElementById("views")!.appendChild(wrap);
  panes.set(id, el);
  wrappers.set(id, wrap);
  return el;
}

function nodeIds(): string[] {
  return [...session.tree.nodes.keys()];
}

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
}

function nodeSelect(name: string, selected?: string): string {
  return `<select name="${name}">${nodeIds()
    .map((id) => {
      const title = session.tree.nodes.get(id)?.title ?? id;
      const sel = id === selected ? " selected" : "";
      return `<option value="${esc(id)}"${sel}>${esc(id)} ${esc(title)}</option>`;
    })
    .join("")}</select>`;
}

function focusedId(): string | null {
  return session.focusedViewId ?? session.viewIds()[0] ?? null;
}

function paintViewBar(id: string): void {
  const wrap = wrappers.get(id);
  const bar = wrap?.querySelector(".view-bar");
  if (!bar) return;
  const scope = session.scopeOf(id);
  const handle = session.view(id);
  const ev = handle?.editorView();
  const focused = session.focusedViewId === id;
  wrap?.classList.toggle("focused", focused);
  bar.innerHTML = `
    <div class="row">
      <strong>${id}</strong>
      ${focused ? "<em>focused</em>" : `<button type="button" data-cmd="focus" data-id="${id}">focus</button>`}
      <button type="button" data-cmd="close" data-id="${id}">close</button>
      <button type="button" data-cmd="save" data-id="${id}">getState</button>
      <span>cause ${session.lastScrollCause(id) ?? "—"}</span>
      <span class="visible-id">visibleNodeId ${handle?.visibleNode ?? "—"}</span>
    </div>
    <div class="row">
      include
      <button type="button" data-cmd="include" data-id="${id}" data-include="own"${scope.include === "own" ? " disabled" : ""}>own</button>
      <button type="button" data-cmd="include" data-id="${id}" data-include="subtree"${scope.include === "subtree" ? " disabled" : ""}>subtree</button>
      presentation
      <button type="button" data-cmd="presentation" data-id="${id}" data-p="source">source</button>
      <button type="button" data-cmd="presentation" data-id="${id}" data-p="wysiwyg">wysiwyg</button>
      grain
      ${[0, 1, 2, 3].map((r) => `<button type="button" data-cmd="grain" data-id="${id}" data-rank="${r}">${r}</button>`).join("")}
    </div>
    <div class="row">
      scope ${nodeSelect("scope", scope.nodeId)}
      <button type="button" data-cmd="set-scope" data-id="${id}">setScope</button>
      ${nodeSelect("go", scope.nodeId)}
      <button type="button" data-cmd="navigate" data-id="${id}">navigateTo</button>
      <button type="button" data-cmd="scroll" data-id="${id}">scrollToNode</button>
    </div>
    <div class="row">
      caret ${ev?.state.selection.main.head ?? 0}
      range ${(() => {
        const r = session.scopeRangeOf(id);
        return `${r.from}–${r.to}${r.lost ? " lost" : ""}`;
      })()}
    </div>
  `;
}

function paintNav(): void {
  const panel = document.getElementById("nav-panel")!;
  const active = session.activeNode;
  const visible = session.visibleNode;
  const crumbs: string[] = [];
  let id: string | null = active;
  while (id) {
    crumbs.unshift(id);
    id = session.tree.nodes.get(id)?.parentId ?? null;
  }
  const walk = (nodeId: string, depth: number): string => {
    const n = session.tree.nodes.get(nodeId);
    if (!n) return "";
    const dirty = session.isDirty(nodeId) ? " dirty" : "";
    const vis = session.visibleNode === nodeId ? " is-visible" : "";
    const mark = session.isDirty(nodeId) ? "*" : session.isSubtreeDirty(nodeId) ? "+" : "";
    const kids = n.childIds.map((c) => walk(c, depth + 1)).join("");
    return `<button type="button" data-cmd="nav" data-node="${n.id}" style="padding-left:${8 + depth * 12}px" class="${dirty}${vis}">${mark}${n.id} ${n.title}${vis ? " · visibleNodeId" : ""}</button>${kids}`;
  };
  panel.innerHTML = `
    <h2>navigateTo</h2>
    <div class="crumb">
      ${crumbs.map((c) => `<button type="button" data-cmd="nav" data-node="${c}">${c}</button>`).join(" / ") || "—"}
    </div>
    <p>activeNode ${active ?? "—"}</p>
    <p class="visible-id">session.visibleNodeId ${visible ?? "—"}</p>
    ${session.tree.roots.map((r) => walk(r, 0)).join("")}
  `;
}

function paintInfo(): void {
  const snap = inspect();
  document.getElementById("info-panel")!.textContent = JSON.stringify(
    {
      focused: snap.focused,
      activeNode: snap.activeNode,
      visibleNode: snap.visibleNode,
      timelineDepth: snap.timelineDepth,
      dirty: snap.dirty,
      subtreeDirty: snap.subtreeDirty,
      relations: snap.relations,
      events: snap.events,
      views: snap.views.map((v) => ({
        id: v.id,
        scope: v.scope,
        visibleNode: v.visibleNode,
        lastScrollCause: v.lastScrollCause,
        scrollTop: v.scrollTop,
        caret: v.caret,
      })),
    },
    null,
    2,
  );
}

function paintSessionBar(): void {
  document.getElementById("session-bar")!.innerHTML = `
    <span class="visible-id">visibleNodeId ${session.visibleNode ?? "—"}</span>
    <button type="button" data-cmd="undo">undo</button>
    <button type="button" data-cmd="redo">redo</button>
    <button type="button" data-cmd="persist">markPersisted</button>
    <input name="type" placeholder="insert at caret" size="16" />
    <button type="button" data-cmd="type">typeIn focused</button>
    <button type="button" data-cmd="reopen" ${savedStates.length ? "" : "disabled"}>openFromState (${savedStates.length})</button>
  `;
}

function paintFactory(): void {
  const depths = session.schema.levels.map((l) => l.headingDepth);
  const sizes = (["S", "M", "L"] as const).map(
    (s) =>
      `<button type="button" data-cmd="load-corpus" data-size="${s}">${s} (${CORPUS_NODE_TARGETS[s]})</button>`,
  );
  document.getElementById("factory-bar")!.innerHTML = `
    <fieldset>
      <legend>corpus</legend>
      <button type="button" data-cmd="load-corpus" data-size="demo">demo</button>
      ${sizes.join("")}
      <span id="corpus-out">${esc(corpusStatus)}</span>
    </fieldset>
    <fieldset>
      <legend>openView</legend>
      ${nodeSelect("open-node")}
      <select name="open-include"><option value="subtree">subtree</option><option value="own">own</option></select>
      <select name="open-pres"><option value="source">source</option><option value="wysiwyg">wysiwyg</option></select>
      <select name="open-grain">${[0, 1, 2, 3].map((r) => `<option value="${r}">grain ${r}</option>`).join("")}</select>
      <button type="button" data-cmd="open">open</button>
    </fieldset>
    <fieldset>
      <legend>applyStructure</legend>
      ${nodeSelect("struct-node")}
      <button type="button" data-cmd="delete-node">deleteNode</button>
      <select name="struct-depth">${depths.map((d) => `<option value="${d}">h${d}</option>`).join("")}</select>
      <button type="button" data-cmd="heading-depth">changeHeadingDepth</button>
    </fieldset>
    <fieldset>
      <legend>find / replace</legend>
      <input name="find-q" placeholder="query (Alpha / pinned / #)" size="22" />
      <button type="button" data-cmd="find" data-mode="view">find view</button>
      <button type="button" data-cmd="find" data-mode="document">find document</button>
      <button type="button" data-cmd="find-next">F3 next</button>
      <button type="button" data-cmd="find-prev">Shift+F3 prev</button>
      <input name="replace-text" placeholder="replace with" size="10" />
      <button type="button" data-cmd="replace-all">replaceAll prose</button>
      <button type="button" data-cmd="replace-meta">replaceAll +metadata</button>
      <span id="find-out">${esc(findStatus)}</span>
    </fieldset>
  `;
}

function inputSnapshot(root: HTMLElement | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!root) return out;
  for (const el of Array.from(root.querySelectorAll("input, select"))) {
    const field = el as HTMLInputElement | HTMLSelectElement;
    if (field.name) out.set(field.name, field.value);
  }
  return out;
}

function restoreInputs(root: HTMLElement | null, values: Map<string, string>): void {
  if (!root) return;
  for (const [name, value] of values) {
    const field = named<HTMLInputElement | HTMLSelectElement>(root, name);
    if (field) field.value = value;
  }
}

function paint(): void {
  const sessionVals = inputSnapshot(document.getElementById("session-bar"));
  const factoryVals = inputSnapshot(document.getElementById("factory-bar"));
  for (const id of session.viewIds()) paintViewBar(id);
  paintNav();
  paintInfo();
  paintSessionBar();
  paintFactory();
  restoreInputs(document.getElementById("session-bar"), sessionVals);
  restoreInputs(document.getElementById("factory-bar"), factoryVals);
}

function formatFindStatus(target: string | null): string {
  const v = target ? session.view(target) : null;
  if (!v || !target) return "—";
  const n = v.findCount;
  const i = v.findIndex;
  const scope = session.scopeOf(target).nodeId;
  if (n === 0) return `0 hits via ${target}@${scope}`;
  return `${i + 1}/${n} via ${target}@${scope}`;
}

function named<T extends HTMLElement>(root: ParentNode, name: string): T | null {
  return root.querySelector(`[name="${name}"]`);
}

function onChromeClick(ev: Event): void {
  const btn = (ev.target as HTMLElement).closest("[data-cmd]") as HTMLElement | null;
  if (!btn) return;
  const cmd = btn.dataset.cmd;
  const id = btn.dataset.id;
  const root = btn.closest(".view-bar, #session-bar, #factory-bar, #nav-panel") ?? document;
  if (cmd === "focus" && id) api.focusView(id);
  else if (cmd === "close" && id) api.closeView(id);
  else if (cmd === "save" && id) {
    const state = api.getState(id);
    if (state) savedStates.push(state);
  } else if (cmd === "reopen") {
    const state = savedStates[savedStates.length - 1];
    if (state) api.openFromState(state);
  } else if (cmd === "include" && id) api.setScope(id, session.scopeOf(id).nodeId, btn.dataset.include as IncludeMode);
  else if (cmd === "presentation" && id) api.setPresentation(id, btn.dataset.p as Presentation);
  else if (cmd === "grain" && id) api.setGrain(id, Number(btn.dataset.rank));
  else if (cmd === "set-scope" && id) {
    const nodeId = named<HTMLSelectElement>(root, "scope")?.value;
    if (nodeId) api.setScope(id, nodeId);
  } else if (cmd === "navigate" && id) {
    const nodeId = named<HTMLSelectElement>(root, "go")?.value;
    if (nodeId) api.navigateTo(id, nodeId);
  } else if (cmd === "scroll" && id) {
    const nodeId = named<HTMLSelectElement>(root, "go")?.value;
    if (nodeId) api.scrollToNode(id, nodeId, "user");
  } else if (cmd === "undo") api.undo();
  else if (cmd === "redo") api.redo();
  else if (cmd === "persist") session.markPersisted();
  else if (cmd === "type") {
    const text = named<HTMLInputElement>(document.getElementById("session-bar")!, "type")?.value ?? "";
    const target = focusedId();
    if (target && text) api.typeIn(target, text);
  } else if (cmd === "open") {
    const factory = document.getElementById("factory-bar")!;
    api.openView({
      nodeId: named<HTMLSelectElement>(factory, "open-node")?.value,
      include: named<HTMLSelectElement>(factory, "open-include")?.value as IncludeMode,
      presentation: named<HTMLSelectElement>(factory, "open-pres")?.value as Presentation,
      grain: Number(named<HTMLSelectElement>(factory, "open-grain")?.value),
    });
  } else if (cmd === "delete-node") {
    const nodeId = named<HTMLSelectElement>(document.getElementById("factory-bar")!, "struct-node")?.value;
    if (nodeId) api.applyStructure({ type: "deleteNode", nodeId });
  } else if (cmd === "heading-depth") {
    const factory = document.getElementById("factory-bar")!;
    const nodeId = named<HTMLSelectElement>(factory, "struct-node")?.value;
    const headingDepth = Number(named<HTMLSelectElement>(factory, "struct-depth")?.value);
    if (nodeId) api.applyStructure({ type: "changeHeadingDepth", nodeId, headingDepth });
  } else if (cmd === "load-corpus") {
    const size = (btn.dataset.size ?? "demo") as "demo" | CorpusSize;
    api.loadCorpus(size);
  } else if (cmd === "find") {
    const mode = btn.dataset.mode as "view" | "document";
    const q = named<HTMLInputElement>(document.getElementById("factory-bar")!, "find-q")?.value ?? "";
    const target = focusedId();
    const hits = target ? session.view(target)?.find(q, { mode }) ?? [] : [];
    findStatus = formatFindStatus(target) + (hits.length ? ` (${hits.map((h) => h.class).join(",")})` : q ? "" : " (empty query)");
    paint();
    return;
  } else if (cmd === "find-next" || cmd === "find-prev") {
    const target = focusedId();
    const v = target ? session.view(target) : null;
    if (v) {
      if (cmd === "find-next") v.findNext();
      else v.findPrev();
    }
    findStatus = formatFindStatus(target);
    paint();
    return;
  } else if (cmd === "replace-all" || cmd === "replace-meta") {
    const text = named<HTMLInputElement>(document.getElementById("factory-bar")!, "replace-text")?.value ?? "";
    const target = focusedId();
    const classes = cmd === "replace-meta" ? (["prose", "metadata"] as const) : (["prose"] as const);
    const result = target ? session.view(target)?.replaceAll(text, { classes: [...classes] }) : null;
    findStatus = result
      ? `replaced via ${target} prose=${result.prose} meta=${result.metadata} rej=${result.rejected ?? 0}`
      : "—";
  } else if (cmd === "nav") {
    const nodeId = btn.dataset.node;
    const target = focusedId();
    if (target && nodeId) api.navigateTo(target, nodeId);
  } else return;
  paint();
}

function openView(opts: {
  nodeId?: string;
  include?: IncludeMode;
  presentation?: Presentation;
  grain?: number;
}): string {
  const handle = session.createView({
    scope: opts.nodeId ? { nodeId: opts.nodeId, include: opts.include } : undefined,
    presentation: opts.presentation,
    grain: opts.grain,
  });
  handle.mount(pane(handle.id));
  return handle.id;
}

function closeAllViews(): void {
  for (const id of [...session.viewIds()]) api.closeView(id);
}

/** Load demo fixture or generated S/M/L corpus (SPEC § 15.1); reset views onto first root. */
function loadCorpus(size: "demo" | CorpusSize): string {
  const t0 = performance.now();
  closeAllViews();
  const doc = size === "demo" ? DOC : generateCorpus(size);
  session.replaceDocument(doc);
  events.length = 0;
  findStatus = "—";
  const roots = session.tree.roots;
  const first = roots[0];
  if (first) {
    if (size === "demo") {
      openView({ nodeId: first, include: "subtree", presentation: "wysiwyg" });
      const second = roots[1];
      if (second) openView({ nodeId: second, include: "subtree", presentation: "wysiwyg" });
      openView({ nodeId: first, include: "subtree", presentation: "source" });
    } else {
      // Large corpora: one source view on the first root (wysiwyg + forms is heavy on L).
      openView({ nodeId: first, include: "subtree", presentation: "source" });
    }
  }
  const ms = Math.round(performance.now() - t0);
  corpusStatus = `${size}: ${session.tree.nodes.size} nodes · ${doc.length} chars · ${ms}ms`;
  document.getElementById("status")!.textContent = `corpus ${corpusStatus}`;
  return corpusStatus;
}

const a = openView({ nodeId: "n0", include: "subtree", presentation: "wysiwyg" });
const b = openView({ nodeId: "n2", include: "subtree", presentation: "wysiwyg" });
const c = openView({ nodeId: "n0", include: "subtree", presentation: "source" });

export type HarnessApi = {
  session: Session;
  events: SessionEvent[];
  openView: typeof openView;
  closeView: (id: string) => void;
  focusView: (id: string) => void;
  setScope: (id: string, nodeId: string, include?: IncludeMode) => void;
  setPresentation: (id: string, p: Presentation) => void;
  setGrain: (id: string, rank: number) => void;
  navigateTo: (id: string, nodeId: string) => void;
  scrollToNode: (id: string, nodeId: string, cause: string) => void;
  undo: () => void;
  redo: () => void;
  applyStructure: (action: StructureAction) => boolean;
  typeIn: (id: string, text: string) => void;
  setSelection: (id: string, from: number, to?: number) => void;
  replaceDocument: (doc: string) => void;
  loadCorpus: (size: "demo" | CorpusSize) => string;
  getState: (id: string) => ViewRestoreState | undefined;
  openFromState: (state: ViewRestoreState) => string;
  flush: () => Promise<ReturnType<typeof inspect>>;
  inspect: () => ReturnType<typeof inspect>;
};

function inspect() {
  const views = session.viewIds().map((id) => {
    const handle = session.view(id)!;
    const ev = handle.editorView();
    const range = session.scopeRangeOf(id);
    return {
      id,
      excerpt: session.excerpt(id),
      doc: ev?.state.doc.toString() ?? "",
      caret: ev?.state.selection.main.head ?? 0,
      visibleNode: handle.visibleNode,
      lastScrollCause: session.lastScrollCause(id),
      scope: session.scopeOf(id),
      scrollTop: ev?.scrollDOM.scrollTop ?? 0,
      grainRanks: ev
        ? Array.from(ev.contentDOM.querySelectorAll("[data-rank]")).map((n) =>
            Number((n as HTMLElement).dataset.rank),
          )
        : [],
      range,
    };
  });
  return {
    document: session.document,
    treeRoots: session.tree.roots,
    nodeIds: [...session.tree.nodes.keys()],
    timelineDepth: session.timelineDepth,
    activeNode: session.activeNode,
    visibleNode: session.visibleNode,
    focused: session.focusedViewId,
    dirty: [...session.tree.nodes.keys()].filter((id) => session.isDirty(id)),
    subtreeDirty: [...session.tree.nodes.keys()].filter((id) => session.isSubtreeDirty(id)),
    relations: session.relations(),
    events: events.map((e) => e.type === "scopeLost" ? e : { type: e.type }),
    layoutDuringUpdate: session.layoutDuringUpdate,
    views,
  };
}

const api: HarnessApi = {
  session,
  events,
  openView,
  closeView(id) {
    session.view(id)?.destroy();
    wrappers.get(id)?.remove();
    wrappers.delete(id);
    panes.delete(id);
  },
  focusView(id) {
    session.view(id)?.focus();
  },
  setScope(id, nodeId, include) {
    session.view(id)?.setScope(nodeId, include ? { include } : undefined);
  },
  setPresentation(id, p) {
    session.view(id)?.setPresentation(p);
  },
  setGrain(id, rank) {
    session.view(id)?.setGrain(rank);
  },
  navigateTo(id, nodeId) {
    session.view(id)?.navigateTo(nodeId);
  },
  scrollToNode(id, nodeId, cause) {
    session.view(id)?.scrollToNode(nodeId, cause);
  },
  undo() {
    session.undo();
  },
  redo() {
    session.redo();
  },
  applyStructure(action) {
    return session.apply(action);
  },
  typeIn(id, text) {
    const ev = session.view(id)?.editorView();
    if (!ev) return;
    const pos = ev.state.selection.main.head;
    session.dispatch(id, [{ changes: { from: pos, to: pos, insert: text } }]);
  },
  setSelection(id, from, to = from) {
    session.dispatch(id, [{ selection: EditorSelection.single(from, to) }]);
  },
  replaceDocument(doc) {
    session.replaceDocument(doc);
  },
  loadCorpus,
  getState(id) {
    return session.view(id)?.getState();
  },
  openFromState(state) {
    const handle = session.createView({ state });
    handle.mount(pane(handle.id));
    return handle.id;
  },
  flush() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve(inspect()));
      });
    });
  },
  inspect,
};

void a;
void b;
void c;

Object.assign(window, { __harness: api });
document.getElementById("status")!.textContent = "ready";
document.addEventListener("click", onChromeClick);
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "F3") return;
  // Editor bindings (findStepKeymap) handle F3 inside CM; chrome/inputs go through the command.
  const t = ev.target as HTMLElement | null;
  if (t?.closest?.(".cm-editor")) return;
  ev.preventDefault();
  const target = focusedId();
  const v = target ? session.view(target) : null;
  if (v) {
    if (ev.shiftKey) v.findPrev();
    else v.findNext();
  }
  findStatus = formatFindStatus(target);
  paint();
});
session.subscribe(() => {
  requestAnimationFrame(() => paint());
});
paint();
