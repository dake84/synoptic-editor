# Editor-Komponente — Spezifikation

Markdown-Editor-Komponente auf CodeMirror 6. Ein Dokument, mehrere gleichzeitig sichtbare
Views mit unterschiedlicher Darstellung und unterschiedlichem Ausschnitt.

Status: Entwurf. Diese Datei wird `SPEC.md` im eigenen Repository und ist dort die einzige
Anforderungsquelle.

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
| Presentation je View bei geteiltem State (V-S) | **gebogen** — `ViewPlugin` identifiziert seine View (§ 10.1) |
| View-abhängige Guards bei geteiltem State (V-S) | **gebogen** — Transaktions-Annotationen statt Konfiguration |

Verbogen wird also ausschließlich in V-S, und nur an zwei Stellen. Alles Übrige ist entweder
nativ oder liegt oberhalb der Engine. Das ist der Grund, warum die Wahl nicht als offen
geführt wird.

### 2.3 Falsifikation

Die Engine-Wahl ist zurückzunehmen, wenn **beides** eintritt: die beiden Biegestellen aus
§ 2.2 erweisen sich in V-S als untragbar **und** die Weiterleitungskosten von V-M sind bei
Korpus L prohibitiv. Dann ist § 1.1 selbst zu prüfen, nicht die Engine.

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
| **View** | Eine Darstellung. Hat Scope, Presentation, Grain, Scroll, Find-Zustand. |
| **Scope** | Node-Id **plus Include-Modus**: `own` oder `subtree`. |
| **renderRange(v)** | Der Bereich, den View `v` rendert: `ownRange(scope)` bei `include: 'own'`, sonst `subtreeRange(scope)`. |
| **Session** | Hält Document, Tree, Baseline, View-Register, Schema, TrackedPositions; nutzt eine Timeline. |
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
| Document · Tree · Baseline · View-Register · Schema · Fokus · Timeline-Anbindung | Scope · Presentation · Grain · Scrollposition · visibleNode · Find-Zustand |

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
| `wysiwyg` | Marker versteckt, Frontmatter als Formular-Widget (§ 8.2), Inline-Referenzen als Widgets (§ 8.3), Metadaten-Pills (§ 8.4), Strukturebenen typografisch ausgezeichnet. |

Der Puffer ist in beiden identisch.

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

**Variantenrelevanz:** In V-S ist das der eine geteilte State — Views hängen sich an und ab,
sonst passiert nichts. In V-M braucht es dafür einen **kanonischen State ohne View**; hinge er
an einer View, wäre deren Schließen ein Eigentümerwechsel im Betrieb. TrackedPositions gehören
deshalb in Phase 1 und zählen beim Variantenvergleich mit (§ 11.4).

### 3.5 View-Zustand über Schließen und Wiederöffnen

Eine View kann geschlossen und wiederhergestellt werden — etwa wenn der Host die Zahl
gleichzeitiger Views begrenzt (§ 15.2). Der Zustand liegt dabei **nicht** in einem Cache der
Session (I10), sondern wird als Wert herausgegeben.

```
view.getState() → {
  scope: { nodeId, include },
  presentation, grain,
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
| **V10** | Wird die Scope-Node einer geschlossenen View gelöscht, meldet TP2 den TrackedPosition als ungültig; beim Wiederherstellen greifen R2 (Scope auf überlebenden Vorfahren) und V5 (Caret an den Anfang). |

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
  frontmatterInWysiwyg?:      'form'   | 'hidden',    // Default 'form'
}
```

`rank` aufsteigend von der äußersten Ebene. Der Kern kennt ausschließlich Ränge; `id` ist ein
undurchsichtiger Bezeichner für den Host. `grain` einer View ist eine `rank`-Angabe.

