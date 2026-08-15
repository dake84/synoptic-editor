/**
 * Spike harness: prove heading-slot height must be known before CM lays out the line.
 * Port 4176 — does not touch harness/ (:4173).
 */

import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import {
  createSession,
  type Session,
  type StructureSchema,
  type ViewHandle,
} from "../../src/index.js";
import {
  collapsibleHeadingExtension,
  CollapsibleHeadingWidget,
  SLOT_BROKEN_ESTIMATE,
  SLOT_COLLAPSED,
  SLOT_EXPANDED,
  type SlotMode,
} from "./widgets.js";

const SCHEMA: StructureSchema = {
  levels: [
    { rank: 0, id: "level-0", headingDepth: 1 },
    { rank: 1, id: "level-1", headingDepth: 2 },
  ],
  idField: "id",
};

const SECTION_COUNT = 24;
const BODY_LINES = 18;

function buildDoc(): string {
  const parts: string[] = [
    "---\nid: root\n---\n\n# Document\n\nRoot intro. Scroll the pane with the mouse wheel.\n\n",
  ];
  for (let i = 0; i < SECTION_COUNT; i++) {
    parts.push(`---\nid: n${i}\nnote: tag-${i}\nmeta: extra-${i}\n---\n\n`);
    parts.push(`## Section ${i}\n\n`);
    for (let j = 0; j < BODY_LINES; j++) {
      parts.push(
        `Body ${i}.${j}: lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod.\n`,
      );
    }
    parts.push("\n");
  }
  return parts.join("");
}

type Metrics = {
  scrollSamples: number[];
  heightJumps: number;
  scrollCorrections: number;
  layoutShifts: number;
  lastScrollTop: number;
  widgetMismatches: number;
  scrollHeightMin: number;
  scrollHeightMax: number;
  notes: string[];
};

function emptyMetrics(): Metrics {
  return {
    scrollSamples: [],
    heightJumps: 0,
    scrollCorrections: 0,
    layoutShifts: 0,
    lastScrollTop: 0,
    widgetMismatches: 0,
    scrollHeightMin: Number.POSITIVE_INFINITY,
    scrollHeightMax: 0,
    notes: [],
  };
}

let session: Session | null = null;
let view: ViewHandle | null = null;
let metrics = emptyMetrics();
let scrolling = false;
let pendingMeasureSnap: { scrollTop: number; heights: number[] } | null = null;

const overlay = () => document.getElementById("overlay")!;

function selectedModes(): { collapsible: boolean; native: boolean; late: boolean; correct: boolean } {
  const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="mode"]'));
  const on = new Set(boxes.filter((b) => b.checked).map((b) => b.value));
  return {
    collapsible: on.has("collapsible"),
    native: on.has("native"),
    late: on.has("late"),
    correct: (document.getElementById("opt-correct") as HTMLInputElement).checked,
  };
}

function slotMode(): SlotMode {
  const m = selectedModes();
  // C wins: sync height, no microtask growth — covers variants 1 and 3.
  if (m.correct) return "correct";
  if (m.late) return "late";
  return "broken";
}

function visibleSlotHeights(port: HTMLElement): number[] {
  const slots = Array.from(port.querySelectorAll<HTMLElement>(".spike-heading-slot"));
  const out: number[] = [];
  for (const el of slots) {
    const painted = Number(el.dataset.paintedHeight ?? el.getBoundingClientRect().height);
    out.push(painted);
  }
  return out;
}

function checkEstimatedVsPainted(ev: EditorView): number {
  let mismatches = 0;
  const port = ev.scrollDOM;
  for (const el of Array.from(port.querySelectorAll<HTMLElement>(".spike-heading-slot"))) {
    const painted = Number(el.dataset.paintedHeight ?? "0");
    const mode = el.dataset.mode as SlotMode;
    const expanded = el.dataset.expanded === "true";
    let estimated = SLOT_BROKEN_ESTIMATE;
    if (mode === "correct") estimated = expanded ? SLOT_EXPANDED : SLOT_COLLAPSED;
    // After late microtask, painted grows but estimated stays 48 — count as mismatch.
    if (painted !== estimated) mismatches += 1;
  }
  return mismatches;
}

