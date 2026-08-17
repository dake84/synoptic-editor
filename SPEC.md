# Editor-Komponente — Spezifikation

Markdown-Editor-Komponente auf CodeMirror 6. Ein Dokument, mehrere gleichzeitig sichtbare
Views mit unterschiedlicher Darstellung und unterschiedlichem Ausschnitt.

Status: Entwurf. Diese Datei wird `SPEC.md` im eigenen Repository und ist dort die einzige
Anforderungsquelle. Die öffentliche Host-API ist § 12 — nicht mehr, nicht weniger.

---

## 1 · Gegenstand

**Ziel:** eine wiederverwendbare Editor-Komponente, die

- ein Markdown-Dokument als einzige Textwahrheit hält,
- daraus einen Strukturbaum projiziert,
- beliebig viele Views darauf zulässt — je View eigene Darstellung, eigener Ausschnitt,
  eigener Scroll,
- Undo/Redo und Suche über das gesamte Dokument führt,
- Nicht-Text-Aktionen auf dieselbe Zeitachse nimmt, auch host-eigene.

**Nicht Gegenstand:** Persistenz, Dateisystem, Netzwerk, Client-Synchronisation,
Autovervollständigung, Linting, Rechtschreibung, Mehrfachauswahl, kollaborative Bearbeitung.

**Domänenfreiheit (verbindlich):** Die Komponente kennt keine Anwendungsdomäne.
Strukturebenen kommen als Konfiguration (§ 3.2). Keine domänenspezifischen Bezeichner in
Code, API, Klassennamen oder Testdaten.

### 1.1 Die entscheidende Annahme

> **Das Dokument ist ein Markdown-String. Jede View ist eine Projektion dieses Strings. Es
> gibt keinen Parse-/Serialisierungs-Roundtrip.**

Aus dieser einen Annahme folgt der größte Teil dieser Spezifikation — und die Wahl der
Engine (§ 2). Wird sie fallengelassen, ist die Spezifikation neu zu schreiben, nicht zu
ändern.

---

## 2 · Engine-Wahl

### 2.1 Kandidaten

| Familie | Dokumentmodell | Verhältnis zu § 1.1 |
| ------- | -------------- | ------------------- |
| **Textbasiert** (CodeMirror 6) | Text + Dekorationen | Deckungsgleich — der Puffer *ist* Markdown |
| **Baumbasiert** (ProseMirror, Tiptap, BlockNote) | Knotenbaum nach Schema | Widerspruch — Markdown ist Import-/Exportformat, nicht Wahrheit |
| **Eigenimplementierung** | frei | Deckungsgleich, aber Aufwand nicht vertretbar |

**Baumbasiert scheidet an § 1.1 aus, nicht an Qualität.** Um die Invarianten I1/I2 zu
erfüllen, bräuchte es ein zu Markdown isomorphes Schema plus verlustfreie Serialisierung in
beide Richtungen. Genau dort entstehen Roundtrip-Verluste, und versteckter, aber in der
Historie vorhandener Frontmatter (§ 8.2) ist in einem Knotenmodell ein Fremdkörper.

**Eigenimplementierung scheidet am Umfang aus:** Textlayout, Selektion, IME, Bidi,
Barrierefreiheit, Viewport-Virtualisierung und Undo-Primitiven sind Jahre an Arbeit, die
keinen Anforderungsvorteil erzeugen.

### 2.2 Was von CodeMirror 6 genutzt wird — und was wir bauen

Antwort auf „was bleibt übrig und was müssen wir verbiegen":

| Fähigkeit | Herkunft |
| --------- | -------- |
| Textmodell, `ChangeSet`, Positionsabbildung | nativ |
| Selektion, IME, Bidi, Barrierefreiheit | nativ |
| Viewport-Virtualisierung (entscheidend für Korpus L) | nativ |
| Dekorationen, `atomicRanges`, Block- und Inline-Widgets | nativ |
| `changeFilter` / `transactionFilter` als Guard-Mechanik | nativ |
| Undo-Primitive (`history`) | nativ, aber der Timeline untergeordnet (§ 7) |
| Markdown-Syntaxbaum (Lezer) | nativ |
| **Timeline über Text- und Nicht-Text-Aktionen** | **gebaut** |
| **Mehr-View-Synchronisation** | **gebaut** — bietet keine Engine nativ |
| **Node-Projektion aus Überschriften/Frontmatter** | **gebaut** |
| **Scope-/Grain-Rendering je View** | **gebaut** |
| **visibleNode aus Scrollposition** | **gebaut** |
| Presentation und Guards je View | **nativ, direkt konfiguriert** — jede View hat ihren eigenen State (§ 11), kein Bend-Mechanismus nötig |

Nichts an der Engine muss verbogen werden — jede genutzte Fähigkeit ist entweder nativ oder
liegt sauber oberhalb der Engine. Das ist der Grund, warum die Wahl nicht als offen geführt
wird.

### 2.3 Falsifikation

Die Engine-Wahl ist zurückzunehmen, wenn die Weiterleitungskosten des Sync-Kerns (§ 11) bei
Korpus L prohibitiv sind **und** sich nicht durch Optimierung innerhalb des Modells lösen
lassen. Dann ist § 1.1 selbst zu prüfen, nicht die Engine.

---

## 3 · Modell

### 3.1 Objekte

| Objekt | Definition |
| ------ | ---------- |
| **Document** | Markdown-String. Einzige Textwahrheit. |
| **Node** | Aus dem Document projizierte Struktureinheit: ATX-Überschrift + optionaler Frontmatter-Block + Rumpf. Identität über Frontmatter-Id. |
| **Tree** | Geordnete Projektion aller Nodes. Kein zweiter Datenbestand. |
| **ownRange(n)** | Überschrift + Frontmatter + Rumpf **bis zur ersten Kind-Überschrift**. |
| **subtreeRange(n)** | `ownRange(n)` einschließlich aller Nachkommen. |
| **View** | Eine Darstellung. Hat Scope, Presentation, Grain, Scroll, Find-Zustand. Jede View hält einen eigenen `EditorState` plus `EditorView` und denselben vollen `Text` wie die Session — keinen kürzeren Puffer. |
| **Scope** | Node-Id **plus Include-Modus**: `own` oder `subtree`. |
| **renderRange(v)** | **Initiale** Range von View `v`: `ownRange(scope)` bei `include: 'own'`, sonst `subtreeRange(scope)`. **`to` ist exklusiv:** die letzte editierbare Position ist `to - 1` (bzw. `to`, wenn `to` das Dokumentende ist). Ein Insert *bei* `to` ist das erste Zeichen der nächsten Node. Der **lebende** Ausschnitt ist nicht `renderRange`, sondern `ScopeRange` (§ 3.6). |
| **ScopeRange** | Lebender Ausschnitt einer offenen View: `{ from, to, lost }`, durch jede Änderung abgebildet (§ 3.6). Eine Stelle (I6). |
| **Session** | Hält `SessionEditorState`, Tree, Baseline, View-Register, Schema, TrackedPositions; nutzt eine Timeline. |
| **SessionEditorState** | Session-eigener CM6-`EditorState` **ohne** `EditorView`. Die eine Textwahrheit. Views projizieren ihn. |
| **Timeline** | Chronologische Folge rücknehmbarer Einträge. Injizierbar (§ 9.1). |
| **TrackedPosition** | Stabile, mitwandernde Marke auf einer Position oder einem Bereich (§ 3.4). |

Die Unterscheidung `ownRange` / `subtreeRange` ist tragend — sie entscheidet Dirty-Semantik
(§ 9.3), Bereichsrelationen (§ 6.1) und über den Include-Modus, was eine View überhaupt zeigt.

**Include-Modus:** `subtree` zeigt den Knoten mit allen Nachkommen (Voreinstellung),
`own` nur seinen eigenen Inhalt — Überschrift, Frontmatter und Rumpf bis zur ersten
Kind-Überschrift. Der Modus ist **unabhängig vom Grain** (A7): Grain bestimmt die
Darstellung, `include` den Umfang. Beides zu koppeln, war im Altbestand die Quelle der
Grain-Wechsel-Rennen (T17).

### 3.2 Eigentum

Kein Belang existiert auf beiden Ebenen. Kein Wert wird zweimal geführt.

| Session | View |
| ------- | ---- |
| SessionEditorState · Tree · Baseline · View-Register · Schema · Fokus · Timeline-Anbindung | Scope · Presentation · Grain · Scrollposition · visibleNode · Find-Zustand · eigener EditorState |

Abgeleitet, nicht gespeichert:

```
session.activeNode      := view[focused].scope
session.visibleNode     := view[focused].visibleNode
session.isDirty(n)      := text(ownRange(n))     ≠ baseline(ownRange(n))
session.isSubtreeDirty(n) := text(subtreeRange(n)) ≠ baseline(subtreeRange(n))
```

### 3.3 Presentation

| Presentation | Verhalten |
| ------------ | --------- |
| `source` | Rohtext inklusive Frontmatter und aller Marker. |
| `wysiwyg` | Marker versteckt, Frontmatter als Formular-Widget (§ 8.2), Inline-Referenzen als Widgets (§ 8.3), Metadaten-Pills (§ 8.4), HTML-Kommentare ausgeblendet (§ 8.5), Inline-Chrome für Emphasis/Strong/Code/Strike (§ 8.6), Strukturebenen typografisch ausgezeichnet. |

Der Puffer ist in beiden identisch.

**Scope-Überschrift in `wysiwyg`:** `showNodeHeading` (View-Option, Default `true`) steuert, ob
die ATX-Zeile des **aktuellen Scope-Knotens** in der Wysiwyg-Fläche leser-sichtbar ist.
`false` blendet genau diese eine Überschrift aus (Titel + Marker + folgendes Newline) —
Kind-Überschriften bleiben sichtbar. Der Pin/Chrome darüber ist Host-Sache (§ 12.1); die
Komponente kennt keinen Pin. In `source` ist die Option wirkungslos.

| # | Regel |
| - | ----- |
| **SNH1** | `showNodeHeading: true` (Default): Scope-Überschrift wie jede andere sichtbare Überschrift (L4, F6). |
| **SNH2** | `showNodeHeading: false` in `wysiwyg`: die Heading-Range des Scope-Knotens (`TreeNode.heading`, inkl. folgendem Newline) ist ausgeblendet und nicht per Caret erreichbar. Kind-Überschriften im Ausschnitt bleiben sichtbar und editierbar. |
| **SNH3** | `setScope` / `setShowNodeHeading` aktualisieren die Ausblendung ohne Remount und ohne Timeline-Eintrag (wie `setGrain`). |
| **SNH4** | Die ausgeblendete Scope-Überschrift nimmt an der Wysiwyg-Suche nicht teil (F4); in `source` bleibt sie suchbar (F5). |
| **V11** | Der Scroll-Anker zwischen Presentations ist ein Dokument-Offset, nie ein Pixelwert (V3). `bodyBlockStarts` liefert die Start-Offsets der sichtbaren Rumpf-Blöcke nach Überschrift und angrenzendem Frontmatter; HTML-Kommentare sind keine Blöcke. `blockIndexAtOffset` mappt eine Position auf den letzten Start bei oder vor ihr, oder −1 wenn die Position vor dem ersten Block liegt. |

### 3.4 TrackedPosition

Eine **TrackedPosition** ist eine Marke auf einer Position oder einem Bereich, die durch jede
Textänderung mitgeführt wird. Sie ist das gemeinsame Primitiv für alles, was „zeigt auf eine
Stelle im Text und muss dort bleiben" — Host-Annotationen, Scrollposition, Caret.

> **Kein CodeMirror-Begriff.** CM6 kennt keine TrackedPosition als API; `EditorSelection.anchor`
> ist etwas anderes (das feste Ende einer Selektion). Gebaut wird sie aus den Bausteinen der
> Engine: `ChangeSet.mapPos` bildet eine Position durch eine Änderung ab, ein `StateField` mit
> `RangeSet` hält viele davon und bildet sie je Transaktion ab.

| # | Regel |
| - | ----- |
| **TP1** | Eine TrackedPosition wird durch jede Änderung automatisch abgebildet. Es gibt keinen Pfad, auf dem sie manuell nachgeführt werden muss. |
| **TP2** | Wird der markierte Bereich vollständig gelöscht, gilt sie als **ungültig** und wird über `subscribe` gemeldet. Sie verschwindet nicht stillschweigend. |
| **TP3** | **Undo stellt sie vollständig wieder her.** Ein durch Undo zurückgeholter Bereich macht seine TrackedPosition wieder gültig, mit ihrer ursprünglichen Ausdehnung. |
| **TP4** | **Ungültig heißt nicht gelöscht.** Eine ungültige TrackedPosition bleibt bestehen, bis der Host sie freigibt. Was daran hängt — etwa eine Annotation — wird dadurch **verwaist, nicht entfernt**. Löschen ist immer eine ausdrückliche Entscheidung des Hosts, nie eine Nebenwirkung einer Textänderung. |
| **TP5** | TrackedPositions sind session-gebunden und werden **ausdrücklich** freigegeben (`release`). Keine automatische Bereinigung, keine Lebensdauer-Vermutung. |
| **TP6** | Die Komponente kennt den **Inhalt** einer Annotation nicht. Sie liefert die Marke; Text, Aussehen und Verwaltung liegen beim Host. |
| **TP7** | `resolve(id)` liefert `{ nodeId, offset }` als einfache Daten — für Persistenz über Session-Grenzen. Daraus lässt sich eine neue TrackedPosition erzeugen; das ist dann eine Momentaufnahme, keine fortgeführte Marke. |
| **TP8** | `replaceDocument` (U7) macht **alle** TrackedPositions ungültig — es gibt keinen `ChangeSet`, durch den sie abgebildet werden könnten. TP4 gilt: sie werden gemeldet, nicht entfernt. |

**Warum in der Komponente und nicht beim Host:** Positionsdrift korrekt zu lösen heißt,
Änderungen abzubilden. Das kann die Engine; ein externer Halter kann es nicht, ohne den
Änderungsstrom nachzubauen.

**TP3 ist nicht umsonst.** Beim Löschen kollabiert die Marke zu einem Punkt; `mapPos` allein
stellt beim Undo die Ausdehnung nicht wieder her. Dafür braucht es Effekte, die die History
mit umkehrt (CM6 bietet dafür `invertedEffects` im History-Modul — beim Bauen gegen die
eingesetzte Fassung zu verifizieren). Das ist gebaute Logik, kein Nebenprodukt.

**Wer führt sie weiter, wenn keine View lebt:** Das Abbilden geschieht im `EditorState`, nicht
in der `EditorView` — und ein State ohne View ist in CM6 normal. Die TrackedPositions liegen
deshalb auf einem **session-eigenen State**, der so lange existiert wie die Session.

Der `SessionEditorState` ohne View ist hierfür ebenso Pflicht wie für das Dokument selbst
(§ 11.2) — hinge er an einer View, wäre deren Schließen ein Eigentümerwechsel im Betrieb.
TrackedPositions gehören in Phase 1 (§ 16).

### 3.5 View-Zustand über Schließen und Wiederöffnen

Eine View kann geschlossen und wiederhergestellt werden — etwa wenn der Host die Zahl
gleichzeitiger Views begrenzt (§ 15.2). Der Zustand liegt dabei **nicht** in einem Cache der
Session (I10), sondern wird als Wert herausgegeben.

```
view.getState() → {
  scope: { nodeId, include },
  presentation, grain, showNodeHeading,
  scrollAt: TrackedPositionId,   // § 3.4
  caretAt:  TrackedPositionId,
  findState,
}
```