**Zur Konfigurierbarkeit von L5/R5:** Strukturbearbeitung in `wysiwyg` zu sperren ist
**Host-Politik, keine Invariante**. Die Komponente muss sperren *können*; ob sie es tut,
entscheidet der Host. Voreingestellt ist `locked`, weil eine Struktur-Mutation ohne sichtbare
Marker für den Bearbeiter schwer vorhersehbar ist.

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
| Selektion | variantenabhängig | § 10 | § 10 | § 10 |

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
| **R2** | Wird die Scope-Node einer View entfernt, fällt ihr Scope auf den nächsten überlebenden Vorfahren. Kein toter Verweis, kein Leerzustand. |
| **R3** | Rangänderung einer Scope-Node lässt den Scope gültig (Identität bleibt); Grain-Chrome und Range werden neu bestimmt. |
| **R4** | Verlässt eine Node die Range von View A und tritt in die von View B ein, rendern beide neu. Keine Neumontage. |
| **R5** | Strukturbearbeitung in `wysiwyg` folgt `policy.structureEditingInWysiwyg` (§ 4). Über `source` und API immer zulässig. |
| **R6** | Eine Strukturänderung erzeugt genau einen Timeline-Eintrag, unabhängig von der Zahl kaskadierender Nodes. |
| **R7** | Eine Kaskade, die das Schema verletzen würde, wird **vollständig** abgelehnt — kein Teilzustand, kein Timeline-Eintrag, Document unverändert. |

### 7.3 Ablauf einer Struktur-Aktion (beide Varianten)

Antwort auf „wie funktionieren `apply` und Undo, insbesondere in V-M":

```
1. Host ruft session.apply(action)                     — z. B. „Node X löschen"
2. Session plant die Kaskade gegen Schema + Tree       — Verletzung → R7, Abbruch
3. Plan wird zu genau einem ChangeSet verdichtet       — R6
4. Anwendung:
   V-S: ein Dispatch auf den geteilten State
   V-M: Dispatch auf den kanonischen State (view-unabhängig!),
        dann Weiterleitung
        desselben ChangeSet an alle übrigen States,
        in derselben Reihenfolge, in einem Durchlauf
5. Tree wird neu projiziert (I2)
6. Scopes werden gegen den neuen Tree validiert        — R2/R3
7. Relationen werden neu bestimmt                      — S3
8. Ein Timeline-Eintrag mit Ziel-Range und Ziel-Node
```

Undo läuft identisch mit dem invertierten `ChangeSet`; Schritte 5–7 wiederholen sich.

**Kritisch für V-M:** Schritt 4 muss atomar über alle States sein — eine Teilweiterleitung
hinterlässt divergierende Dokumente. Diese Fehlerklasse existiert in V-S nicht und ist ein
Kriterium in § 11.4.

**Kritisch für beide Varianten:** `EditorView.update` ist nicht reentrant (§ 11.1 Punkt 6) —
der Weiterleitungs-/Fan-out-Code darf beim Durchlaufen der Views keinen weiteren Dispatch
auslösen, unabhängig von der Variante.

---

## 8 · Gesperrte Bereiche, Frontmatter, Widgets

### 8.1 Allgemein

| # | Regel |
| - | ----- |
| **L1** | Strukturmarker sind in `wysiwyg` atomar: Löschen erfasst die ganze Einheit oder nichts. |
| **L2** | Getippte Markdown-Syntax wird nicht interpretiert, sondern maskiert geschrieben (`#`, `*`, `_`, `>`, `-`, Backtick, Backslash, `<`). |
| **L3** | Mehrzeiliges Einfügen wird in einem Schritt maskiert und in einem Schritt zurückgenommen. |
| **L4** | Überschriftentext bleibt in `wysiwyg` immer editierbar, unabhängig von `policy.structureEditingInWysiwyg`. |
| **L5** | Programmatische Änderungen umgehen die Sperren gezielt (Widgets, API, Undo). |
| **L6** | Sperrdefinition an genau einer Stelle (I6). |

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
| **FM2** | Keine Tastenfolge — auch keine wiederholte — macht ihn sichtbar, zerteilt ihn oder verklebt ihn mit Nachbartext. |
| **FM3** | Das Formular schreibt Änderungen **ausschließlich als Transaktion** auf die YAML-Range. Kein Formularzustand außerhalb des Document. |
| **FM4** | Daraus folgt ohne Zusatzpfad: die Änderung liegt auf der Timeline (§ 9) und im Dirty-Status (§ 9.3). |
| **FM5** | Ein geleertes Feld erzeugt gültiges Markdown — Schlüssel entfällt oder trägt einen leeren Wert, nie ein YAML-Fragment. |
| **FM6** | Der Frontmatter des Scope-Node einer View wird auch dann gerendert, wenn er textlich vor der Überschrift liegt. |
| **FM7** | Das Formular ist **Metadaten-Oberfläche, kein Fließtext**: seine Feldinhalte nehmen an der Textsuche (§ 10) **nicht** teil. |

