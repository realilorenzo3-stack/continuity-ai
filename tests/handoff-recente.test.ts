import { it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/persistence/store.js";
import { Engine } from "../src/core/engine.js";

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);

it("il successore riceve gli ultimi messaggi, non quelli dell'inizio", async () => {
  const data = mkdtempSync(join(tmpdir(), "continuity-handoff-"));
  dirs.push(data);
  const db = new Store(data);
  const engine = new Engine(db);
  try {
    const run = await engine.create("Obiettivo", "simulation", "claude");
    const r = engine.run(run.id);
    // Una sessione lunga: oltre il limite di lettura del registro.
    for (let i = 1; i <= 700; i++)
      engine.event(
        engine.run(run.id),
        "agent.message",
        `messaggio ${i}`,
        "codex",
      );

    const consegnati = engine
      .reportedByAgent(engine.run(run.id))
      .map((x: any) => x.text);
    // Deve esserci la fine della sessione, non il suo inizio.
    expect(consegnati.at(-1)).toContain("messaggio 700");
    expect(consegnati.join(" ")).not.toContain("messaggio 1 ");
    expect(consegnati).toHaveLength(12);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 60000);