| # | Regel |
| - | ----- |
| **V1** | **Innerhalb einer laufenden Session** sind `scrollAt` und `caretAt` echte TrackedPosition. Sie werden mitgeführt, auch wenn eine andere View im selben Node editiert. Beim Wiederöffnen ist die Position semantisch exakt — **nie gedriftet**. |
| **V2** | **Über Session-Grenzen** (Neustart) wird über `resolveTrackedPosition` eine Momentaufnahme persistiert. Beim Wiederherstellen ist sie ausdrücklich Best-Effort: Scope-Node entfallen → R2, Versatz außerhalb → geklemmt. |
| **V3** | Position wird **nie als Pixelwert** gespeichert. Ein `scrollTop` ist nach jeder Änderung und jeder Breitenänderung falsch. |
| **V4** | Beim Wiederherstellen **gewinnt der Scroll-TrackedPosition**: der Caret wird gesetzt, ohne dorthin zu scrollen. Zwei Positionsbesitzer, die sich widersprechen, sind ausgeschlossen (I4). |
| **V5** | Erstöffnung ohne gespeicherten Zustand: Caret an den Anfang des ersten Fließtexts im Scope — nicht auf eine Überschrift, nicht ans Dokumentende. Scroll an den Anfang des Scope. |
| **V6** | Schließen einer View kostet weder Historie (U8) noch Text (I1) noch Dirty-Status (I7). Eine Obergrenze für gleichzeitige Views ist reines Render-Budget und **Host-Politik**, keine Regel dieser Komponente. |
| **V7** | **TrackedPosition überleben `destroy()`.** Sie liegen in der Session, nicht in der View, und werden weiter mitgeführt, während keine View sie rendert. Nach Wiederöffnen ist die Position exakt — auch wenn zwischenzeitlich genau dort editiert wurde. |
| **V8** | Eigentum: `view.destroy()` gibt die TrackedPosition der View frei — **es sei denn**, sie wurden zuvor über `getState()` herausgegeben. Ab da liegt die Freigabe beim Host (`release`, TP4). So verliert eine geschlossene View ihre Position nicht versehentlich, und ein Host, der sie nicht braucht, leckt nicht. |
| **V9** | Ein TrackedPosition kostet einen Positionsmarker. Eine Obergrenze für gleichzeitige **Views** muss die Zahl der TrackedPosition nicht mitbegrenzen. |
| **V10** | Wird die Scope-Node einer **geschlossenen** View gelöscht, meldet TP2 den TrackedPosition als ungültig; beim Wiederherstellen greifen R2 (Scope auf überlebenden Vorfahren) und V5 (Caret an den Anfang). Eine **offene** View fällt nicht auf den Vorfahren — EX3/EX4. |

### 3.6 Lebender Ausschnitt

`renderRange` bestimmt den Ausschnitt **einmal** beim Öffnen (Titel/Tree). Danach ist der
lebende Bereich ein durch den `ChangeSet` abgebildetes Intervall — nicht jedes Mal neu über
den Titel aufgelöst. Titel-Neuauflösung nach Enter an `from` hat den Zeilenumbruch aus dem
Ausschnitt geworfen und ein Geschwister adoptiert; das ist ein Konstruktionsfehler.

| # | Regel |
| - | ----- |
| **EX1** | Der lebende Ausschnitt wird durch jede Änderung abgebildet. `from` Assoc **−1** (Inserts an `from` bleiben innen). `to` Assoc **−1**, solange der Ausschnitt Breite hat (Inserts an der exklusiven Kante bleiben außen). Ist er leer (`from === to`), Assoc **+1** — Inserts an dem Punkt gehören zum Ausschnitt (EX3). |
| **EX2** | Hide, Fence, Copy, Select-All und Caret-Klammer lesen **denselben** `ScopeRange` (I6). Eine zweite Berechnung derselben Range — Titel-Lookup, eingefrorene Offsets, parallele Projektion — ist ein Konstruktionsfehler. |
| **EX3** | Leert eine View **ihren eigenen** Ausschnitt, bleibt sie gemountet und editierbar. Ein leerer Ausschnitt (`from === to`) nimmt Inserts an diesem Punkt an. Das ist nicht `lost`. |
| **EX4** | Leert eine **fremde** Änderung (Sync) einen zuvor nicht-leeren Ausschnitt, wird er `lost`. Die Session meldet `scopeLost` **einmal** über `subscribe`. Der Bereich wächst nicht mit späteren Inserts am Kollapspunkt; lokale Edits sind gesperrt; Hide zeigt nichts. Der Host behandelt das wie Schließen (V8) — kein Tab-Chrome in der Komponente. |
| **EX5** | Ein fehlender Titel darf keinen Nachbarn adoptieren. Kein Geschwister-Fallback bei der initialen Auflösung und kein stilles Umhängen eines `lost`-Ausschnitts. |
| **EX6** | `setScope` auf dieselbe Node und dasselbe `include` ersetzt `ScopeRange` nicht aus einer neuen `subtreeRange`-Projektion. Der lebende Ausschnitt bleibt der gemappte (EX1). Ein echter Scope-Wechsel (andere Node oder anderes `include`) setzt neu. |

Hide ist Darstellung, nicht Isolation. Isolation ist der Fence (`changeFilter` /
`transactionFilter` auf `ScopeRange`) plus die eine in-section-Regel, dass die nächste
Überschrift auf Spalte 0 bleibt. `atomicRanges` gehören auf wysiwyg-Marker, **nicht** auf
das Hide außerhalb des Ausschnitts — `skipAtomic` dehnt sonst eine Löschung in den Nachbarn.

---

## 4 · Konfiguration

```
createSession({
  doc:       string,
  schema:    StructureSchema,
  policy?:   Policy,
  timeline?: Timeline,        // § 7.3
  strings?:  Record<string, string>,
})

StructureSchema = {
  levels:  Array<{ rank: number, id: string, headingDepth: number }>,
  idField: string,            // Frontmatter-Schlüssel der Knoten-Identität
}

Policy = {
  structureEditingInWysiwyg?: 'locked' | 'allowed',   // Default 'locked'
  headingEditingInWysiwyg?:   'inline' | 'locked',    // Default 'inline' (L4); 'locked' → LH1–LH3
  frontmatterInWysiwyg?:      'form'   | 'hidden',    // Default 'form'
  pillFields?:                string[],               // Default [] — YAML keys shown as pills (§ 8.4)
  inlineRefStyle?:            'attribute-block' | 'html-ref',  // Default 'attribute-block' (§ 8.3)
}
```

`rank` aufsteigend von der äußersten Ebene. Der Kern kennt ausschließlich Ränge; `id` ist ein
undurchsichtiger Bezeichner für den Host. `grain` einer View ist eine `rank`-Angabe.
`pillFields` wählt, welche Frontmatter-Schlüssel zusätzlich als Pills unter der Überschrift
erscheinen (P5). Nicht gelistete Schlüssel bleiben nur im Formular (FM7).
`inlineRefStyle` wählt **eine** Chip-Syntax je Session (W6). Die Styles mischen sich nicht.

**Zur Konfigurierbarkeit von L5/R5:** Strukturbearbeitung in `wysiwyg` zu sperren ist
**Host-Politik, keine Invariante**. Die Komponente muss sperren *können*; ob sie es tut,
entscheidet der Host. Voreingestellt ist `locked`, weil eine Struktur-Mutation ohne sichtbare
Marker für den Bearbeiter schwer vorhersehbar ist.
`headingEditingInWysiwyg` ist dieselbe Klasse: Default `'inline'` hält L4 und LH4; `'locked'` macht
Schema-Überschrift plus YAML-Zaun zur atomaren Einheit (LH1–LH3). Der Host rendert den Titel
dann als Formular/Widget und schreibt per L5.

---

## 5 · Invarianten

Verbindlich. Verletzung ist ein Defekt, kein Kompromiss.

| # | Invariante |
| - | ---------- |
| **I1** | Genau ein Document je Session. Keine View hält eine unabhängige Textwahrheit. |
| **I2** | Der Tree ist jederzeit Projektion des Document. Kein Pfad ändert den Tree ohne Textänderung. |
| **I3** | Genau eine Timeline je Session mit genau einem Eintrittspunkt. Kein Routing zwischen Stacks. |
| **I4** | Jede Änderung der Scrollposition hat genau einen Owner und eine benannte Ursache. |
| **I5** | Kein Warten auf eine **geratene Dauer** (Timeout, Poll-Intervall, Retry) in Scroll-, Fokus- oder Selektionspfaden. Ein einzelnes Warten auf ein **wohldefiniertes Ereignis** (ein Frame, ein Microtask) ist zulässig — es rät nichts, es feuert deterministisch genau einmal. Siehe `SETUP.md` § 4, `check-no-waiting`. |
| **I6** | Eine Invariante wird an einer Stelle berechnet und durchgesetzt. Keine zweite Absicherung derselben Regel. |
| **I7** | Dirty ist abgeleitet, nie mitgeführt. |
| **I8** | Der Kern ist frei von UI-Framework-Abhängigkeiten und ohne DOM testbar. |
| **I9** | `wysiwyg` erzeugt keinen Zustand, der in `source` ungültiges Markdown wäre. |
| **I10** | Kein Cache, dessen Korrektheit von der Disziplin der Aufrufer abhängt. |

**I1 und CM6-Puffer.** I1 spricht das Session-Document an, nicht die Zahl der `Text`-Objekte
in der Engine. Ein `EditorState` je View mit atomarer `ChangeSet`-Weiterleitung ist kein
zweites Document — die Puffer müssen gleich sein; Divergenz ist ein Fehler. Eine geteilte
CM6-Selektion folgt daraus nicht und ist kein I1-Gebot.

---

## 6 · Bereichsrelationen und Synchronisation

**„Synchronisiert" und „nicht synchronisiert" sind keine Modi.** Alle Views hängen am selben
Document; ob eine View eine Änderung sieht, folgt aus der Relation ihrer Range zur Änderung.

### 6.1 Relation zweier Views

Aus den `renderRange`s abgeleitet, **nie gespeichert** — nach jeder Strukturänderung neu
bestimmt. Maßgeblich ist der gerenderte Bereich, nicht die Scope-Node.

| Relation | Bedingung |
| -------- | --------- |
| `identical` | `renderRange(A)` = `renderRange(B)` |
| `containing` | `renderRange(A)` ⊃ `renderRange(B)` |
| `disjoint` | Ranges überschneiden sich nicht |

Weil `renderRange` den Include-Modus einschließt, ergeben sich zwei Fälle, die es ohne ihn
nicht gäbe:

| Konstellation | Relation |
| ------------- | -------- |
| Beide auf Node X, beide `subtree` (oder beide `own`) | `identical` |
| Beide auf Node X, A `subtree`, B `own` | **`containing`** — gleiche Node, trotzdem nicht dasselbe |
| A auf X mit `own`, B auf einem Kind von X | **`disjoint`** — `ownRange(X)` endet vor der ersten Kind-Überschrift |

### 6.2 Was propagiert

| Belang | Ebene | `identical` | `containing` | `disjoint` |
| ------ | ----- | ----------- | ------------ | ---------- |
| Textänderung | Session | beide | äußere sieht innere | keine Sichtbarkeit |
| Strukturänderung | Session | beide | äußere sieht neue/entfallene Nodes | nur bei Rang-/Reihenfolgeänderung oberhalb (§ 7) |
| Timeline, Tree, Dirty | Session | geteilt | geteilt | geteilt |
| Scope, Presentation, Grain | View | unabhängig | unabhängig | unabhängig |
| Scrollposition | View | unabhängig, **koppelbar** (opt-in) | unabhängig | unabhängig |
| visibleNode, Find-Zustand | View | unabhängig | unabhängig | unabhängig |
| Selektion | View | unabhängig — nicht weitergeleitet (§ 11.2) | unabhängig | unabhängig |

**S1** Textsynchronisation ist nicht abschaltbar und nicht scope-abhängig.
**S2** Viewport- und Cursor-Kopplung ist opt-in je View-Paar, nur bei `identical` sinnvoll.
Standard: aus.
**S3** Die Relation wird nach jeder Strukturänderung neu bestimmt. Views können ihre Relation
ändern, ohne dass eine Scope-Zuweisung stattfand.

---

## 7 · Strukturänderungen

Jede Strukturänderung ist eine Textänderung (I2) und liegt auf der Timeline (I3).

### 7.1 Auslöser und Wirkung

| Auslöser | Wirkung |
| -------- | ------- |
| Überschrift eingefügt | neue Node in der Projektion |
| Überschrift entfernt | Node entfällt, Rumpf fällt an den Vorgänger |
| Überschriftentiefe geändert | Rang ändert sich, Nachkommen kaskadieren |
| Node verschoben | Reihenfolge/Elternschaft ändern sich |
| Node gelöscht | Range entfällt vollständig |

### 7.2 Regeln

| # | Regel |
| - | ----- |
| **R1** | Eine neue Node innerhalb der Range einer View erscheint dort ohne Zutun — auch in Views mit gröberem Grain, die sie enthalten. |
| **R2** | Wird die Scope-Node einer **geschlossenen** View entfernt, fällt ihr Scope beim Wiederherstellen auf den nächsten überlebenden Vorfahren (V10). Eine **offene** View fällt nicht um: Selbst-Leeren bleibt gemountet (EX3), fremdes Leeren meldet `scopeLost` (EX4). |
| **R3** | Rangänderung einer Scope-Node lässt den Scope gültig (Identität bleibt); Grain-Chrome und Range werden neu bestimmt. |
| **R4** | Verlässt eine Node die Range von View A und tritt in die von View B ein, rendern beide neu. Keine Neumontage. |
| **R5** | Strukturbearbeitung in `wysiwyg` folgt `policy.structureEditingInWysiwyg` (§ 4). Über `source` und API immer zulässig. |
| **R6** | Eine Strukturänderung erzeugt genau einen Timeline-Eintrag, unabhängig von der Zahl kaskadierender Nodes. |
| **R7** | Eine Kaskade, die das Schema verletzen würde, wird **vollständig** abgelehnt — kein Teilzustand, kein Timeline-Eintrag, Document unverändert. |

### 7.3 Ablauf einer Struktur-Aktion

Antwort auf „wie funktionieren `apply` und Undo":

```
1. Host ruft session.apply(action)                     — z. B. „Node X löschen"
2. Session plant die Kaskade gegen Schema + Tree       — Verletzung → R7, Abbruch
3. Plan wird zu genau einem ChangeSet verdichtet       — R6
4. Dispatch auf den SessionEditorState (view-unabhängig, § 11.2),
   dann Weiterleitung desselben ChangeSet an alle View-States,
   in derselben Reihenfolge, in einem Durchlauf
5. Tree wird neu projiziert (I2)
6. Offene Ausschnitte: Abbildung EX1–EX4 (kein Titel-Lookup).
   Geschlossene Scopes: R2/V10. Rang: R3
7. Relationen werden neu bestimmt                      — S3
8. Ein Timeline-Eintrag mit Ziel-Range und Ziel-Node
```

Undo läuft identisch mit dem invertierten `ChangeSet`; Schritte 5–7 wiederholen sich.

**Kritisch:** Schritt 4 muss atomar über alle View-States sein — eine Teilweiterleitung
hinterlässt divergierende Dokumente. Zusätzlich ist `EditorView.update` nicht reentrant
(§ 11.1 Punkt 5): der Weiterleitungscode darf beim Durchlaufen der Views keinen weiteren
Dispatch auslösen.

---

