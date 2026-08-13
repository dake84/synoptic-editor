import { FIXTURE_SCHEMA } from "../tests/fixtures/corpus.js";
import { createSession } from "../src/session.js";
import type { ViewHandle } from "../src/view-handle.js";
import { createCommands, type HarnessCommands } from "./commands.js";
import { inspect, type InspectorSnapshot } from "./inspector.js";

const SAMPLE = `---
id: root
---

# Root

Root body. Edit here in either pane.

---
id: child-a
---

## Child A

Text in child A.

---
id: child-b
---

## Child B

Text in child B.

---
id: other
---

# Other

Another root branch.
`;

export interface HarnessApi {
  commands: HarnessCommands;
  inspect(): InspectorSnapshot;
  getDoc(): string;
  session: ReturnType<typeof createSession>;
}

declare global {
  // eslint-disable-next-line no-var
  var __harness: HarnessApi;
}

function el(id: string): HTMLElement {
  const n = document.getElementById(id);
  if (!n) throw new Error(`#${id} missing`);
  return n;
}

function mount() {
  const session = createSession({
    doc: SAMPLE,
    schema: FIXTURE_SCHEMA,
    selectionMitigation: true,
  });

  const views = new Map<string, ViewHandle>();
  const viewA = session.createView({
    scopeNodeId: "root",
    include: "subtree",
    presentation: "source",
  });
  const viewB = session.createView({
    scopeNodeId: "other",
    include: "subtree",
    presentation: "source",
  });
  views.set(viewA.id, viewA);
  views.set(viewB.id, viewB);

  viewA.mount(el("pane-a"));
  viewB.mount(el("pane-b"));
  viewA.focus();

  const commands = createCommands(session, views);

  const status = el("status");
  const traceEl = el("caret-trace");
  const render = () => {
    const snap = inspect(session, views);
    const focusFlags = snap.views
      .map((v) => `${v.id.slice(-2)} focus=${v.cmHasFocus} inRange=${v.headInRenderRange}`)
      .join(" | ");
    status.textContent = [
      `caret@${snap.caret.head} node=${snap.caret.nodeId} sessionFocus=${snap.caret.sessionFocusedViewId}`,
      focusFlags,
      `timeline=${snap.timelineDepth} dirty=[${snap.dirty.join(",")}]`,
    ].join("\n");
    const last = snap.caretTrace.slice(-8);
    traceEl.textContent =
      last.length === 0
        ? "(no caret trace yet — click a pane)"
        : last
            .map(
              (e) =>
                `${e.cause} view=${e.viewId} head=${e.head} inRange=${e.inRenderRange} cmFocus=${e.cmHasFocus} scope=${e.nodeId}`,
            )
            .join("\n");
    el("inspector").textContent = JSON.stringify(snap, null, 2);
  };

  session.subscribe(render);
  render();

  el("btn-undo").addEventListener("click", () => commands.undo());
  el("btn-redo").addEventListener("click", () => commands.redo());
  el("btn-focus-a").addEventListener("click", () => {
    commands.focusView(viewA.id);
  });
  el("btn-focus-b").addEventListener("click", () => {
    commands.focusView(viewB.id);
  });
  el("btn-nav-child").addEventListener("click", () => {
    commands.navigateTo(viewA.id, "child-a");
  });
  el("btn-scope-other").addEventListener("click", () => {
    commands.setScope(viewA.id, "other", "subtree");
  });
  el("btn-delete-child").addEventListener("click", () => {
    commands.applyStructure({ type: "deleteNode", nodeId: "child-b" });
  });

  window.__harness = {
    commands,
    inspect: () => inspect(session, views),
    getDoc: () => session.document,
    session,
  };

  // Expose stable ids for tests
  (window as unknown as { __viewIds: { a: string; b: string } }).__viewIds = {
    a: viewA.id,
    b: viewB.id,
  };
}

mount();
