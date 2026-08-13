import {
  applyOrigin,
  clippedCopy,
  createPresentationSession,
  createScopeSession,
  placeCaret,
  proveG1Backspace,
  proveG1Boundary,
  proveG1DocumentEnd,
  proveG1EnterAtFrom,
  proveG1NoPrepend,
  proveG1ScopeLost,
  proveG1StayMounted,
  proveG1Presentation,
  proveG1Scope,
  proveG1SelectAllDelete,
  proveG1SourceMarkerChars,
  proveG1TitleCaret,
  proveG2,
  proveG2TitleSpaces,
  proveG2WysiwygAdjacentMarker,
  proveG2WysiwygDeleteNewline,
  proveG2WysiwygHeadingAtom,
  proveG2DeleteMask,
  proveG2NoDoubleEscape,
  proveG3,
  viewRange,
  SPIKE_DOC,
  visibleSlice,
  type CaretWhere,
  type SpikeSession,
} from "./spike.js";
import { EditorSelection } from "@codemirror/state";

const logEl = document.getElementById("log")!;

const presentation = createPresentationSession({
  parentSrc: document.getElementById("pane-src")!,
  parentWys: document.getElementById("pane-wys")!,
});
const scope = createScopeSession({
  parentA: document.getElementById("pane-a")!,
  parentA1: document.getElementById("pane-a1")!,
  parentA2: document.getElementById("pane-a2")!,
});

function sessionOf(id: string): SpikeSession {
  if (id === "src" || id === "wys") return presentation;
  return scope;
}

function line(result: { id: string; passed: boolean; detail: string }): string {
  return `${result.passed ? "PASS" : "FAIL"} ${result.id}: ${result.detail}`;
}

function refreshLog(extra?: string): void {
  const proofs = [
    proveG1Presentation(createPresentationSession()),
    proveG1Scope(createScopeSession()),
    proveG1Boundary(createScopeSession()),
    proveG1Backspace(createScopeSession()),
    proveG1SelectAllDelete(createScopeSession()),
    proveG1NoPrepend(createScopeSession()),
    proveG1EnterAtFrom(createScopeSession()),
    proveG1StayMounted(createScopeSession()),
    proveG1ScopeLost(createScopeSession()),
    proveG1TitleCaret(createScopeSession()),
    proveG1SourceMarkerChars(createScopeSession()),
    proveG1DocumentEnd(createPresentationSession()),
    proveG2(createPresentationSession()),
    proveG2WysiwygHeadingAtom(createPresentationSession()),
    proveG2WysiwygAdjacentMarker(createPresentationSession()),
    proveG2TitleSpaces(createPresentationSession()),
    proveG2WysiwygDeleteNewline(createPresentationSession()),
    proveG2DeleteMask(createPresentationSession()),
    proveG2NoDoubleEscape(createPresentationSession()),
    proveG3(createPresentationSession()),
  ];
  const src = presentation.views[0]!;
  const wys = presentation.views[1]!;
  const a = scope.views[0]!;
  const a1 = scope.views[1]!;
  const a2 = scope.views[2]!;
  const live = [
    `scene1 session === src === wys: ${presentation.sessionState.doc.eq(src.state.doc) && src.state.doc.eq(wys.state.doc)}`,
    `src visible: ${JSON.stringify(visibleSlice(presentation, "src"))}`,
    `wys visible: ${JSON.stringify(visibleSlice(presentation, "wys"))}`,
    `src head ${src.state.selection.main.head} · wys head ${wys.state.selection.main.head}`,
    `scene2 session === A === A1 === A2: ${scope.sessionState.doc.eq(a.state.doc) && a.state.doc.eq(a1.state.doc) && a1.state.doc.eq(a2.state.doc)}`,
    `A visible: ${JSON.stringify(visibleSlice(scope, "A"))}`,
    `A1 visible: ${JSON.stringify(visibleSlice(scope, "A1"))}`,
    `A2 visible: ${JSON.stringify(visibleSlice(scope, "A2"))}`,
  ];
  logEl.textContent = [...proofs.map(line), "", ...live, extra ?? ""].join("\n");
}

refreshLog(`mounted. doc length ${SPIKE_DOC.length}`);

(window as unknown as { __spike: unknown }).__spike = {
  presentation,
  scope,
  typeIn(id: string, text: string) {
    const session = sessionOf(id);
    const slot = session.views.find((v) => v.id === id)!;
    const pos = slot.state.selection.main.head;
    applyOrigin(session, id, [{ changes: { from: pos, to: pos, insert: text } }]);
    refreshLog(`typed ${JSON.stringify(text)} in ${id}`);
  },
  placeCaret(id: string, where: CaretWhere) {
    const session = sessionOf(id);
    placeCaret(session, id, where);
    const slot = session.views.find((v) => v.id === id)!;
    slot.view?.focus();
    refreshLog(`caret ${id} → ${where} @ ${slot.state.selection.main.head}`);
  },
  selectAll(id: string) {
    const session = sessionOf(id);
    const slot = session.views.find((v) => v.id === id)!;
    const range = viewRange(slot.state);
    const from = range?.from ?? 0;
    const to = range?.to ?? slot.state.doc.length;
    applyOrigin(session, id, [{ selection: EditorSelection.single(from, to) }]);
    refreshLog(`selectAll ${id}`);
  },
  clippedCopy(id: string) {
    const session = sessionOf(id);
    const slot = session.views.find((v) => v.id === id)!;
    const doc = slot.state.doc.toString();
    const range = viewRange(slot.state)!;
    const sel = slot.state.selection.main;
    return clippedCopy(doc, sel.from, sel.to, range.from, range.to);
  },
  inspect() {
    const src = presentation.views[0]!;
    const wys = presentation.views[1]!;
    const a = scope.views[0]!;
    const a1 = scope.views[1]!;
    const a2 = scope.views[2]!;
    return {
      presentation: {
        session: presentation.sessionState.doc.toString(),
        src: src.state.doc.toString(),
        wys: wys.state.doc.toString(),
        srcVisible: visibleSlice(presentation, "src"),
        wysVisible: visibleSlice(presentation, "wys"),
        srcHead: src.state.selection.main.head,
        wysHead: wys.state.selection.main.head,
        srcDom: src.view?.contentDOM.textContent ?? "",
        wysDom: wys.view?.contentDOM.textContent ?? "",
      },
      scope: {
        session: scope.sessionState.doc.toString(),
        A: a.state.doc.toString(),
        A1: a1.state.doc.toString(),
        A2: a2.state.doc.toString(),
        aVisible: visibleSlice(scope, "A"),
        a1Visible: visibleSlice(scope, "A1"),
        a2Visible: visibleSlice(scope, "A2"),
        aHead: a.state.selection.main.head,
        a1Head: a1.state.selection.main.head,
        a2Head: a2.state.selection.main.head,
        aDom: a.view?.contentDOM.textContent ?? "",
        a1Dom: a1.view?.contentDOM.textContent ?? "",
        a2Dom: a2.view?.contentDOM.textContent ?? "",
        scopeLost: scope.scopeLost,
      },
    };
  },
};
