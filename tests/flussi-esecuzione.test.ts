// Fase 3, passo 2: l'esecuzione dei flussi (CONTINUITY_2.0.md §5.17). Le AI
// che lavorano sono finte (il turno è sostituito), i gratuiti rispondono da un
// servizio finto: niente rete, niente crediti.
import { it, expect, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProject } from "../src/core/project.js";
import { Store } from "../src/persistence/store.js";
import { Engine } from "../src/core/engine.js";
import { portachiaviInMemoria } from "../src/core/portachiavi.js";
import { flussiPredefiniti, salvaFlussi } from "../src/core/flussi.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const temp = (n: string) => {
  const d = mkdtempSync(join(tmpdir(), n));
  dirs.push(d);
  return d;
};

type Azione = { scrivi?: [string, string]; messaggio: string };

// Una sessione con un'AI finta per i passi a turni e Groq finto per i gratuiti.
async function sessione(opzioni: { risposteGroq?: string[]; groq?: boolean; flussi?: (c: ReturnType<typeof flussiPredefiniti>) => void } = {}) {
  const root = temp("continuity-flusso-");
  const data = temp("continuity-dati-");
  writeFileSync(join(root, "carrello.js"), "export const totale = (r) => r.prezzo;\n");
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=P", "-c", "user.email=p@example.invalid", ...a], { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "base");
  if (opzioni.flussi) {
    const c = flussiPredefiniti();
    opzioni.flussi(c);
    salvaFlussi(data, c);
  }
  const aperto = openProject(root);
  const engine = new Engine(new Store(data));
  engine.chiavi = portachiaviInMemoria(opzioni.groq === false ? {} : { groq: "gsk_finta" });
  const domandeGroq: any[] = [];
  const risposte = [...(opzioni.risposteGroq ?? [])];
  engine.scaricaGratuiti = (async (url: any, init?: any) => {
    if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "openai/gpt-oss-120b" }] }));
    domandeGroq.push(JSON.parse(init.body));
    const testo = risposte.shift() ?? "NESSUN SUGGERIMENTO";
    return new Response(JSON.stringify({ choices: [{ message: { content: testo } }] }), { headers: { "content-type": "application/json" } });
  }) as any;
  const run = await engine.create(
    "Obiettivo",
    "simulation",
    "claude",
    { root: aperto.root, head: aperto.head, branch: aperto.branch, verify: aperto.config.verify, commandsDigest: aperto.commandsDigest },
    { providers: ["codex", "claude"] },
  );
  // I turni dei passi: l'AI finta esegue il copione, poi il turno finisce.
  const copione: Azione[] = [];
  const turni: { testo: string; provider?: string; soloLettura: boolean }[] = [];
  engine.avviaPassoTurno = async (id: string, testo: string, o: { provider?: string; soloLettura: boolean }) => {
    turni.push({ testo, ...o });
    const azione = copione.shift() ?? { messaggio: "Fatto." };
    const r = engine.run(id);
    if (azione.scrivi) writeFileSync(join(r.work, azione.scrivi[0]), azione.scrivi[1]);
    engine.event(r, "agent.message", azione.messaggio, o.provider ?? "codex");
    setImmediate(() => void engine.dopoTurnoDiFlusso(id, false));
  };
  const eventi = () => engine.store.events(run.id).map((e: any) => ({ tipo: e.type, testo: String(e.payload?.message ?? "") }));
  const fine = () =>
    vi.waitFor(() => expect(eventi().some((e) => e.tipo === "flow.completed" || e.tipo === "flow.stopped")).toBe(true), { timeout: 5000 });
  return { engine, run, copione, turni, domandeGroq, eventi, fine };
}

