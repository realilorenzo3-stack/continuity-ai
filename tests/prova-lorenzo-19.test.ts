// Regressioni della prova guidata di Lorenzo (19 ottobre 2026,
// ~/Desktop/PROVA_LORENZO_2.0.md): nome dell'AI al lavoro, allegati che
// restavano nel campo, /applica dopo /annulla, connettori che ritardavano il
// turno, modelli di Ollama a Ollama spento, versione sempre visibile.
import { it, expect, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProject } from "../src/core/project.js";
import { Store } from "../src/persistence/store.js";
import { Engine } from "../src/core/engine.js";
import { dimenticaConnettori, scopriConnettori } from "../src/adapters/connettori.js";
import { modelliSulDisco } from "../src/core/ibrida.js";
import { versioneApp } from "../src/core/build.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

async function sessione() {
  const root = mkdtempSync(join(tmpdir(), "continuity-prova19-"));
  const data = mkdtempSync(join(tmpdir(), "continuity-dati-"));
  dirs.push(root, data);
  writeFileSync(join(root, "carrello.js"), "originale\n");
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
    { providers: ["claude", "codex"] },
  );
  await engine.shutdown();
  return { engine, db, run, root };
}

it("durante un turno l'interfaccia legge chi lavora, non un «prossimo» vecchio", async () => {
  const { engine, db, run } = await sessione();
  try {
    const r = engine.run(run.id);
    // Com'era nella sessione della prova: salvato «codex», al lavoro Claude.
    r.prossimo = "codex";
    r.agent = "claude";
    engine.event(r, "engine.warning", "stato della prova");
    // Un processo al lavoro per questa sessione.
    (engine as any).children.set(run.id, {});
    expect(engine.current(run.id).prossimo).toBe("claude");
    (engine as any).children.delete(run.id);
    // Fuori dal turno: la prima disponibile della sequenza.
    const r2 = engine.run(run.id);
    r2.providers = ["codex", "claude"];
    engine.event(r2, "engine.warning", "stato della prova");
    expect(engine.current(run.id).prossimo).toBe("codex");
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("gli allegati partono con il loro messaggio e poi lasciano il campo", async () => {
  const { engine, db, run } = await sessione();
  try {
    const fuori = mkdtempSync(join(tmpdir(), "continuity-allegato-"));
    dirs.push(fuori);
    writeFileSync(join(fuori, "requisiti.md"), "# requisiti\n");
    engine.allega(run.id, join(fuori, "requisiti.md"));
    expect(engine.run(run.id).allegati).toEqual(["requisiti.md"]);
    await engine.turn(run.id, "Implementa il requisito allegato");
    const r = engine.run(run.id);
    expect(r.allegati).toEqual([]);
    expect(r.allegatiTurno).toEqual(["requisiti.md"]);
    expect(r.allegatiPrecedenti).toEqual(["requisiti.md"]);
    // Il file resta nella copia: l'AI può rileggerlo se serve.
    expect(existsSync(join(r.work, "allegati", "requisiti.md"))).toBe(true);
    await vi.waitFor(() => expect(["PAUSED", "READY"]).toContain(engine.run(run.id).state), {
      timeout: 20000,
    });
    // Il messaggio dopo non li rimanda.
    await engine.turn(run.id, "Grazie");
    expect(engine.run(run.id).allegatiTurno).toEqual([]);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 40000);

it("/applica dopo /annulla rimette il lavoro dell'AI", async () => {
  const { engine, db, run, root } = await sessione();
  try {
    const r = engine.run(run.id);
    writeFileSync(join(r.work, "carrello.js"), "corretto dall'AI\n");
    writeFileSync(join(r.work, "nuovo.js"), "nuovo\n");
    engine.applyToProject(run.id);
    engine.annullaUltimo(run.id);
    expect(readFileSync(join(root, "carrello.js"), "utf8")).toBe("originale\n");
    expect(existsSync(join(root, "nuovo.js"))).toBe(false);
    const esito = engine.applyToProject(run.id);
    expect([...esito.applicati].sort()).toEqual(["carrello.js", "nuovo.js"]);
    expect(readFileSync(join(root, "carrello.js"), "utf8")).toBe("corretto dall'AI\n");
    expect(existsSync(join(root, "nuovo.js"))).toBe(true);
    // E si può annullare di nuovo.
    engine.annullaUltimo(run.id);
    expect(readFileSync(join(root, "carrello.js"), "utf8")).toBe("originale\n");
    // Un turno nuovo dimentica la versione messa da parte.
    await engine.turn(run.id, "altro");
    expect(engine.run(run.id).rifacibile).toBeUndefined();
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 40000);

it("un elenco di connettori vecchio vale subito; la rilettura va in sottofondo", async () => {
  dimenticaConnettori();
  let letture = 0;
  let sblocca!: () => void;
  const lenta = () =>
    new Promise<any[]>((ok) => {
      letture++;
      sblocca = () => ok([{ id: "claude:mcp:x", nome: "x", ai: "claude", stato: "attivo" }]);
    });
  const lettori = { claude: lenta } as any;
  const prima = scopriConnettori({ claude: "/bin/claude" }, false, lettori);
  sblocca();
  expect((await prima).length).toBe(1);
  // Dieci minuti dopo: risponde subito con l'elenco vecchio.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 11 * 60 * 1000);
  try {
    const subito = await Promise.race([
      scopriConnettori({ claude: "/bin/claude" }, false, lettori),
      new Promise((ok) => setTimeout(() => ok("attesa"), 200)),
    ]);
    expect(subito).not.toBe("attesa");
    expect(letture).toBe(2);
    sblocca();
  } finally {
    vi.useRealTimers();
    dimenticaConnettori();
  }
});

it("i modelli di Ollama si leggono dal disco, a Ollama spento", () => {
  const cartella = mkdtempSync(join(tmpdir(), "continuity-ollama-"));
  dirs.push(cartella);
  expect(modelliSulDisco(cartella)).toEqual([]);
  const lib = join(cartella, "manifests", "registry.ollama.ai", "library");
  mkdirSync(join(lib, "qwen3.5"), { recursive: true });
  writeFileSync(join(lib, "qwen3.5", "4b"), "{}");
  expect(modelliSulDisco(cartella)).toEqual(["qwen3.5:4b"]);
});

it("la versione dice numero e commit", () => {
  // La versione di package.json, qualunque sia (2.0.0, 2.1.0-beta.1…).
  const v = JSON.parse(readFileSync("package.json", "utf8")).version.replace(/[.+]/g, "\\$&");
  expect(versioneApp()).toMatch(new RegExp(`^v${v} · [0-9a-f]{7}\\+?$`));
});

it("«esci» da solo esce; dentro una frase resta per l'AI", async () => {
  const { comandoSenzaBarra } = await import("../src/cli/session.js");
  expect(comandoSenzaBarra("esci")).toBe("/esci");
  expect(comandoSenzaBarra(" Esci ")).toBe("/esci");
  expect(comandoSenzaBarra("esci dal ciclo quando trovi il prodotto")).toBe(
    "esci dal ciclo quando trovi il prodotto",
  );
});

it("Ollama entra nella sequenza come le altre AI («claude, ollama», anche «qwen»)", async () => {
  const { nuovaSequenza } = await import("../src/core/provider.js");
  expect(nuovaSequenza(["codex", "claude"], "claude, ollama")).toEqual(["claude", "ollama", "codex"]);
  expect(nuovaSequenza(["codex", "claude"], "solo qwen")).toEqual(["ollama"]);
  const { engine, db, run } = await sessione();
  try {
    expect(engine.impostaSequenza(run.id, "claude, ollama").providers).toEqual(["claude", "ollama", "codex"]);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

// Gruppi di processi e segnali Unix.
it.skipIf(process.platform === "win32")("un gruppo di processi che rifiuta il segnale (EPERM) si ferma processo per processo", async () => {
  const { spawn } = await import("node:child_process");
  const { stop, processiNelGruppo } = await import("../src/supervisor/process.js");
  const figlio = spawn("/bin/sh", ["-c", "sleep 30 & sleep 30 & wait"], { detached: true, stdio: "ignore" });
  await new Promise((ok) => setTimeout(ok, 300));
  expect(processiNelGruppo(figlio.pid!).length).toBeGreaterThanOrEqual(3);
  // Come il 23 ottobre: il segnale al gruppo intero viene rifiutato.
  const vero = process.kill.bind(process);
  const spia = vi.spyOn(process, "kill").mockImplementation(((pid: number, segnale?: any) => {
    if (pid < 0 && segnale !== 0) throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
    return vero(pid, segnale);
  }) as any);
  try {
    expect(await stop(figlio)).toEqual({ restano: [] });
  } finally {
    spia.mockRestore();
  }
  expect(processiNelGruppo(figlio.pid!)).toEqual([]);
}, 15000);