FM7 ist eine bewusste Entscheidung, keine technische Grenze — Begründung und Alternative in
§ 17, O8.

### 8.3 Inline-Widgets (Referenz-Chips)

Im Gegensatz zum Frontmatter-Formular ersetzen Inline-Widgets eine Textstelle, deren
sichtbare Beschriftung **Fließtext-Rang** hat.

| # | Regel |
| - | ----- |
| **W1** | Die sichtbare Beschriftung ist Teil der Textprojektion: auffindbar (§ 10), hervorhebbar und **als Teilstring selektierbar**. |
| **W2** | Nicht sichtbare Anteile (Attribute, Ids, Marker) nehmen an der Suche nicht teil. |
| **W3** | Löschen erfasst die gesamte Widget-Einheit oder nichts (L1). |
| **W4** | Widgets überstehen Presentation-, Scope- und Grain-Wechsel funktionsfähig. |
| **W5** | Fokus in einem Widget entzieht der Text-View den Cursor nicht, solange der Bearbeiter es nicht anspricht. |

### 8.4 Metadaten-Pills

Ausgewählte Frontmatter-Felder werden zusätzlich als **Pills** unter der Überschrift im
Lesefluss gerendert. Sie sind die dritte Widget-Klasse und verhalten sich anders als beide
vorherigen, weil **Anzeigeort und Textort auseinanderfallen**: die Zeichen liegen im
YAML-Block, angezeigt werden sie nach der Überschrift.

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
| **U14** | Verschränkung gilt **unabhängig von der Variante** — auch in V-S. Die CM6-eigene History ist dort ein *Primitiv*, das die äußere Timeline ansteuert: bei einem Texteintrag ruft sie CM6-Undo, bei einem fremden Eintrag dessen `revert`, **ohne** die CM6-History anzufassen. |
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

### 10.2 Projektion

| # | Regel |
| - | ----- |
| **F4** | Die Trefferprojektion in `wysiwyg` ist **was der Leser sieht** — nicht „sichtbarer Dokumenttext". Sie umfasst damit auch Inhalte, die ein Widget aus einer anderen Dokumentstelle ableitet (Pills, P4/P5), und schließt Marker, Widget-Attribute und das Frontmatter-Formular aus. |
| **F5** | Daraus folgt: derselbe Query liefert in `source` und `wysiwyg` unterschiedliche Trefferzahlen. Vertrag, kein Defekt. |
| **F6** | Alles Gesehene ist durchsuchbar — **einschließlich Überschriftentiteln, Inline-Chip-Beschriftungen und Metadaten-Pills**. |
| **F7** | Ein Treffer wird als **Teilstring** hervorgehoben, auch innerhalb einer Überschrift, einer Chip-Beschriftung und einer Pill. **Selektierbar** ist er nur dort, wo seine Trefferstelle echter Fließtext an der Anzeigeposition ist — also nicht in Pills (P3). |
| **F8** | Frontmatter-Formularfelder nehmen nicht teil (FM7); ihre als Pill gerenderten Werte schon (P5). |
| **F9** | Jeder Treffer trägt eine **Klasse**: `prose` (Trefferstelle im Fließtext) oder `metadata` (Trefferstelle im Frontmatter, dargestellt als Pill). Die Klasse steuert das Ersetzen (§ 10.3). |

F6/F7 sind der Grund, warum Überschriften und Chip-Beschriftungen als **echter Text** und
nicht als Ersatz-Widget gerendert werden müssen — ein reines `Decoration.replace` ohne
Textinhalt wäre nicht selektierbar.

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

## 11 · Varianten

Zwei Umsetzungen desselben Modells, umschaltbar zur Laufzeit. Variantenspezifisch ist
ausschließlich der Synchronisationskern.

### 11.1 Grundlage

1. `EditorState` ist unveränderlich und enthält Dokument, Selektion und Konfiguration.
2. Eine `EditorView` rendert genau einen State; derselbe State darf mehreren Views übergeben
   werden.
3. `ViewPlugin` wird in der Konfiguration deklariert, aber **je `EditorView` instanziiert** —
   Dekorationen und atomare Bereiche können auch bei geteiltem State je View abweichen.