## 8 · Gesperrte Bereiche, Frontmatter, Widgets

### 8.1 Allgemein

| # | Regel |
| - | ----- |
| **L1** | Marker sind in `wysiwyg` atomar: Löschen erfasst die ganze Einheit oder nichts. Die ATX-Einheit ist `#{1,6}` plus **genau ein** Trenner `[ \t]`. Weitere Spaces gehören zum Titel (L4) und sind einzeln löschbar. ATX-Marker gelten **nicht** innerhalb eines Fenced-Code-Blocks (CommonMark): `#` dort bleibt sichtbarer Quelltext. Inline-Delimiter (§ 8.6) sind dieselbe Atom-Familie — je Delimiter-Run (`*` / `**` / `_` / `__` / `~~` / Backtick-Run), nicht die ganze Spanne. In `source` ist `##` zwei Zeichen, kein Atom. |
| **L2** | Getippte Markdown-Syntax wird nicht interpretiert, sondern maskiert geschrieben (`#`, `*`, `_`, `>`, `-`, Backtick, Backslash, `<`). **Ein Durchgang** über die ursprüngliche Einfügung. Der Maskierungs-Backslash wird nicht ein zweites Mal maskiert — sonst wird aus `#` zuerst `\#` und lebend `\\####`. In `wysiwyg` blendet die Darstellung den Maskierungs-Backslash aus (`\#` liest als `#`); der Puffer behält `\#`. Löschen des sichtbaren `#` entfernt den Backslash mit. |
| **L3** | Mehrzeiliges Einfügen wird in einem Schritt maskiert und in einem Schritt zurückgenommen. |
| **L4** | Überschriftentext bleibt in `wysiwyg` editierbar, unabhängig von `policy.structureEditingInWysiwyg` — **außer** der Scope-Überschrift, wenn `showNodeHeading: false` (SNH2): die ist ausgeblendet und nicht erreichbar. Zeilenumbruch (Enter) auf einer Überschriftenzeile fügt bei `'locked'` keine Zeile ein — das wäre Struktur, nicht Titeltext. Eine Leerzeile *zwischen* Überschriften bleibt normale Prosa. Gilt bei `headingEditingInWysiwyg: 'inline'` (Default). Bei `'locked'` tritt LH1 an die Stelle der Titel-Editierbarkeit. |
| **L5** | Programmatische Änderungen umgehen die Sperren gezielt (Widgets, API, Undo). |
| **L6** | Sperrdefinition an genau einer Stelle (I6). |
| **L7** | Ändert sich die Presentation oder die Menge der gesperrten Bereiche, wird die Selektion **in einem Schritt** aus neu gesperrten Bereichen geparkt: Anker und Kopf je auf die nächstgelegene erreichbare Position außerhalb der Sperre. Eine Position auf `from` einer halb-offenen Sperre `[from, to)` gilt als innen, wenn `from` am Zeilenanfang oder auf einem Zeilenumbruch liegt (Einfügeloch vor Block-Atomen) — Parkziel ist dann `to`. Inline-Atome (Chip-Chrome nach dem Label) behalten `from` als erreichbaren Rand. Endet eine Block-Sperre am Dokumentende ohne folgende Zeile, wird ein `\n` als Parkzeile angelegt (kein Timeline-Eintrag). Grenzen zwei Block-Sperren unmittelbar aneinander (`a.to === b.from`), wird dasselbe `\n` dazwischen gelegt — der Caret bleibt auf der neuen Zeile, er springt nicht in die zweite Sperre. Ohne Scroll (I4), ohne Nachlauf (I5). Eine in `source` gültige Selektion darf in `wysiwyg` nicht in Chrome stehen bleiben. Gilt für alle Sperren derselben Menge — eigene wie host-beigesteuerte (`ProtectedRange`, § 12). Ein Ort (L6). |
| **L8** | In `wysiwyg` darf eine Löschung Prosa nicht mit einer Schema-Überschrift oder gebundenem YAML verkleben, indem sie den trennenden Zeilenumbruch (und nur-leere Zeilen dazwischen) entfernt. Gilt unabhängig von `headingEditingInWysiwyg`. Undo, Sync und L5 (`hostWriteAnnotation`) umgehen die Sperre. Host-Chrome, das keine Schema-Überschrift ist, sperrt denselben Join über `extraLockedRanges` (Rücktaste an `from`). |
| **LH1** | `headingEditingInWysiwyg: 'locked'`: jede Schema-Überschrift und ihr YAML-Zaun (falls vorhanden) sind **eine** gesperrte, atomare Einheit. Die Einheit läuft vom öffnenden Zaun (sonst `heading.from`) bis einschließlich des Newlines nach der ATX-Zeile. Titeltext ist nicht zeichenweise erreichbar. Leading blanks vor dem Zaun bleiben Prosa. `source` und `'inline'` unverändert. Schreibzugriff nur L5. |
| **LH2** | Leerer Caret an der Einheitsgrenze: Rücktaste bei `to` bzw. Entf bei `from` (oder dem Newline davor) **selektiert** die Einheit und löscht nicht. |
| **LH3** | Eine Löschung darf eine Heading-Einheit nur entfernen, wenn sie die Einheit vollständig überdeckt. Teilüberlappung wird abgewiesen. Select-all im Ausschnitt und anschließendes Löschen ist zulässig. |
| **LH4** | `headingEditingInWysiwyg: 'inline'`: Wird der Titel einer Schema-Überschrift vollständig geleert, entfällt die Heading-Einheit (YAML-Zaun falls vorhanden plus ATX-Zeile inkl. Newline). Reine Einfügungen (Zeilenumbruch im Titel) tun das nicht. Extra-gesperrte Host-Ranges sind ausgenommen. Leading blanks vor dem Zaun bleiben Prosa (LH1). `'locked'` braucht das nicht (LH1). |

### 8.2 Frontmatter

Der Frontmatter-Block ist **im Document und in der Timeline vorhanden**, aber in `wysiwyg`
nicht als Rohtext erreichbar. `policy.frontmatterInWysiwyg` entscheidet die Darstellung:

| Wert | Darstellung |
| ---- | ----------- |
| `form` (Default) | Block-Widget mit Formularfeldern je Schlüssel |
| `hidden` | vollständig unsichtbar |

| # | Regel |
| - | ----- |
| **FM1** | Der Rohtext des Blocks ist in `wysiwyg` nicht per Caret erreichbar und nicht direkt editierbar. |
| **FM2** | Keine Tastenfolge — auch keine wiederholte — macht ihn sichtbar, zerteilt ihn oder verklebt ihn mit Nachbartext. Zur gesperrten Einheit gehören der YAML-Zaun und die Klebe-Leerzeilen nach dem schließenden Zaun bis zur gebundenen Überschrift. Rücktaste direkt vor `---`, wenn die vorausgehende Zeile nicht leer ist, bleibt gesperrt. |
| **FM3** | Das Formular schreibt Änderungen **ausschließlich als Transaktion** auf die YAML-Range. Kein Formularzustand außerhalb des Document. |
| **FM4** | Daraus folgt ohne Zusatzpfad: die Änderung liegt auf der Timeline (§ 9) und im Dirty-Status (§ 9.3). |
| **FM5** | Ein geleertes Feld erzeugt gültiges Markdown — Schlüssel entfällt oder trägt einen leeren Wert, nie ein YAML-Fragment. |
| **FM6** | Der Frontmatter des Scope-Node einer View wird auch dann gerendert, wenn er textlich vor der Überschrift liegt. |
| **FM7** | Das Formular ist **Metadaten-Oberfläche, kein Fließtext**: seine Feldinhalte nehmen an der Textsuche (§ 10) **nicht** teil. |
| **FM8** | Als Block-Widget deklariert das Formular seine **Endhöhe** über `estimatedHeight` (oder gleichwertig), bevor Scroll/Layout die Zeile braucht. `toDOM` stellt dieselbe Höhe **synchron** her — kein nachträgliches Wachstum per Microtask/`requestMeasure`, das `scrollTop` korrigiert, während der Nutzer nur rollt. |
| **FM9** | In `hidden` ist die ausgeblendete **und gesperrte** Spanne der YAML-Zaun bis zur gebundenen Überschrift (inkl. Klebe-Leerzeilen nach dem schließenden Zaun). Die Leerzeile *nach* der vorausgehenden Überschrift bleibt eine normale, sichtbare, editierbare Zeile. |

FM7 ist eine bewusste Entscheidung, keine technische Grenze — Begründung und Alternative in
§ 17, O8.

### 8.3 Inline-Widgets (Referenz-Chips)

Im Gegensatz zum Frontmatter-Formular ersetzen Inline-Widgets eine Textstelle, deren
sichtbare Beschriftung **Fließtext-Rang** hat.

**Eine Syntax je Session** (`policy.inlineRefStyle`, § 4). Beide Styles projizieren auf
dieselbe L1-Einheit: sichtbares Label, totes Chrome. Hover- und Katalogdaten liegen beim
Host.

| Style | Syntax | Voreinstellung |
| ----- | ------ | -------------- |
| `attribute-block` | `[label]{id=… type=…}` | ja |
| `html-ref` | `<(type)-ref …>label</(type)-ref>` · Selbstschluss `<(type)-ref … />` | |

`label` ist sichtbarer Fließtext, wenn ein Textknoten existiert. Chrome (`{…}` bzw.
Start-/End-Tag samt Attributen) ist in `wysiwyg` ausgeblendet und nicht suchbar. `type`
im html-ref-Tag ist ein undurchsichtiger Token (Namensfragment vor dem Suffix `-ref`),
keine Domäne. Übrige Attribute sind undurchsichtig. Label und Chrome bilden **eine**
L1-Einheit.

**html-ref ohne Textknoten** (W7): Selbstschluss (`<(type)-ref … />`) und leeres Element
(`<(type)-ref …></(type)-ref>`, auch nur Whitespace im Rumpf) sind Chips. Sichtbare
Beschriftung ist synthetisch: Wert von `id`, sonst `type`, sonst `ref`. In `wysiwyg` ein
Ersatz-Widget über die ganze Einheit. Suche trifft diese Beschriftung an der
Label-Spanne (id-Wert oder type-Token). Ersetzen schreibt dieselbe Spanne — bei
vorhandenem `id` den Attributwert, nicht das ganze Tag (RP1). Ohne `id` den type-Token.

Kein Chip — und damit kein Widget — sind: abweichender End-Tag, verschachteltes Markup
im Label (`<` im Textknoten). Roh-HTML, das kein Chip ist, bleibt Quelltext (§ 8.5).

| # | Regel |
| - | ----- |
| **W1** | Die sichtbare Beschriftung ist Teil der Textprojektion: auffindbar (§ 10) und hervorhebbar. Mit Textknoten: das geschriebene Label *ist* die Anzeige, **als Teilstring selektierbar**, CSS-Klasse `syn-chip` (kein Default-Look — Hosts stylen). Ohne Textknoten (W7): synthetische Beschriftung; findbar, nicht teilstring-selektierbar (wie Pills, F7). Die Komponente resolvt keine Katalogdaten — Hover liegt beim Host. |
| **W2** | Nicht sichtbare Anteile (übrige Attribute, Marker, Tags) nehmen an der Suche nicht teil. Ausnahme W7: der id-Wert bzw. der type-Token *ist* das Label, nicht verstecktes Chrome. |
| **W3** | Löschen erfasst die gesamte Widget-Einheit oder nichts (L1). |
| **W4** | Widgets überstehen Presentation-, Scope- und Grain-Wechsel funktionsfähig. |
| **W5** | Fokus in einem Widget entzieht der Text-View den Cursor nicht, solange der Bearbeiter es nicht anspricht. |
| **W6** | Genau ein `inlineRefStyle` je Session. Hide, Atom, Find, Replace und L1 laufen über **einen** Scanner auf diese Einheit (I6). Die andere Syntax ist in derselben Session gewöhnlicher Quelltext. |
| **W7** | html-ref Selbstschluss und leeres Element sind Chips ohne Textknoten. Widget über die ganze Einheit; Label = `id` \| `type` \| `ref`. |

### 8.4 Metadaten-Pills

Ausgewählte Frontmatter-Felder werden zusätzlich als **Pills** unter der Überschrift im
Lesefluss gerendert. Welche Schlüssel — legt `policy.pillFields` fest (§ 4). Sie sind die
dritte Widget-Klasse und verhalten sich anders als beide vorherigen, weil **Anzeigeort und
Textort auseinanderfallen**: die Zeichen liegen im YAML-Block, angezeigt werden sie nach der
Überschrift.

| Klasse | Textbereich | Suche | Selektion | Ersetzen |
| ------ | ----------- | ----- | --------- | -------- |
| **Inline-Chip in Prosa** (§ 8.3) | eigener Bereich in der Prosa | findbar | Teilstring selektierbar | ja |
| **Metadaten-Pill** (§ 8.4) | abgeleitet aus dem YAML-Bereich | findbar | **atomar**, keine Teilstring-Selektion | ja, mit Schutz (§ 10.3) |
| **Frontmatter-Formular** (§ 8.2) | YAML-Bereich | nicht durchsucht | — | — |

| # | Regel |
| - | ----- |
| **P1** | Eine Pill belegt **keinen** Dokumentbereich. Sie ist ein Widget an der Position nach der Überschrift; ihr Inhalt ist aus dem YAML-Bereich abgeleitet. |
| **P2** | Daraus folgt: Textlöschen in ihrer Umgebung entfernt sie nicht. Ein Feld wird über sein Control geleert (FM5), nicht mit der Rücktaste. |
| **P3** | Der Caret kann nicht in eine Pill gesetzt werden, und eine Selektion kann sie nicht zeichenweise erfassen. Grund: CM6-Selektionen sind in Dokumentreihenfolge zusammenhängend — eine Auswahl „Prosa + Pill" müsste rückwärts in den YAML-Block springen oder Überschrift und Frontmatter mitverschlucken. |
| **P4** | Eine Pill ist **suchbar und hervorhebbar**, einschließlich **Teilstring-Hervorhebung innerhalb der Pill**. Hervorheben ist eine Render-Frage und von P3 nicht betroffen: die Komponente kennt die Trefferstelle im YAML und weiß, welche Pill sie darstellt. |
| **P5** | Ein Frontmatter-Wert ist **genau dann** durchsuchbar, wenn er als Pill im Lesefluss gerendert wird. Gezählt wird an der Pill, nie zusätzlich im Formular — keine Doppelzählung. |
| **P6** | Als Block-Widget an der Überschrift deklariert die Pill ihre **Endhöhe** über `estimatedHeight` (oder gleichwertig), bevor Scroll/Layout die Zeile braucht. Dieselbe Höhenregel wie FM8; gilt auch für Host-Chrome über `presentationExtensions` (§ 12). Collapsible Heading-Chrome (Höhe der Überschriftenzeile) ist nicht Body-Fold. |

### 8.5 HTML-Kommentare

`wysiwyg` ist kein HTML-Preview und bindet Roh-HTML nie als lebendes DOM ein. Kommentare
sind Chrome wie ein Marker, kein Widget mit Label.

| # | Regel |
| - | ----- |
| **H1** | Ein abgeschlossener HTML-Kommentar (`<!-- … -->`) ist in `wysiwyg` nicht leser-sichtbar: ausgeblendet und atomar. Er nimmt an der Suche nicht teil (F4). In `source` ist er sichtbarer Quelltext und suchbar (F5). Ein Chip innerhalb eines Kommentars ist nicht sichtbar — der Kommentar gewinnt. Unvollständige Sequenzen ohne `-->` sind kein Kommentar. |

