# TopHatt

[🇬🇧 English](README.md) | 🇩🇪 **Deutsch**

TopHatt ist ein Spieltags-Cockpit für [Hattrick](https://www.hattrick.org). Es liest die Daten aus
Hattrick Organizer (HO), schlägt Aufstellung, Taktik und Wechsel für das nächste Spiel vor und schreibt
das Ergebnis als HRF-Datei zurück, die HO zu Hattrick hochlädt. Alles läuft lokal im Browser, hell oder dunkel, auf Deutsch, Englisch, Spanisch, Italienisch oder Polnisch.

![Aufstellungsseite mit Spielfeld, Formationsvorschlag, Spielerliste und Ersatzbank](docs/img/aufstellung.png)

<sub>Alle Screenshots zeigen einen erfundenen Verein mit erfundenen Spielern und Werten; die Spielerbilder sind Hattrick-Avatare aus HO.</sub>

**Inhalt:** [Die Seiten](#die-seiten) · [Installieren](#installieren) · [Benutzen](#benutzen) · [Aufbau](#aufbau) · [Entwickeln](#entwickeln) · [Lizenz](#lizenz)

## Die Seiten

Die Seiten folgen dem Menü links in der App. Jeder Abschnitt lässt sich aufklappen.

### Spieltag

<details open>
<summary><b>Übersicht</b>: das nächste Spiel auf einen Blick</summary>
<br>

Gegner, Anstoß, erwartete HatStats, Formation, größte Schwachstelle und die nächsten Spiele. Darunter Kacheln, die
direkt zur passenden Seite führen.

![Übersicht](docs/img/spieltag.png)
</details>

<details open>
<summary><b>Aufstellung</b>: in sechs Schritten zur fertigen HRF-Datei</summary>
<br>

Spielfeld wie in HO (Torwart oben). Oben springt man über die nummerierten Knöpfe zu den Bereichen.

<details open>
<summary>1 · Spielfeld und Bank</summary>
<br>

- **Formationen als Kacheln** mit HatStats, Siegchance gegen den nächsten Gegner, Erfahrung und Trainingsplätzen:
  eingespielte Formationen (Erfahrung ab 6) zuerst, dann je eine **Trainingsformation** gegen Stärkere, Ausgeglichene
  und Schwächere, „Stärker, aber kaum eingespielt“ mit Hinweis auf Desorganisation, der Rest eingeklappt.
- **Aufstellen per Knopf:** „Automatisch aufstellen“ (stärkste Elf nach HatStats), „Stärkste Elf + Training“
  (Formation mit den meisten Trainingsplätzen, solange sie höchstens 2 % HatStats kostet), **„Gegen Gegner“**
  (Formation, Spieler und Taktik mit der besten Siegchance gegen den nächsten Gegner, mit Vergleich zur stärksten Elf),
  „B-Kader“, „Noch nicht gespielt“ und „Feld leeren“.
- **Kapitän und Standards** als Auswahlzeile über dem Spielfeld, „Automatisch“ oder selbst gewählt.
- Spielerliste mit „Schon trainierte ausblenden“ und „Schon gespielte ausblenden“. Nach dem zweiten Spiel der Woche
  plant TopHatt schon die nächste Trainingswoche.
- **Ansehen/Ändern**: Im Ansehen-Modus zeigt ein Spieler beim Darüberfahren seine Karte, Antippen hält sie fest, nichts
  verschiebt sich versehentlich. Im Ändern-Modus Spieler ziehen oder antippen; die Linien zeigen, wo er am besten passt.
- Rahmenfarbe = Eignung für die Position, Kreisfarbe = Kader (A lila, B blau, Rest grau), Pfeile = geplante Wechsel mit Minute.

**Spieler angeklickt:** Die Spielerkarte zeigt Alter, TSI, Gehalt, Form, Kondition, alle Fähigkeiten, die besten
Positionen (in denselben Farben wie die Linien auf dem Feld) und die letzte Bewertung.

![Spielerkarte nach Klick auf einen Spieler, Linien zu den passenden Positionen](docs/img/spielerkarte.png)
</details>

<details>
<summary>2 · Taktik</summary>
<br>

Empfehlung für Taktik, Einstellung und Ausrichtung aus der HO-Spielvorhersage gegen die Gegnerstärke, mit Sieg-,
Remis- und Niederlagenchance. Ausrichtungen gibt es nur, soweit Trainertyp und Taktik-Assistenten sie erlauben.
Pressing wird wie in HO aus der Pressingstärke der Elf berechnet und in der Spielvorhersage berücksichtigt.

![Taktik-Empfehlung](docs/img/taktik.png)
</details>

<details>
<summary>3 · Auswechslungen und Anweisungen</summary>
<br>

Vorschläge nach Kondition, Training und Einsatzzeit mit den Zielen **Sieg**, **Ausgewogen** oder **Training**.
**Automatisch** passt die Wechsel jeder Änderung der Aufstellung an, **Manuell** lässt sie stehen. Darunter die
Anweisungen wie in HO; was nicht mehr zur Aufstellung passt, wird markiert.

![Auswechslungs-Vorschläge und Anweisungen](docs/img/auswechslungen.png)
</details>

<details>
<summary>4 · Elfmeterschützen</summary>
<br>

Reihenfolge wie in HO aus Erfahrung, Standards und Torschuss, automatisch oder von Hand sortiert.

![Elfmeterschützen](docs/img/elfmeter.png)
</details>

<details>
<summary>5 · Reserve und 6 · Speichern</summary>
<br>

Die Reserve ist die zweite Bankreihe: automatisch der stärkste andere Bankspieler je Position. „Für HO speichern“
schreibt eine HRF-Datei mit Aufstellung, Taktik, Kapitän, Standards, Bank, Reserve, Elfmeterschützen und Anweisungen.

![Reserve der Ersatzbank und Speichern](docs/img/reserve-speichern.png)
</details>
</details>

<details>
<summary><b>Gegner-Check</b>: wie stark ist der nächste Gegner?</summary>
<br>

Stärke des Gegners aus seinen letzten Pflichtspielen (HO-Gegnercheck), Ballbesitz und Duell für Duell gegen die eigene Elf,
dazu Siegchance und Remis mit der besten Taktik. Verglichen wird standardmäßig die Aufstellung, die gerade auf der
Aufstellungsseite steht; unter „Unsere Seite“ lässt sich stattdessen die beste Elf jeder Formation wählen (mit HatStats,
Siegchance und Erfahrung). Die Legende zeigt, womit gerechnet wird, z. B. „Wir (deine Aufstellung, 4-4-2)“.

![Gegner-Check](docs/img/gegner.png)
</details>

### Mannschaft

<details>
<summary><b>Kader</b>: wer ist einsatzbereit, und wo?</summary>
<br>

Kader nach Mannschaftsteilen mit Einsatzwert aus Positionsstärke, Kondition und Verletzung; jeder Spieler einmal,
wahlweise ausgewogen, nach bester Position oder wie aufgestellt.

![Kader](docs/img/kader.png)
</details>

<details>
<summary><b>Schwachstellen</b>: wo verliert die Mannschaft am meisten?</summary>
<br>

Bewertung je Mannschaftsteil für die eigene Aufstellung, der stärkste Hebel und ein Vergleich aller Formationen.
Weicht die Elf der Aufstellungsseite von der besten Elf ihrer Formation ab (etwa nach „Gegen Gegner“), steht sie als
eigene Zeile „Deine Aufstellung“ in der Tabelle. Jede Änderung der Aufstellung kommt sofort an.

![Schwachstellen](docs/img/schwachstellen.png)
</details>

<details>
<summary><b>Spielerentwicklung</b>: wohin entwickelt sich ein Spieler?</summary>
<br>

Graph mit Prognose aus dem HO-Trainingsmodell, Altersabbau und Hinweis, wann ein Verkauf oder Ersatz ansteht.

![Spielerentwicklung](docs/img/entwicklung.png)
</details>

### Planung

<details>
<summary><b>Kaderplanung</b>: wo droht in ein, zwei Saisons eine Lücke?</summary>
<br>

Der ganze Kader gegen den Bedarf (Plätze plus je Platz ein Ersatz): Überzählige mit Gehalt, Lücken und Durchschnittsalter
auf einen Blick. „Was zu tun ist“ nennt die Schritte: Lücke schließen (mit Aushelfer aus dem Kader oder Suchprofil),
Nachfolger für nachlassende Stammspieler, Überzählige verkaufen. Je Mannschaftsteil steht jeder Spieler genau einmal mit
Rolle (Stammspieler, Ersatz, Talent, überzählig) und Stärke heute und in zwei Saisons.

![Kaderplanung](docs/img/kaderplanung.png)
</details>

<details>
<summary><b>Transfers</b>: welche Verstärkung bringt am meisten?</summary>
<br>

Suchprofile für den Transfermarkt in Kaufreihenfolge, abgestimmt mit der Kaderplanung (Lücken zuerst, Überzählige als
Verkaufskandidaten), mit einem gemeinsamen Budget: Das Höchstgebot hält den Kontostand eine ganze Saison über dem Mindest-Puffer (mit Gehalt und typischen Wocheneinnahmen). Trag den Preis eines echten Kandidaten ein, um ihn zu prüfen, hake ungenutzte Spieler zum Verkauf an und sieh deine bisherigen Transfers aus HO.

![Transfers](docs/img/transfers.png)
</details>

<details>
<summary><b>Trainingswoche</b>: wer spielt wo, damit möglichst viele trainieren?</summary>
<br>

A-Kader und B-Kader, Plan für Liga-, Pokal- und Freundschaftsspiel nach Trainingsnutzen. Die Liste „Nicht trainieren“ hält Spieler, die verkauft oder entlassen werden, von den Trainingsplätzen fern. Auf der Aufstellungsseite stellt „Noch nicht gespielt“ alle auf, die diese Woche noch keinen Einsatz hatten, und wechselt bis zu 3 weitere von der Bank ein.

Sind beide Spiele der Woche gespielt, zeigt eine Karte bis zum Trainingsupdate die abgeschlossene Woche: wer voll, halb
oder gar nicht trainiert hat. Alles darunter plant dann schon die nächste Woche.

![Trainingswoche](docs/img/training.png)
</details>

<details>
<summary><b>Trainer & Effizienz</b>: lohnt sich ein besserer Trainer?</summary>
<br>

Trainingseffizienz wie die Hattrick-Sandbox, Kosten je Effizienzpunkt, günstigste Wege zu mehr Effizienz und Trainerpreise.

![Trainer & Effizienz](docs/img/trainer.png)
</details>

### Saison und Verein

<details>
<summary><b>Spielplan & Tabelle</b></summary>
<br>

![Spielplan und Tabelle](docs/img/spielplan.png)
</details>

<details>
<summary><b>Finanzen</b>: kann sich der Verein das leisten?</summary>
<br>

Kontostand, Wochenbilanz, Personal und eine Ampel mit Prognose, ob geplante Ausgaben in die Schulden führen.

![Finanzen](docs/img/finanzen.png)
</details>

<details>
<summary><b>Verlauf</b>: geht der Plan über die Wochen auf?</summary>
<br>

Je Trainingswoche ein Schnappschuss von Training, Personal, Finanzen, Mannschaft und Kader; Export und Import als JSON.

![Verlauf](docs/img/verlauf.png)
</details>

## Installieren

Ohne Build: unter [Releases](https://github.com/michelix/tophatt/releases/latest) die Datei `TopHatt-<Version>.zip`
herunterladen und entpacken. Darin liegen `TopHatt.bat`, `dist/tophatt.html` und `sync/TopHattSync.jar`.
Vorausgesetzt wird nur eine Installation von [Hattrick Organizer](https://github.com/ho-dev/HattrickOrganizer);
dessen Java wird für den Sync mitbenutzt. Nur die App ohne HO-Datenbank: `tophatt.html` aus dem Release reicht.

## Benutzen

1. In HO wie gewohnt die Daten herunterladen (am besten mit Gegnercheck). Die `.hrf`-Datei landet im HO-Datenordner,
   hier `F:\claude\hattrick\HO\daten`.
2. **`TopHatt.bat`** starten. Das liest die HO-Datenbank (nur lesend, über eine Kopie), schreibt
   `tophatt-data.json` in den Datenordner und öffnet `dist/tophatt.html`.
3. Beim ersten Mal in der App unter „Daten“ den Ordner verbinden (geht in Chrome und Edge). Danach lädt TopHatt beim
   Öffnen immer die neuesten Daten, „Aktualisieren“ liest sie neu ein. Ohne Ordner geht es auch: HRF-Datei und
   `tophatt-data.json` ins Fenster ziehen.
4. Aufstellung prüfen und „Für HO speichern“. In HO über Datei → Importieren → HRF einlesen und „Aufstellung senden“.

Die Pfade zu HO stehen oben in `TopHatt.bat` und lassen sich dort anpassen. Spielerbilder liest der Sync aus
`img/playersAvatar` der lokalen HO-Installation; sie bleiben auf dem eigenen Rechner und gehören nicht ins Repository.

## Aufbau

| Teil | Inhalt |
| --- | --- |
| `sync/` | TopHatt-Sync (Java 17): liest die HO-Datenbank (HSQLDB) und exportiert Spielplan, Tabelle, Spielerhistorie, Training, Gegnerbewertungen und Spielerbilder |
| `src/core/hrf.ts` | HRF-Dateien lesen und schreiben |
| `src/core/hodata.ts` | `tophatt-data.json` lesen, nächstes Spiel, Tabelle |
| `src/core/rating.ts`, `optimizer.ts` | Bewertungsformel aus HO und Aufstellungs-Optimierung |
| `src/core/editor.ts` | Manuelle Aufstellung bewerten, vervollständigen und mit dem Vorschlag vergleichen |
| `src/core/tactics.ts`, `matchplan.ts` | Taktik-Wirkung, Spielvorhersage und Empfehlung für Taktik, Einstellung, Ausrichtung |
| `src/core/substitutions.ts` | Auswechslungs-Vorschläge nach Kondition, Training und Einsatzzeit |
| `src/core/orders.ts` | Anweisungen, Elfmeterschützen und Reserve-Reihe im HRF-Format von HO |
| `src/core/portfolio.ts` | Trainingsformationen gegen Stärkere, Ausgeglichene und Schwächere |
| `src/core/opponent.ts` | Gegnerstärke aus den Spielbewertungen des Gegners, direkte Duelle |
| `src/core/opponentfit.ts` | Aufstellung mit der besten Siegchance gegen den nächsten Gegner („Gegen Gegner“) |
| `src/core/weakness.ts` | Schwachstellen je Mannschaftsteil und stärkster Hebel |
| `src/core/squad.ts`, `squadplan.ts` | Kader nach Mannschaftsteilen; Kaderplanung mit Rollen, Bedarf und Lücken |
| `src/core/development.ts` | Trainingszuwachs und Altersabbau (Formeln aus HO) |
| `src/core/training.ts`, `trainingweek.ts` | Trainingsplätze, A-/B-Kader und Wochenplan |
| `src/core/staff.ts` | Trainer, Assistenten, Spezialisten: Kosten und Trainingseffizienz |
| `src/core/finance.ts` | Kontostand, Wochenbilanz und Prognose |
| `src/core/history.ts` | Wochen-Schnappschüsse für den Verlauf |
| `src/core/scouting.ts`, `advisor.ts`, `transferplan.ts` | Suchprofile, Transferbudget und Kaufreihenfolge, Trainingshinweise |
| `src/i18n/translations.json` | Übersetzungen (Englisch, Spanisch, Italienisch, Polnisch) |
| `src/ui/` | Oberfläche; `build.mjs` packt alles in eine HTML-Datei |

## Entwickeln

```
npm install
npm test          # Tests mit test/fixtures (anonymisierter Testverein)
npm run typecheck
npm run build     # erzeugt dist/tophatt.html (nicht im Repository, fertig gebaut im Release)

# TopHatt-Sync bauen (JDK 17+, hsqldb-2.7.4.jar aus HO)
javac --release 17 -cp hsqldb-2.7.4.jar -d sync/build sync/src/TopHattSync.java
jar cfe sync/TopHattSync.jar TopHattSync -C sync/build .
```

Zum Ausprobieren ohne eigene HO-Daten `tophatt.html` aus dem Release (oder nach dem Build `dist/tophatt.html`) öffnen und `test/fixtures/team.hrf` zusammen mit
`test/fixtures/tophatt-data.json` ins Fenster ziehen. Auf diesen Daten beruhen auch die Screenshots in `docs/img`
(Namen und einige Werte geändert, Spielerbilder ergänzt).

## Lizenz

Copyright © 2026 [michelix](https://github.com/michelix).

TopHatt steht unter der GNU Lesser General Public License, Version 3 oder später (LGPL-3.0-or-later);
siehe [`COPYING`](COPYING) und [`COPYING.LESSER`](COPYING.LESSER).

Bewertungsmodell, Spielvorhersage, Trainingspositionen, Trainings- und Abbauformeln, Konditionsverlauf sowie
Kapitäns-, Standard- und Elfmeterschützenwahl sind aus Hattrick Organizer
(https://github.com/ho-dev/HattrickOrganizer, LGPL-3.0, © die HO-Entwickler) portiert. Formeln: Schum.
Deshalb steht auch TopHatt unter der LGPL.

TopHatt ist ein privates Hilfsprogramm und steht in keiner Verbindung zu Hattrick.