4. `changeFilter`, `transactionFilter` und `keymap` liegen auf State-Ebene — View-Bezug dort
   nur über Transaktions-Annotationen.
5. **`Text` ist eine persistente, unveränderliche Rope-Struktur.** Mehrere States können
   beim Anlegen denselben `Text` per Referenz teilen (kein Kopieraufwand). Nach einer
   Änderung erzeugt jeder State, der sie anwendet, sein eigenes neues Wurzelobjekt; nur
   unveränderte Teilbäume bleiben strukturell geteilt — Kopieraufwand je Änderung ist
   **O(log n)**, nicht O(n). Betrifft beide Varianten gleich.
6. `EditorView.update` ist **nicht reentrant** — ein Aufruf während eines laufenden Updates
   ist ein Fehler. Ein Fan-out-/Weiterleitungs-Koordinator darf beim Durchlaufen der Views
   keinen weiteren Dispatch auslösen (z. B. aus einem `updateListener`, der reflexhaft
   zurückschreibt). Gilt unabhängig davon, ob der Ziel-State geteilt ist oder nicht.
7. Layout-Geometrie ist nur in einer separaten, per `requestAnimationFrame` geplanten
   Messphase verfügbar; synchrones Messen während eines Updates ist ausgeschlossen (bestätigt
   T13).

Folge: **Parallele Views mit unterschiedlicher Presentation sind in beiden Varianten
möglich.**

### 11.2 V-S — Single Instance

Ein `EditorState`, N `EditorView`s.

| | |
| - | - |
| Document | geteilt — Divergenz strukturell unmöglich |
| Timeline | eine, ohne Zusatzcode |
| Selektion | **geteilt** über alle Views |
| Guards, Keymap | geteilt; View-Bezug über Annotationen |
| Speicher | eine Textkopie |
| Sync-Aufwand | keiner |

**Zu prüfende Milderung:** Die State-Selektion folgt der fokussierten View; die letzte
Cursorposition anderer Views wird als passive Dekoration gerendert. Ob das die
`disjoint`-Schwäche entschärft, ist in Phase 1 zu klären (§ 16).

**Fan-out:** Ursprungs-View zuerst `update(trs)` (CodeMirror-Split). Bei
`select.pointer` bekommen Geschwister denselben End-State per `setState` — nicht
dieselbe Transaction, sonst schreibt CM6 den Caret in jede View und stiehlt den
Fokus (G3). ViewPlugins überleben `setState` über den G1-WeakMap-Slot.

### 11.3 V-M — Multi Instance

Ein `EditorState` je View plus ein **kanonischer State ohne View**, `ChangeSet`-Weiterleitung, Timeline außerhalb mit einem Eigner.

| | |
| - | - |
| Document | je View; Weiterleitung nötig |
| Timeline | zentral geführt, States delegieren |
| Selektion | je View unabhängig |
| Guards, Keymap | je View direkt konfiguriert |
| Speicher | Textkopie × (Views **+ 1**) — der kanonische State ohne View zählt mit (§ 3.4) |
| Sync-Aufwand | je Änderung über alle Views |

### 11.4 Entscheidungskriterien

| Frage | Kippt zugunsten |
| ----- | --------------- |
| Geteilte Selektion bei `identical` — brauchbar oder störend? | brauchbar → V-S |
| Geteilte Selektion bei `disjoint` — Cursor liegt zwangsläufig außerhalb einer View. Tragbar, ggf. mit Milderung (11.2)? | tragbar → V-S |
| Bleiben annotationsgeführte Guards lesbar, oder entsteht Sonderfall-Häufung? | lesbar → V-S |
| Wiegt strukturelle Divergenzfreiheit schwerer als direkte Konfigurierbarkeit? | ja → V-S |
| Bleibt die Weiterleitung (§ 7.3, Schritt 4) bei n Views und Korpus L im Latenzbudget? | nein → V-S |
| Ist Live-Kollaboration absehbar (§ 11.5)? | ja → V-S |

`disjoint` ist der Härtefall für V-S, atomare Weiterleitung der für V-M.

### 11.5 Live-Kollaboration (post-MVP, nicht gebaut)

Nicht Gegenstand dieser Fassung (§ 1), aber die Varianten verhalten sich unterschiedlich, und
das gehört in die Bewertung (§ 11.4).