it("Lavora e ricontrolla: chi rivede trova un problema, torna a chi scrive, poi è tutto a posto", async () => {
  const s = await sessione({
    risposteGroq: ["- carrello.js:1 — non moltiplica per la quantità → usa r.prezzo * r.quantita", "NESSUN SUGGERIMENTO"],
  });
  try {
    s.copione.push(
      { scrivi: ["carrello.js", "export const totale = (r) => r.prezzo + 0;\n"], messaggio: "Ho sistemato il totale." },
      { scrivi: ["carrello.js", "export const totale = (r) => r.prezzo * r.quantita;\n"], messaggio: "Corretto: moltiplico per la quantità." },
    );
    s.engine.impostaFlusso(s.run.id, "revisione");
    await s.engine.turn(s.run.id, "correggi il totale del carrello");
    await s.fine();
    const e = s.eventi();
    expect(e.find((x) => x.tipo === "user.request")?.testo).toBe("correggi il totale del carrello");
    expect(e.find((x) => x.tipo === "flow.started")?.testo).toMatch(/Lavora e ricontrolla.*Scrive \(la sequenza\) → Rivede/);
    expect(s.turni).toHaveLength(2);
    expect(s.turni[0]).toMatchObject({ soloLettura: false, provider: undefined });
    expect(s.turni[0].testo).toContain("correggi il totale del carrello");
    // La correzione porta i problemi trovati.
    expect(s.turni[1].testo).toMatch(/Correzione, giro 1 di 2/);
    expect(s.turni[1].testo).toContain("non moltiplica per la quantità");
    // Chi rivede ha visto le modifiche vere.
    expect(JSON.stringify(s.domandeGroq[0].messages)).toContain("r.prezzo + 0");
    expect(JSON.stringify(s.domandeGroq[1].messages)).toContain("r.prezzo * r.quantita");
    expect(e.filter((x) => x.tipo === "flow.review").map((x) => x.testo)).toEqual([
      "• carrello.js:1 — non moltiplica per la quantità → usa r.prezzo * r.quantita",
      "Nessun problema: il lavoro sembra a posto",
    ]);
    expect(e.at(-1)).toMatchObject({ tipo: "flow.completed", testo: "Flusso «Lavora e ricontrolla» concluso" });
    expect(s.engine.run(s.run.id).esecuzione).toBeUndefined();
  } finally {
    await s.engine.shutdown();
  }
});

it("finiti i giri, i problemi restano come suggerimenti per il prossimo messaggio", async () => {
  const s = await sessione({
    risposteGroq: ["- carrello.js:1 — manca il controllo dei prezzi negativi → lancia un errore", "- carrello.js:1 — ancora nessun controllo → aggiungilo"],
    flussi: (c) => (c.flussi.find((f) => f.id === "revisione")!.giri = 1),
  });
  try {
    s.copione.push(
      { scrivi: ["carrello.js", "export const totale = (r) => r.prezzo * r.quantita;\n"], messaggio: "Fatto." },
      { scrivi: ["carrello.js", "export const totale = (r) => r.prezzo * r.quantita; // ok\n"], messaggio: "Fatto di nuovo." },
    );
    s.engine.impostaFlusso(s.run.id, "revisione");
    await s.engine.turn(s.run.id, "sistema il totale");
    await s.fine();
    expect(s.turni).toHaveLength(2);
    const ultimo = s.eventi().at(-1)!;
    // Tutti i passi fatti: concluso, con i problemi detti (CT-2.0-609).
    expect(ultimo.tipo).toBe("flow.completed");
    expect(ultimo.testo).toMatch(/concluso con problemi: Dopo 1 giro di correzione resta 1 problema/);
    expect(s.engine.run(s.run.id).suggerimenti).toEqual([
      expect.objectContaining({ testo: "carrello.js:1 — ancora nessun controllo → aggiungilo", stato: "nuovo", motivo: "flusso" }),
    ]);
  } finally {
    await s.engine.shutdown();
  }
});

