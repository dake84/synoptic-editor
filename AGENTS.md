# AGENTS.md

Editor-Komponente auf CodeMirror 6. Diese Datei gilt für jeden — Mensch oder Agent — der in
diesem Repository arbeitet.

## Gegenstand

Wiederverwendbare Markdown-Editor-Komponente: ein Dokument, mehrere gleichzeitig sichtbare
Views mit eigener Darstellung und eigenem Ausschnitt. Kein Anwendungsprodukt.

## Verbindliche Regeln

1. **`SPEC.md` ist die einzige Anforderungsquelle.** Kein Verweis auf externe Dokumente,
   Architekturentscheidungen anderer Projekte oder Tickets als Anforderungsträger. Neue
   Erkenntnis → zuerst in `SPEC.md`, dann implementieren.
2. **Keine Anwendungsdomäne im Code.** Strukturebenen kommen ausschließlich aus dem
   `StructureSchema` (`SPEC.md` § 4). Keine domänenspezifischen Bezeichner in Code, API,
   Klassennamen, Testdaten oder Beispielen.
3. **Invarianten I1–I10 (`SPEC.md` § 5) sind nicht verhandelbar.** Besonders:
   - I5: kein Retry, kein Timeout, kein Best-Effort in Scroll-, Fokus- oder
     Selektionspfaden. Ein Test, der nur mit Warten grün wird, gilt als nicht bestanden.
   - I6: eine Invariante an einer Stelle berechnen und durchsetzen. Eine zweite Absicherung
     derselben Regel ist ein Konstruktionsfehler.
   - I8: der Kern ist frei von UI-Framework-Abhängigkeiten und ohne DOM testbar.
4. **Kein Fix ohne Regel.** Ein Sonderfall, der nur mit einer Ticketnummer begründbar ist,
   ist unfertig. Entweder auf eine benannte Regel zurückführen oder als Anforderung in
   `SPEC.md` aufnehmen.
5. **Kein Code aus fremden Projekten übernehmen** — auch nicht per Copy-Paste einzelner
   Module. Neu geschrieben, nicht neu einsortiert.

## CM6-Referenz

Vor jeder Änderung an `src/sync/**` oder `src/view/**`: **erst die installierten
Typdefinitionen prüfen**, nicht raten und nicht aus Trainingswissen zitieren —
`node_modules/@codemirror/state/dist/index.d.ts` und
`node_modules/@codemirror/view/dist/index.d.ts`. Beide sind vollständig JSDoc-kommentiert
und exakt zur gepinnten Version (`package.json`) — kein Versions-Mismatch-Risiko wie bei
externer Doku.

Die offizielle Referenz (https://codemirror.net/docs/ref/) und die Beispielsammlung
(https://codemirror.net/examples/, insbesondere `split` — Vorbild für § 11.2) sind gut für
Konzepte und Muster, aber **immer gegen die installierten Typen gegenprüfen**: Dieses Repo
wurde bereits einmal von einer ungeprüften Annahme über CM6-Verhalten eingeholt (siehe die
verworfene Variantenfrage in `SPEC.md` § 11) — deren Widerlegung kam erst durch echten Code,
nicht durch Doku-Lektüre allein. Beide zusammen, in dieser Reihenfolge.

## Aufbau

Repository-Schnitt, Prüfskripte, Testebenen und Agenten-Budget: `SETUP.md`.

## Tests

| Ebene | Umfang |
| ----- | ------ |
| Verhalten (E2E) | `SPEC.md` § 14, T1–T108 |
| Unit | Sync-Kern-Mechanik (§ 11.2) |

E2E-Tests lösen Zustände über die Kommandoschnittstelle aus (`SPEC.md` § 13.4), nicht über
Zeigergesten.

## Phasen

`SPEC.md` § 16. Die Architektur ist entschieden (§ 11) — kanonischer State ohne View, ein
`EditorState` je View, Dokument-Weiterleitung, keine Selektions-Weiterleitung — aber in
**diesem** Repository noch nicht neu belegt: `spikes/`, `harness/`, der bisherige
Sync-/View-Layer und die zugehörigen Tests wurden entfernt, weil sie gegen eine inzwischen
verworfene Prämisse gebaut waren (`git log` zeigt die Historie). Erster Schritt ist deshalb
**§ 16.1 neu** — G1–G3 frisch gegen echten Code belegen, mit einem neuen, schlanken Spike —
erst danach Phase 1. `src/core/**` ist davon nicht betroffen und bleibt stehen (kennt CM6
nicht).

## Fertig heißt

Alle Regeln aus `SPEC.md` § 5–10 erfüllt, T1–T108 grün, Benchmark-Ergebnis mit Zahlen und
Falsifikationssatz (§ 15.4), API gehärtet (§ 12).

## Sprache

Antworten an den Maintainer auf Deutsch. Code, Bezeichner und Kommentare auf Englisch.
`SPEC.md` derzeit deutsch; Umstellung auf Englisch bei Veröffentlichung (`SPEC.md` § 17, O3)
— das Repo ist jetzt öffentlich, diese Entscheidung ist nicht mehr rein hypothetisch.