| | |
| - | - |
| **V-S** | Trivial. Die Collab-Erweiterung hängt am einen State; Remote-Änderungen werden dorthin dispatched, alle Views sehen sie. Collab ist orthogonal zur Zahl der Views. |
| **V-M** | Möglich, aber eine Stufe schwerer. Das Problem ist **Rebasing**: trifft eine fremde Änderung ein, während unbestätigte lokale Änderungen vorliegen, werden die lokalen umgeschrieben — die View-States haben sie aber schon angewandt. Der Synchronisationskern muss dann nicht nur weiterleiten, sondern **Korrekturen nachreichen**, inklusive Selektionsabbildung je View. Fehler dort erzeugen stille Divergenz. |

**Notiz zu einem dritten Weg:** Mit einem CRDT (etwa Yjs) ließe sich in V-M jeder View-State an
dasselbe geteilte Dokument binden — der Synchronisationskern entfiele, das CRDT wäre er. Das
verschiebt allerdings die Wahrheit von „ein Markdown-String, der uns gehört" auf „ein
CRDT-Dokument, das wir nach Markdown projizieren" und berührt damit § 1.1. Andere Architektur,
nicht andere Umsetzung — hier nur festgehalten, nicht verfolgt.

---

## 12 · Öffentliche API

Entwurf. Alles nicht Aufgeführte ist intern.

### Session

| Signatur | Art |
| -------- | --- |
| `createSession({ doc, schema, policy?, timeline?, strings? })` | Factory |
| `session.document` · `session.tree` | lesend |
| `session.readNodes(ids)` | lesend — Inhalt in host-gewählter Reihenfolge (§ 17, O10) |
| `session.createTrackedPosition(range)` · `.release(id)` · `.resolve(id)` | TrackedPosition (§ 3.4) |
| `session.activeNode` · `session.visibleNode` | lesend, abgeleitet |
| `session.isDirty(nodeId)` · `session.isSubtreeDirty(nodeId)` | lesend, abgeleitet |
| `session.undo()` · `session.redo()` | Kommando — der eine Eintrittspunkt |
| `session.apply(action)` | Kommando — Struktur-/Nicht-Text-Aktion (§ 7.3) |
| `session.markPersisted(nodeId?)` | Kommando |
| `session.replaceDocument(doc)` | Kommando — U7 |
| `session.subscribe(fn)` | Ereignis — ein Kanal für alle Zustandsänderungen |
| `session.createView(opts)` | Factory |

### View

| Signatur | Art |
| -------- | --- |
| `view.mount(el)` · `view.destroy()` | Lebenszyklus |
| `view.getState()` | lesend — Wiederherstellungszustand mit TrackedPositions (§ 3.5) |
| `view.setScope(nodeId, { include: 'own' \| 'subtree' })` | Kommando — Umfang (§ 3.1) |
| `view.setPresentation(p)` · `setGrain(rank)` | Kommando |
| `view.navigateTo(nodeId)` | Kommando — löst Scope vs. Viewport auf (§ 13.2) |
| `view.scrollToNode(nodeId, cause)` | Kommando — `cause` ist Pflicht (I4) |
| `view.visibleNode` | lesend |
| `view.find(query, { mode: 'view' \| 'document' })` | Kommando (§ 10.1) |
| `view.replace(hitId, text)` · `view.replaceAll(text, { classes })` | Kommando (§ 10.3) |
| `view.focus()` | Kommando |

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
| Variantenschalter | V-S ⇄ V-M zur Laufzeit |
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

Verhaltenstests, **variantenunabhängig formuliert — sie laufen unverändert gegen V-S und
V-M**. Das gilt ausdrücklich auch für Scope- und Grain-Tests: Scope und Grain sind
Modellbegriffe (§ 3), keine Eigenschaften einer Variante. Einzige Ausnahme: T-V\*.

