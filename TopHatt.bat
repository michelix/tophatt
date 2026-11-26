@echo off
rem TopHatt starten: holt Spielplan, Tabelle und Spielerhistorie aus HO und oeffnet die App.
rem Die HO-Datenbank wird nur gelesen (ueber eine Kopie), nie veraendert.
setlocal
rem Pfade anpassen: HO = Programmordner von Hattrick Organizer (mit hsqldb-*.jar, jre und db),
rem DATEN = Ordner, in dem HO die HRF-Dateien speichert. Eigene Pfade am besten in TopHatt.local.bat
rem (gleicher Ordner, zwei Zeilen "set HO=..." und "set DATEN=..."); die Datei wird nicht ueberschrieben.
set "HO=C:\HO"
set "DATEN=C:\HO\daten"
set "APP=%~dp0"
if exist "%APP%TopHatt.local.bat" call "%APP%TopHatt.local.bat"

set "HSQL="
for %%f in ("%HO%\hsqldb-*.jar") do set "HSQL=%%f"
if not defined HSQL (
  echo HO wurde unter %HO% nicht gefunden. Bitte den Pfad oben in TopHatt.bat anpassen.
  pause
  exit /b 1
)

echo Lese Daten aus Hattrick Organizer ...
"%HO%\jre\bin\java.exe" -cp "%HSQL%;%APP%sync\TopHattSync.jar" TopHattSync "%HO%\db" "%DATEN%\tophatt-data.json"
if errorlevel 1 (
  echo.
  echo Die HO-Daten konnten nicht gelesen werden. Die App startet trotzdem mit der HRF-Datei.
  pause
)
start "" "%APP%dist\tophatt.html"