Übriges Roh-HTML (unbekannte Tags, die kein Chip nach § 8.3 sind) bleibt Quelltext in
beiden Präsentationen.

### 8.6 Inline-Chrome (Emphasis, Strong, Code, Strike)

Abgeschlossene Inline-Paare werden in `wysiwyg` leser-sichtbar: Delimiter ausgeblendet,
Innen typografisch markiert. **Decorations schreiben nie das Document** — `*kursiv*` bleibt
`*kursiv*` im Buffer (I9). Chrome kommt aus einem **Paar-Scan über den String**, Rebuild nur
bei Document-/Scope-Änderung, nie beim Scrollen. Kein Lezer-Tree für An/Aus; der Tree darf
Highlight in `source` treiben, nicht Wysiwyg-Chrome.

| # | Regel |
| - | ----- |
| **IM1** | Abgeschlossene Paare (`*`/`_` Emphasis, `**`/`__` Strong, `~~` Strike, Code-Span mit Backticks) sind in `wysiwyg`: Delimiter per `Decoration.replace` unsichtbar und atomar (L1); Innen per `Decoration.mark` mit Klasse `syn-em` / `syn-strong` / `syn-strike` / `syn-code`. Styles liegen in `theme.css`, nicht in HTML-Tags. |
| **IM2** | Ein Scanner, eine Stelle (I6). Löcher: HTML-Kommentare (H1), maskierte Literale (`\*`, L2), Code-Spans (brechen Emphasis/Strong/Strike). Schachtelung nur CommonMark-üblich (`***` = Strong+Em). Kein Tabellen-, Listen-, Setext-, Image- oder Fenced-Code-Chrome in diesem Scanner. |
| **IM3** | Getipptes `*` / `_` / `#` / … bleibt maskiert (L2). Wysiwyg zeigt das Literal; der Scanner behandelt `\*` nicht als Delimiter. Sonst ist I9 tot. |
| **IM4** | Suche trifft den Innen-Text, nicht die versteckten Delimiter (F4). `source` sucht den Rohstring inklusive Marker (F5). |

Nicht Gegenstand dieses Schnitts (bleiben `source` / ignore / spätere Phase): Tabellen,
Images, Fences, HTML-Blöcke, Task lists, Setext, eingerückter Code, Live-Links, Blockquotes,
Listen-Marker.

### 8.7 Heading-Stempel (Rang / Tiefe / Relativ)

Jede **sichtbare** Schema-ATX im Ausschnitt trägt Line-Chrome (keine Document-Änderung, I9).
Hosts stylen; die Komponente hat keinen Default-Look.

| Token | Bedeutung |
| ----- | --------- |
| `headingDepth` | ATX-`#`-Anzahl |
| `rank` | Schema-Rang von der Wurzel |
| `rel` | `rank − scope.rank` |

Klassen: `syn-depth-N`, `syn-rank-N`, `syn-rel-N` (negativ `syn-rel--1`). Attribute
`data-heading-depth`, `data-rank`, `data-rel`. `setGrain` bleibt View-Zustand; es gibt
keine zweite `syn-grain`-Klasse.

`syn-section-open` liegt auf der **ersten Prosa-Zeile** nach der Überschrift (Leerzeilen und
Frontmatter übersprungen). Dieselbe `data-rel`/`data-rank`/`data-heading-depth` wie die
öffnende Überschrift. CM6-Zeilen sind flach — CSS `h + p` reicht für Dropcaps nicht.

| # | Regel |
| - | ----- |
| **HS1** | Jede Schema-ATX im `ScopeRange` (außer SNH2-ausgeblendeter Scope-Überschrift) trägt depth, rank und rel. ATX außerhalb des Schemas bleibt ungestempelt. |
| **HS2** | `rel` ist `heading.rank − scope.rank`. `setScope` aktualisiert Stempel ohne Remount (wie SNH3). |
| **HS3** | Erste Prosa nach einer Schema-ATX (auch wenn deren Zeile per SNH2 versteckt ist) trägt `syn-section-open`. Nächste Schema-ATX ohne dazwischenliegende Prosa → kein Open für die äußere Überschrift. |

### 8.8 Markdown-Kommandos

Generische Quelltext-Edits. Kein Schema, keine Ränge, keine Knotentypen.

| # | Regel |
| - | ----- |
| **C1** | `setHeadingLevel(view, depth)` ersetzt das ATX-Präfix der aktuellen Zeile durch `#{1,6}` plus genau ein Leerzeichen. `depth` ist die Hash-Anzahl, kein Schema-Rang. Bestehendes Präfix `#{1,6}[ \t]+` wird ersetzt; ohne Präfix wird es vorn eingefügt. |
| **C2** | `insertListPrefix(view, '-' \| '1.')` setzt den Listenmarker der aktuellen Zeile: fehlender Marker wird nach dem Einzug eingefügt; anderer Markertyp wird getauscht; derselbe Typ ein zweites Mal entfernt den Marker und behält den Einzug. |
| **C3** | `toggleWrapSelection(view, open, close?)` umschließt die Selektion mit den gegebenen Markern (`close` default = `open`). Ein leerer Caret expandiert zuerst auf das umgebende Wort in der Zeile (Buchstaben, Ziffern, `_`). Die Selektion liegt danach auf dem umschlossenen Text, nicht auf den Markern. |

---

## 9 · Timeline

| # | Regel |
| - | ----- |
| **U1** | Eine Timeline je Session. Undo nimmt die letzte Aktion zurück, unabhängig von View und Node. |
| **U2** | Eintrittspunkt ist `session.undo()` / `redo()`. Die CM6-eigene History verarbeitet Tastatureingaben nicht selbst; sie ist der Timeline untergeordnet. |
| **U3** | Nicht-Text-Aktionen liegen auf derselben Timeline und sind in der Bedienung nicht unterscheidbar. |
| **U4** | Jeder Eintrag trägt Ziel-Range und Ziel-Node — oder, bei host-eigenen Einträgen, einen Aufdeck-Rückruf des Hosts. |
| **U5** | Aufdecken nach Undo/Redo, in dieser Reihenfolge: (1) zeigt eine View die Ziel-Node, dort aufdecken; (2) zeigen mehrere, die fokussierte; (3) zeigt keine, Scope der fokussierten View setzen, dann aufdecken. |
| **U6** | Undo/Redo dürfen gesperrte Bereiche verändern — Wiederherstellen ist keine Bearbeitung. |
| **U7** | `replaceDocument` leert die Timeline, setzt die Baseline neu und macht alle TrackedPositions ungültig (TP8). Einziger Fall legitimen Historieverlusts. |
| **U8** | **Timeline und Undo-Reichweite liegen in der Session, nie in einer View.** Öffnen und Schließen von Views, Scope-, Presentation- und Grain-Wechsel kosten keine Historie und brauchen keinen Zustands-Cache. |

### 9.1 Fremde Entitäten auf derselben Timeline

Ein Host verwaltet in der Regel mehr als dieses eine Dokument. Damit „Undo = letzte Aktion"
auch dort gilt, ist die **Timeline injizierbar**:

```
createSession({ ..., timeline })     // optional; sonst session-eigen
timeline.push({ apply, revert, reveal? , label? })
```

| # | Regel |
| - | ----- |
| **U9** | Fremde Entitäten werden **nicht** als Nodes in das Document aufgenommen. Das Document trägt genau einen Markdown-Text. |
| **U10** | Fremde Einträge sind undurchsichtige Kommandos mit `apply` / `revert`. Die Komponente kennt ihren Inhalt nicht. |
| **U11** | Das Aufdecken fremder Einträge liegt beim Host (`reveal`) — die Komponente kann nicht aufdecken, was sie nicht rendert. |
| **U12** | Mehrere Sessions dürfen sich eine Timeline teilen. Undo bleibt global chronologisch. |
| **U13** | Beide Betriebsarten sind zulässig: **verschränkt** (geteilte Timeline, Editor- und Host-Aktionen in einer Reihe) und **getrennt** (Timeline je Session). **Voreingestellt ist verschränkt.** |
| **U14** | Die CM6-eigene History ist ein *Primitiv*, das die äußere Timeline ansteuert: bei einem Texteintrag ruft sie CM6-Undo (auf dem `SessionEditorState`, § 11.2), bei einem fremden Eintrag dessen `revert`, **ohne** die CM6-History anzufassen. |
| **U15** | Damit U14 trägt, müssen Texteinträge der Timeline 1:1 und in Reihenfolge auf CM6-History-Schritte abbilden. Deshalb darf nichts sonst in die CM6-History schieben (U2). |
| **U16** | Bei gemischtem Betrieb ist **jeder Undo-Eintrittspunkt an genau eine Timeline gebunden** — üblicherweise über die fokussierte Oberfläche. Kein Erraten, welcher Stack gemeint ist. |

Damit ist die globale Zeitachse Host-weit, ohne dass fremde Domänen in den Markdown-Puffer
gezwungen werden (Domänenfreiheit, § 1).

### 9.2 Aufdecken bei mehreren Sessions

Zeigt keine View der eigenen Session die Ziel-Node und stammt der Eintrag aus einer anderen
Session, greift `reveal` des Eintrags statt U5.

### 9.3 Dirty

| # | Regel |
| - | ----- |
| **D1** | `isDirty(n)` vergleicht **`ownRange(n)`** gegen die Baseline. Eine Änderung in einem Kind macht den Elternknoten **nicht** dirty. |
| **D2** | `isSubtreeDirty(n)` vergleicht `subtreeRange(n)` — für Sammelanzeigen. Beide sind abgeleitet (I7). |
| **D3** | Eine Strukturänderung markiert genau die Nodes dirty, deren `ownRange`-Text sich tatsächlich ändert. |
| **D4** | Rückkehr zum Baseline-Stand — durch Tippen oder Undo — setzt Dirty zurück. |
| **D5** | `markPersisted(nodeId?)` setzt die Baseline für einen Node oder das gesamte Document. |

D1 ist die Antwort auf die häufigste Fehlklasse: eine Änderung in einem Kind darf keinen
Speicherbedarf für den Elternknoten vortäuschen.

---

## 10 · Suche

### 10.1 Zwei Modi

Lokale und globale Suche sind **getrennte Modi mit unterschiedlicher Aufdeck-Semantik**, nicht
ein Modus mit einem Parameter:

| Modus | Bereich | Aufdecken | Scope-Wirkung |
| ----- | ------- | --------- | ------------- |
| `view` (lokal) | `renderRange(view)` | nur innerhalb der eigenen View scrollen | **keine** — Scope bleibt, `activeNode` bleibt |
| `document` (global) | gesamtes Document | nach U5 | darf den Scope der fokussierten View setzen |

| # | Regel |
| - | ----- |
| **F1** | Lokale Suche findet nichts außerhalb der eigenen Range und ändert niemals Scope oder `activeNode`. |
| **F2** | Globale Suche findet über die eigene Range hinaus; der Übergang zu einem Treffer außerhalb folgt U5. |
| **F3** | Trefferliste und aktiver Treffer gehören zur View. Zwei Views können gleichzeitig in unterschiedlichen Modi suchen. |
| **F10** | `findNext` / `findPrev` (Tasten **F3** / **Shift+F3**) wechseln nur den **aktiven Treffer** der bestehenden Liste — keine neue Projektion. Am Ende der Liste wird gewrappt. Aufdecken folgt dem Modus der Liste (F1/F2). |
| **F11** | Bevor ein Treffer aufgedeckt wird, werden alle Folds aufgehoben, die den Trefferbereich überlappen. Ein Dispatch, kein Warten (I5). Ohne überlappenden Fold ist der Aufruf ein No-Op. |
| **F12** | Die Suche beachtet standardmäßig die Groß-/Kleinschreibung **nicht**. `caseSensitive: true` verlangt exakte Groß-/Kleinschreibung. Gilt für Literal und Regex. |
| **F13** | `regex: false` (Default) sucht den Query-String **literal**, auch wenn er Regex-Metazeichen enthält. `regex: true` interpretiert die Query als JavaScript-Regulären-Ausdruck (`u`-Flag). Ein ungültiges Muster liefert eine leere Trefferliste, keinen Wurf. |

Hosts dürfen dieselbe Query gegen viele Dokumente laufen lassen; die Einheit ist
`findInDocument` (ein Document, eine Projektion). Die Komponente orchestriert keine
workspace-übergreifende Suche.

### 10.2 Projektion

| # | Regel |
| - | ----- |
| **F4** | Die Trefferprojektion in `wysiwyg` ist **was der Leser sieht** — nicht „sichtbarer Dokumenttext". Sie umfasst damit auch Inhalte, die ein Widget aus einer anderen Dokumentstelle ableitet (Pills, P4/P5), und schließt Marker (ATX, Inline-Delimiter IM4), Widget-Attribute, HTML-Kommentare (H1) und das Frontmatter-Formular aus. |
| **F5** | Daraus folgt: derselbe Query liefert in `source` und `wysiwyg` unterschiedliche Trefferzahlen. Vertrag, kein Defekt. |
| **F6** | Alles Gesehene ist durchsuchbar — **einschließlich Überschriftentiteln, Inline-Chip-Beschriftungen und Metadaten-Pills**. |
| **F7** | Ein Treffer wird als **Teilstring** hervorgehoben, auch innerhalb einer Überschrift, einer Chip-Beschriftung und einer Pill. **Selektierbar** ist er nur dort, wo seine Trefferstelle echter Fließtext an der Anzeigeposition ist — also nicht in Pills (P3). |
| **F8** | Frontmatter-Formularfelder nehmen nicht teil (FM7); ihre als Pill gerenderten Werte schon (P5). |
| **F9** | Jeder Treffer trägt eine **Klasse**: `prose` (Trefferstelle im Fließtext) oder `metadata` (Trefferstelle im Frontmatter, dargestellt als Pill). Die Klasse steuert das Ersetzen (§ 10.3). |

F6/F7 sind der Grund, warum Überschriften und Chip-Beschriftungen **mit Textknoten** als
**echter Text** und nicht als Ersatz-Widget gerendert werden müssen — ein reines
`Decoration.replace` ohne Textinhalt wäre nicht selektierbar. html-ref ohne Textknoten
(W7) hat keinen solchen Knoten: Widget, findbar über die Label-Spanne, Selektion wie
Pills (F7).

### 10.3 Ersetzen

Leitregel: **was in einer View findbar ist, ist dort auch ersetzbar.** Ersetzen arbeitet auf
Dokumentbereichen, nicht auf der Selektion — es ist deshalb von P3 nicht betroffen und gilt
auch für Pills.

| # | Regel |
| - | ----- |
| **RP1** | Ersetzen wirkt auf die Trefferbereiche der Projektion, schreibt aber in das Document. |
| **RP2** | „Alle ersetzen" erzeugt **genau einen** Timeline-Eintrag, unabhängig von der Trefferzahl (analog R6). |
| **RP3** | Im Suchmodus `view` fasst Ersetzen nichts außerhalb der eigenen Range an (F1). |
| **RP4** | Ersetzen über eine gesperrte Grenze hinweg wird abgelehnt (§ 8.1). |
| **RP5** | **Metadaten-Schutz:** Treffer der Klasse `metadata` werden **nur auf ausdrücklichen Wunsch** ersetzt. Voreingestellt wirkt „Alle ersetzen" nur auf `prose`. Das Ergebnis meldet beide Zahlen getrennt. |
| **RP6** | **YAML-Gültigkeitsschutz:** Würde eine Ersetzung in einem Frontmatter-Wert den Block ungültig machen (Doppelpunkt, Zeilenumbruch, Anführungszeichen), wird **dieser Treffer** abgelehnt und gemeldet — die übrigen laufen durch. Ein Einzelfall mit Begründung, keine Kategorieausnahme. |
| **RP7** | Ersetzen markiert je betroffener Node Dirty nach D1 — nie pauschal das Dokument. |