it("Pianifica, lavora e ricontrolla: il piano aspetta il sì; si può farlo cambiare; poi scrive, i test, la revisione e il verdetto", async () => {
  const s = await sessione({ risposteGroq: ["NESSUN SUGGERIMENTO", "NON PRONTO\n- manca il caso del carrello vuoto"] });
  try {
    s.copione.push(
      { messaggio: "1. Moltiplica per la quantità in carrello.js\n2. Aggiungi un test" },
      { messaggio: "1. Moltiplica per la quantità\n2. Aggiungi due test, anche con quantità zero" },
      { scrivi: ["carrello.js", "export const totale = (r) => r.prezzo * r.quantita;\n"], messaggio: "Fatto." },
      { scrivi: ["carrello.test.js", "// test\n"], messaggio: "Test scritti: 2 passano." },
    );
    s.engine.impostaFlusso(s.run.id, "completo");
    await s.engine.turn(s.run.id, "il totale deve contare la quantità");
    await vi.waitFor(() => expect(s.engine.run(s.run.id).esecuzione?.attesa).toBe("piano"));
    // Il piano lo fa la prima AI in sola lettura.
    expect(s.turni[0]).toMatchObject({ soloLettura: true });
    expect(s.turni[0].testo).toMatch(/il tuo ruolo è «Pianifica»[\s\S]*leggi soltanto/);
    expect(s.eventi().find((x) => x.tipo === "flow.plan_ready")?.testo).toContain("Aggiungi un test");
    // Mentre il piano aspetta, un messaggio nuovo non parte.
    await expect(s.engine.turn(s.run.id, "altro")).rejects.toThrow(/Il piano aspetta la tua risposta/);
    s.engine.rispondiPiano(s.run.id, "modifica", "anche il caso con quantità zero");
    await vi.waitFor(() => expect(s.turni).toHaveLength(2));
    expect(s.turni[1].testo).toContain("La persona chiede di cambiarlo così:\nanche il caso con quantità zero");
    await vi.waitFor(() => expect(s.engine.run(s.run.id).esecuzione?.attesa).toBe("piano"));
    s.engine.rispondiPiano(s.run.id, "approva");
    await s.fine();
    expect(s.turni.map((t) => t.soloLettura)).toEqual([true, true, false, false]);
    expect(s.turni[2].testo).toMatch(/Piano approvato dalla persona:\n1\. Moltiplica per la quantità\n2\. Aggiungi due test/);
    expect(s.turni[3].testo).toMatch(/il tuo ruolo è «Scrive i test»/);
    const e = s.eventi();
    expect(e.find((x) => x.tipo === "flow.verdict")?.testo).toMatch(/^NON PRONTO/);
    expect(e.at(-1)).toMatchObject({ tipo: "flow.completed", testo: "Flusso «Pianifica, lavora e ricontrolla» concluso · NON pronto" });
    // Il verdetto ha visto le modifiche di tutti i passi.
    const verdetto = JSON.stringify(s.domandeGroq[1].messages);
    expect(verdetto).toContain("carrello.test.js");
    expect(verdetto).toContain("PRONTO oppure NON PRONTO");
  } finally {
    await s.engine.shutdown();
  }
});

it("il piano annullato ferma il flusso senza far lavorare nessuno", async () => {
  const s = await sessione();
  try {
    s.copione.push({ messaggio: "1. Un piano" });
    s.engine.impostaFlusso(s.run.id, "completo");
    await s.engine.turn(s.run.id, "fai qualcosa");
    await vi.waitFor(() => expect(s.engine.run(s.run.id).esecuzione?.attesa).toBe("piano"));
    s.engine.rispondiPiano(s.run.id, "annulla");
    expect(s.eventi().at(-1)).toMatchObject({ tipo: "flow.stopped", testo: "Flusso «Pianifica, lavora e ricontrolla» fermato: piano annullato da te" });
    expect(s.turni).toHaveLength(1);
    expect(() => s.engine.rispondiPiano(s.run.id, "approva")).toThrow(/Nessun piano/);
  } finally {
    await s.engine.shutdown();
  }
});

it("senza un gratuito collegato chi rivede non parte, e il flusso spiega che cosa fare", async () => {
  const s = await sessione({ groq: false });
  try {
    s.copione.push({ scrivi: ["carrello.js", "x\n"], messaggio: "Fatto." });
    s.engine.impostaFlusso(s.run.id, "revisione");
    await s.engine.turn(s.run.id, "cambia");
    await s.fine();
    expect(s.eventi().at(-1)!.testo).toMatch(/fermato: Rivede: nessun servizio gratuito collegato\. Collegane uno con \/collega groq/);
  } finally {
    await s.engine.shutdown();
  }
});

