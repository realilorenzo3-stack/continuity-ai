import { it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/core/engine.js";
import { Store } from "../src/persistence/store.js";
import { openProject } from "../src/core/project.js";
import { normalizedLiveEvent } from "../src/adapters/live.js";

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);

async function sessione() {
  const root = mkdtempSync(join(tmpdir(), "continuity-ripristino-"));
  const data = mkdtempSync(join(tmpdir(), "continuity-dati-"));
  dirs.push(root, data);
  writeFileSync(join(root, "note.txt"), "appunti\n");
  const aperto = openProject(root);
  const db = new Store(data);
  const engine = new Engine(db);
  const run = await engine.create(
    "Obiettivo",
    "simulation",
    "claude",
    {
      root: aperto.root,
      head: aperto.head,
      branch: aperto.branch,
      verify: aperto.config.verify,
      commandsDigest: aperto.commandsDigest,
      senzaGit: true,
    },
    { providers: ["codex", "claude"] },
  );
  await engine.shutdown();
  return { engine, db, run };
}

it("una sessione bloccata da un guasto si recupera invece di restare morta", async () => {
  const { engine, db, run } = await sessione();
  try {
    // È quello che è successo davvero: un errore del provider e la sessione
    // diventa irraggiungibile, con la conversazione e i file dentro.
    const r = engine.run(run.id);
    r.state = "BLOCKED";
    r.error = "Errore provider";
    engine.event(r, "run.blocked", "guasto simulato per la prova");

    await engine.turn(run.id, "riprendiamo da qui");
    const dopo = engine.run(run.id);
    expect(dopo.state).not.toBe("BLOCKED");
    expect(dopo.error).toBeUndefined();
    await engine.shutdown();
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 40000);

it("il testo in corso non si trascina da un turno all'altro", async () => {
  const { engine, db, run } = await sessione();
  try {
    const r = engine.run(run.id);
    engine.parziali.set(run.id, "testo del turno precedente");
    // Avviare un nuovo tentativo azzera ciò che era rimasto in mostra.
    await engine.start(r).catch(() => {});
    expect(engine.parziali.get(run.id) ?? "").not.toContain("precedente");
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 40000);

it("i token letti dalla cache non vengono contati come consumo nuovo", () => {
  const claude = normalizedLiveEvent("claude", {
    type: "result",
    is_error: false,
    usage: {
      input_tokens: 1200,
      cache_read_input_tokens: 240000,
      cache_creation_input_tokens: 800,
      output_tokens: 300,
    },
  });
  expect(claude.type).toBe("uso");
  // 1200 nuovi + 800 di scrittura cache: non 242.000.
  // La cache riletta resta a parte: serve solo a stimare il costo.
  expect(claude.uso).toEqual({ entrata: 2000, uscita: 300, cache: 240000 });
});

it("l'errore del provider viene riportato con parole comprensibili", async () => {
  const { motivoLeggibile } = await import("../src/adapters/live.js");
  // È il caso reale: un modello che l'abbonamento dell'utente non ha.
  const vero =
    '{"type":"error","status":400,"error":{"message":"The \'gpt-5.4\' model is not supported when using Codex with a ChatGPT account."}}';
  const detto = motivoLeggibile("Codex", vero);
  expect(detto).toContain("non può usare questo modello");
  expect(detto).toContain("gpt-5.4");
  expect(detto).toContain("modello");
  // Non deve restare la frase generica che non spiegava nulla.
  expect(detto).not.toContain("classificazione non confermata");

  expect(motivoLeggibile("Claude", "401 unauthorized")).toContain(
    "non risulta autenticato",
  );
  expect(motivoLeggibile("Codex", "connection timed out")).toContain(
    "non ha risposto in tempo",
  );
  // Un errore sconosciuto viene riportato così com'è, non nascosto.
  expect(motivoLeggibile("Codex", "disk full while writing")).toContain(
    "disk full",
  );
});

it("un modello rifiutato dal provider viene ricordato come non disponibile", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { Store } = await import("../src/persistence/store.js");
  const data = mkdtempSync(join(tmpdir(), "continuity-modelli-"));
  const db = new Store(data);
  const engine = new Engine(db);
  try {
    expect(engine.modelliNonDisponibili()).toEqual({});
    engine.segnaModelloNonDisponibile("codex", "gpt-5.4");
    engine.segnaModelloNonDisponibile("codex", "gpt-5.4");
    engine.segnaModelloNonDisponibile("claude", "opus");
    expect(engine.modelliNonDisponibili()).toEqual({
      codex: ["gpt-5.4"],
      claude: ["opus"],
    });
    // Sopravvive al riavvio: è una proprietà della macchina, non della sessione.
    expect(new Engine(db).modelliNonDisponibili().codex).toEqual(["gpt-5.4"]);
  } finally {
    await engine.shutdown();
    db.close();
    rmSync(data, { recursive: true, force: true });
  }
}, 30000);
