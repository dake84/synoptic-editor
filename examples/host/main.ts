/**
 * Example host (SPEC.md § 12, § 13.2). Uses only the package root — no internals.
 * Paint from `subscribe`; navigation and search call session/view commands.
 */

import {
  createSession,
  createTimeline,
  type Session,
  type StructureSchema,
  type ViewHandle,
} from "../../src/index.js";

const SCHEMA: StructureSchema = {
  levels: [
    { rank: 0, id: "level-0", headingDepth: 1 },
    { rank: 1, id: "level-1", headingDepth: 2 },
  ],
  idField: "id",
};

const DOC = `---
id: n0
note: pinned
---

# Root

Root body with a chip [Alpha]{id=a type=ref} in the prose.

---
id: n1
note: child-note
---

## Child

Child body.

---
id: n2
---

# Other

Other body.
`;

const timeline = createTimeline();
const session: Session = createSession({
  doc: DOC,
  schema: SCHEMA,
  timeline,
  policy: {
    pillFields: ["note"],
    frontmatterInWysiwyg: "form",
    structureEditingInWysiwyg: "locked",
  },
});

const source: ViewHandle = session.createView({
  scope: { nodeId: "n0", include: "subtree" },
  presentation: "source",
});
const wysiwyg: ViewHandle = session.createView({
  scope: { nodeId: "n0", include: "subtree" },
  presentation: "wysiwyg",
});

function focused(): ViewHandle {
  return session.view(session.focusedViewId ?? source.id) ?? source;
}

function paintNav(): void {
  const nav = document.getElementById("nav")!;
  const visible = session.visibleNode;
  const bits: string[] = ["<h2>tree</h2>"];
  const walk = (id: string, depth: number) => {
    const node = session.tree.nodes.get(id);
    if (!node) return;
    const dirty = session.isDirty(id) ? " dirty" : "";
    const vis = id === visible ? " visible" : "";
    bits.push(
      `<button type="button" data-nav="${id}" class="${dirty}${vis}" style="padding-left:${8 + depth * 12}px">${escapeHtml(node.title)}${session.isDirty(id) ? " *" : ""}</button>`,
    );
    for (const child of node.childIds) walk(child, depth + 1);
  };
  for (const root of session.tree.roots) walk(root, 0);
  nav.innerHTML = bits.join("");
}

function paintToolbar(): void {
  const q = (document.querySelector("#toolbar input[name=q]") as HTMLInputElement | null)?.value ?? "";
  document.getElementById("toolbar")!.innerHTML = `
    <button type="button" data-cmd="undo">undo (${session.timelineDepth})</button>
    <button type="button" data-cmd="redo">redo</button>
    <button type="button" data-cmd="persist">mark persisted</button>
    <input name="q" value="${escapeHtml(q)}" placeholder="find" />
    <button type="button" data-cmd="find-view">find in view</button>
    <button type="button" data-cmd="find-doc">find in document</button>
    <button type="button" data-cmd="find-next">next</button>
    <button type="button" data-cmd="find-prev">prev</button>
  `;
}

function paintStatus(): void {
  const view = focused();
  document.getElementById("status")!.textContent =
    `focus ${session.focusedViewId ?? "—"} · active ${session.activeNode ?? "—"} · visible ${session.visibleNode ?? "—"} · view ${view.id}`;
}

function paint(): void {
  paintNav();
  paintToolbar();
  paintStatus();
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
}

document.getElementById("nav")!.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button[data-nav]");
  const id = btn?.getAttribute("data-nav");
  if (id) focused().navigateTo(id);
});

document.getElementById("toolbar")!.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button[data-cmd]");
  const cmd = btn?.getAttribute("data-cmd");
  if (!cmd) return;
  const q = (document.querySelector("#toolbar input[name=q]") as HTMLInputElement | null)?.value ?? "";
  if (cmd === "undo") session.undo();
  else if (cmd === "redo") session.redo();
  else if (cmd === "persist") session.markPersisted();
  else if (cmd === "find-view") focused().find(q, { mode: "view" });
  else if (cmd === "find-doc") focused().find(q, { mode: "document" });
  else if (cmd === "find-next") focused().findNext();
  else if (cmd === "find-prev") focused().findPrev();
  paint();
});

session.subscribe((e) => {
  if (e.type === "scopeLost") {
    session.view(e.viewId)?.destroy();
  }
  paint();
});

source.mount(document.getElementById("source")!);
wysiwyg.mount(document.getElementById("wysiwyg")!);
source.focus();
paint();
