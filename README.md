# TopHatt

TopHatt ist ein Spieltags-Cockpit für Hattrick. Es liest die Daten von Hattrick Organizer (HO) und zeigt:

- das **nächste Spiel** mit Aufstellungsvorschlag, Formation und erwarteten HatStats,
- die **Schwachstellen** je Mannschaftsteil (Abwehr links/mitte/rechts, Mittelfeld, Angriff links/mitte/rechts),
- die **Spielerentwicklung** als Graph mit Prognose aus dem HO-Trainingsmodell und Alterswarnung,
- Spielplan und Tabelle, eine Freundschaftsspiel-Aufstellung fürs Training, Transfer- und Kaderhinweise.

Alles läuft lokal im Browser. Up- und Download zu Hattrick macht weiterhin HO.

## Benutzen

1. In HO wie gewohnt die Daten herunterladen. Die `.hrf`-Datei landet in `F:\claude\hattrick\HO\daten`.
2. **`TopHatt.bat`** starten. Das liest die HO-Datenbank (nur lesend, über eine Kopie), schreibt
   `tophatt-data.json` in denselben Ordner und öffnet `dist/tophatt.html`.
3. Beim ersten Mal in der App „Ordner verbinden“ wählen und `F:\claude\hattrick\HO\daten` auswählen
   (geht in Chrome und Edge). Danach lädt TopHatt beim Öffnen immer die neuesten Daten, „Aktualisieren“ liest sie neu ein.
4. Aufstellung „Für HO speichern“, in HO über Datei → Importieren → HRF einlesen und „Aufstellung senden“.

Die Pfade zu HO stehen oben in `TopHatt.bat` und lassen sich dort anpassen.

## Aufbau

| Teil | Inhalt |
| --- | --- |
| `sync/` | TopHatt-Sync (Java 17): liest die HO-Datenbank (HSQLDB) und exportiert Spielplan, Tabelle, Spielerhistorie, Training |
| `src/core/hrf.ts` | HRF-Dateien lesen und schreiben |
| `src/core/hodata.ts` | `tophatt-data.json` lesen, nächstes Spiel, Tabelle |
| `src/core/rating.ts`, `optimizer.ts` | Bewertungsformel aus HO und Aufstellungs-Optimierung |
| `src/core/weakness.ts` | Schwachstellen je Mannschaftsteil und stärkster Hebel |
| `src/core/development.ts` | Trainingszuwachs und Altersabbau (Formeln aus HO) |
| `src/core/training.ts`, `advisor.ts` | Freundschaftsspiel-Plan, Transfer- und Trainingshinweise |
| `src/ui/` | Oberfläche (eine HTML-Datei) |

## Entwickeln

```
npm install
npm test          # Tests mit test/fixtures
npm run typecheck
npm run build     # erzeugt dist/tophatt.html

# TopHatt-Sync bauen (JDK 17+, hsqldb-2.7.4.jar aus HO)
javac --release 17 -cp hsqldb-2.7.4.jar -d sync/build sync/src/TopHattSync.java
jar cfe sync/TopHattSync.jar TopHattSync -C sync/build .
```

## Lizenz

Bewertungsmodell, Trainingspositionen, Trainings- und Abbauformeln sowie Kapitäns- und Standardschützenwahl sind aus
Hattrick Organizer (https://github.com/ho-dev/HattrickOrganizer, LGPL-3.0) portiert. Formeln: Schum.
TopHatt steht daher ebenfalls unter LGPL-3.0.
