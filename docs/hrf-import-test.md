# Test: Aufstellung aus TopHatt in HO importieren (T19)

Für das Ligaspiel am Samstag, 21.11., einmal komplett durchspielen. Dauert etwa 5 Minuten.

## Vorbereitung

1. In HO herunterladen (Spiele, Gegnercheck für SV Bach).
2. `TopHatt.bat` starten. Im Kopf von TopHatt muss „Spielplan“ mit heutigem Datum stehen.
3. Im Abschnitt **Aufstellung** prüfen: Spiel-ID ist eingetragen, Spielart „Liga“, Spielort „Auswärtsspiel“.

## Export und Import

4. „Für HO speichern“ klicken. Die Datei heißt `tophatt-liga-<Spiel-ID>.hrf`.
5. In HO: Datei → Importieren → HRF, Datei auswählen, „Ersetzen“ mit Ja bestätigen.
6. In HO das Spiel am 21.11. auswählen (Aufstellung → Spiel auswählen).

## Prüfen (in HO, vor dem Senden)

| Punkt | Erwartet | OK? |
| --- | --- | --- |
| Elf Spieler auf denselben Positionen wie im TopHatt-Spielfeld | ja | |
| Verhalten (offensiv, defensiv, zur Mitte, nach außen) | wie in TopHatt | |
| Taktik und Einstellung | wie in TopHatt gewählt | |
| Kapitän | wie in TopHatt (C) | |
| Standardschütze | wie in TopHatt (St) | |
| Ersatzbank (7 Plätze) | wie in TopHatt | |
| HO-Bewertung (Mittelfeld, Abwehr, Angriff) | ungefähr wie TopHatt, Abweichung höchstens eine Unterstufe | |

## Senden

7. In HO „Aufstellung senden (HO → HT)“.
8. Auf hattrick.org die Aufstellung für das Spiel öffnen und kurz vergleichen.

Wenn etwas nicht passt: Screenshot von HO und TopHatt machen und im Issue #19 beschreiben, was abweicht.