Unit-Tests sind zusätzlich und variantenspezifisch (V-M: Weiterleitung und
Selektionsabbildung; V-S: Annotationsfilter und View-Zuordnung im `ViewPlugin`). Kein
Testfall darf auf Zeit warten (I5).

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
| T23 | Scope-Node entfernt → Fallback auf überlebenden Vorfahren (R2). |
| T24 | Rangänderung der Scope-Node → Scope bleibt gültig (R3). |
| T25 | Node wandert von Range A nach Range B → beide rendern neu, keine Neumontage (R4). |
| T26 | Relation zweier Views ändert sich durch eine Strukturänderung ohne Scope-Zuweisung (S3). |

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
| T42 | Löschen am Strukturmarker erfasst die atomare Einheit oder nichts. |
| **T43** | `policy.structureEditingInWysiwyg: 'locked'` → Strukturänderung abgelehnt, Überschriftentext editierbar (L4). Mit `'allowed'` → Strukturänderung zulässig, Regeln R6/R7 gelten unverändert. **Beide Belegungen werden geprüft.** |
| T44 | Undo darf gesperrte Bereiche verändern (U6). |
| T64 | Caret lässt sich in `wysiwyg` nicht in den Frontmatter-Rohtext setzen (FM1). |
| T65 | Formularfeld ändern → YAML-Range im Document geändert, in paralleler `source`-View sichtbar (FM3). |
| T66 | Feld leeren → gültiges Markdown, kein YAML-Fragment (FM5). |
| T67 | Frontmatter vor der Überschrift wird für den Scope-Node gerendert (FM6). |

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
| T71 | Suche nach einem als Pill gerenderten Frontmatter-Wert: Treffer in `wysiwyg`, Pill markiert, **Teilstring innerhalb der Pill hervorgehoben** (P4/F6). |
| T72 | Derselbe Wert, **nicht** als Pill gerendert: kein Treffer in `wysiwyg`, Treffer in `source` (P5). |
| T73 | Caret lässt sich nicht in eine Pill setzen; eine Selektion erfasst sie nicht zeichenweise (P3). |
| T74 | Textlöschen neben einer Pill entfernt sie nicht (P2). |
| T75 | Jeder Treffer trägt die Klasse `prose` oder `metadata` (F9). |

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
| T91 | Verschränkte Timeline in **V-S**: Undo eines fremden Eintrags ruft dessen `revert` und lässt die CM6-History unangetastet; der nächste Undo trifft den davor liegenden Texteintrag (U14/U15). |

### Widgets

| # | Fall |
| - | ---- |
| T51 | Feldänderung schreibt eine Transaktion; die parallele `source`-View zeigt den neuen Text. |
| T52 | Feldänderung erscheint als Timeline-Eintrag und ist rücknehmbar (FM4). |
| T53 | Feldänderung setzt Dirty genau der betroffenen Node (D1). |
| T54 | Widget übersteht Presentation-, Scope- und Grain-Wechsel funktionsfähig (W4). |
| T55 | Feld leeren erzeugt gültiges Markdown. |
| T56 | Fokus im Widget stiehlt der Text-View den Cursor nicht (W5). |

### Variantenverhalten

Diese beiden Fälle **schreiben fest, sie bewerten nicht**. Sie sind je Variante mit
unterschiedlicher Erwartung hinterlegt und dienen als Beobachtungsgrundlage für § 11.4.

| # | Fall |
| - | ---- |
| **T-V1** | Relation `identical`: Cursor in View A setzen. V-S — View B zeigt denselben Cursor. V-M — View B behält ihren eigenen. Erwartungswert je Variante fixiert. |
| **T-V2** | Relation `disjoint`: Cursor in View A setzen. V-S — die geteilte Selektion liegt außerhalb der Range von B; festgehalten wird, was B dann darstellt und ob eine Bedienung von B den Cursor unerwartet fortbewegt. V-M — B unberührt. **Härtefall**; ergibt zusammen mit der Milderung aus § 11.2 die Antwort auf § 11.4, Frage 2. |

**Ist hier etwas zu entscheiden?** Für den Phase-1-Default nein: G3 hat unabhängige Selektion
festgelegt (O7). T-V1/T-V2 bleiben die Beobachtungsfälle, falls V-S je gebaut wird — dann
ohne und mit Milderung (§ 11.2), sonst würde eine Variante verworfen, deren einfachste
Verbesserung nie probiert wurde.

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
| Speicher je Variante, Größe und n | V-M skaliert mit n, V-S nicht |
| Undo-Latenz über Node-Grenzen | U1 unter Last |
| Suchlaufzeit, je Modus | § 10.1 unter Last |
| Latenz einer kaskadierenden Strukturänderung | R6/§ 7.3 unter Last |
| Weiterleitungsdauer über alle States (nur V-M) | § 7.3 Schritt 4 |

