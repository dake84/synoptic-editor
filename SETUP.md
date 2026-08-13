# Repository- und Harness-Aufbau

Wie das Repository geschnitten wird, damit die Komponente **agentengestützt** gebaut werden
kann, ohne dass die Spezifikation still auseinanderläuft. Wandert mit `SPEC.md` und
`AGENTS.md` ins eigene Repository.

Leitgedanke: **Alles, was in `SPEC.md` als Regel steht, muss mechanisch prüfbar sein.** Eine
Regel, die nur in Prosa lebt, wird von einem Agenten (und von einem Menschen) irgendwann
übergangen — genau so ist der Altbestand entstanden.

---

## 1 · Verzeichnisse

```
SPEC.md                    einzige Anforderungsquelle
AGENTS.md                  Leitplanken für Agenten
SETUP.md                   diese Datei
BUDGETS.json               absolute Messbudgets (SPEC § 16.2, B1)

src/
  core/                    kopflos: kein DOM, kein UI-Framework (I8)
    document.ts            Textwahrheit
    tree.ts                Projektion aus Überschriften + Frontmatter
    timeline.ts            eine Zeitachse, Text und Fremdeinträge
    tracked-position.ts    § 3.4
    dirty.ts               ownRange / subtreeRange (D1–D5)
    search.ts              Projektion, Modi, Trefferklassen
    structure.ts           Kaskadenplanung, R7-Ablehnung
  sync/                    Sync-Kern (§ 11): kanonischer State, Weiterleitung
    engine.ts              ein EditorState je View, Dokument-Weiterleitung (§ 11.2)
    index.ts               createSync()
  view/                    CM6-Adapter, DOM
    presentation/          source | wysiwyg
    guards/                L1–L6, FM1–FM2
    widgets/               Formular, Chips, Pills
    scroll.ts              genau ein Owner, benannte Ursache (I4)
  index.ts                 öffentliche API (§ 12) — einziger Exportpunkt

harness/                   Testoberfläche, wird nicht veröffentlicht
  commands.ts              Kommandoschnittstelle (§ 13.4)
  inspector.ts             Instrumentierung (§ 13.3)

tests/
  behaviour/               T1–T108
  unit/
    sync/                  Sync-Kern-Mechanik (§ 11.2)
  fixtures/corpus.ts       Generator S/M/L, fester Seed

bench/
  run.ts
  results/                 Messläufe, eingecheckt

scripts/
  check-rules-covered.mjs
  check-core-purity.mjs
  check-no-waiting.mjs
  check-export-surface.mjs
```

---

## 2 · Regel-Ids an Tests binden

Der wichtigste Mechanismus. `SPEC.md` vergibt Ids: `I1–I10`, `TP1–TP8`, `V1–V10`,
`S1–S3`, `R1–R7`, `U1–U16`, `D1–D5`, `L1–L6`, `FM1–FM7`, `W1–W5`, `P1–P5`, `F1–F9`,
`RP1–RP7`, `B1–B4`, `G1–G3`.

Jeder Test annotiert, welche Regeln er abdeckt:

```ts
/** @covers T61, D1, D2 */
it("Rumpf eines Kindes ändern lässt den Elternknoten sauber", () => { … })
```

`scripts/check-rules-covered.mjs` liest alle Ids aus `SPEC.md`, alle `@covers` aus `tests/`
und meldet:

| Befund | Bedeutung |
| ------ | --------- |
| Regel ohne Test | **Fehler** — Anforderung nicht belegt |
| `@covers` auf unbekannte Id | **Fehler** — Tippfehler oder gelöschte Regel |
| Testfall-Id `T*` ohne Test | **Fehler** |

Damit ist „ist die Spec umgesetzt" eine Zahl, keine Einschätzung. Und wenn eine Regel
gestrichen wird, schlägt der Test an, der sie noch behauptet.

---

## 3 · Mechanische Prüfungen

Jede erzwingt eine Invariante, die sonst erodiert.

| Skript | Erzwingt | Vorgehen |
| ------ | -------- | -------- |
| `check-core-purity` | **I8** | `src/core/**` importiert nichts aus `@codemirror/view`, keinem UI-Framework, keinem DOM-Global. Verstoß = Fehler. |
| `check-no-waiting` | **I5** | Kein `setTimeout`, `waitForTimeout`, `sleep`, Poll-Schleife mit Intervall/Backoff in `tests/**` — das rät eine Dauer. **Erlaubt** ist ein einzelnes, unbedingtes Warten auf ein wohldefiniertes Ereignis (ein `requestAnimationFrame`, ein Microtask-Flush) — das rät nichts. Für `visibleNode`: Positions→Node-Auflösung als reine Funktion mit injizierter Geometrie unit-testen; nur die Integration gegen echtes Layout braucht den einen Frame-Await. |
| `check-rules-covered` | Spec-Deckung | § 2 |
| `check-export-surface` | **F5** (Spec § 5) | `src/index.ts` exportiert genau die Namen aus SPEC § 12 — nicht mehr. Neue Exporte erfordern eine Spec-Änderung. |

`check-export-surface` ist für ein OSS-Paket der unterschätzte: versehentlich exportierte
Interna werden zu Vertrag, sobald jemand sie benutzt.

---