RP5 und RP6 sind der Preis dafür, die Leitregel ohne Ausnahme zu halten: statt „Metadaten
kann man nur in `source` ersetzen" gibt es ein einheitliches Modell mit zwei benannten,
erklärbaren Schutzmechanismen.

---

## 11 · Sync-Kern

**Ein `EditorState` je View, ein `SessionEditorState` ohne View als Wahrheit —
`ChangeSet`-Weiterleitung von der Session zu jeder View. Ein Stern, kein Netz, keine
Selektions-Weiterleitung.**

Keine offene Variantenfrage mehr. Eine frühere Fassung stellte dieser Konstruktion einen
geteilten `EditorState` (mehrere Views auf einem State) als gleichwertige Alternative
gegenüber und wollte zwischen beiden messen. Das ist verworfen, aus zwei unabhängigen
Gründen, die beide erst nach echtem Code sichtbar wurden:

1. **CM6s eigenes Referenzbeispiel für mehrere Views** (`codemirror.net/examples/split`)
   ist das **Konzept** (unabhängige States, ein Dokument) — nicht die Verdrahtung.
   Das Beispiel ist ein A↔B-Netz; hier geht jeder `ChangeSet` Session → jede View
   (Stern). Views schreiben nicht einander.
2. **Yjs' CM6-Anbindung** (`y-codemirror`) bindet ebenfalls **einen `EditorState` je View**
   an ein gemeinsames CRDT-Dokument, nicht einen geteilten `EditorState`.

Der naheliegende CM6-Weg für „mehrere Views, ein Dokument" ist unabhängige States mit
Weiterleitung — ein geteilter State ist die Konstruktion **dagegen**, nicht der Normalfall,
und die einzige Stärke, die er böte (kostenlos geteilte Selektion), war ohnehin nie eine
Anforderung.

### 11.1 Grundlage (verifiziert an CM6 6.43)

1. `EditorState` ist unveränderlich und enthält Dokument, Selektion und Konfiguration.
2. Eine `EditorView` rendert genau einen State.
3. `changeFilter`, `transactionFilter` und `keymap` liegen auf State-Ebene. Da jede View ihr
   eigenes State-Objekt hat, konfiguriert jede View sie **direkt und unabhängig** — Guards,
   die nur in `wysiwyg` gelten sollen, hängen schlicht nicht an der `source`-View-State.
   Keine Transaktions-Annotation nötig, um View-Identität zu unterscheiden.
4. **`Text` ist eine persistente, unveränderliche Rope-Struktur.** Der `SessionEditorState` und
   jede View-State können denselben `Text` beim Erzeugen per Referenz teilen (kein
   Kopieraufwand). Nach einer Änderung erzeugt jeder State, der sie anwendet, sein eigenes
   neues Wurzelobjekt; nur unveränderte Teilbäume bleiben strukturell geteilt —
   Kopieraufwand je Änderung ist **O(log n)**, nicht O(n). Ein Teildoc je View (kürzerer
   Puffer, Offset-Übersetzung) ist verworfen: derselbe `ChangeSet` ließe sich nicht
   durchreichen.
5. `EditorView.update` ist **nicht reentrant** — ein Aufruf während eines laufenden Updates
   ist ein Fehler. Der Weiterleitungscode (§ 11.2, § 7.3) darf beim Durchlaufen der Views
   keinen weiteren Dispatch auslösen. Beim Durchlauf `update` aufrufen, nie `dispatch`.
6. Layout-Geometrie ist nur in einer separaten, per `requestAnimationFrame` geplanten
   Messphase verfügbar; synchrones Messen während eines Updates ist ausgeschlossen (bestätigt
   T13; Testkonsequenz in `SETUP.md`).
7. **Hide ist Darstellung, nicht Isolation.** `Decoration.replace` blendet den Nachbarn aus;
   Isolation ist der Fence auf `ScopeRange` (§ 3.6). Hide braucht
   `inclusiveStart: false, inclusiveEnd: false` — sonst schluckt die Nachbar-Range den Caret
   an der Kante. **Kein `block: true`:** ein Block-Widget zeichnet eine leere erste Zeile
   in Kind-Ausschnitten. **Kein `atomicRanges` auf dem Hide** — `skipAtomic` dehnt sonst
   eine Löschung in den Nachbarn. (Pills und FM-form dürfen `block: true` — P1/FM8;
   die Hide-Regel gilt nur für den Scope-Rand.)
8. **Der lebende Ausschnitt ist sticky** (EX1), keine Titel-Neuauflösung und keine
   eingefrorenen Offsets. Hide, Fence, Copy und Select-All lesen dasselbe Feld (EX2).
9. **L2 lebend:** `transactionFilter`, der `#` zu `\#` umschreibt, kämpft gegen das bereits
   ins DOM geschriebene Zeichen und maskiert den Maskierungs-Backslash mit. Lebende Eingabe
   fängt `EditorView.inputHandler` ab (ein Dispatch, `filter: false`); programmatisches
   `state.update` bleibt der `transactionFilter`. Die Maskierungsregel selbst liegt in
   einer Funktion (I6, L6).
10. **L1 lebend:** Natives Backspace/Delete über `Decoration.replace` ist ein No-Op.
    Die wysiwyg-Keymap löscht das ATX-Atom (Hashes + ein Trenner) bzw. das CRLF hinter
    der Überschriftenzeile. Das ist empirisch, nicht ein zweiter Guard — die Atom-Regel
    bleibt L1 an einer Stelle. `source` hat diese Keymap nicht.
11. **Fence:** `changeFilter` unterdrückt `[0, from)` und `[to, length)`. Zusätzlich bleibt
    die Überschrift, die bei `to` beginnt, auf Spalte 0 (oder sie ist ganz weg) — sonst
    klebt Backspace an der Kante `##` an die vorige Zeile und der Nachbar erscheint im
    Ausschnitt. Sync-annotierte Transaktionen umgehen den Fence, damit der Stern
    weiterleiten kann.

### 11.2 Ablauf

`SessionEditorState` ohne View ist die Wahrheit. Jede View-State wird **von der Session aus**
fortgeschrieben, nie von einer anderen View-State aus (Ablauf im Detail: § 7.3).
`examples/split` liefert das Konzept, nicht das A↔B-Netz.

| | |
| - | - |
| Document | je View; Weiterleitung von der Session aus, nie zwischen Views |
| Timeline | zentral geführt, View-States delegieren |
| Selektion | je View unabhängig — **nicht weitergeleitet**, keine Sonderbehandlung nötig |
| Guards, Keymap | je View direkt konfiguriert (§ 11.1 Punkt 3) |
| Berechnung | jede View-State berechnet ihre StateFields (Parsebaum, Dekorationen) eigenständig — Kosten skalieren mit der Zahl der Views, zu messen (§ 15) |

Das ist der einzige strukturelle Kostenpunkt gegenüber einem (verworfenen) geteilten State:
N-fache statt einfache Berechnung abgeleiteter StateField-Werte. Zu messen, nicht zu setzen.

### 11.3 Verifikation

G1a/G1b, G2 und G3, empirisch geprüft — Spike `spikes/phase-0/` in **zwei Szenen**, Tests
`tests/unit/spike/g-questions.test.ts` und `tests/behaviour/phase-0-gate.spec.ts` —
statt gesetzt.

Szene 1: gleicher Ausschnitt, `source` | `wysiwyg`. Szene 2: A subtree | A1 own | A2 own
(containing / disjoint). Dokument generisch, keine Domäne.

| # | Frage | Ergebnis |
| - | ----- | -------- |
| **G1a** | Zeigen zwei Views dasselbe Document in unterschiedlicher Presentation, ohne Presentation im Document zu speichern? | **Bestanden** (Szene 1). `SessionEditorState` ohne View; je View ein State, derselbe volle `Text`. Document-Strings gleich; Marker bleiben im String. `source`-DOM zeigt `#`, `wysiwyg`-DOM nicht. Eine am Dokumentende eingefügte Überschrift bleibt sichtbar, wenn der Ausschnitt das Ende einschließt. |
| **G1b** | Zeigen zwei Views dasselbe Document in unterschiedlichem Scope, ohne Isolation mit Hide zu verwechseln? | **Bestanden** (Szene 2). Sticky `ScopeRange` (EX1/EX2), nicht Titel-Neuauflösung. Hide inklusivitätsfrei, inline, ohne `atomicRanges` (§ 11.1.7). Insert an `to - 1` und an `from` bleibt im Ausschnitt; Enter an `from` leakt keine Zeile nur in den Vorfahren. Fence hält die nächste Überschrift auf Spalte 0. Select-All-Copy clippt auf den Ausschnitt (Clipboard ≠ Hide). Selbst-Leeren bleibt gemountet (EX3); fremdes Leeren → `scopeLost`, kein Wiederanwachsen (EX4). Source darf ein `#` von `##` einzeln löschen. |
| **G2** | Greifen die wysiwyg-Guards L1–L3 nur in der wysiwyg-View? | **Bestanden.** Filter/Handler/L1-Keymap nur auf der wysiwyg-Konfiguration. Source lässt `#` durch und behandelt `##` nicht als Atom. **L2 lebend:** vier `#`-Tasten → `\#\#\#\#`, nicht `\\####` (`inputHandler` + `filter: false`, § 11.1.9). „Ohne Tasten-Sonderfall“ betraf diesen L2-Pfad, nicht L1: natives Delete über Replace ist ein No-Op, die wysiwyg-Keymap ist empirisch (§ 11.1.10). Atom = Hashes + ein Trenner; Extra-Spaces sind Titel (L4). `\#` liest in wysiwyg als `#`; Löschen des sichtbaren `#` nimmt den Backslash mit. Keine View-Id-Annotation. |
| **G3** | Bleibt die Selektion der anderen View unberührt? | **Bestanden** (Szene 1, identical range). Selektion wird nicht weitergeleitet. Selektions-Transaktion in A: B's Caret numerisch unverändert. Tippen in A (lebend und programmatisch): Document-Strings gleich; B's Caret wird durch den `ChangeSet` abgebildet, nie durch A's Selektion ersetzt. |

Fällt eine dieser Fragen künftig um — etwa bei einer echten Regression —, ist **diese Sektion**
zu revidieren, nicht ein Rückfall auf geteilten State, der nicht mehr Teil des Modells ist.

### 11.4 Live-Kollaboration (post-MVP, nicht gebaut)

Nicht Gegenstand dieser Fassung (§ 1), aber ein weiterer Beleg für die getroffene Wahl: Ein
CRDT (Yjs) bindet sich pro View an ein gemeinsames Dokument — genau das Muster, das dieser
Sync-Kern bereits hat (State je View, ein `SessionEditorState`). Der Weiterleitungscode aus
§ 11.2 wäre der Teil, der später durch eine Yjs-Bindung ersetzt oder ergänzt würde; an
Guards, Presentation und der Je-View-Konfiguration ändert sich dabei nichts.

---

## 12 · Öffentliche API

Vertrag. Einziger Einstieg für Hosts ist das Paket-Root (`createSession`, `createTimeline`
und die unten genannten Typen). Alles nicht Aufgeführte ist intern — einschließlich
Test-/Harness-Hilfen (`excerpt`, `dispatch`, `relations`, `editorView`, …). Neue Exporte
erfordern eine Änderung dieser Sektion; `scripts/check-export-surface.mjs` erzwingt die
Deckung.

### Fabriken

| Signatur | Art |
| -------- | --- |
| `createSession({ doc, schema, policy?, timeline?, strings? })` | Session |
| `createTimeline()` | Timeline — Host erzeugt sie, wenn er Einträge schieben oder eine Zeitachse teilen will (U12/U13). Ohne Argument legt `createSession` eine eigene an. |
| `findChips(doc, from?, to?, style?)` | rein — Chip-Spans für `attribute-block` / `html-ref` (I6, § 8.3). Eine Scanner-Stelle für Host und Komponente. |
| `isExactChipDelete(doc, from, to, style?)` | rein — wahr genau dann, wenn `[from, to)` eine lückenlose Folge ganzer Chips ist (W3). |
| `setHeadingLevel(view, depth)` · `insertListPrefix(view, '-' \| '1.')` · `toggleWrapSelection(view, open, close?)` | Kommando — Markdown-Zeile/Selektion, kein Schema (C1–C3). |
| `bodyBlockStarts(text)` · `blockIndexAtOffset(starts, pos)` | rein — Scroll-Anker zwischen Presentations (V11). |
| `findInDocument(doc, opts)` | rein — Trefferliste eines Documents (§ 10). `opts` trägt Presentation, Range, Schema und `FindMatchOptions` (`caseSensitive`, `regex`). |
| `unfoldOverlappingFolds(view, from, to)` | Kommando — Folds über dem Treffer aufheben vor dem Aufdecken (F11). |
| `paddedVisibleRanges(view, pad?)` | lesend — sichtbare Ranges plus Rand (G8). |
| `intervalsOverlap(a, b)` · `scrollElementIntoViewIfNeeded(el, opts?, port?)` | rein / DOM — vertikale Sichtbarkeit im Scrollport (G9). |
| `wysiwygGuards(opts?)` | Extension — L1–L3 Guards für einen wysiwyg-EditorState ohne Session. Mit `schema` auch L8 (`structureJoinFilter`). |
| `structureJoinFilter(schema)` | Extension — L8: Prosa darf nicht mit Schema-Überschrift oder gebundenem YAML verkleben. |
| `frontmatterLockFilter(schema, opts?)` | Extension — FM2 Edit-Sperre; L5 via `hostWriteAnnotation` / `frontmatterWriteAnnotation` / Undo. `opts.allowChange` für Host-Löcher in der gepolsterten Zone. |
| `hiddenFrontmatterGuards(schema)` | Extension — wysiwyg ohne Session: FM unsichtbar (Zeilen-Hide ab dem Zaun, FM9), atomar, Edit-Sperre (FM1/FM2). |
| `projectTree(doc, schema)` | rein — Strukturbäume (I2). |
| `frontmatterRanges(doc, schema)` | rein — YAML-Blöcke aus dem Tree (FM1, I6). |
| `paddedFrontmatterRanges(doc, schema)` | rein — YAML-Blöcke plus umgebende Leerzeilen bis zur gebundenen Überschrift (I6). |
| `hiddenFrontmatterRanges(doc, schema)` | rein — YAML-Zaun bis zur gebundenen Überschrift, ohne die Leerzeile nach der vorausgehenden Überschrift (FM9, I6). |
| `headingUnitRanges(doc, schema)` | rein — YAML-Zaun plus gebundene ATX-Zeile inkl. Newline (LH1, I6). |
| `headingUnitGuards(schema, opts?)` · `headingUnitAtBoundary(doc, schema, head, dir)` | Extension / rein — Default `'locked'`: Lock, Atom, Sticky-Select (LH1–LH3). `{ editing: 'inline' }`: leerer Titel entfernt die Einheit (LH4). |
| `headingMarkers(doc)` · `maskBackslashRanges(doc, from, to)` · `findHtmlComments(doc, from?, to?)` · `findInlineMarks(doc)` · `inlineDelimiterRanges(marks)` | rein — eine Scanner-Stelle (I6). |
| `extraLockedRanges` | Facet — Host-Sperren (`ProtectedRange`) in dieselbe Menge (L6/L7). |
| `extraAtomicRanges` | Facet — Host-Ranges, die der Caret überspringt. Unabhängig von `extraLockedRanges` (eine Zeile kann gesperrt und trotzdem nicht atomar sein). |
| `extraLockedGuards()` | Extension — Edit-Sperre auf `extraLockedRanges`, Atomic auf `extraAtomicRanges`, L7-Park der Extra-Ranges inkl. Parkzeile am EOF. |
| `hostWriteAnnotation` | Annotation — L5-Bypass der Extra-Sperren (Host-Schreibvorgänge). |
| `parkSelectionInState(state, opts?)` | lesend — L7-Park auf dem aktuellen State (Scanner + `extraLockedRanges`). |
| `protectedWidgetExtension` · `preventProtectedDeletionFilter` · `protectedAtomicField` | Extension — Host-Widgets auf geschützten Ranges (`block: true` Replace). |