### 15.4 Ergebnis

Empfehlung mit Zahlen **plus Falsifikationssatz**: ab welchem Messwert bei welcher Größe und
welchem n die Empfehlung kippt.

---

## 16 · Phasen

**Vorbemerkung zur Reihenfolge.** Ursprünglich sollte Phase 0 entscheiden, ob ein geteilter
`EditorState` (V-S) trägt. Das Tor hat diese Konstruktion **nicht** mehr als Anforderung.
Begründung: I1 verlangt ein Session-Document, keine geteilte CM6-Selektion. Selektion ist
`EditorSelection` (Anker/Head im State). Sie mit dem State zu teilen ist eine Nebenwirkung
von V-S, kein Produktziel — und sie ist der Härtefall bei `disjoint` (§ 11.4).

Phase 0 prüft deshalb drei **produktseitige** Lasten, ohne einen geteilten `EditorState`
vorauszusetzen. Der Spike beantwortet sie mit einem `EditorState` je View und Weiterleitung
nur der Document-`ChangeSet`s (CodeMirror-Split). V-S bleibt in § 11.2 dokumentiert, ist
aber nicht durch das Tor gedeckt und nicht Phase-1-Default.

Das Messbudget in Phase 2 (§ 16.2) bleibt absolut: die gewählte Konstruktion muss die
Budgets halten, nicht eine ungebauten Alternative schlagen.

| Phase | Inhalt | Ergebnis |
| ----- | ------ | -------- |
| **0** | **Risikotor** (§ 16.1) — Presentation, Guards, Selektionsunabhängigkeit; ohne geteilten `EditorState` | schriftliches Bestanden/Durchgefallen je Punkt |
| **1** | Session, Tree-Projektion, Timeline (verschränkt), TrackedPositions + View-Zustand, zwei Text-Views, Scope (inkl. `include`)/Grain, Navigationsauflösung, Scroll-Owner, visibleNode, Dirty, minimale Guards — CM6-Anbindung wie der Spike: ein `EditorState` je View, nur Document-Änderungen weiterleiten. Keine Selektions-Milderung (§ 11.2) | T1–T37, T57–T63, T83–T106 grün; T-V1/T-V2 mit der Spike-Erwartung (Selektion je View) |
| **2** | Benchmark (§ 15) **gegen vorab festgelegte absolute Budgets** (§ 16.2) | Budgets gehalten → weiter; verfehlt → Budget verfehlt (B2), kein automatischer Variantenwechsel |
| **3** | Frontmatter-Formular, Inline-Widgets, Pills, Suche und Ersetzen vollständig, gesperrte Bereiche vollständig, strukturelle Listenansicht | T38–T56, T64–T82 grün |
| **4** | API-Härtung, Beispiel-Host, Dokumentation | Veröffentlichungsfähig |

### 16.1 Risikotor (Phase 0)

Drei Fragen, in ein bis zwei Tagen beantwortbar. Ein geteilter `EditorState` ist **keine**
Tor-Anforderung.

