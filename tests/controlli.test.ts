// Fase 3, passo 4: i controlli sempre attivi. Il revisore è il primo; gli
// altri lavorano come lui, ognuno con le sue istruzioni. Servizio finto.
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

async function sessione(chiavi: Record<string, string> = { groq: "gsk_finta" }) {
  const root = temp("continuity-controlli-");
  writeFileSync(join(root, "form.js"), "export const invia = (x) => x;\n");
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=P", "-c", "user.email=p@example.invalid", ...a], { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "base");
  const aperto = openProject(root);
  const engine = new Engine(new Store(temp("continuity-dati-")));
  engine.chiavi = portachiaviInMemoria(chiavi);
  const domande: { sistema: string; url: string }[] = [];
  engine.scaricaGratuiti = (async (url: any, init?: any) => {
    if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "openai/gpt-oss-120b" }, { id: "gemini-3.6-flash" }] }));
    const corpo = JSON.parse(init.body);
    const sistema = String(corpo.messages[0].content);
    domande.push({ sistema, url: String(url) });
    const testo = /SICUREZZA_FINTA/.test(sistema) ? "- form.js:1 — input non controllato → validalo" : "- form.js:1 — manca un test → aggiungilo";
    return new Response(JSON.stringify({ choices: [{ message: { content: testo } }] }), { headers: { "content-type": "application/json" } });
  }) as any;
  const run = await engine.create(
    "Obiettivo",
    "simulation",
    "claude",
    { root: aperto.root, head: aperto.head, branch: aperto.branch, verify: aperto.config.verify, commandsDigest: aperto.commandsDigest },
    { providers: ["codex", "claude"] },
  );
  return { engine, run, domande };
}
const finite = (engine: Engine) => vi.waitFor(() => expect(engine.revisioniInCorso.size).toBe(0));

it("il revisore e un controllo «Sicurezza» rivedono insieme, ognuno con le sue istruzioni", async () => {
  const { engine, run, domande } = await sessione();
  try {
    engine.impostaRevisore(run.id, { attivo: true });
    const r = engine.aggiungiControllo(run.id, "Sicurezza", "SICUREZZA_FINTA: controlla solo i form");
    const chiave = r.controlli[0].id;
    expect(chiave).toBe("sicurezza");
    expect(r.controlli[0]).toMatchObject({ attivo: false, nome: "Sicurezza" });
    engine.impostaRevisore(run.id, { attivo: true }, chiave);
    writeFileSync(join(engine.run(run.id).work, "form.js"), "export const invia = (x) => eval(x);\n");
    expect(engine.avviaRevisioni(run.id, "fine")).toEqual({ revisore: "avviata", sicurezza: "avviata" });
    // Due revisioni in parallelo, ognuna la sua.
    expect(engine.revisioniInCorso.size).toBe(2);
    await finite(engine);
    expect(domande).toHaveLength(2);
    expect(domande.filter((d) => /SICUREZZA_FINTA/.test(d.sistema))).toHaveLength(1);
    const suggerimenti = engine.run(run.id).suggerimenti;
    expect(suggerimenti.map((x: any) => [x.da.split(" · ")[0], x.testo]).sort()).toEqual([
      ["Groq", "form.js:1 — manca un test → aggiungilo"],
      ["Sicurezza", "form.js:1 — input non controllato → validalo"],
    ]);
    // Ognuno ricorda la sua fotografia: rivista la stessa, nessuno riparte.
    expect(engine.avviaRevisioni(run.id, "fine")).toEqual({ revisore: "già vista", sicurezza: "già vista" });
    // Il revisore spento: il controllo va avanti da solo.
    engine.impostaRevisore(run.id, { attivo: false });
    writeFileSync(join(engine.run(run.id).work, "form.js"), "export const invia = (x) => String(x);\n");
    expect(engine.avviaRevisioni(run.id, "fine")).toEqual({ revisore: "spento", sicurezza: "avviata" });
    await finite(engine);
  } finally {
    await engine.shutdown();
  }
});

it("un controllo ogni 2 turni rivede al secondo turno, il revisore a ogni turno (28 ottobre: niente più minuti)", async () => {
  const { engine, run } = await sessione();
  try {
    engine.impostaRevisore(run.id, { attivo: true });
    const chiave = engine.aggiungiControllo(run.id, "Testi", "Controlla i testi in italiano").controlli[0].id;
    engine.impostaRevisore(run.id, { attivo: true, ogniTurni: 2 }, chiave);
    writeFileSync(join(engine.run(run.id).work, "form.js"), "// cambiato\n");
    expect(engine.avviaRevisioni(run.id, "fine")).toEqual({ revisore: "avviata", testi: "fra 1 turni" });
    await finite(engine);
    writeFileSync(join(engine.run(run.id).work, "form.js"), "// cambiato ancora\n");
    expect(engine.avviaRevisioni(run.id, "fine")).toEqual({ revisore: "avviata", testi: "avviata" });
    await finite(engine);
  } finally {
    await engine.shutdown();
  }
});

it("un controllo con Google parte subito: nessun consenso da chiedere (28 ottobre)", async () => {
  const { engine, run } = await sessione({ google: "AIza_finta" });
  try {
    const chiave = engine.aggiungiControllo(run.id, "Sicurezza", "SICUREZZA_FINTA").controlli[0].id;
    engine.impostaRevisore(run.id, { attivo: true, provider: "google" }, chiave);
    writeFileSync(join(engine.run(run.id).work, "form.js"), "// x\n");
    expect(engine.avviaRevisione(run.id, "fine", undefined, chiave)).toBe("avviata");
    await finite(engine);
  } finally {
    await engine.shutdown();
  }
});

it("togliere un controllo; il revisore no; al massimo 6", async () => {
  const { engine, run } = await sessione();
  try {
    const chiave = engine.aggiungiControllo(run.id, "Sicurezza", "x").controlli[0].id;
    expect(() => engine.impostaRevisore(run.id, { togli: true })).toThrow(/non si toglie/);
    expect(engine.impostaRevisore(run.id, { togli: true }, chiave).controlli).toEqual([]);
    expect(() => engine.impostaRevisore(run.id, { attivo: true }, "sparito")).toThrow(/non trovato/);
    for (let i = 0; i < 6; i++) engine.aggiungiControllo(run.id, `C${i}`, "x");
    expect(() => engine.aggiungiControllo(run.id, "Troppi", "x")).toThrow(/Al massimo 6/);
    // Due con lo stesso nome hanno chiavi diverse.
    const ids = engine.run(run.id).controlli.map((c: any) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  } finally {
    await engine.shutdown();
  }
});