it("fermare il flusso mentre chi rivede aspetta la risposta: si annulla e non scrive più", async () => {
  const s = await sessione();
  let chiamato = false;
  s.engine.scaricaGratuiti = (async (url: any, init?: any) => {
    if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "openai/gpt-oss-120b" }] }));
    chiamato = true;
    return new Promise((_, no) => init.signal.addEventListener("abort", () => no(new Error("annullata"))));
  }) as any;
  try {
    s.copione.push({ scrivi: ["carrello.js", "y\n"], messaggio: "Fatto." });
    s.engine.impostaFlusso(s.run.id, "revisione");
    await s.engine.turn(s.run.id, "cambia");
    await vi.waitFor(() => expect(chiamato).toBe(true));
    expect(s.engine.occupato()).toBe(true);
    await s.engine.fermaFlusso(s.run.id);
    expect(s.engine.passiDiretti.size).toBe(0);
    const prima = s.eventi().length;
    expect(s.eventi().at(-1)).toMatchObject({ tipo: "flow.stopped", testo: expect.stringMatching(/fermato da te/) });
    await new Promise((ok) => setTimeout(ok, 50));
    expect(s.eventi()).toHaveLength(prima);
  } finally {
    await s.engine.shutdown();
  }
});

it("un flusso con Claude che rivede: turno in sola lettura con Claude, e il suo messaggio fa da revisione", async () => {
  const s = await sessione({
    flussi: (c) =>
      c.flussi.push({
        id: "sicuro",
        nome: "Sicuro",
        giri: 2,
        passi: [
          { ruolo: "scrive", ai: "codex" },
          { ruolo: "rivede", ai: "claude" },
        ],
      }),
  });
  try {
    s.copione.push({ scrivi: ["carrello.js", "z\n"], messaggio: "Fatto." }, { messaggio: "NESSUN SUGGERIMENTO" });
    s.engine.impostaFlusso(s.run.id, "sicuro");
    await s.engine.turn(s.run.id, "cambia il carrello");
    await s.fine();
    expect(s.turni.map((t) => [t.provider, t.soloLettura])).toEqual([
      ["codex", false],
      ["claude", true],
    ]);
    expect(s.eventi().at(-1)).toMatchObject({ tipo: "flow.completed" });
    expect(s.domandeGroq).toHaveLength(0);
  } finally {
    await s.engine.shutdown();
  }
});

it("il flusso diretto resta un turno normale, senza esecuzione", async () => {
  const s = await sessione();
  const avvii: string[] = [];
  const originale = s.engine.avviaFlusso.bind(s.engine);
  s.engine.avviaFlusso = ((...a: any[]) => (avvii.push(a[3]), (originale as any)(...a))) as any;
  try {
    await s.engine.turn(s.run.id, "Nota: cambia il titolo");
    expect(avvii).toEqual([]);
    expect(s.engine.run(s.run.id).esecuzione).toBeUndefined();
    expect(s.eventi().find((x) => x.tipo === "user.request")?.testo).toBe("Nota: cambia il titolo");
    await vi.waitFor(() => expect(s.eventi().some((x) => x.tipo === "turn.completed")).toBe(true), { timeout: 8000 });
  } finally {
    await s.engine.shutdown();
  }
});

