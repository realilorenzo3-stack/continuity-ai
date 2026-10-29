import { conserva } from "./redact.js";
import { assertTransition } from "../core/state.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
export class Store {
  db: DatabaseSync;
  constructor(public root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(root, "continuity.sqlite"));
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;
 CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS events(run TEXT,seq INTEGER,body TEXT,PRIMARY KEY(run,seq));
 CREATE TABLE IF NOT EXISTS requests(key TEXT PRIMARY KEY,body TEXT,result TEXT);`);
  }
  get(id: string): any {
    const r = this.db.prepare("SELECT body FROM runs WHERE id=?").get(id);
    return r ? JSON.parse(String(r.body)) : null;
  }
  // Tutte le run, dalla più recente: con un limite fisso il recupero, il
  // controllo «un solo writer», la ripresa e la ricerca della sessione di una
  // cartella non vedevano quelle più vecchie. Solo il pannello ne chiede meno.
  list(limite = -1): any[] {
    return this.db
      .prepare("SELECT body FROM runs ORDER BY rowid DESC LIMIT ?")
      .all(limite)
      .map((r) => JSON.parse(String(r.body)));
  }
  // Gli ultimi eventi, non i primi: il pacchetto di handoff descrive ciò che è
  // appena successo, e leggere dall'inizio consegnava al successore un contesto
  // vecchio di ore proprio nelle sessioni lunghe.
  eventiRecenti(id: string, quanti = 60) {
    return this.db
      .prepare("SELECT body FROM events WHERE run=? ORDER BY seq DESC LIMIT ?")
      .all(id, quanti)
      .map((r: any) => JSON.parse(r.body))
      .reverse();
  }
  events(id: string, after = 0) {
    return this.db
      .prepare(
        "SELECT body FROM events WHERE run=? AND seq>? ORDER BY seq LIMIT 500",
      )
      .all(id, after)
      .map((r) => JSON.parse(String(r.body)));
  }
  save(run: any, type: string, message: string, source = "continuity") {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.get(run.id);
      if (previous) assertTransition(previous.state, run.state);
      run.version = (previous?.version ?? 0) + 1;
      const event = {
        schemaVersion: "0.1.0",
        eventId: `${run.id}:${run.version}`,
        runId: run.id,
        seq: run.version,
        recordedAt: new Date().toISOString(),
        type,
        source,
        simulated:
          run.mode !== "live" ||
          (type === "failure.detected" && !run.quotaDetected),
        payload: { message: conserva(message) },
      };
      this.db
        .prepare("INSERT OR REPLACE INTO runs VALUES(?,?)")
        .run(run.id, JSON.stringify(run));
      this.db
        .prepare("INSERT INTO events VALUES(?,?,?)")
        .run(run.id, run.version, JSON.stringify(event));
      this.db.exec("COMMIT");
      return event;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
