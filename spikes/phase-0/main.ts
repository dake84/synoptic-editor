import { createSpikeSession, defaultCarets, type SpikeSession } from "./spike";

export type SpikeApi = {
  getDoc(): string;
  focusView(id: string): void;
  setSelection(id: string, anchor: number, head?: number): void;
  typeText(id: string, text: string): void;
  pasteText(id: string, text: string): void;
  deleteBackward(id: string): void;
  undo(id: string): boolean;
  getSnapshot(id: string): ReturnType<SpikeSession["getSnapshot"]>;
  getCarets(): { a: number; b: number };
};

declare global {
  var __spike: SpikeApi;
}

function mount() {
  const parentA = document.getElementById("view-a");
  const parentB = document.getElementById("view-b");
  const status = document.getElementById("status");
  if (!parentA || !parentB) throw new Error("missing view mounts");

  const carets = defaultCarets();
  const session = createSpikeSession([
    { id: "a", parent: parentA, presentation: "source", initialCaret: carets.a },
    { id: "b", parent: parentB, presentation: "wysiwyg", initialCaret: carets.b },
  ]);

  const updateStatus = () => {
    if (!status) return;
    const sa = session.getSnapshot("a");
    const sb = session.getSnapshot("b");
    status.textContent =
      `docsInSync=${sa.docsInSync} | ` +
      `selA=${sa.selection.head} inOwn=${sa.selectionInOwnBranch} | ` +
      `selB=${sb.selection.head} inOwn=${sb.selectionInOwnBranch}`;
  };

  window.__spike = {
    getDoc: () => session.getDoc(),
    focusView: (id) => {
      session.focusView(id);
      updateStatus();
    },
    setSelection: (id, anchor, head) => {
      session.setSelection(id, anchor, head);
      updateStatus();
    },
    typeText: (id, text) => {
      session.typeText(id, text);
      updateStatus();
    },
    pasteText: (id, text) => {
      session.pasteText(id, text);
      updateStatus();
    },
    deleteBackward: (id) => {
      session.deleteBackward(id);
      updateStatus();
    },
    undo: (id) => {
      const ok = session.undo(id);
      updateStatus();
      return ok;
    },
    getSnapshot: (id) => session.getSnapshot(id),
    getCarets: () => defaultCarets(session.getDoc()),
  };

  updateStatus();
}

mount();
