// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// TopHatt-Sync: liest die Datenbank von Hattrick Organizer (nur lesend, über eine Kopie)
// und schreibt die Daten, die TopHatt braucht, als JSON-Datei.
// Aufruf: java -cp hsqldb.jar;TopHattSync.jar TopHattSync <HO-db-Ordner> <Ausgabedatei>

import java.io.IOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.sql.*;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.Comparator;
import java.util.stream.Stream;

public class TopHattSync {
  public static void main(String[] args) throws Exception {
    Path dbDir = Paths.get(args.length > 0 ? args[0] : "db");
    Path out = Paths.get(args.length > 1 ? args[1] : "tophatt-data.json");
    if (!Files.exists(dbDir.resolve("database.script"))) {
      System.err.println("Keine HO-Datenbank gefunden in " + dbDir.toAbsolutePath());
      System.exit(2);
    }
    Path tmp = Files.createTempDirectory("tophatt-");
    try {
      // Kopie, damit ein laufendes HO nicht stört und die Original-DB nie verändert wird
      for (String f : new String[] {"database.properties", "database.script", "database.data", "database.log", "database.backup"}) {
        Path src = dbDir.resolve(f);
        if (Files.exists(src)) Files.copy(src, tmp.resolve(f), StandardCopyOption.REPLACE_EXISTING);
      }
      Class.forName("org.hsqldb.jdbc.JDBCDriver");
      String url = "jdbc:hsqldb:file:" + tmp.resolve("database").toAbsolutePath() + ";readonly=true;shutdown=true;hsqldb.lock_file=false";
      try (Connection c = DriverManager.getConnection(url, "sa", "");
           Writer w = Files.newBufferedWriter(out, StandardCharsets.UTF_8)) {
        w.write("{\n\"format\":1,\n\"generated\":" + q(LocalDateTime.now().toString().substring(0, 19)));
        section(w, c, "basics", "SELECT * FROM BASICS WHERE HRF_ID=(SELECT MAX(HRF_ID) FROM BASICS)");
        section(w, c, "hrf", "SELECT HRF_ID, DATUM FROM HRF ORDER BY DATUM");
        section(w, c, "matches", "SELECT MATCHID,MATCHTYP,MATCHDATE,HEIMID,HEIMNAME,GASTID,GASTNAME,HEIMTORE,GASTTORE,STATUS,AUFSTELLUNG,ISDERBY,ISNEUTRAL,WEATHERFORECAST,MATCHCONTEXTID,CUPLEVEL FROM MATCHESKURZINFO WHERE ISOBSOLETE=FALSE ORDER BY MATCHDATE");
        section(w, c, "leagues", "SELECT * FROM SPIELPLAN");
        section(w, c, "fixtures", "SELECT * FROM PAARUNG ORDER BY SAISON, SPIELTAG");
        section(w, c, "players", "SELECT HRF_ID,SPIELERID,DATUM,FIRSTNAME,NICKNAME,LASTNAME,AGE,AGEDAYS,KONDITION,FORM,TORWART,VERTEIDIGUNG,SPIELAUFBAU,FLUEGEL,TORSCHUSS,PASSPIEL,STANDARDS,"
            + "SUBTORWART,SUBVERTEIDIGUNG,SUBSPIELAUFBAU,SUBFLUEGEL,SUBTORSCHUSS,SUBPASSPIEL,SUBSTANDARDS,SUBFORM,SUBSTAMINA,ERFAHRUNG,FUEHRUNG,LOYALTY,HOMEGROWN,GEHALT,MARKTWERT,VERLETZT,GELBEKARTEN,ISPEZIALITAET,TRANSFERLISTED,LASTMATCHRATING,LASTMATCH_POSITIONCODE "
            + "FROM SPIELER ORDER BY DATUM, SPIELERID");
        // Bewertungen gespielter Spiele (eigene und vom Gegnercheck geladene Spiele der Gegner)
        section(w, c, "matchRatings", "SELECT MATCHID,MATCHTYP,SPIELDATUM,HEIMID,HEIMNAME,GASTID,GASTNAME,HEIMTORE,GASTTORE,"
            + "HEIMMIDFIELD,HEIMLEFTDEF,HEIMMIDDEF,HEIMRIGHTDEF,HEIMLEFTATT,HEIMMIDATT,HEIMRIGHTATT,HEIMTACTICTYPE,HEIMTACTICSKILL,HEIMEINSTELLUNG,HOMEFORMATION,"
            + "GASTMIDFIELD,GASTLEFTDEF,GASTMIDDEF,GASTRIGHTDEF,GASTLEFTATT,GASTMIDATT,GASTRIGHTATT,GASTTACTICTYPE,GASTTACTICSKILL,GASTEINSTELLUNG,AWAYFORMATION "
            + "FROM MATCHDETAILS WHERE MATCHTYP < 100 ORDER BY SPIELDATUM");
        // Aufstellungen der letzten 120 Tage (eigene und vom Gegnercheck geladene), für die Manndeckung
        section(w, c, "lineupPlayers", "SELECT l.MATCHID,l.TEAMID,l.SPIELERID,l.ROLEID,l.VNAME,l.NICKNAME,l.NAME,m.SPIELDATUM "
            + "FROM MATCHLINEUPPLAYER l JOIN MATCHDETAILS m ON m.MATCHID=l.MATCHID AND m.MATCHTYP=l.MATCHTYP "
            + "WHERE l.ROLEID BETWEEN 100 AND 113 AND m.SPIELDATUM > CURRENT_TIMESTAMP - INTERVAL '120' DAY ORDER BY m.SPIELDATUM DESC");
        section(w, c, "training", "SELECT * FROM TRAINING ORDER BY TRAINING_DATE");
        section(w, c, "futureTraining", "SELECT * FROM FUTURETRAINING ORDER BY TRAINING_DATE");
        // Käufe und Verkäufe des Vereins (HO lädt sie mit „Daten herunterladen“)
        section(w, c, "transfers", "SELECT TRANSFERID,DATE,SEASON,WEEK,PLAYERID,PLAYERNAME,BUYERID,BUYERNAME,SELLERID,SELLERNAME,PRICE,TSI FROM TRANSFER ORDER BY DATE");
        avatars(w, dbDir.toAbsolutePath().getParent().resolve("img").resolve("playersAvatar"));
        w.write("\n}\n");
      }
      System.out.println("TopHatt-Daten geschrieben: " + out.toAbsolutePath());
    } finally {
      try (Stream<Path> s = Files.walk(tmp)) {
        s.sorted(Comparator.reverseOrder()).forEach(p -> p.toFile().delete());
      } catch (IOException ignored) {
      }
    }
  }