it("un passo che doveva solo leggere e ha scritto: la copia torna com'era e lo si dice", async () => {
  const s = await sessione();
  try {
    const work = s.engine.run(s.run.id).work;
    // Turno vero (AI simulata) in sola lettura; durante il turno «l'AI» scrive.
    await s.engine.turn(s.run.id, "leggi e basta", { passoFlusso: { soloLettura: true } });
    expect(s.engine.run(s.run.id).passoSoloLettura).toBe(true);
    writeFileSync(join(work, "carrello.js"), "MODIFICATO DA CHI LEGGE\n");
    writeFileSync(join(work, "nuovo.txt"), "nuovo\n");
    await vi.waitFor(() => expect(s.eventi().some((x) => x.tipo === "turn.completed")).toBe(true), { timeout: 8000 });
    const violazione = s.eventi().find((x) => x.tipo === "flow.readonly_violation");
    expect(violazione?.testo).toMatch(/doveva solo leggere ma ha cambiato 2 file .*li ho rimessi com'erano/);
    expect(readFileSync(join(work, "carrello.js"), "utf8")).toBe("export const totale = (r) => r.prezzo;\n");
    expect(existsSync(join(work, "nuovo.txt"))).toBe(false);
    expect(s.engine.run(s.run.id).passoSoloLettura).toBe(false);
  } finally {
    await s.engine.shutdown();
  }
});

it("con un turno vero (AI simulata) la fine del turno fa partire il passo dopo", async () => {
  const s = await sessione();
  s.engine.avviaPassoTurno = Engine.prototype.avviaPassoTurno;
  try {
    s.engine.impostaFlusso(s.run.id, "revisione");
    await s.engine.turn(s.run.id, "cambia qualcosa");
    await vi.waitFor(() => expect(s.eventi().some((x) => x.tipo === "flow.completed" || x.tipo === "flow.stopped")).toBe(true), { timeout: 10000 });
    const tipi = s.eventi().map((x) => x.tipo);
    // Il turno del passo non ripete la richiesta della persona nel registro.
    expect(tipi.filter((t) => t === "user.request")).toHaveLength(1);
    expect(tipi.indexOf("turn.completed")).toBeLessThan(tipi.lastIndexOf("flow.step"));
    // L'AI simulata non cambia i file: chi rivede non ha niente da guardare.
    expect(s.eventi().find((x) => x.tipo === "flow.review")?.testo).toBe("Niente da rivedere: nessuna modifica");
    expect(s.eventi().at(-1)).toMatchObject({ tipo: "flow.completed" });
  } finally {
    await s.engine.shutdown();
  }
});

it("«Approva sempre»: salvato nel flusso, il piano dopo parte da solo; si torna a chiedere togliendolo", async () => {
  const s = await sessione({ risposteGroq: ["NESSUN SUGGERIMENTO", "PRONTO", "NESSUN SUGGERIMENTO", "PRONTO"] });
  try {
    s.copione.push(
      { messaggio: "1. Un piano" },
      { scrivi: ["carrello.js", "a\n"], messaggio: "Fatto." },
      { scrivi: ["carrello.test.js", "t\n"], messaggio: "Test." },
      { messaggio: "1. Un altro piano" },
      { scrivi: ["carrello.js", "b\n"], messaggio: "Fatto." },
      { scrivi: ["carrello.test.js", "u\n"], messaggio: "Test." },
    );
    s.engine.impostaFlusso(s.run.id, "completo");
    await s.engine.turn(s.run.id, "primo lavoro");
    await vi.waitFor(() => expect(s.engine.run(s.run.id).esecuzione?.attesa).toBe("piano"));
    s.engine.rispondiPiano(s.run.id, "sempre");
    await s.fine();
    const { leggiFlussi } = await import("../src/core/flussi.js");
    expect(leggiFlussi(s.engine.store.root).flussi.find((f) => f.id === "completo")?.approvaPiano).toBe(true);
    expect(s.eventi().find((x) => x.tipo === "flow.plan_approved")?.testo).toMatch(/da ora i piani di questo flusso partono da soli/);
    // Il secondo lavoro: il piano compare e si va avanti senza chiedere.
    const prima = s.eventi().length;
    await s.engine.turn(s.run.id, "secondo lavoro");
    await vi.waitFor(() => expect(s.eventi().slice(prima).some((x) => x.tipo === "flow.completed")).toBe(true), { timeout: 5000 });
    const dopo = s.eventi().slice(prima);
    expect(dopo.find((x) => x.tipo === "flow.plan_ready")?.testo).toBe("1. Un altro piano");
    expect(dopo.find((x) => x.tipo === "flow.plan_approved")?.testo).toMatch(/approvato da solo/);
    expect(s.turni).toHaveLength(6);
  } finally {
    await s.engine.shutdown();
  }
});
