/**
 * Block deletions that would join prose with a schema heading or bound YAML (L8).
 */

import { type EditorState as EditorStateType, type Extension } from "@codemirror/state";
import { hiddenFrontmatterRanges, projectTree } from "../../core/tree.js";
import type { StructureSchema } from "../../core/types.js";
import { syncAnnotation } from "../../sync/engine.js";
import { hostWriteAnnotation } from "./locked-ranges.js";
import { namedChangeFilter } from "./filter-trace.js";

export type StructureJoinSchemaArg =
  StructureSchema | ((state: EditorStateType) => StructureSchema);

function resolveSchema(schema: StructureJoinSchemaArg, state: EditorStateType): StructureSchema {
  return typeof schema === "function" ? schema(state) : schema;
}

function isBlankLineText(text: string): boolean {
  return text.trim().length === 0;
}

function structuralLineFroms(doc: string, schema: StructureSchema): Set<number> {
  const froms = new Set<number>();
  for (const node of projectTree(doc, schema).nodes.values()) {
    froms.add(node.heading.from);
  }
  for (const zone of hiddenFrontmatterRanges(doc, schema)) {
    let pos = zone.from;
    while (pos < zone.to) {
      froms.add(pos);
      const nl = doc.indexOf("\n", pos);
      if (nl < 0 || nl >= zone.to) break;
      pos = nl + 1;
    }
  }
  return froms;
}

function isStructuralLine(state: EditorStateType, lineNo: number, froms: Set<number>): boolean {
  return froms.has(state.doc.line(lineNo).from);
}

function isProseLine(state: EditorStateType, lineNo: number, froms: Set<number>): boolean {
  if (isStructuralLine(state, lineNo, froms)) return false;
  return !isBlankLineText(state.doc.line(lineNo).text);
}

/** Backspace at `pos` would join this prose line with structure above. */
export function isBackwardJoinBlocked(
  state: EditorStateType,
  pos: number,
  schema: StructureSchema,
): boolean {
  if (pos <= 0) return true;
  const line = state.doc.lineAt(pos);
  if (pos !== line.from) return false;
  const froms = structuralLineFroms(state.doc.toString(), schema);
  if (!isProseLine(state, line.number, froms)) return false;
  for (let prevNo = line.number - 1; prevNo >= 1; prevNo--) {
    if (isBlankLineText(state.doc.line(prevNo).text)) continue;
    return isStructuralLine(state, prevNo, froms);
  }
  return true;
}

/** Delete at `pos` would join this prose line with structure below. */
export function isForwardJoinBlocked(
  state: EditorStateType,
  pos: number,
  schema: StructureSchema,
): boolean {
  const line = state.doc.lineAt(pos);
  const froms = structuralLineFroms(state.doc.toString(), schema);
  if (!isProseLine(state, line.number, froms)) return false;
  if (pos !== line.to - 1 && pos !== line.to) return false;
  for (let nextNo = line.number + 1; nextNo <= state.doc.lines; nextNo++) {
    if (isBlankLineText(state.doc.line(nextNo).text)) continue;
    return isStructuralLine(state, nextNo, froms);
  }
  return false;
}

function deletionJoinsStructure(
  state: EditorStateType,
  fromA: number,
  toA: number,
  schema: StructureSchema,
): boolean {
  if (toA <= fromA) return false;
  for (let pos = fromA + 1; pos <= toA; pos++) {
    if (isBackwardJoinBlocked(state, pos, schema)) return true;
  }
  for (let pos = fromA; pos < toA; pos++) {
    if (isForwardJoinBlocked(state, pos, schema)) return true;
  }
  return false;
}

/** Isolated wysiwyg / session chrome: prose must not merge into schema headings or bound YAML. */
export function structureJoinFilter(schema: StructureJoinSchemaArg): Extension {
  return namedChangeFilter("structureJoinFilter", (tr) => {
    if (!tr.docChanged) return true;
    if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) return true;
    if (tr.annotation(syncAnnotation)) return true;
    if (tr.annotation(hostWriteAnnotation)) return true;
    const resolved = resolveSchema(schema, tr.startState);
    let blocked = false;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (inserted.length > 0 || toA <= fromA) return;
      if (deletionJoinsStructure(tr.startState, fromA, toA, resolved)) blocked = true;
    });
    return !blocked;
  });
}