function renderOverlay(): void {
  const el = overlay();
  const m = selectedModes();
  const mode = slotMode();
  const heightDrift =
    Number.isFinite(metrics.scrollHeightMin) && metrics.scrollHeightMax > 0
      ? metrics.scrollHeightMax - metrics.scrollHeightMin
      : 0;
  const estimateOk = metrics.widgetMismatches === 0;
  const fail =
    metrics.layoutShifts > 0 ||
    metrics.scrollCorrections > 0 ||
    metrics.heightJumps > 0 ||
    !estimateOk ||
    // Under-estimated slots grow the height map as toDOM runs (virtualization).
    (metrics.scrollSamples.length >= 5 && heightDrift > 80 && (mode === "broken" || mode === "late"));

  const verdict =
    metrics.scrollSamples.length === 0
      ? "idle — wheel through several headings"
      : fail
        ? "FAIL — estimate≠paint and/or height-map growth while rolling"
        : estimateOk
          ? "PASS — toDOM height = estimatedHeight; no correction spikes"
          : "WATCH";

  el.className = verdict.startsWith("FAIL") ? "fail" : verdict.startsWith("PASS") ? "pass" : "";
  el.textContent = [
    `verdict: ${verdict}`,
    `modes: collapsible=${m.collapsible} correctC=${m.correct} native=${m.native} late=${m.late}`,
    `slotMode=${mode}  SLOT collapsed=${SLOT_COLLAPSED} expanded=${SLOT_EXPANDED} brokenEst=${SLOT_BROKEN_ESTIMATE}`,
    `scrollTop=${metrics.lastScrollTop.toFixed(1)}  samples=${metrics.scrollSamples.length}`,
    `scrollHeight drift=${heightDrift} (min=${metrics.scrollHeightMin} max=${metrics.scrollHeightMax})`,
    `layoutShifts=${metrics.layoutShifts}  scrollCorrections=${metrics.scrollCorrections}  heightJumps=${metrics.heightJumps}`,
    `widgetEstimateMismatches(visible)=${metrics.widgetMismatches}`,
    ...metrics.notes.slice(-8),
  ].join("\n");
}

function instrumentationPlugin(): Extension {
  return ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        const orig = view.requestMeasure.bind(view);
        (view as unknown as { requestMeasure: typeof view.requestMeasure }).requestMeasure = (
          ...args: Parameters<EditorView["requestMeasure"]>
        ) => {
          const port = view.scrollDOM;
          pendingMeasureSnap = {
            scrollTop: port.scrollTop,
            heights: visibleSlotHeights(port),
          };
          return orig(...args);
        };
      }

      update(): void {
        const port = this.view.scrollDOM;
        const top = port.scrollTop;
        if (pendingMeasureSnap) {
          const before = pendingMeasureSnap;
          pendingMeasureSnap = null;
          const afterH = visibleSlotHeights(port);
          if (Math.abs(top - before.scrollTop) > 0.5 && scrolling) {
            metrics.scrollCorrections += 1;
            metrics.notes.push(
              `measure corrected scrollTop ${before.scrollTop.toFixed(1)} → ${top.toFixed(1)}`,
            );
          }
          if (
            afterH.length &&
            before.heights.length &&
            afterH.some((h, i) => Math.abs(h - (before.heights[i] ?? h)) > 1)
          ) {
            metrics.heightJumps += 1;
            metrics.notes.push(`measure height jump ${JSON.stringify(before.heights)} → ${JSON.stringify(afterH)}`);
          }
        }
        metrics.widgetMismatches = checkEstimatedVsPainted(this.view);
        metrics.lastScrollTop = top;
        renderOverlay();
      }

      destroy(): void {}
    },
  );
}

