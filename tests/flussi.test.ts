// Fase 3, passo 1: ruoli e flussi (CONTINUITY_2.0.md §5.17).
import { it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  descriviFlusso,
  flussiPredefiniti,
  idDaNome,
  leggiFlussi,
  problemaAI,
  problemaFlusso,
  salvaFlussi,
  type Ruolo,
} from "../src/core/flussi.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const cartella = () => {
  const d = mkdtempSync(join(tmpdir(), "continuity-flussi-"));
  dirs.push(d);
  return d;
};

it("i flussi pronti sono validi e il diretto è Continuity com'è oggi", () => {
  const { ruoli, flussi } = flussiPredefiniti();
  expect(ruoli.map((r) => r.id)).toEqual(["pianifica", "scrive", "test", "rivede", "verifica"]);
  for (const f of flussi) expect(problemaFlusso(f, ruoli), f.id).toBeUndefined();
  const diretto = flussi.find((f) => f.id === "diretto")!;
  expect(diretto.passi).toEqual([{ ruolo: "scrive", ai: "sequenza" }]);
  expect(descriviFlusso(flussi.find((f) => f.id === "completo")!, ruoli)).toBe(
    "Pianifica (la sequenza) → Scrive (la sequenza) → Scrive i test (la sequenza) → Rivede (un gratuito) → Verifica finale (un gratuito)",
  );
});

it("chi scrive solo con le AI che lavorano sui file; chi legge con qualunque AI", () => {
  const { ruoli } = flussiPredefiniti();
  const scrive = ruoli.find((r) => r.id === "scrive")!;
  const rivede = ruoli.find((r) => r.id === "rivede")!;
  expect(problemaAI(scrive, "codex")).toBeUndefined();
  expect(problemaAI(scrive, "claude")).toBeUndefined();
  expect(problemaAI(scrive, "sequenza")).toBeUndefined();
  // Dal 28 ottobre ogni AI fa ogni ruolo.
  expect(problemaAI(scrive, "groq")).toBeUndefined();
  expect(problemaAI(scrive, "gratuito")).toBeUndefined();
  expect(problemaAI(rivede, "groq")).toBeUndefined();
  expect(problemaAI(rivede, "claude")).toBeUndefined();
  expect(problemaAI(rivede, "gratuito")).toBeUndefined();
  expect(problemaAI(rivede, "inventata")).toMatch(/sconosciuta/);
});

it("un flusso sbagliato si spiega", () => {
  const { ruoli } = flussiPredefiniti();
  const base = { id: "mio", nome: "Mio", giri: 2, passi: [{ ruolo: "scrive", ai: "codex" }] };
  expect(problemaFlusso(base, ruoli)).toBeUndefined();
  expect(problemaFlusso({ ...base, passi: [] }, ruoli)).toMatch(/almeno un passo/);
  expect(problemaFlusso({ ...base, giri: 9 }, ruoli)).toMatch(/giri/);
  expect(problemaFlusso({ ...base, descrizione: "x".repeat(400) }, ruoli)).toMatch(/descrizione/);
  expect(problemaFlusso({ ...base, passi: [{ ruolo: "boh", ai: "codex" }] }, ruoli)).toMatch(/ruolo sconosciuto/);
  expect(problemaFlusso({ ...base, passi: [{ ruolo: "rivede", ai: "groq" }] }, ruoli)).toMatch(/chi rivede ha bisogno/);
  expect(problemaFlusso({ ...base, passi: [{ ruolo: "scrive", ai: "groq" }] }, ruoli)).toBeUndefined();
  expect(problemaFlusso({ ...base, passi: [{ ruolo: "scrive", ai: "inventata" }] }, ruoli)).toMatch(/passo 1 \(Scrive\): AI sconosciuta/);
});

