# Phase 0 risk-gate spike (G1–G3)

Throwaway evidence for `SPEC.md` § 16.1. Not production code — do not lift into
`src/` (see `AGENTS.md` rule 5). Kept as the written record behind the gate verdict.

Construction: one `EditorState` per view; forward document changes only (CodeMirror
split). Shared `EditorState` is not a gate requirement.

## Run locally

```bash
npm run spike:phase0
# → http://127.0.0.1:4174/
```

## Playwright

```bash
npx playwright test tests/behaviour/phase-0-gate.spec.ts
```

The behaviour suite starts the spike server via `playwright.config.ts`.