function destroy(): void {
  view?.destroy();
  view = null;
  session = null;
  const host = document.getElementById("editor-host");
  if (host) host.replaceChildren();
}

function rebuild(): void {
  destroy();
  metrics = emptyMetrics();
  const m = selectedModes();
  const mode = slotMode();

  const policy = m.native
    ? { pillFields: ["note", "meta"], frontmatterInWysiwyg: "form" as const }
    : { pillFields: [] as string[], frontmatterInWysiwyg: "hidden" as const };

  session = createSession({
    doc: buildDoc(),
    schema: SCHEMA,
    policy,
  });

  const presentationExtensions: Partial<Record<"source" | "wysiwyg", Extension[]>> = {};
  const wys: Extension[] = [instrumentationPlugin()];
  if (m.collapsible || m.late) {
    wys.push(collapsibleHeadingExtension(SCHEMA, mode));
  }
  presentationExtensions.wysiwyg = wys;

  view = session.createView({
    scope: { nodeId: "root", include: "subtree" },
    presentation: "wysiwyg",
    presentationExtensions,
  });

  const host = document.getElementById("editor-host")!;
  view.mount(host);

  const port = view.scrollPort;
  if (port) {
    metrics.lastScrollTop = port.scrollTop;
    port.addEventListener(
      "scroll",
      () => {
        scrolling = true;
        const t = port.scrollTop;
        metrics.lastScrollTop = t;
        metrics.scrollSamples.push(t);
        const sh = port.scrollHeight;
        metrics.scrollHeightMin = Math.min(metrics.scrollHeightMin, sh);
        metrics.scrollHeightMax = Math.max(metrics.scrollHeightMax, sh);
        // Detect non-monotone correction while user scrolls down (jump back up).
        const n = metrics.scrollSamples.length;
        if (n >= 3) {
          const a = metrics.scrollSamples[n - 3]!;
          const b = metrics.scrollSamples[n - 2]!;
          const c = metrics.scrollSamples[n - 1]!;
          // Down then sudden up while still rolling → correction
          if (b > a + 2 && c < b - 4) {
            metrics.scrollCorrections += 1;
            metrics.notes.push(`scrollTop non-monotone ${a.toFixed(0)}→${b.toFixed(0)}→${c.toFixed(0)}`);
          }
        }
        renderOverlay();
        queueMicrotask(() => {
          scrolling = false;
        });
      },
      { passive: true },
    );
  }

  metrics.notes.push(`mounted sections=${SECTION_COUNT} docLen=${session.document.length}`);
  renderOverlay();
}

function setupLayoutShiftObserver(): void {
  if (typeof PerformanceObserver === "undefined") return;
  try {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType !== "layout-shift") continue;
        const ls = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
        if (ls.hadRecentInput) continue;
        metrics.layoutShifts += 1;
        metrics.notes.push(`layout-shift value=${(ls.value ?? 0).toFixed(4)}`);
        renderOverlay();
      }
    });
    obs.observe({ type: "layout-shift", buffered: true } as PerformanceObserverInit);
  } catch {
    metrics.notes.push("LayoutShift observer unavailable");
  }
}

document.getElementById("btn-rebuild")!.addEventListener("click", () => rebuild());
document.getElementById("btn-reset")!.addEventListener("click", () => {
  metrics = emptyMetrics();
  renderOverlay();
});
document.getElementById("btn-navigate")!.addEventListener("click", () => {
  view?.navigateTo(`n${SECTION_COUNT - 1}`);
  metrics.notes.push(`navigateTo n${SECTION_COUNT - 1}`);
  renderOverlay();
});
for (const el of Array.from(document.querySelectorAll("input[name=mode], #opt-correct"))) {
  el.addEventListener("change", () => rebuild());
}

setupLayoutShiftObserver();
rebuild();

(window as unknown as { __spike: unknown }).__spike = {
  rebuild,
  metrics: () => metrics,
  session: () => session,
  view: () => view,
  CollapsibleHeadingWidget,
};