## 4 · Testebenen und Agenten-Budget

Aus dem Marli-Vorgehen übernommen, weil es sich dort bewährt hat.

| Ebene | Wann | Befehl |
| ----- | ---- | ------ |
| **1 — gezielt** | je Teilaufgabe | `npx vitest run <pfad>` · `npx playwright test <spec>` |
| **2 — Zweig** | Teilaufgaben fertig | `npm run typecheck` + `npm run lint` |
| **3 — Tor** | vor Merge / CI | `npm run verify` |

`verify` = `typecheck` + `lint` + die vier Prüfungen aus § 3 + `test:unit` + `test:behaviour`.

> **Agenten führen ausschließlich Ebene 1 aus.** Nicht `verify`, nicht die vollen Suiten.
> Deren Ausgabe ist lang, ihre Laufzeit auch, und der Erkenntnisgewinn gegenüber dem
> gezielten Test ist null. Ebene 2 und 3 laufen beim Maintainer oder in CI.

---

## 5 · E2E über Kommandos, nicht über Gesten

`SPEC.md` § 13.4 ist keine Bequemlichkeit, sondern die Voraussetzung für I5: Zeigergesten
brauchen Warten auf Layout, Kommandos nicht.

| # | Regel |
| - | ----- |
| E1 | Verhaltenstests lösen Zustände über die Kommandoschnittstelle aus. |
| E2 | Geprüft wird über den Inspector (§ 13.3) oder das gerenderte Ergebnis — nie über interne Objekte der Komponente. |
| E3 | Echte Maus- und Scrollbedienung bleibt möglich und wird stichprobenartig geprüft, ist aber nicht der Testpfad. |

---

## 6 · Benchmark

| # | Regel |
| - | ----- |
| BM1 | `BUDGETS.json` wird **vor** dem ersten Lauf gefüllt (SPEC B1) und liegt unter Versionskontrolle. |
| BM2 | Jeder Lauf schreibt nach `bench/results/<datum>-<commit>.json`. Ergebnisse werden eingecheckt — sonst gibt es keine Zeitreihe. |
| BM3 | Der Lauf schlägt fehl, wenn ein Budget verfehlt wird. Budget anheben statt Ursache beheben ist unzulässig (B2). |
| BM4 | Korpus wird aus festem Seed erzeugt, nie eingecheckt. |

---

## 7 · Agentenführung

**Für Claude Code** gibt es keine bedingte Regelladung — `AGENTS.md` muss alles Wesentliche
selbst tragen und bleibt deshalb kurz. Lange Regelwerke werden nicht besser befolgt, sondern
schlechter.

**Für Cursor** ergänzend schmale, glob-gebundene Regeln:

| Datei | `globs:` | Inhalt |
| ----- | -------- | ------ |
| `.cursor/rules/core.mdc` | `src/core/**` | I8, keine Engine-Importe, keine Domänenbegriffe |
| `.cursor/rules/sync.mdc` | `src/sync/**` | § 7.3 Ablauf, Atomarität, Reentrancy (§ 11.1 Punkt 5) |
| `.cursor/rules/view.mdc` | `src/view/**` | I4 Scroll-Owner, Guards an einer Stelle (I6) |
| `.cursor/rules/tests.mdc` | `tests/**` | `@covers` Pflicht, kein Warten auf Zeit, Kommandos statt Gesten |

### Definition of Done je Aufgabe

1. Betroffene `SPEC.md`-Regeln benannt.
2. Mindestens ein Test trägt `@covers` darauf.
3. Ebene-1-Test grün, Befehl und Ergebnis notiert.
4. `check-rules-covered` grün.
5. Kein neuer Export ohne Spec-Änderung.

### Zwei Regeln gegen die bekannten Fehlermuster

- **Kein Fix ohne Regel.** Ein Sonderfall, der nur mit einer Ticketnummer begründbar ist, ist
  unfertig — entweder auf eine Spec-Regel zurückführen oder die Spec ergänzen. (Diese
  Fehlerklasse hat den Altbestand geprägt.)
- **Erst suchen, dann schreiben.** Vor einem neuen Helfer prüfen, ob es ihn gibt; wenn doch
  ein neuer entsteht, im Commit begründen, warum der vorhandene nicht passte.

---

## 8 · Reihenfolge des Aufbaus

| Schritt | Inhalt |
| ------- | ------ |
| 1 | `SPEC.md`, `AGENTS.md`, `SETUP.md`, Lizenz (SPEC O2) |
| 2 | Tooling: TypeScript, Vitest, Playwright, Lint — ohne Anwendungscode |
| 3 | Die vier Prüfskripte aus § 3, **bevor** Anwendungscode entsteht |
| 4 | Korpusgenerator + `BUDGETS.json` |
| 5 | Neuer, schlanker Spike gegen G1–G3 (SPEC § 16.1) — die Architektur aus § 11.2 ist als Zielbild entschieden, aber in diesem Repository noch nicht belegt; dieser Schritt belegt sie |
| 6 | Phase 1 nach SPEC § 16 |

Schritt 3 vor Schritt 6 ist Absicht: Prüfungen, die erst nachträglich eingeführt werden,
finden einen Berg von Verstößen vor und werden dann abgeschaltet statt befolgt.