`strings` ist optionales Host-Vokabular. Unbekannte Schlüssel werden ignoriert; gerenderte
Widgets zeigen Frontmatter-Schlüssel unverändert, solange kein Mapping in dieser Sektion
steht.

### Session

| Signatur | Art |
| -------- | --- |
| `session.document` · `session.tree` | lesend |
| `session.readNodes(ids)` | lesend — Inhalt in host-gewählter Reihenfolge (§ 17, O10) |
| `session.createTrackedPosition(range)` · `.release(id)` · `.resolve(id)` | TrackedPosition (§ 3.4) |
| `session.activeNode` · `session.visibleNode` | lesend, abgeleitet |
| `session.focusedViewId` | lesend — welche View Fokus hat (O6; globale Suche in § 13.2) |
| `session.view(id)` | lesend — Handle oder `undefined`; `scopeLost` trägt nur die Id |
| `session.timelineDepth` · `session.redoDepth` | lesend — Tiefe der einen Timeline (I3, § 13.2 Undo-Bedienung) |
| `session.isDirty(nodeId)` · `session.isSubtreeDirty(nodeId)` | lesend, abgeleitet |
| `session.undo()` · `session.redo()` | Kommando — der eine Eintrittspunkt (I3). Nicht `timeline.undo` |
| `session.apply(action)` | Kommando — Strukturaktion (§ 7.3, `StructureAction`) |
| `session.markPersisted(nodeId?)` | Kommando |
| `session.replaceDocument(doc)` | Kommando — U7 |
| `session.subscribe(fn)` | Ereignis — ein Kanal für alle Zustandsänderungen, einschließlich `scopeLost` (EX4) |
| `session.createView(opts)` | Factory → `ViewHandle` |

### View

| Signatur | Art |
| -------- | --- |
| `view.id` | lesend |
| `view.mount(el)` · `view.destroy()` | Lebenszyklus |
| `view.getState()` | lesend — Wiederherstellungszustand mit TrackedPositions (§ 3.5) |
| `view.setScope(nodeId, { include: 'own' \| 'subtree' })` | Kommando — Umfang (§ 3.1) |
| `view.setPresentation(p)` · `setGrain(rank)` · `setShowNodeHeading(show)` | Kommando |
| `view.navigateTo(nodeId)` | Kommando — löst Scope vs. Viewport auf (§ 13.2) |
| `view.scrollToNode(nodeId, cause)` | Kommando — `cause` ist Pflicht (I4) |
| `view.reveal(from, to, cause)` | Kommando — Range in den Viewport (Find-Offsets); `cause` Pflicht (I4) |
| `view.setPlugins(plugins)` | Kommando — benannte Host-Plugins ohne Remount (I3/U8; ADR 0015) |
| `view.setExtensions(extensions, presentationExtensions?)` | **deprecated** — Prefer `setPlugins` |
| `view.coords(from, to)` | lesend — Box relativ zum Scrollport (§ 12.1); `null` wenn ungemountet oder Position ungültig |
| `view.scrollPort` | lesend — Scroll-Owner-Element (I4) oder `null` wenn ungemountet |
| `view.visibleNode` | lesend |
| `view.find(query, { mode: 'view' \| 'document', activate?: boolean, caseSensitive?: boolean, regex?: boolean })` | Kommando (§ 10.1) → `SearchHit[]`. `activate: false` malt Treffer ohne Scroll/Selektion (Suchleiste beim Tippen). Default: nicht case-sensitive, literal (F12/F13). |
| `view.findNext()` · `view.findPrev()` | Kommando — aktiver Treffer (F3/F10) → `SearchHit \| null` |
| `view.replace(hitId, text)` · `view.replaceAll(text, { classes })` | Kommando (§ 10.3) |
| `view.focus()` | Kommando |

### Timeline

| Signatur | Art |
| -------- | --- |
| `timeline.depth` | lesend — gleich `session.timelineDepth` derselben Session |
| `timeline.pushForeign(command)` | Kommando — host-eigene Entität (U9–U11). `command` = `{ apply, revert, reveal?, label? }` |

Text-Undo läuft ausschließlich über `session.undo` / `session.redo` (I3). Die Timeline-Klasse
der Implementierung darf intern mehr können; das ist kein Host-Vertrag.

### Ereignisse

`subscribe` liefert einen der folgenden Werte. Ein Kanal, kein gespiegelter Zustand (I7, I10).

```
{ type: 'document' }
{ type: 'tree' }
{ type: 'views' }
{ type: 'focus', viewId: string }
{ type: 'visible' }
{ type: 'tracked', id: TrackedPositionId }
{ type: 'scopeLost', viewId: string }
```

### 12.1 Geometrie für Host-Overlays

Hosts, die Annotationen oder Randnotizen **in derselben Scroll-Achse** wie den Text
zeichnen, brauchen Positionen — nicht den `EditorView`. Die Komponente exportiert deshalb
nur Geometrie:

| Regel | Inhalt |
| ----- | ------ |
| **G4** | `coords(from, to)` liefert eine Box **relativ zum Scrollport**, inkl. aktuellem `scrollTop`/`scrollLeft` — geeignet für `position: absolute` in einem Kind von `scrollPort`. Nicht Viewport-relativ, nicht als Persistenz (V3). |
| **G5** | `scrollPort` ist das Element, das scrollt (I4). Overlay-Wurzeln hängen der Host dort ein. |
| **G6** | Ungemountet: `coords` → `null`, `scrollPort` → `null`. Kein Throw. |
| **G7** | Hosts rufen `coords` **nicht** während eines Dispatch/Update-Zyklus auf (T13). Messung gehört in den Mess-/Scroll-Zyklus oder Host-`requestAnimationFrame`. |
| **G8** | `paddedVisibleRanges(view, pad?)` erweitert jedes `visibleRanges`-Intervall um `pad` (Default 500) und klemmt auf `[0, doc.length]`, damit Viewport-Scanner am Rand nicht abschneiden. |
| **G9** | Ein Kasten gilt im Scrollport als sichtbar genau dann, wenn die **vertikalen** Intervalle strikt überlappen: `box.bottom > port.top` und `box.top < port.bottom`. Kantenberührung zählt nicht. Die horizontale Lage ändert das nicht. Ist der Kasten schon sichtbar, wird nicht gescrollt (I4). |

Papierbogen, angepinnte Heading und Gutter-UI sind **Host-Chrome**, kein Teil dieser API.

### Typen (Auszug)

```
CoordRect = { top: number, left: number, bottom: number, right: number }

ChipSpan = {
  from: number, to: number,       // whole chip including chrome
  labelFrom: number, labelTo: number,
  attrsFrom: number, attrsTo: number,
  label: string,
  attrs: string,
  textNode: boolean,              // false = W7 (no text node; synthetic label)
}

SearchHit = {
  id:    string,
  from:  number,              // document offset (pill hits: YAML value range)
  to:    number,
  class: 'prose' | 'metadata',
}

StructureAction =
  | { type: 'deleteNode', nodeId: string }
  | { type: 'changeHeadingDepth', nodeId: string, headingDepth: number }
  | { type: 'moveNode', nodeId: string, parentId: string | null, index: number }
  | { type: 'renameNode', nodeId: string, title: string }

replaceAll → { prose: number, metadata: number, rejected?: number }
```

`createView` nimmt optional `showNodeHeading` (Default `true`, § 3.3 SNH1–SNH4) und
`plugins` (ADR 0015): Beiträge mit `id` und Slot `markdown` | `autocomplete` | `lint` |
`keymap` | `source` | `wysiwyg`. Slots hängen **hinter** dem Session-Chrome und werden mit
der Präsentation neu konfiguriert. Sie dürfen kein `history()` ergänzen, Undo/Redo
nicht an den View-State binden und `scrollIntoView` nicht als Navigation nutzen
(I1, I3, I4). Roh-`extensions` / `presentationExtensions` sind deprecated.

**Heading-nahe Block-Widgets** (Host-Slot, Pills, FM-form) müssen
ihre Slot-Höhe **synchron** liefern (Zahl oder CSS / `estimatedHeight`) — nicht
nach Hydration strecken (FM8, P6). `EditorView` bleibt außerhalb von § 12;
Injection ist die Plugin-Registry. Overlay-Hosts nutzen `coords` / `scrollPort`
(G4–G7), nicht `EditorView.findFromDOM`. Host-Plugin-Autoren importieren CM6-Typen
über `synoptic-editor/cm`, nicht über `@codemirror/*` im App-Paket.

`moveNode` platziert den Subtree so, dass die Tree-Projektion denselben Parent und
Index ergibt — eine Rangverletzung oder ein Zug in den eigenen Subtree ist R7.

`replaceAll` zählt getrennt (RP5) und weist YAML-Treffer ab (RP6).

Struktur-, Tree-, Policy- und Restore-Typen gehören zum Vertrag, weil Hosts sie
konstruieren oder aus `subscribe` lesen müssen. CodeMirror-`EditorView` gehört nicht dazu.

`Policy.inlineRefStyle` ist `'attribute-block' | 'html-ref'` (W6, Default `attribute-block`).

Entwurfsentscheidungen: `cause` als Pflichtparameter macht I4 im Typsystem prüfbar. Ein
`subscribe`-Kanal statt spezialisierter Events verhindert gespiegelten Zustand beim
Konsumenten (I7, I10).

---

## 13 · Test-Harness

### 13.1 Innerhalb der Komponente

Document · Tree · Timeline-Anbindung · Baseline/Dirty · Find-Engine · Scroll-Owner ·
visibleNode-Erkennung · Guards · Widgets · Navigationsauflösung.

### 13.2 Außerhalb, über `subscribe` angebunden

| Element | Liest | Schreibt |
| ------- | ----- | -------- |
| Navigationsbaum | `tree`, `isDirty`, `isSubtreeDirty`, `activeNode`, `visibleNode` | `view.navigateTo` |
| Breadcrumb | Pfad zu `activeNode`, `visibleNode` | `view.navigateTo` |
| Undo/Redo-Bedienung | Timeline-Tiefe, letzter Eintrag | `session.undo/redo` |
| Suchleiste **lokal** | Trefferliste der View | `view.find(q, {mode:'view'})` |
| Suchleiste **global** | Trefferliste der fokussierten View | `view.find(q, {mode:'document'})` |
| Struktur-Aktionen | `tree` | `session.apply` |
| Speicher-Anzeige | `isDirty` je Node | `session.markPersisted` |
| Offene Views / Tabs | `scopeLost` (EX4) | `view.destroy()` — Host schließt, kein Chrome in der Komponente |

**Zustand und Logik liegen innen, die Bedienoberfläche außen.** Kein äußeres Element führt
eigenen Zustand.

**Navigationsauflösung (`view.navigateTo`)** — gilt für Breadcrumb und Baum gleichermaßen:

| Ziel-Node relativ zum aktuellen Scope | Wirkung |
| ------------------------------------- | ------- |
| innerhalb `renderRange(view)`, ≠ Scope-Node | `scrollToNode` — Viewport bewegt sich, Scope bleibt |
| gleich dem Scope | `scrollToNode` an den Anfang |
| außerhalb (Vorfahr, Geschwister, fremder Zweig) | `setScope` |

Die Regel liegt **in** der Komponente, nicht im Host — sonst implementiert sie jeder
Konsument neu und unterschiedlich (I6).

**Zwei Suchleisten oder eine?** Die Modi sind getrennt (§ 10.1); ob der Host sie als zwei
Leisten oder eine Leiste mit Umschalter zeigt, ist Host-Sache. Der Harness zeigt zwei, damit
beide gleichzeitig beobachtbar sind.

### 13.3 Instrumentierung (nur Harness)

| Element | Zweck |
| ------- | ----- |
| Scroll-Owner-Log je View | letzte Ursache im Klartext — macht I4 prüfbar |
| Scroll-Lock je View | pinnt die Position, damit Tests nachweisen, dass kein anderer Owner sie ändert |
| Relations-Anzeige | aktuelle Relation aller View-Paare (§ 6.1) |
| Zustandsanzeige | `activeNode`, `visibleNode` je View, Timeline-Tiefe, Dirty-Liste (own + subtree) |
| View-Fabrik | Views zur Laufzeit mit beliebigem Scope anlegen/schließen (§ 15.2) |

### 13.4 Kommandoschnittstelle

E2E-Tests lösen Zustände hierüber aus statt über Zeigergesten — Voraussetzung für I5.

`setScope` · `navigateTo` · `scrollToNode(cause)` · `undo` · `redo` ·
`find(viewId, query, mode)` · `applyStructure` · `setVariant` · `focusView` ·
`openView(scope, presentation)` · `closeView`

---

## 14 · Testmatrix

Verhaltenstests gegen den einen Sync-Kern (§ 11) — keine Variantenunterscheidung mehr nötig.
Unit-Tests decken zusätzlich die Weiterleitungsmechanik selbst ab (§ 11.2). Kein Testfall
darf auf Zeit warten (I5).

### Scrollposition

| # | Fall |
| - | ---- |
| T1 | Scrollen in View A ändert Position von View B nicht. |
| T2 | Scope-Wechsel scrollt nur die Ziel-View. |
| T3 | Presentation-Wechsel hält dieselbe Textstelle im Sichtfenster; Versatz festgeschrieben. |
| T4 | Nach Undo außerhalb des Sichtfensters ist die Zielstelle sichtbar (U5). |
| T5 | Grain-Wechsel ändert die Scrollposition nicht. |
| T6 | Öffnen/Schließen einer View ändert die Position bestehender Views nicht. |
| T7 | Jede Positionsänderung ist einer benannten Ursache zuordenbar; kein Pfad setzt Scroll ohne Ursache (I4). |

### visibleNode