| # | Frage | Bestanden, wenn |
| - | ----- | --------------- |
| **G1** | Zeigen zwei Views dasselbe Document in unterschiedlicher Presentation und unterschiedlichem Scope, ohne Presentation im Document zu speichern? | `source` und `wysiwyg` gleichzeitig; Node-A vs. Node-B; Document-Strings nach einer Änderung gleich; Marker nur in `source` sichtbar |
| **G2** | Greifen die wysiwyg-Guards L1–L3 nur in der wysiwyg-View, in einem Filter, ohne Tasten-Sonderfall? | `#` in wysiwyg → escaped; mehrzeiliges Einfügen ist eine maskierte Änderung; partielles Marker-Delete expandiert; `#` in `source` bleibt unmaskiert |
| **G3** | Bleibt die Selektion der anderen View bei `disjoint` unberührt? | Selektion in A ändert den Caret von B nicht; Tippen in A aktualisiert B's Document (Stringgleichheit), B's Caret bleibt im eigenen Zweig (Abbildung durch den `ChangeSet` ist erlaubt, Übernahme von A's Selektion nicht) |

**Fällt einer durch**, ist die Spike-Konstruktion untragbar — dann ist § 16.1 zu revidieren,
nicht still auf V-S zurückzufallen.

#### Urteil (Spike `spikes/phase-0/`, Tests `tests/behaviour/phase-0-gate.spec.ts`)

| # | Ergebnis | Begründung |
| - | -------- | ---------- |
| **G1** | **Bestanden** | Ein `EditorState` je View. Presentation und Scope stehen in der View-Konfiguration (ViewPlugin-Closure), nicht im Document. `source` zeigt Marker, `wysiwyg` blendet sie per Replace/`atomicRanges` aus; fremde Zweige per Line-Decoration. Document-Strings bleiben gleich. Hinweis: Replace über Zeilenumbrüche darf in CM6 nicht aus einem ViewPlugin kommen — Line-Decorations reichen für den Scope-Beweis. |
| **G2** | **Bestanden** | L1–L3 sitzen in einem `transactionFilter` nur auf dem wysiwyg-State. Source hat den Filter nicht — View-Identität braucht keine Annotation. Input/Paste/Delete setzen `userEvent`; kein Tasten-Sonderfall. |
| **G3** | **Bestanden** | Selektion wird nicht weitergeleitet. `setSelection`/Tippen in A lässt B's Caret im eigenen Zweig; B's Document folgt. Keine Milderung, kein passiver Caret. |

**Gesamturteil: Phase 0 bestanden ohne geteilten EditorState.** Phase 1 folgt für die
CM6-Anbindung der Spike-Konstruktion. `src/sync/shared-state/` ist nicht durch das Tor
gedeckt. V-S bleibt in § 11.2 dokumentiert.

### 16.2 Warum das Budget absolut sein muss

Ohne V-M gibt es keine Vergleichszahl. Ein Messwert allein sagt nichts — „38 ms" ist weder
gut noch schlecht ohne Maßstab. Deshalb:

| # | Regel |
| - | ----- |
| **B1** | Die Budgets je Messgröße aus § 15.3 werden **vor** dem ersten Lauf festgelegt und im Repository festgeschrieben. |
| **B2** | Nachträgliches Anheben eines Budgets, weil der Messwert es verfehlt, ist unzulässig. Verfehlt heißt verfehlt. |
| **B3** | Verfehlt die Phase-1-Konstruktion (ein `EditorState` je View, Document-Weiterleitung) ein Budget bei Korpus L, gilt das Budget als verfehlt. Ein nachträglicher Wechsel auf geteilten EditorState ist dadurch nicht angeordnet. |
| **B4** | V-S (§ 11.2) bleibt dokumentierte Alternative, nicht Phase-1-Default und nicht durch das Tor gedeckt. § 11.3 beschreibt die gewählte CM6-Anbindung; § 11.5 bleibt gültig. |

Damit ist die Entscheidung weiterhin belegt statt gesetzt — der Beleg ist das Budget der
gewählten Konstruktion, nicht ein Zweitbau.

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
| O7 | Selektionsverhalten | **entschieden (G3):** Selektion je View, nicht geteilt. Milderung § 11.2 entfällt für den Phase-1-Default. T-V1/T-V2 bleiben Beobachtung, falls V-S je gebaut wird. |
| O8 | Nehmen Frontmatter-Formularfelder an der Textsuche teil? | **entschieden: nein** (FM7) — als Pill gerenderte Werte dagegen ja (P5) |
| O9 | Rendert `wysiwyg` Überschriftentitel und Chip-Beschriftungen als echten Text? | **entschieden: ja**, erzwungen durch F7 — Bauvorgabe, keine offene Frage |
| **O10** | Abweichende Reihenfolgen (Chronologie, Achsenreihenfolge) | **entschieden: Host-Sache.** Reine Präsentation, live über `subscribe`, gespeist aus `session.readNodes(ids)`. Kein Projektionsmodell in der Komponente — Dekorationen können Text nicht umordnen, eine editierbare Umordnung erzwänge je View ein permutiertes Dokument. Annotationen dorthin über TrackedPosition (§ 3.4). |
| **O11** | Kann eine Präsentation in abweichender Reihenfolge auch **schreiben**? | Nicht als Text. Umsortieren dort bedeutet ein Metadatenfeld ändern (`session.apply`) oder eine Fremdentität (geteilte Timeline, § 9.1) — nie die Dokumentreihenfolge. |