it("salvataggio: ruoli e flussi personalizzati restano, i predefiniti non si perdono né si eliminano", () => {
  const root = cartella();
  const config = flussiPredefiniti();
  const sicurezza: Ruolo = {
    id: "sicurezza",
    nome: "Sicurezza",
    tipo: "legge",
    esito: "suggerimenti",
    istruzioni: "Controlla solo la sicurezza dei form.",
  };
  config.ruoli.push(sicurezza);
  config.flussi.push({
    id: "sicuro",
    nome: "Sicuro",
    giri: 1,
    passi: [
      { ruolo: "scrive", ai: "codex" },
      { ruolo: "sicurezza", ai: "claude" },
    ],
  });
  config.ruoli.find((r) => r.id === "rivede")!.istruzioni = "Controlla che i testi siano in italiano.";
  salvaFlussi(root, config);
  const letta = leggiFlussi(root);
  expect(letta.ruoli.find((r) => r.id === "sicurezza")).toMatchObject({ nome: "Sicurezza", tipo: "legge" });
  expect(letta.ruoli.find((r) => r.id === "rivede")).toMatchObject({ istruzioni: "Controlla che i testi siano in italiano.", predefinito: true });
  expect(letta.flussi.map((f) => f.id)).toEqual(["diretto", "revisione", "completo", "sicuro"]);

  // Eliminare un predefinito: no.
  expect(() => salvaFlussi(root, { ...letta, flussi: letta.flussi.filter((f) => f.id !== "diretto") })).toThrow(/non si può eliminare/);
  expect(() => salvaFlussi(root, { ...letta, ruoli: letta.ruoli.filter((r) => r.id !== "rivede") })).toThrow(/non si può eliminare/);
  // Un flusso che usa un ruolo personalizzato tolto: non si salva.
  expect(() => salvaFlussi(root, { ...letta, ruoli: letta.ruoli.filter((r) => r.id !== "sicurezza") })).toThrow(/ruolo sconosciuto/);
});

it("un file rovinato o con voci non valide non ferma Continuity", () => {
  const root = cartella();
  writeFileSync(join(root, "flussi.json"), "{ non è json");
  expect(leggiFlussi(root).flussi.map((f) => f.id)).toEqual(["diretto", "revisione", "completo"]);
  writeFileSync(
    join(root, "flussi.json"),
    JSON.stringify({
      ruoli: [{ id: "x", nome: "", tipo: "legge" }],
      flussi: [{ id: "rotto", nome: "Rotto", giri: 1, passi: [{ ruolo: "scrive", ai: "inventata" }] }],
    }),
  );
  const letta = leggiFlussi(root);
  expect(letta.ruoli.map((r) => r.id)).toEqual(["pianifica", "scrive", "test", "rivede", "verifica"]);
  expect(letta.flussi.map((f) => f.id)).toEqual(["diretto", "revisione", "completo"]);
});

it("idDaNome dà un nome interno stabile e non ripetuto", () => {
  expect(idDaNome("Sicurezza dei form", [])).toBe("sicurezza-dei-form");
  expect(idDaNome("Più veloce!", ["piu-veloce"])).toBe("piu-veloce-2");
  expect(idDaNome("??", [])).toBe("nuovo");
});

