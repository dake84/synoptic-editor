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

## Aufbau

Repository-Schnitt, Prüfskripte, Testebenen und Agenten-Budget: `SETUP.md`.

## Tests

| Ebene | Umfang | Variantenbindung |
| ----- | ------ | ---------------- |
| Verhalten (E2E) | `SPEC.md` § 14, T1–T106 | variantenunabhängig, laufen gegen beide |
| Verhalten (E2E) | T-V1, T-V2 | je Variante festgeschrieben |
| Unit | Synchronisationskern | je Variante getrennt |

E2E-Tests lösen Zustände über die Kommandoschnittstelle aus (`SPEC.md` § 13.4), nicht über
Zeigergesten.

## Phasen

`SPEC.md` § 16. **Phase 0 ist das Risikotor G1–G3** — Presentation, Guards,
Selektionsunabhängigkeit; ohne geteilten `EditorState`. Phase 1 folgt der Spike-Konstruktion
(ein `EditorState` je View, Document-Weiterleitung). V-S ist dokumentierte Alternative
(§ 11.2), nicht durch das Tor gedeckt.

## Fertig heißt

Alle Regeln aus `SPEC.md` § 5–10 erfüllt, T1–T106 grün, Benchmark-Ergebnis mit Zahlen und
Falsifikationssatz (§ 15.4), API gehärtet (§ 12).

## Sprache

Antworten an den Maintainer auf Deutsch. Code, Bezeichner und Kommentare auf Englisch.
`SPEC.md` derzeit deutsch; Umstellung auf Englisch bei Veröffentlichung (`SPEC.md` § 17, O3)
— das Repo ist jetzt öffentlich, diese Entscheidung ist nicht mehr rein hypothetisch.