| # | Fall | Prüft |
| - | ---- | ----- |
| T8 | Scrollen über mehrere Nodes meldet die Folge korrekt. | Grundfunktion |
| T118 | `visibleNode` liegt **innerhalb** von `renderRange(view)` — eine Leselinie auf dem versteckten Prefix/Suffix (Hide außerhalb des Scope) meldet keine fremde Node. | Hide ist Darstellung, nicht Isolation; die Geometrie darf trotzdem nicht aus dem Ausschnitt fallen |
| T9 | Cursorsprung ohne Scroll ändert `visibleNode` nicht. | visibleNode kommt aus Scroll, nicht aus Selektion |
| T10 | Überschriften unterhalb der Schema-Ränge verschieben `visibleNode` nicht. | Nur Schema-Ränge sind Nodes |
| T11 | Bei mehreren Views ist eindeutig und stabil, welche `session.visibleNode` speist. | Fokusabhängige Ableitung |
| **T12** | Auf Korpus L wird für **jede** Node eine Stichprobe von Positionen quer durch ihren Rumpf aufgelöst; jede muss **diese** Node ergeben, nie eine Nachbar-Node. | Die Positions-→-Node-Auflösung ist typischerweise eine Suche über zwischengespeicherte Überschriften-Offsets. Bei großen Dokumenten driften solche Caches, und Bereichsgrenzen sind off-by-one-anfällig. Der Fehler zeigt sich nicht bei drei Kapiteln, sondern bei dreihundert — deshalb ausdrücklich auf L. |
| **T13** | Während eines Dispatch/Update-Zyklus wird keine Layout-Messung ausgeführt (instrumentiert: `coordsAtPos`, `getBoundingClientRect` und Verwandte). | `visibleNode` braucht Geometrie („welche Node steht an der Leselinie?"). Naiv liest man sie beim Dokument-Update. CM6 verbietet Messungen während eines laufenden Updates; zusätzlich erzwingt jede synchrone Messung ein Reflow und macht Tippen bei L spürbar langsamer. Die Messung gehört in den Mess-/Scroll-Zyklus, nicht in die Transaktion. |

### Scope und Grain

| # | Fall |
| - | ---- |
| T14 | Grain-Wechsel ändert nur Darstellung: Document, Timeline-Tiefe und Scroll identisch. |
| T15 | Scope-Wechsel über eine Teilbaumgrenze: keine Neumontage, kein Historieverlust. |
| T16 | Die gerenderte Struktur entspricht dem Grain — geprüft an Struktur, nicht an Aussehen. |
| T17 | Grain-Wechsel während eines laufenden Scope-Wechsels führt zu definiertem Endzustand. |
| T57 | `navigateTo` auf eine Node **innerhalb** des Scope bewegt den Viewport und lässt den Scope unverändert (§ 13.2). |
| T58 | `navigateTo` auf Vorfahr, Geschwister oder fremden Zweig setzt den Scope. |
| T92 | Node X mit `include: 'own'` rendert Überschrift, Frontmatter und eigenen Rumpf — **ohne** Kindkörper; mit `include: 'subtree'` mit Kindern. |
| T93 | Zwei Views auf **derselben** Node, eine `own`, eine `subtree` → Relation `containing`, nicht `identical` (§ 6.1). |
| T94 | View auf X mit `own` und View auf einem Kind von X → Relation `disjoint`. |
| T95 | Umschalten `own` ⇄ `subtree` ändert weder Dokument noch Timeline-Tiefe noch Historie; es ist kein Dokumentwechsel. |
| T96 | Grain-Wechsel ändert den Include-Modus **nicht** und umgekehrt — die beiden sind entkoppelt (A7, § 3.1). |
| T97 | `include: 'own'` und eine Änderung in einem Kind: die View zeigt sie nicht, die Timeline erfasst sie trotzdem, Dirty trifft das Kind (D1). |

### Mehrere Views, Bereichsrelationen

| # | Fall |
| - | ---- |
| T18 | `disjoint`: Tippen in A ändert weder Scroll noch `visibleNode` von B. |
| **T19** | `containing`: Änderungen der inneren View erscheinen in der äußeren — geprüft für **drei Pfade**: (a) Tippen im Rumpf, (b) Überschriftentitel ändern, (c) Feld im Frontmatter-Formular ändern (FM3). |
| T20 | `containing`: neue Überschrift in der inneren View erscheint als neue Node in der äußeren (R1). |
| T21 | Navigationsklick wirkt nur auf die fokussierte View. |
| T22 | `session.activeNode` folgt dem Fokuswechsel, ohne dass ein Scope sich ändert. |
| T23 | Offene View: fremdes Leeren des Ausschnitts → `scopeLost` einmal, kein Fallback auf Vorfahr oder Geschwister, späteres Tippen im Vorfahren hängt den Ausschnitt nicht wieder an (EX4/EX5). |
| T24 | Rangänderung der Scope-Node → Scope bleibt gültig (R3). |
| T25 | Node wandert von Range A nach Range B → beide rendern neu, keine Neumontage (R4). |
| T26 | Relation zweier Views ändert sich durch eine Strukturänderung ohne Scope-Zuweisung (S3). |
| T109 | Tippen und Enter an `ScopeRange.from` bleiben im Ausschnitt; keine Geisterzeile nur im Vorfahren (EX1). |
| T110 | Selbst-Leeren (Select-All + Delete) bleibt gemountet und editierbar; kein `scopeLost` (EX3). |
| T111 | Backspace an der exklusiven Kante klebt die nächste Überschrift nicht an die vorige Zeile; der Nachbar erscheint nicht im Ausschnitt (§ 11.1.11). |
| T112 | Select-All-Copy ist auf den Ausschnitt geclippt — Clipboard ist nicht Hide (EX2). |
| T113 | In `source` ist `##` zwei Zeichen: ein `#` lässt sich einzeln löschen (L1). |
| **T135** | Nach `##` → `#` an einem Kind bleibt der Parent-Ausschnitt vollständig; `setScope` auf dieselbe Wurzel schneidet ihn nicht ab (EX1/EX6). |

### Timeline und Dirty

| # | Fall |
| - | ---- |
| T27 | Änderung in Node X, dann Y, dann Undo → Y wird zurückgenommen. |
| T28–T30 | Undo überlebt Scope-Wechsel, Presentation-Wechsel sowie Schließen und erneutes Öffnen einer View (U8). |
| T31 | Node löschen → Undo stellt Node, Text und Baumposition wieder her. |
| T32 | Gemischte Folge Text → Löschen → Text, dreimal Undo, umgekehrte Reihenfolge. |
| T33 | Undo einer Änderung in X bei fokussierter View auf Y → zurückgenommen **und** aufgedeckt (U5). |
| T34 | Kaskadierende Rangänderung ist genau ein Timeline-Eintrag (R6). |
| **T35** | Eine Kaskade, die das Schema verletzt, wird vollständig abgelehnt: Document unverändert, kein Timeline-Eintrag, kein Teilzustand (R7). **Beispiel:** Schema mit Rängen 0–3; eine Node auf Rang 2 mit Kindern auf Rang 3 wird herabgestuft — die Kinder müssten auf Rang 4, den es nicht gibt. Ohne diese Regel entsteht ein halb angewandter Baum, dessen Rest sich nur noch per Reload reparieren lässt. |
| T36 | `replaceDocument` leert Timeline und setzt Baseline (U7). |
| T37 | Undo erreicht genau einen Handler, unabhängig vom Fokus (U2). |
| T59 | Fremder Timeline-Eintrag (Host-Entität) wird chronologisch korrekt zurückgenommen und über `reveal` aufgedeckt (U10/U11). |
| T60 | Zwei Sessions an einer geteilten Timeline: Undo läuft global chronologisch (U12). |
| **T61** | Rumpf eines Kindes ändern → **nur das Kind** ist dirty, der Elternknoten nicht; `isSubtreeDirty(parent)` ist gleichwohl wahr (D1/D2). |
| T62 | Frontmatter-Feld eines Kindes ändern → dieselbe Abgrenzung wie T61. |
| T63 | Rückkehr zum Baseline-Stand durch Undo setzt Dirty zurück (D4). |

### Gesperrte Bereiche und Frontmatter

| # | Fall |
| - | ---- |
| T38 | Frontmatter übersteht ≥50 aufeinanderfolgende Rücktasten an der Node-Grenze (FM2). |
| T39 | Dasselbe für Entf vorwärts, Enter an der Grenze, Einfügen am Dokumentanfang. |
| T40 | Getippte Markdown-Syntax bleibt Literal; in der parallelen `source`-View maskiert sichtbar. |
| T41 | Mehrzeiliges Einfügen: ein Maskierungsschritt, ein Undo-Schritt. |
| T42 | Löschen am Strukturmarker erfasst die atomare Einheit oder nichts. ATX-Atom = `#{1,6}` plus genau ein Trenner; Extra-Spaces sind Titel und einzeln löschbar (L1/L4). |
| T114 | Vier lebend getippte `#` in `wysiwyg` → `\#\#\#\#`, nicht `\\####` (L2, § 11.1.9). |
| T115 | Wysiwyg-Delete am Ende der Überschriftenzeile entfernt das folgende CRLF, nicht den Nachbarn (§ 11.1.10). |
| T116 | Löschen des sichtbaren `#` von `\#` in `wysiwyg` entfernt den Maskierungs-Backslash mit (L2). |
| **T43** | `policy.structureEditingInWysiwyg: 'locked'` → Strukturänderung abgelehnt, Überschriftentext editierbar (L4). Mit `'allowed'` → Strukturänderung zulässig, Regeln R6/R7 gelten unverändert. **Beide Belegungen werden geprüft.** |
| **T136** | `headingEditingInWysiwyg: 'locked'`: Caret und Tippen erreichen den Titel nicht; YAML-Zaun und ATX-Zeile sind eine Einheit (LH1). Default `'inline'` ändert T43 nicht. |
| **T137** | Leerer Caret hinter der Einheit: Rücktaste selektiert die Einheit und ändert das Document nicht (LH2). |
| **T138** | Selektion, die die Einheit vollständig überdeckt (inkl. Select-all), darf sie löschen; eine Teilüberlappung nicht (LH3). |
| T44 | Undo darf gesperrte Bereiche verändern (U6). |
| T64 | Caret lässt sich in `wysiwyg` nicht in den Frontmatter-Rohtext setzen (FM1). |
| T65 | Formularfeld ändern → YAML-Range im Document geändert, in paralleler `source`-View sichtbar (FM3). |
| T66 | Feld leeren → gültiges Markdown, kein YAML-Fragment (FM5). |
| T67 | Frontmatter vor der Überschrift wird für den Scope-Node gerendert (FM6). |
| **T139** | Zwei Schema-Überschriften mit Leerzeile plus YAML dazwischen: in `hidden` bleibt die Leerzeile nach der ersten Überschrift sichtbar; der YAML-Zaun nicht (FM9). |
| **T140** | Dieselbe Leerzeile ist editierbar (Tippen, Löschen). Rücktaste, die die Überschriftenzeile mit `---` verkleben würde, bleibt abgelehnt (FM2/FM9). |
| **T141** | Rücktaste am Anfang einer Prosa-Zeile direkt unter einer Schema-Überschrift (oder gebundenem YAML) ändert das Document nicht; Entf am Ende der Prosa-Zeile direkt über der nächsten Schema-Überschrift ebenso (L8). |
| **T142** | Wysiwyg, letzte Block-Sperre endet am EOF ohne folgende Zeile: Selektion auf EOF legt ein `\n` an und parkt den Caret dahinter (L7). |
| **T143** | `headingEditingInWysiwyg: 'inline'`: Löschen des letzten Titelzeichens entfernt YAML-Zaun und ATX-Zeile, Prosa bleibt; Enter im Titel tut das nicht; eine extra-gesperrte Überschrift bleibt (LH4). |
| **T144** | Zwei Block-Sperren ohne Zeichen dazwischen: Selektion an der Naht legt ein `\n` an und parkt den Caret darauf, nicht in die zweite Sperre (L7). |

### Suche

| # | Fall |
| - | ---- |
| T45 | Suche nach `#` in `wysiwyg` liefert nur maskierte Literale. |
| T46 | Suche nach einem Frontmatter-Schlüssel: keine Treffer in `wysiwyg`, Treffer in `source` (F4/F8). |
| **T47** | Suche nach einem **Widget-Attribut** (Id, Typ): keine Treffer (W2). |
| **T68** | Suche nach der **sichtbaren Widget-Beschriftung**: Treffer; er wird hervorgehoben und als **Teilstring** selektiert, ohne umgebendes Chrome (W1/F7). |
| **T69** | Suche nach einem Teilstring **innerhalb eines Überschriftentitels** in `wysiwyg`: Treffer, hervorgehoben und als Teilstring selektiert; die Selektion enthält keine Marker (F6/F7). |
| T48 | Trefferzahlen in `source` und `wysiwyg` weichen ab und sind je View korrekt (F5). |
| T49 | Modus `document` findet über die eigene Range hinaus; Aufdecken nach U5, Scope darf sich ändern. |
| T50 | Modus `view` findet nicht außerhalb der eigenen Range **und ändert weder Scope noch `activeNode`** (F1). |
| T70 | Zwei Views suchen gleichzeitig in unterschiedlichen Modi ohne gegenseitige Beeinflussung (F3). |
| T117 | `findNext` / `findPrev` wrappen die Trefferliste der View, lassen die andere View unberührt und decken im Modus `document` nach U5 auf (F3/F10). |
| T71 | Suche nach einem als Pill gerenderten Frontmatter-Wert: Treffer in `wysiwyg`, Pill markiert, **Teilstring innerhalb der Pill hervorgehoben** (P4/F6). |
| T72 | Derselbe Wert, **nicht** als Pill gerendert: kein Treffer in `wysiwyg`, Treffer in `source` (P5). |
| T73 | Caret lässt sich nicht in eine Pill setzen; eine Selektion erfasst sie nicht zeichenweise (P3). |
| T74 | Textlöschen neben einer Pill entfernt sie nicht (P2). |
| T75 | Jeder Treffer trägt die Klasse `prose` oder `metadata` (F9). |
| **T122** | Suche nach Text in einem HTML-Kommentar: keine Treffer in `wysiwyg`, Treffer in `source` (H1/F4/F5). |
| **T123** | Chip-Beschriftung innerhalb eines HTML-Kommentars: in `wysiwyg` kein Treffer (H1). |
| **T119** | `html-ref`: Suche nach der sichtbaren Beschriftung trifft in `wysiwyg`; Tagname, Attribute und Id treffen nicht (W1/W2/W6). |
| **T129** | `*kursiv*` / `**fett**` in `wysiwyg`: Delimiter unsichtbar und atomar; Innen trägt `syn-em` / `syn-strong`; Document behält die Marker (IM1/I9). |
| **T130** | Suche nach `*` oder `**` trifft in `wysiwyg` keine Emphasis-/Strong-Delimiter; Suche nach dem Innen-Text trifft (IM4/F4). In `source` sind die Marker suchbar (F5). |
| **T131** | `~~x~~` und `` `code` ``: gleiche Hide+Mark-Regel; Code-Span bricht Emphasis darin (IM1/IM2). |
| T132 | `\*literal\*` in `wysiwyg`: Backslash hide (L2); die `*` sind keine Delimiter und bleiben sichtbar (IM3). |
| **T145** | Query `ARIA` trifft `aria` (Default); mit `caseSensitive: true` nicht (F12). |
| **T146** | `regex: true`, Query `a.ia` trifft `aria`; dieselbe Query literal nicht. Ungültiges Muster `[` → leere Liste (F13). |

### Ersetzen

| # | Fall |
| - | ---- |
| T76 | „Alle ersetzen" über mehrere Nodes ist **ein** Timeline-Eintrag und mit einem Undo vollständig zurückgenommen (RP2). |
| T77 | „Alle ersetzen" im Modus `view` fasst nichts außerhalb der eigenen Range an (RP3). |
| T78 | Voreingestellt bleiben `metadata`-Treffer unberührt; das Ergebnis meldet Prosa- und Metadaten-Zahl getrennt (RP5). |
| T79 | Mit ausdrücklichem Einschluss wird der YAML-Wert ersetzt und ist in der parallelen `source`-View sichtbar. |
| T80 | Ersetzung, die den YAML-Block ungültig machen würde, wird für **diesen** Treffer abgelehnt und gemeldet; die übrigen laufen durch (RP6). |
| T81 | Ersetzen in einer Chip-Beschriftung schreibt in den Prosa-Bereich; Ersetzen eines Chip-Attributs ist mangels Treffer unmöglich (W2). |
| T82 | Ersetzen markiert nur die betroffenen Nodes dirty (RP7/D1). |
| **T120** | `html-ref`: Ersetzen der Beschriftung schreibt nur den Textknoten; Start- und End-Tag bleiben (RP1/W6). |

### TrackedPosition und View-Zustand

| # | Fall |
| - | ---- |
| T83 | Ein TrackedPosition wandert bei Einfügung davor mit; seine aufgelöste Position bleibt semantisch dieselbe (TP1). |
| T84 | Löschen des markierten Bereichs meldet den TrackedPosition als ungültig (TP2); Undo macht ihn wieder gültig (TP3). |
| T85 | TrackedPosition wandert auch bei einer Änderung durch eine **andere** View im selben Node mit. |
| T86 | View schließen und wiederöffnen innerhalb der Session: Caret und Scroll semantisch exakt, **auch nach zwischenzeitlicher Änderung im selben Node** (V1). |
| T87 | Wiederherstellen aus `resolveTrackedPosition`-Momentaufnahme: Scope entfallen → R2, Versatz außerhalb → geklemmt, kein Absturz (V2). |
| T88 | Beim Wiederherstellen gewinnt der Scroll-TrackedPosition; ein Caret außerhalb des Sichtfensters löst kein Scrollen aus (V4). |
| T89 | Erstöffnung ohne Zustand: Caret am Anfang des ersten Fließtexts, nicht auf einer Überschrift, nicht am Dokumentende (V5). |
| T90 | View schließen kostet weder Historie noch Text noch Dirty-Status (V6/U8). |
| **T98** | **Der LRU-Fall:** View auf Node X mit `getState()` sichern, `destroy()`, dann **in X vor dem Caret einfügen**, dann `createView(state)` → Caret steht am selben Zeichen wie vorher (V7). |
| T99 | Dasselbe mit einer Strukturänderung während der Schließzeit (neue Kind-Überschrift in X): TrackedPosition gültig, Position semantisch korrekt. |
| T100 | `destroy()` **ohne** vorheriges `getState()` gibt die TrackedPosition frei; ihre Ids sind danach ungültig (V8). |
| T101 | Scope-Node während der Schließzeit gelöscht → TrackedPosition ungültig gemeldet, Wiederherstellen fällt auf den überlebenden Vorfahren, Caret an den Anfang (V10). |
| T102 | Anzahl lebender TrackedPosition bleibt konstant, wenn eine View wiederholt geschlossen und mit demselben State wiedereröffnet wird (kein Leck, V8/V9). |
| **T103** | Bereich mit TrackedPosition löschen → ungültig gemeldet (TP2), **Marke bleibt bestehen** (TP4); Undo macht sie wieder gültig **mit ursprünglicher Ausdehnung** (TP3). |
| T104 | Ungültige TrackedPosition wird nicht automatisch freigegeben; erst `release` entfernt sie (TP4/TP5). |
| T105 | `replaceDocument` meldet alle TrackedPositions als ungültig, entfernt aber keine (TP8/U7). |
| T106 | TrackedPositions werden auch dann abgebildet, wenn **keine einzige View** montiert ist (§ 3.4). |
| T91 | Verschränkte Timeline: Undo eines fremden Eintrags ruft dessen `revert` und lässt die CM6-History unangetastet; der nächste Undo trifft den davor liegenden Texteintrag (U14/U15). |

### Widgets

| # | Fall |
| - | ---- |
| T51 | Feldänderung schreibt eine Transaktion; die parallele `source`-View zeigt den neuen Text. |
| T52 | Feldänderung erscheint als Timeline-Eintrag und ist rücknehmbar (FM4). |
| T53 | Feldänderung setzt Dirty genau der betroffenen Node (D1). |
| T54 | Widget übersteht Presentation-, Scope- und Grain-Wechsel funktionsfähig (W4). |
| T55 | Feld leeren erzeugt gültiges Markdown. |
| T56 | Fokus im Widget stiehlt der Text-View den Cursor nicht (W5). |
| **T121** | `html-ref`: abweichender End-Tag und `<` im Textknoten sind kein Chip (W6). |
| **T124** | `attribute-block` interpretiert html-ref-Syntax nicht als Chip und umgekehrt (W6). |
| **T125** | `html-ref`: Selbstschluss (`/>`) und leeres Element sind Chips; sichtbares Label = `id` \| `type` \| `ref`; Find trifft das Label; Ersetzen mit `id` schreibt den Attributwert (W7/RP1). |

### Selektionsunabhängigkeit

| # | Fall |
| - | ---- |
| T107 | Relation `identical`: Cursor in View A setzen. View B behält ihren eigenen Cursor — Selektion ist nie geteilt, auch nicht bei gleichem Scope (§ 11.2, G3). |
| T108 | Relation `disjoint`: Cursor in View A setzen. View B vollständig unberührt (§ 11.3, G3). |

### Geometrie (Host-Overlays)

| # | Fall | Begründung |
| - | ---- | ---------- |
| **T126** | Ungemountet: `scrollPort` ist `null`, `coords(0, 0)` ist `null` (G6). Nach `mount` ist `scrollPort` das CM6-`scrollDOM`; `coords` für eine gültige Range liefert eine Box mit `bottom ≥ top` und `right ≥ left` (G4/G5). | Vertrag für Overlay ohne `EditorView`-Leak |
| **T127** | `coords` liegt relativ zum Scrollport inkl. Scroll-Offset: nach programmatischem Scroll ändert sich die Box konsistent mit `scrollTop` (G4); Persistenz bleibt TrackedPosition, nicht Pixel (V3). | Overlay wandert mit dem Text |

### Scope-Überschrift (`showNodeHeading`)

| # | Fall |
| - | ---- |
| **T133** | `showNodeHeading: false` in `wysiwyg`: DOM zeigt den Titel des Scope-Knotens nicht, Kind-Titel bleiben; Document behält die ATX-Zeile. `setScope` aufs Kind blendet *dessen* Heading aus. In `source` bleibt die Scope-Überschrift sichtbar. Suche nach dem Scope-Titel: kein Treffer in `wysiwyg`, Treffer in `source` (SNH2–SNH4/F4/F5). Default `true` ändert bestehende Fälle nicht (SNH1). |

### Heading-Stempel

| # | Fall |
| - | ---- |
| **T134** | Wysiwyg, Scope auf Rank-0-Knoten mit Kind Rank-1: Kind-Überschrift hat `data-rel="1"` und `data-rank` des Kindes; erste Prosa danach hat `syn-section-open` mit derselben `data-rel`. SNH2: Scope-ATX ohne Heading-Stempel, deren erste Prosa trotzdem `syn-section-open` `data-rel="0"` (HS1–HS3). |

---

## 15 · Benchmark

### 15.1 Korpus

Reproduzierbar generiert, gleicher Seed für alle Läufe. Generische Fülltexte.

| Größe | Zweck |
| ----- | ----- |
| S | Funktionsprüfung |
| M | Referenzfall |
| L | Falsifikation, deutlich oberhalb erwarteter Nutzung |

Struktur über alle Schema-Ränge, jede Node mit Frontmatter, Inline-Widgets und Referenzen in
realistischer Dichte.

### 15.2 View-Konfigurationen

Drei Views im Harness genügen für die Bedienung, **nicht für den Benchmark**. Gemessen wird
über eine definierte Menge von View-Konfigurationen.

Vollständige Permutationen über alle Nodes sind bei L kombinatorisch nicht durchführbar.
Stattdessen: **Relationsklassen mal Anzahl.** Für einen Elternknoten A mit Kindern B, C:

| Klasse | Beispiel | Misst |
| ------ | -------- | ----- |
| `single` | {A} | Grundlinie |
| `identical` × n | {B, B, B} | Kosten geteilter Darstellung |
| `disjoint` × n | {B, C, …} | Weiterleitung ohne Sichtüberschneidung |
| `containing` (1 + n) | {A, B, C} | Äußere View rendert alles, was innere ändern |
| `mixed` | {A, B, fremder Zweig} | Realistischer Mischfall |

n ∈ {1, 2, 3, 5, 8} für S und M; für L auf n ∈ {1, 2, 3, 5} begrenzt, sofern die Laufzeit es
erzwingt — die Begrenzung ist zu protokollieren, nicht stillschweigend zu setzen.

**Zur Idee, redundante Views zu schließen:** Die Motivation dahinter — Undo-Zustand in der
umfassenden View erhalten — entfällt. Nach U8 liegt die Timeline in der Session, nie in einer
View; eine View zu schließen kostet niemals Historie. Eine Begrenzung der View-Zahl bleibt
eine mögliche **Host**-Politik aus Performancegründen, ist aber keine Anforderung an die
Komponente und darf keine Regel aus § 6 verletzen.

### 15.3 Messgrößen

| Größe | Warum |
| ----- | ----- |
| Eingabelatenz je View-Konfiguration | Kernfrage der Synchronisation |
| Zeit bis interaktiv | Kosten des Gesamtdokuments |
| Sprungzeit zu entfernter Node | Viewport-Kosten bei L |
| Speicher/Berechnung je Größe und n | wächst mit n (N-fache StateField-Berechnung, § 11.2) — Falsifikationsgrenze (§ 2.3), kein Vergleichswert |
| Undo-Latenz über Node-Grenzen | U1 unter Last |
| Suchlaufzeit, je Modus | § 10.1 unter Last |
| Latenz einer kaskadierenden Strukturänderung | R6/§ 7.3 unter Last |
| Weiterleitungsdauer über alle View-States | § 7.3 Schritt 4 |

### 15.4 Ergebnis

Empfehlung mit Zahlen **plus Falsifikationssatz**: ab welchem Messwert bei welcher Größe und
welchem n die Empfehlung kippt.

---

## 16 · Phasen

**Zum Sync-Kern (§ 11) gibt es keine offene Variantenfrage mehr** — `SessionEditorState` ohne
View, ein `EditorState` je View, Dokument-Weiterleitung, keine Selektions-Weiterleitung.
Empirisch geprüft (§ 11.3), nicht gesetzt. Die Phasen bauen entsprechend in einem Zug, ohne
Torstelle vor dem ersten Anwendungscode.

| Phase | Inhalt | Ergebnis |
| ----- | ------ | -------- |
| **1** | Session, Tree-Projektion, Timeline (verschränkt), TrackedPositions + View-Zustand, zwei Text-Views, Scope (inkl. `include`)/Grain, Navigationsauflösung, Scroll-Owner, visibleNode, Dirty, minimale Guards — Sync-Kern nach § 11.2 (`SessionEditorState`, Dokument-Weiterleitung, keine Selektions-Weiterleitung, EX1–EX5) | T1–T37, T57–T63, T83–T116 grün |
| **2** | Benchmark (§ 15) **gegen vorab festgelegte absolute Budgets** (§ 16.2) | Budgets gehalten → weiter; verfehlt → Kosten benennen und innerhalb des Modells lösen (§ 2.3) |
| **3** | Frontmatter-Formular, Inline-Widgets, Pills, Suche und Ersetzen vollständig, gesperrte Bereiche vollständig, Inline-Chrome (§ 8.6) | T38–T56, T64–T82, T117, T119–T124, T129–T132 grün |
| **4** | API-Härtung, Beispiel-Host, Dokumentation | Veröffentlichungsfähig |

### 16.1 Verifikation des Sync-Kerns

G1a/G1b, G2, G3 empirisch beantwortet (§ 11.3) statt als Tor vor Phase 1 gesetzt.
Belege: Spike `spikes/phase-0/` — Stern: `SessionEditorState` ohne View, ein State je View,
derselbe volle `Text`, `ChangeSet` nur von der Session aus. Zwei Szenen (identical
Presentation vs. containing/disjoint Scope). Tests: `tests/unit/spike/g-questions.test.ts`
(ohne DOM) und `tests/behaviour/phase-0-gate.spec.ts` (lebende `EditorView`, Tastatur nicht
nur `state.update`).

Ergebnis und Nacharbeit: § 11.3. Nicht Gegenstand des Spikes und in Phase 1 zu belegen:
Undo nach `scopeLost`, IME gegen L2-`inputHandler`, CommonMark-Einrückung vor `#`.

Fällt eine der Fragen bei einer echten Regression künftig um, ist § 11 zu revidieren.

### 16.2 Warum das Budget absolut sein muss

Ein Messwert allein sagt nichts — „38 ms" ist weder gut noch schlecht ohne Maßstab. Deshalb:

| # | Regel |
| - | ----- |
| **B1** | Die Budgets je Messgröße aus § 15.3 werden **vor** dem ersten Lauf festgelegt und im Repository festgeschrieben. |
| **B2** | Nachträgliches Anheben eines Budgets, weil der Messwert es verfehlt, ist unzulässig. Verfehlt heißt verfehlt. |
| **B3** | Verfehlt der Sync-Kern ein Budget bei Korpus L, ist das ein benannter Befund — welche Messgröße, bei welchem n — der innerhalb des Modells gelöst wird (Optimierung der StateField-Berechnung, § 11.2). Kein Rückfall auf einen geteilten State: der ist nicht mehr Teil des Modells (§ 2.3 Falsifikation betrifft die Engine-Wahl, nicht den Sync-Kern). |
| **B4** | Ein verfehltes Budget ist damit ein Arbeitsauftrag, kein Auslöser für eine zweite Architektur. |

Das Budget bleibt der Beleg, dass die Entscheidung hält — nicht mehr im Vergleich zu einer
zweiten Konstruktion, sondern gegen sich selbst.

---

## 17 · Offene Punkte

| # | Frage | Stand |
| - | ----- | ----- |
| O1 | Name der Komponente und des Repositories | offen |
| O2 | Lizenz | **entschieden: MIT** — siehe `LICENSE` |
| O3 | Sprache der Spezifikation bei Veröffentlichung | Entwurf deutsch, Veröffentlichung englisch |
| O4 | Navigations-Oberfläche mitgeliefert? | nein — Baumdaten, `navigateTo` und Auswahl-API ja, Oberfläche nein |
| O5 | Obergrenze der Views | keine im Modell; Benchmark nach § 15.2 |
| O6 | Welche View speist `session.visibleNode` | die fokussierte |
| O7 | Selektionsverhalten | **entschieden (§ 11.3, G3):** Selektion je View, nie geteilt. Kein Sonderfall, keine Milderung nötig — es gibt nichts zu vermitteln. |
| O8 | Nehmen Frontmatter-Formularfelder an der Textsuche teil? | **entschieden: nein** (FM7) — als Pill gerenderte Werte dagegen ja (P5) |
| O9 | Rendert `wysiwyg` Überschriftentitel und Chip-Beschriftungen als echten Text? | **entschieden: ja**, erzwungen durch F7 — Bauvorgabe, keine offene Frage |
| **O10** | Abweichende Reihenfolgen (Chronologie, Achsenreihenfolge) | **entschieden: Host-Sache.** Reine Präsentation, live über `subscribe`, gespeist aus `session.readNodes(ids)`. Kein Projektionsmodell in der Komponente — Dekorationen können Text nicht umordnen, eine editierbare Umordnung erzwänge je View ein permutiertes Dokument. Annotationen dorthin über TrackedPosition (§ 3.4). |
| **O11** | Kann eine Präsentation in abweichender Reihenfolge auch **schreiben**? | Nicht als Text. Umsortieren dort bedeutet ein Metadatenfeld ändern (`session.apply`) oder eine Fremdentität (geteilte Timeline, § 9.1) — nie die Dokumentreihenfolge. |