  static void section(Writer w, Connection c, String name, String sql) throws IOException {
    w.write(",\n" + q(name) + ":[");
    try (Statement st = c.createStatement(); ResultSet r = st.executeQuery(sql)) {
      ResultSetMetaData m = r.getMetaData();
      boolean first = true;
      while (r.next()) {
        w.write(first ? "\n{" : ",\n{");
        first = false;
        for (int i = 1; i <= m.getColumnCount(); i++) {
          if (i > 1) w.write(",");
          w.write(q(m.getColumnLabel(i).toLowerCase()) + ":" + value(r, i, m.getColumnType(i)));
        }
        w.write("}");
      }
    } catch (SQLException e) {
      // Tabelle fehlt in älteren HO-Versionen: leer lassen
      System.err.println("Hinweis: " + name + " nicht lesbar: " + e.getMessage());
    }
    w.write("]");
  }

  /** Spielerbilder, die HO unter img/playersAvatar/<SpielerID>.png ablegt (nur lokal, nie ins Repo) */
  static void avatars(Writer w, Path dir) throws IOException {
    w.write(",\n" + q("avatars") + ":[");
    if (Files.isDirectory(dir)) {
      boolean first = true;
      try (DirectoryStream<Path> ds = Files.newDirectoryStream(dir, "*.png")) {
        for (Path f : ds) {
          String id = f.getFileName().toString().replace(".png", "");
          if (!id.matches("\\d+") || Files.size(f) > 200_000) continue;
          w.write((first ? "\n{" : ",\n{") + q("spielerid") + ":" + id + "," + q("png") + ":" + q(Base64.getEncoder().encodeToString(Files.readAllBytes(f))) + "}");
          first = false;
        }
      }
    }
    w.write("]");
  }

  static String value(ResultSet r, int i, int type) throws SQLException {
    Object o = r.getObject(i);
    if (o == null) return "null";
    switch (type) {
      case Types.INTEGER: case Types.SMALLINT: case Types.TINYINT: case Types.BIGINT:
      case Types.DOUBLE: case Types.FLOAT: case Types.REAL: case Types.DECIMAL: case Types.NUMERIC:
        double d = r.getDouble(i);
        if (Double.isNaN(d) || Double.isInfinite(d)) return "null";
        return d == Math.rint(d) && Math.abs(d) < 1e15 ? Long.toString((long) d) : Double.toString(d);
      case Types.BOOLEAN: case Types.BIT:
        return Boolean.toString(r.getBoolean(i));
      case Types.TIMESTAMP: case Types.DATE:
        String t = r.getString(i);
        return q(t.length() > 19 ? t.substring(0, 19) : t);
      default:
        return q(r.getString(i));
    }
  }

  static String q(String s) {
    StringBuilder b = new StringBuilder("\"");
    for (char ch : s.toCharArray()) {
      switch (ch) {
        case '"': b.append("\\\""); break;
        case '\\': b.append("\\\\"); break;
        case '\n': b.append("\\n"); break;
        case '\r': b.append("\\r"); break;
        case '\t': b.append("\\t"); break;
        default:
          if (ch < 0x20) b.append(String.format("\\u%04x", (int) ch)); else b.append(ch);
      }
    }
    return b.append('"').toString();
  }
}
