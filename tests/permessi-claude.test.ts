// Claude Code senza sandbox e in modalità libera (decisione di Lorenzo del 30
// ottobre): senza la sandbox del sistema ogni comando passa dal permesso della
// persona; con «Bypass permissions» Claude non chiede nulla.
import { it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { liveCommand } from "../src/adapters/live.js";
import { leggiModoClaude, salvaModoClaude } from "../src/core/permessi-claude.js";
import { decidi } from "../src/adapters/permessi-mcp.mjs";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const temp = (n: string) => {
  const d = mkdtempSync(join(tmpdir(), n));
  dirs.push(d);
  return d;
};

const argomenti = (lavoro: Record<string, unknown>) => {
  const work = temp("perm-work-");
  const { args } = liveCommand("claude", work, undefined, undefined, "project", undefined, undefined, {
    permessi: { run: "r1", servizio: "/x/service.json" },
    ...lavoro,
  });
  const valore = (nome: string) => args[args.lastIndexOf(nome) + 1];
  return { args, valore };
};

it("con la sandbox: i comandi sono consentiti in anticipo, Claude accetta le modifiche nella copia", () => {
  const { valore } = argomenti({ sandbox: true, modoClaude: "chiedi" });
  expect(valore("--allowedTools").split(",")).toContain("Bash");
  expect(JSON.parse(valore("--settings")).sandbox.enabled).toBe(true);
  expect(valore("--permission-mode")).toBe("acceptEdits");
});

it("senza sandbox (Linux senza bubblewrap): Claude parte lo stesso, e ogni comando lo consente la persona", () => {
  const { args, valore } = argomenti({ sandbox: false, modoClaude: "chiedi" });
  expect(valore("--allowedTools").split(",")).not.toContain("Bash");
  expect(JSON.parse(valore("--settings")).sandbox).toEqual({ enabled: false });
  expect(valore("--permission-prompt-tool")).toBe("mcp__continuity__permesso");
  const mcp = JSON.parse(args[args.lastIndexOf("--mcp-config") + 1]);
  expect(mcp.mcpServers.continuity.env.CONTINUITY_PERMESSI_COMANDI).toBe("1");
});

it("modalità libera (Bypass permissions): nessuna domanda; la sandbox resta dove c'è", () => {
  const conSandbox = argomenti({ sandbox: true, modoClaude: "libero" });
  expect(conSandbox.valore("--permission-mode")).toBe("bypassPermissions");
  expect(conSandbox.args).not.toContain("--permission-prompt-tool");
  expect(JSON.parse(conSandbox.valore("--settings")).sandbox.enabled).toBe(true);
  const senza = argomenti({ sandbox: false, modoClaude: "libero" });
  expect(senza.valore("--allowedTools").split(",")).toContain("Bash");
  // Chi legge soltanto (un controllo di un flusso) resta in sola lettura.
  expect(argomenti({ sandbox: false, modoClaude: "libero", soloLettura: true }).valore("--permission-mode")).toBe("dontAsk");
});

it("il programma dei permessi: un comando senza sandbox si chiede alla persona; con la sandbox resta vietato fuori dai connettori", async () => {
  const prima = process.env.CONTINUITY_PERMESSI_COMANDI;
  try {
    delete process.env.CONTINUITY_PERMESSI_COMANDI;
    expect((await decidi({ tool_name: "Bash", input: { command: "ls" } })).behavior).toBe("deny");
    process.env.CONTINUITY_PERMESSI_COMANDI = "1";
    // Il servizio non c'è: la domanda non parte e il comando resta fermo, ma
    // ci si è arrivati (prima era vietato senza nemmeno chiedere).
    const esito = await decidi({ tool_name: "Bash", input: { command: "ls" } });
    expect(esito.behavior).toBe("deny");
    expect((esito as { message?: string }).message).toMatch(/^Permesso non ottenuto/);
  } finally {
    if (prima === undefined) delete process.env.CONTINUITY_PERMESSI_COMANDI;
    else process.env.CONTINUITY_PERMESSI_COMANDI = prima;
  }
});

it("la scelta resta salvata: di serie chiede, poi libero", () => {
  const dati = temp("perm-dati-");
  expect(leggiModoClaude(dati)).toBe("chiedi");
  salvaModoClaude(dati, "libero");
  expect(leggiModoClaude(dati)).toBe("libero");
});

// Prova di Lorenzo del 31 ottobre: l'avviso «bloccato finché non lo consenti»
// c'era, la domanda di fine turno no. /permessi offre sempre il modo di farlo.
it("/permessi offre di consentire le azioni che Codex non ha potuto fare nell'ultimo turno", async () => {
  const { pannelloPermessi } = await import("../src/tui/comandi.js");
  const chiamate: [string, unknown][] = [];
  const avvisi: string[] = [];
  let voci: any[] = [];
  const c: any = {
    api: async (p: string, corpo?: unknown) => (chiamate.push([p, corpo]), {}),
    id: "x",
    cartellaDati: temp("perm-dati-"),
    run: () => ({ permessiNegati: ["app: vercel.create_deployment"] }),
    inTurno: () => false,
    avvisa: (_t: string, testo: string) => avvisi.push(testo),
    aggiorna: async () => {},
    scegli: async (_titolo: string, elenco: any[]) => ((voci = elenco), elenco[0]),
  };
  await pannelloPermessi(c);
  expect(voci[0]).toMatchObject({ nome: "Consenti le azioni bloccate, per il prossimo turno", descrizione: "app: vercel.create_deployment" });
  expect(chiamate).toEqual([["/runs/x/permessi-turno", { consenti: true }]]);
  expect(avvisi.at(-1)).toMatch(/Consentito per il prossimo turno: app: vercel\.create_deployment/);
  // Senza azioni bloccate restano solo le due scelte per Claude.
  c.run = () => ({});
  await pannelloPermessi({ ...c, scegli: async (_t: string, elenco: any[]) => ((voci = elenco), undefined) });
  expect(voci.map((v) => v.valore)).toEqual(["chiedi", "libero"]);
});
