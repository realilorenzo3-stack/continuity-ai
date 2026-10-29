// Il revisore fra tutte le AI e «Correggi da solo» (28 ottobre): chi corregge,
// e Codex, Claude, Qwen come revisori, rivedono con un turno vero dopo chi ha
// lavorato. AI simulata, Groq finto.
import { it, expect, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProject } from "../src/core/project.js";
import { Store } from "../src/persistence/store.js";
import { Engine } from "../src/core/engine.js";
import { portachiaviInMemoria } from "../src/core/portachiavi.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const temp = (n: string) => {
  const d = mkdtempSync(join(tmpdir(), n));
  dirs.push(d);
  return d;
};

async function sessione() {
  const root = temp("continuity-rev-turno-");
  writeFileSync(join(root, "a.js"), "export const a = 1;\n");
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=P", "-c", "user.email=p@example.invalid", ...a], { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "base");
  const aperto = openProject(root);
  const store = new Store(temp("continuity-dati-"));
  const engine = new Engine(store);
  engine.chiavi = portachiaviInMemoria({ groq: "gsk_finta" });
  engine.scaricaGratuiti = (async (url: any) => {
    if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "openai/gpt-oss-120b" }] }));
    return new Response(JSON.stringify({ choices: [{ message: { content: "NESSUN SUGGERIMENTO" } }] }), { headers: { "content-type": "application/json" } });
  }) as any;
  const run = await engine.create(
    "Obiettivo",
    "simulation",
    "claude",
    { root: aperto.root, head: aperto.head, branch: aperto.branch, verify: aperto.config.verify, commandsDigest: aperto.commandsDigest },
    { providers: ["codex", "claude"] },
  );
  const eventi = () => store.events(run.id).map((e: any) => ({ tipo: e.type, testo: String(e.payload?.message ?? "") }));
  return { engine, store, run, eventi };
}

it("chi rivede a turno: Claude, o un gratuito che corregge; un gratuito che suggerisce resta una domanda veloce", async () => {
  const { engine, run } = await sessione();
  try {
    writeFileSync(join(engine.run(run.id).work, "a.js"), "export const a = 2;\n");
    engine.impostaRevisore(run.id, { attivo: true, provider: "groq" });
    expect(engine.avviaRevisione(run.id, "fine")).toBe("avviata");
    await vi.waitFor(() => expect(engine.revisioniInCorso.size).toBe(0));
    engine.impostaRevisore(run.id, { corregge: true });
    expect(engine.avviaRevisione(run.id, "fine")).toBe("a turno");
    engine.impostaRevisore(run.id, { corregge: false, provider: "claude" });
    expect(engine.run(run.id).revisore).toMatchObject({ provider: "claude", corregge: false });
    // Già in coda: non si ripete.
    expect(engine.avviaRevisione(run.id, "fine")).toBe("a turno");
    expect(engine.run(run.id).codaRevisioni).toEqual(["revisore"]);
  } finally {
    await engine.shutdown();
  }
});

it("il turno di revisione parte con l'AI scelta, in sola lettura se suggerisce; i suggerimenti in attesa restano per chi lavora", async () => {
  const { engine, run, eventi } = await sessione();
  try {
    writeFileSync(join(engine.run(run.id).work, "a.js"), "export const a = 3;\n");
    const r = engine.run(run.id);
    r.suggerimenti = [{ id: "s0", testo: "uno vecchio", da: "Groq", stato: "nuovo" }];
    engine.event(r, "review.marked", "prova");
    engine.impostaRevisore(run.id, { attivo: true, provider: "claude" });
    expect(engine.avviaRevisione(run.id, "fine")).toBe("a turno");
    await engine.prossimaRevisioneATurno(run.id);
    expect(engine.run(run.id).agent).toBe("claude");
    expect(engine.run(run.id).passoSoloLettura).toBe(true);
    await vi.waitFor(() => expect(eventi().some((x) => x.tipo === "review.completed")).toBe(true), { timeout: 10_000 });
    const dopo = engine.run(run.id);
    expect(dopo.revisioneATurno).toBeUndefined();
    expect(dopo.codaRevisioni).toEqual([]);
    // L'AI simulata non scrive suggerimenti: nessuno; quello vecchio è ancora per chi lavora.
    expect(eventi().find((x) => x.tipo === "review.completed")?.testo).toBe("Nessun suggerimento: le modifiche sembrano a posto");
    expect(dopo.suggerimenti).toEqual([expect.objectContaining({ id: "s0", stato: "nuovo" })]);
    // Il turno di revisione non ne chiede un altro.
    expect(eventi().filter((x) => x.tipo === "review.queued")).toHaveLength(1);
  } finally {
    await engine.shutdown();
  }
}, 20_000);

it("l'esito: i suggerimenti vanno in attesa; con «Correggi da solo» si elencano le correzioni fatte", async () => {
  const { engine, run, eventi } = await sessione();
  try {
    const r = engine.run(run.id);
    engine.event(r, "agent.message", "- a.js:1 — manca il controllo → aggiunto\n- a.js:2 — nome sbagliato → rinominato", "claude");
    const seq = engine.run(run.id).version;
    engine.esitoRevisioneATurno(run.id, engine.run(run.id), { chiave: "revisore", corregge: false, da: "Claude Code", seq }, false);
    expect(engine.run(run.id).suggerimenti.map((x: any) => [x.testo, x.stato, x.da])).toEqual([
      ["a.js:1 — manca il controllo → aggiunto", "nuovo", "Claude Code"],
      ["a.js:2 — nome sbagliato → rinominato", "nuovo", "Claude Code"],
    ]);
    engine.esitoRevisioneATurno(run.id, engine.run(run.id), { chiave: "revisore", corregge: true, da: "Groq", seq }, false);
    expect(eventi().at(-1)).toMatchObject({ tipo: "review.completed", testo: expect.stringMatching(/^Corretto da Groq:\n• a\.js:1/) });
    engine.esitoRevisioneATurno(run.id, engine.run(run.id), { chiave: "revisore", corregge: true, da: "Groq", seq }, true, "uscita 1");
    expect(eventi().at(-1)).toMatchObject({ tipo: "review.failed", testo: "Groq: uscita 1" });
  } finally {
    await engine.shutdown();
  }
});
