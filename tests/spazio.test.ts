import { it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/core/engine.js";
import { Store } from "../src/persistence/store.js";
import { openProject } from "../src/core/project.js";
import { liveCommand, MODELLI_NOTI } from "../src/adapters/live.js";
import { zonaInput, visibile } from "../src/cli/schermo.js";

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);

async function sessione() {
  const root = mkdtempSync(join(tmpdir(), "continuity-spazio-"));
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
  return { engine, db, run, root };
}

it("il modello scelto arriva al comando del provider", () => {
  const claude = liveCommand(
    "claude",
    "/tmp/w",
    undefined,
    undefined,
    "project",
    "opus",
  );
  expect(claude.args).toContain("--model");
  expect(claude.args[claude.args.indexOf("--model") + 1]).toBe("opus");
  const codex = liveCommand(
    "codex",
    "/tmp/w",
    undefined,
    undefined,
    "project",
    "gpt-x",
  );
  expect(codex.args).toContain("-m");
  expect(codex.args[codex.args.indexOf("-m") + 1]).toBe("gpt-x");
  // Senza scelta esplicita non si impone nulla: vale il predefinito del provider.
  expect(
    liveCommand("claude", "/tmp/w", undefined, undefined, "project").args,
  ).not.toContain("--model");
  expect(MODELLI_NOTI.claude).toContain("opus");
});

it("il modello si imposta per provider e si può togliere", async () => {
  const { engine, db, run } = await sessione();
  try {
    engine.impostaModello(run.id, "claude", "haiku");
    expect((engine.run(run.id) as any).modelli.claude).toBe("haiku");
    engine.impostaModello(run.id, "claude", "");
    expect((engine.run(run.id) as any).modelli.claude).toBeUndefined();
    expect(() => engine.impostaModello(run.id, "gpt", "x")).toThrow(
      /non supportata/,
    );
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("un modello di un'altra AI viene fermato, non accettato in silenzio", async () => {
  const { engine, db, run } = await sessione();
  try {
    // Il caso reale: «opus 5.5» scelto per Codex passava e falliva a turno avviato.
    expect(() => engine.impostaModello(run.id, "codex", "opus 5.5")).toThrow(
      /codex non ha un modello/,
    );
    expect(() => engine.impostaModello(run.id, "codex", "opus 5.5")).toThrow(
      /gpt-5.6-sol/,
    );
    expect((engine.run(run.id) as any).modelli?.codex).toBeUndefined();
    // Un nome dell'elenco passa; uno fuori elenco solo se confermato.
    engine.impostaModello(run.id, "codex", "gpt-5.6-sol");
    expect((engine.run(run.id) as any).modelli.codex).toBe("gpt-5.6-sol");
    engine.impostaModello(run.id, "codex", "gpt-domani", true);
    expect((engine.run(run.id) as any).modelli.codex).toBe("gpt-domani");
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("gli elenchi contengono i modelli visti davvero sulla macchina", () => {
  expect(MODELLI_NOTI.codex).toContain("gpt-5.6-sol");
  expect(MODELLI_NOTI.codex).toContain("gpt-6-astra");
  expect(MODELLI_NOTI.claude).toContain("opus");
  expect(MODELLI_NOTI.claude).toContain("claude-sonnet-4-6");
  // Nessun incrocio: i modelli di un'AI non compaiono fra quelli dell'altra.
  expect(MODELLI_NOTI.codex.some((m) => m.includes("claude"))).toBe(false);
  expect(MODELLI_NOTI.claude.some((m) => m.startsWith("gpt"))).toBe(false);
});

it("un allegato entra nella copia di lavoro ma non viene consegnato", async () => {
  const { engine, db, run, root } = await sessione();
  try {
    const fuori = mkdtempSync(join(tmpdir(), "continuity-doc-"));
    dirs.push(fuori);
    const documento = join(fuori, "specifica.txt");
    writeFileSync(documento, "codice ZAFFIRO-7\n");
    engine.allega(run.id, documento);
    const r = engine.run(run.id) as any;
    expect(r.allegati).toEqual(["specifica.txt"]);
    expect(existsSync(join(r.work, "allegati", "specifica.txt"))).toBe(true);
    // È materiale dell'utente, non lavoro prodotto: non torna indietro.
    expect(engine.changedFiles(r)).not.toContain("allegati/specifica.txt");
    engine.applyToProject(run.id);
    expect(existsSync(join(root, "allegati"))).toBe(false);
    expect(() => engine.allega(run.id, "/percorso/inesistente")).toThrow(
      /non trovato/,
    );
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("nel riquadro si leggono lo stato e tutti i comandi, con i bordi allineati", () => {
  const z = zonaInput("claude", "sonnet-4-6", ["a.pdf", "b.txt"]);
  expect(z.azioni).toContain("allega");
  expect(z.azioni).toContain("sonnet-4-6");
  expect(z.azioni).toContain("claude");
  expect(z.azioni).toContain("2 allegati");
  // La seconda parte elenca i comandi per nome (CT-028).
  expect(z.azioni).toContain("/modello");
  expect(z.azioni).toContain("/allega");
  // I bordi restano allineati con ogni riga delle azioni.
  expect(visibile(z.cima)).toBe(visibile(z.mezzo));
  for (const riga of z.azioni.split("\n"))
    expect(visibile(riga)).toBe(visibile(z.mezzo));
  // Sotto la riga dell'input non si disegna nulla: readline cancella fino a
  // fine schermo a ogni tasto, e ciò che sta sotto sparirebbe subito.
  expect(z).not.toHaveProperty("fondo");
  // Senza modello scelto si legge la parola, non un nome inventato.
  expect(zonaInput("codex").azioni).toContain("modello");
});