it("Codex e Claude in sola lettura: niente scritture nella copia, niente permessi da chiedere", async () => {
  const { liveCommand } = await import("../src/adapters/live.js");
  const work = cartella();
  const permessi = { run: "r1", servizio: "/x/service.json", codexConsentito: true };
  const normale = liveCommand("codex", work, undefined, undefined, "project", undefined, undefined, { permessi, cache: "/c" }).args;
  expect(normale).toContain('sandbox_mode="workspace-write"');
  const codex = liveCommand("codex", work, undefined, undefined, "project", undefined, undefined, {
    permessi,
    cache: "/c",
    soloLettura: true,
  }).args;
  expect(codex).toContain('sandbox_mode="read-only"');
  expect(codex).not.toContain('sandbox_mode="workspace-write"');
  expect(codex[codex.indexOf("--sandbox") + 1]).toBe("read-only");
  expect(codex.join(" ")).not.toContain("writable_roots");
  // Anche con il permesso del turno, i connettori che scrivono restano fermi.
  expect(codex).toContain('apps._default.default_tools_approval_mode="writes"');

  const claude = liveCommand("claude", work, undefined, undefined, "project", undefined, undefined, {
    permessi,
    cache: "/c",
    soloLettura: true,
    agenti: [{ nome: "aiutante", descrizione: "Aiuta", istruzioni: "Aiuta.", permessi: "scrittura", modelli: {} } as any],
  }).args;
  expect(claude[claude.indexOf("--permission-mode") + 1]).toBe("dontAsk");
  expect(claude).not.toContain("--permission-prompt-tool");
  expect(claude[claude.indexOf("--disallowedTools") + 1].split(",")).toEqual(
    expect.arrayContaining(["Edit", "Write", "NotebookEdit"]),
  );
  expect(claude[claude.indexOf("--allowedTools") + 1].split(",")).not.toContain("Edit");
  const impostazioni = JSON.parse(claude[claude.indexOf("--settings") + 1]);
  expect(impostazioni.sandbox.filesystem).toEqual({ denyWrite: [work] });
  expect(JSON.parse(claude[claude.indexOf("--agents") + 1]).aiutante.disallowedTools).toEqual(["Edit", "Write", "NotebookEdit"]);
  // Senza sola lettura tutto come prima.
  const scrive = liveCommand("claude", work, undefined, undefined, "project", undefined, undefined, { permessi, cache: "/c" }).args;
  expect(scrive[scrive.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
  expect(scrive).toContain("--permission-prompt-tool");
  expect(JSON.parse(scrive[scrive.indexOf("--settings") + 1]).sandbox.filesystem).toEqual({ allowWrite: ["/c"] });
});

it("il flusso attivo è della sessione: di serie il diretto, si cambia con un evento", async () => {
  const { Store } = await import("../src/persistence/store.js");
  const { Engine } = await import("../src/core/engine.js");
  const { execFileSync } = await import("node:child_process");
  const { openProject } = await import("../src/core/project.js");
  const root = cartella();
  writeFileSync(join(root, "a.js"), "1\n");
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=P", "-c", "user.email=p@example.invalid", ...a], { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "base");
  const aperto = openProject(root);
  const engine = new Engine(new Store(cartella()));
  const run = await engine.create(
    "Obiettivo",
    "simulation",
    "claude",
    { root: aperto.root, head: aperto.head, branch: aperto.branch, verify: aperto.config.verify, commandsDigest: aperto.commandsDigest },
    { providers: ["codex", "claude"] },
  );
  try {
    expect(engine.flussoAttivo(engine.run(run.id)).id).toBe("diretto");
    engine.impostaFlusso(run.id, "completo");
    expect(engine.run(run.id).flusso).toBe("completo");
    expect(engine.store.events(run.id).some((e: any) => e.type === "flow.changed" && /Pianifica, lavora e ricontrolla/.test(e.payload.message))).toBe(true);
    expect(() => engine.impostaFlusso(run.id, "inventato")).toThrow(/Non conosco il flusso/);
    // Un flusso tolto dal file: si torna al diretto, senza errori.
    expect(engine.flussoAttivo({ ...engine.run(run.id), flusso: "sparito" }).id).toBe("diretto");
  } finally {
    await engine.shutdown();
  }
});

it("i flussi pronti hanno nomi che dicono cosa succede, e quelli salvati con i nomi vecchi li prendono", () => {
  const { flussi } = flussiPredefiniti();
  expect(flussi.map((f) => f.nome)).toEqual(["Lavora", "Lavora e ricontrolla", "Pianifica, lavora e ricontrolla"]);
  for (const f of flussi) expect(f.descrizione, f.id).toBeTruthy();
  // Un flussi.json di prima (con la parola e i nomi vecchi): nomi nuovi,
  // descrizione, niente parola. Un nome cambiato dalla persona resta.
  const root = cartella();
  writeFileSync(
    join(root, "flussi.json"),
    JSON.stringify({
      ruoli: [],
      flussi: [
        { id: "diretto", nome: "Diretto", parola: "diretto", giri: 0, passi: [{ ruolo: "scrive", ai: "sequenza" }] },
        { id: "revisione", nome: "Il mio controllo", parola: "revisione", giri: 1, passi: [{ ruolo: "scrive", ai: "sequenza" }, { ruolo: "rivede", ai: "gratuito" }] },
        { id: "completo", nome: "Completo", parola: "completo", giri: 2, passi: [{ ruolo: "scrive", ai: "sequenza" }] },
      ],
    }),
  );
  const letta = leggiFlussi(root);
  expect(letta.flussi.map((f) => f.nome)).toEqual(["Lavora", "Il mio controllo", "Pianifica, lavora e ricontrolla"]);
  expect(letta.flussi[0].descrizione).toMatch(/Un'AI fa il lavoro/);
  expect(letta.flussi[1].descrizione).toBeUndefined();
  expect(letta.flussi.some((f) => "parola" in f)).toBe(false);
  // E si salvano senza errori.
  salvaFlussi(root, letta);
});

it("un flusso salvato con un servizio tolto (Zen, GitHub Models) passa al gratuito automatico, non sparisce", () => {
  const root = cartella();
  writeFileSync(
    join(root, "flussi.json"),
    JSON.stringify({
      ruoli: [],
      flussi: [{ id: "mio", nome: "Mio", giri: 1, passi: [{ ruolo: "scrive", ai: "codex" }, { ruolo: "rivede", ai: "zen" }, { ruolo: "verifica", ai: "github" }] }],
    }),
  );
  const mio = leggiFlussi(root).flussi.find((f) => f.id === "mio");
  expect(mio?.passi.map((p) => p.ai)).toEqual(["codex", "gratuito", "gratuito"]);
});
