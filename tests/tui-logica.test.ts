import { it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applicaEventi,
  nuovaConversazione,
  segnapostoIncolla,
  unaRiga,
  type Evento,
} from "../src/tui/conversazione.js";
import { dopoIlTurno, pubblica, testoConsegna } from "../src/tui/cliente.js";
import { eseguiComando, stato, type Contesto } from "../src/tui/comandi.js";
import { impostaLingua, leggiLingua, lingua, traduci } from "../src/tui/lingua.js";
import { configPredefinita } from "../src/core/ibrida.js";
import { flussiPredefiniti } from "../src/core/flussi.js";

const ev = (seq: number, type: string, message = "", extra: Partial<Evento> = {}): Evento => ({
  seq,
  type,
  payload: { message },
  recordedAt: new Date(Date.UTC(2026, 9, 14, 10, 0, seq)).toISOString(),
  ...extra,
});

// Una cartella temporanea per le preferenze di lingua dei test.
const DATI_LINGUA = mkdtempSync(join(tmpdir(), "continuity-lingua-"));

it("la conversazione nasce dagli eventi, ognuno col suo tipo", () => {
  const s = applicaEventi(nuovaConversazione(), [
    ev(1, "user.request", "Correggi il test"),
    ev(2, "turn.started"),
    ev(3, "attempt.started", "codex reale avviato"),
    ev(4, "agent.action", "  ↳ legge src/a.ts", { source: "codex" }),
    ev(5, "agent.action", "delega all'agente revisore"),
    ev(6, "agent.message", "Fatto.", { source: "codex" }),
    ev(7, "usage.reported", "1.200 token in ingresso · 300 in uscita"),
    ev(8, "verification.completed", "2/2 criteri verificati · test:ok build:ok"),
    ev(9, "turn.completed", "Turno 1 concluso da codex · 1 file"),
  ]);
  expect(s.elementi.map((e) => e.tipo)).toEqual([
    "richiesta",
    "lavoro",
    "azione",
    "azione",
    "messaggio",
    "verifica",
    "fineTurno",
  ]);
  expect(s.elementi[1]).toEqual({ tipo: "lavoro", ai: "codex" });
  expect(s.elementi[2]).toMatchObject({ testo: "legge src/a.ts", delega: false });
  expect(s.elementi[3]).toMatchObject({ delega: true });
  expect(s.elementi[5]).toMatchObject({ esito: "ok" });
  expect(s.elementi[6]).toMatchObject({
    durata: "7s",
    consumo: "1.200 in · 300 out",
    esito: "ok",
  });
  expect(s.ultimoSeq).toBe(9);
});

it("eventi ripetuti o vecchi non duplicano la conversazione", () => {
  const a = applicaEventi(nuovaConversazione(), [ev(1, "user.request", "x")]);
  const b = applicaEventi(a, [ev(1, "user.request", "x"), ev(2, "user.request", "y")]);
  expect(b.elementi).toHaveLength(2);
  expect(applicaEventi(b, [ev(2, "user.request", "y")])).toBe(b);
});

it("quota, credito, errori e passaggi: ognuno visibile, l'errore su una riga", () => {
  const s = applicaEventi(nuovaConversazione(), [
    ev(1, "agent.reported", "You've hit your usage limit, try again at 11:24 PM"),
    ev(2, "switch.started", "Quota del provider esaurita · passaggio a claude"),
    ev(3, "agent.error", "Errore lungo\nseconda riga\nterza"),
    ev(4, "provider.credit", "anthropic ha finito il credito"),
    ev(5, "verification.completed", "1/2 criteri verificati"),
    ev(6, "turn.blocked", "Tutti i provider sono senza crediti"),
  ]);
  expect(s.elementi.map((e) => e.tipo)).toEqual([
    "avviso",
    "passaggio",
    "errore",
    "avviso",
    "verifica",
    "fineTurno",
  ]);
  expect((s.elementi[2] as any).testo).toBe("Errore lungo");
  expect((s.elementi[4] as any).esito).toBe("ko");
  expect((s.elementi[5] as any).esito).toBe("fermo");
  expect(unaRiga("a".repeat(500), 10)).toHaveLength(10);
  expect(segnapostoIncolla("una riga")).toBeUndefined();
  expect(segnapostoIncolla("1\n2\n3")).toBe("[Incollate ~3 righe]");
});

// Un servizio finto: registra le chiamate e risponde come quello vero.
function servizio(risposte: Record<string, any>) {
  const chiamate: { percorso: string; corpo?: any }[] = [];
  const api = async (percorso: string, corpo?: unknown) => {
    chiamate.push({ percorso, corpo });
    const chiave = Object.keys(risposte).find((k) => percorso.startsWith(k));
    const r = chiave ? risposte[chiave] : {};
    if (r instanceof Error) throw r;
    return typeof r === "function" ? r(corpo, chiamate) : r;
  };
  return { api, chiamate };
}

it("dopo il turno: consegna nella cartella e, se attiva, pubblicazione automatica", async () => {
  const s = servizio({
    "/runs/x/changed": { files: ["a.ts"] },
    "/runs/x/apply": { applicati: ["a.ts"] },
    "/runs/x/github": { automatica: true, destinazione: "io/sito" },
    "/runs/x/pubblica": (corpo: any) =>
      corpo?.conferma
        ? { ramo: "main", url: "https://github.com/io/sito" }
        : {
            destinazione: "io/sito",
            aggiunti: [],
            modificati: ["a.ts"],
            eliminati: [],
            sospetti: [],
            esclusi: [],
            piano: "p1",
          },
  });
  const esiti = await dopoIlTurno(s.api, "x");
  // Prima il riepilogo delle modifiche, poi la consegna e la pubblicazione.
  expect(esiti[0]).toMatchObject({ tipo: "modifiche", testo: "1 file" });
  expect(esiti[1]).toMatchObject({ tipo: "ok" });
  expect(esiti[1].testo).toContain("nella tua cartella: a.ts");
  expect(esiti[2].testo).toMatch(/Pubblicato su io\/sito \(main\): 1 modificato/);
});

it("la pubblicazione automatica si ferma da sola su eliminazioni o segreti", async () => {
  const s = servizio({
    "/runs/x/pubblica": {
      destinazione: "io/sito",
      aggiunti: [],
      modificati: [],
      eliminati: ["vecchio.html"],
      sospetti: [],
      esclusi: [],
      piano: "p",
    },
  });
  const esiti = await pubblica(s.api, "x", { automatica: true });
  expect(esiti[0]).toMatchObject({ tipo: "avviso" });
  expect(esiti[0].testo).toMatch(/sospesa: su GitHub verrebbero eliminati 1 file/);
  expect(s.chiamate.some((c) => c.corpo?.conferma)).toBe(false);
  expect(testoConsegna({ messaggio: "Nessuna modifica" })).toBe("Nessuna modifica");
});

function contesto(api: any, run: any = {}): Contesto & { avvisi: string[]; locali: any[] } {
  const avvisi: string[] = [];
  const locali: any[] = [];
  return {
    api,
    id: "x",
    cartellaDati: "/tmp/nessuna",
    run: () => run,
    inTurno: () => false,
    avvisa: (_t, testo) => void avvisi.push(testo),
    aggiungiLocale: (e) => void locali.push(...e),
    aggiorna: async () => {},
    esci: () => void avvisi.push("ESCI"),
    ricaricaIbrida: async () => {},
    scegli: async () => undefined,
    chiedi: async () => undefined,
    avvisi,
    locali,
  };
}

it("i comandi: con la barra, senza barra se inequivocabili, il resto va all'AI", async () => {
  const s = servizio({ "/runs/x/providers": { providers: ["claude", "codex"] } });
  const c = contesto(s.api, { providers: ["codex", "claude"] });
  expect(await eseguiComando("/ordine claude", c)).toBe(true);
  expect(s.chiamate[0]).toEqual({
    percorso: "/runs/x/providers",
    corpo: { richiesta: "claude" },
  });
  expect(c.avvisi[0]).toMatch(/claude → codex/);
  expect(await eseguiComando("ordine codex", c)).toBe(true);
  expect(await eseguiComando("Correggi il bug del carrello", c)).toBe(false);
  expect(await eseguiComando("ordine alfabetico dei file", c)).toBe(false);
  expect(await eseguiComando("/inesistente", c)).toBe(true);
  expect(c.avvisi.at(-1)).toMatch(/Comando sconosciuto/);
  expect(await eseguiComando("/esci", c)).toBe(true);
  expect(c.avvisi.at(-1)).toBe("ESCI");
});

it("un comando che fallisce lo dice, senza far cadere l'interfaccia", async () => {
  const s = servizio({ "/runs/x/providers": new Error("AI non supportata: gemini") });
  const c = contesto(s.api, { providers: ["codex"] });
  expect(await eseguiComando("/ordine gemini", c)).toBe(true);
  expect(c.avvisi[0]).toBe("AI non supportata: gemini");
});

it("/language cambia la preferenza e gli alias inglesi eseguono i comandi", async () => {
  const cartellaDati = mkdtempSync(join(tmpdir(), "continuity-lingua-"));
  const s = servizio({ "/runs/x/providers": { providers: ["claude", "codex"] } });
  const c = contesto(s.api, { providers: ["codex", "claude"] });
  c.cartellaDati = cartellaDati;
  expect(await eseguiComando("/language english", c)).toBe(true);
  expect(lingua()).toBe("en");
  expect(leggiLingua(cartellaDati)).toBe("en");
  expect(await eseguiComando("/order claude", c)).toBe(true);
  expect(s.chiamate.at(-1)).toMatchObject({ percorso: "/runs/x/providers" });
  impostaLingua(cartellaDati, "it");
});

it("la lingua inglese localizza anche le voci dei pannelli avanzati", () => {
  impostaLingua(DATI_LINGUA, "en");
  expect(traduci("Suggerimenti per il prossimo turno")).toBe("Suggestions for the next turn");
  expect(traduci("Collega un'AI")).toBe("Connect an AI");
  expect(traduci("Passo 2 di 3")).toBe("Step 2 of 3");
  // Le frasi del motore dentro i messaggi composti (28 ottobre).
  expect(traduci("Nessuna verifica di Continuity: controlla tu il risultato")).toBe("No Continuity checks: review the result yourself");
  expect(traduci("Flusso «Chi fa cosa» fermato: NVIDIA build · x non è riuscito (Turno interrotto · y): il lavoro fatto finora resta nella copia")).toBe(
    "Workflow ‘Who does what’ stopped: NVIDIA build · x failed (Turn interrupted · y): work so far remains in the working copy",
  );
  expect(traduci("Passo 1 di 4 · NVIDIA build · x · NVIDIA build (gratuito)")).toBe("Step 1 of 4 · NVIDIA build · x · NVIDIA build (free)");
  impostaLingua(DATI_LINGUA, "it");
});

it("l'inglese conserva nomi e contenuti, ma traduce consegna, pubblicazione e flussi predefiniti", async () => {
  const dati = DATI_LINGUA;
  impostaLingua(dati, "en");
  try {
    expect(traduci("Passo 2 di 3")).toBe("Step 2 of 3");
    expect(traduci("Flusso «Revisione personalizzata»")).toBe("Workflow ‘Revisione personalizzata’");
    expect(traduci("Lavora e ricontrolla")).toBe("Work and review");
    expect(traduci("Il mio file chiave.ts resta qui")).toBe("Il mio file chiave.ts resta qui");
    expect(traduci("File portati nella cartella: chiave.ts")).toBe("Files delivered to your folder: chiave.ts");
    expect(traduci("Flusso «Lavora e ricontrolla»: Scrive (la sequenza) → Rivede (un gratuito)"))
      .toBe("Workflow ‘Work and review’: Write (the AI sequence) → Review (a free provider)");
    expect(traduci("Passo 2 di 3 · Rivede · un gratuito"))
      .toBe("Step 2 of 3 · Review · a free provider");
    expect(traduci("Tutti i provider sono senza crediti in questo turno."))
      .toBe("All providers are out of credit for this turn.");
    const s = servizio({
      "/runs/x/changed": { files: ["chiave.ts"] },
      "/runs/x/apply": { applicati: ["chiave.ts"] },
      "/runs/x/github": { automatica: true, destinazione: "io/sito" },
      "/runs/x/pubblica": (corpo: any) => corpo?.conferma
        ? { ramo: "main" }
        : { destinazione: "io/sito", aggiunti: ["chiave.ts"], modificati: [], eliminati: [], sospetti: [], esclusi: [], piano: "p" },
    });
    const esiti = await dopoIlTurno(s.api, "x");
    expect(esiti[1].testo).toContain("in your folder: chiave.ts · /undo to revert");
    expect(esiti[2].testo).toContain("Published to io/sito (main): 1 new file");
    expect(stato({ agent: "codex", providers: ["codex"], turnNumber: 2, switches: 1 })[0].testo).toContain("2 turns · 1 switch due to exhausted credits");
  } finally {
    impostaLingua(dati, "it");
  }
});

it("i pannelli workflow e hybrid mostrano titoli, opzioni e descrizioni predefinite in inglese", async () => {
  const dati = DATI_LINGUA;
  impostaLingua(dati, "en");
  const pannelli: { titolo: string; voci: string[]; nota: string }[] = [];
  const c = contesto(async (path: string) => {
    if (path === "/flussi") return flussiPredefiniti();
    if (path === "/ibrida?verifica=1") return { config: configPredefinita(), ollama: { acceso: true, versione: "1.0" } };
    return {};
  }, { providers: ["codex", "claude"], flusso: "diretto" });
  c.scegli = async (titolo, voci, opzioni) => {
    pannelli.push({ titolo: traduci(titolo)!, voci: voci.map((v) => traduci(v.nome)!), nota: traduci(opzioni?.nota) ?? "" });
    return undefined;
  };
  try {
    await eseguiComando("/workflow", c);
    await eseguiComando("/hybrid", c);
    expect(pannelli[0].titolo).toBe("How AIs work");
    expect(pannelli[0].voci).toContain("Work and review");
    expect(pannelli[0].voci).toContain("Plan, work and review");
    expect(pannelli[0].nota).toContain("The selected workflow applies to every message");
    expect(pannelli[1].titolo).toBe("Hybrid AI");
    expect(pannelli[1].voci).toContain("Backup: takes over when credits run out");
    expect(pannelli[1].voci).toContain("On demand, with shift+tab");
  } finally {
    impostaLingua(dati, "it");
  }
});

it("/chiudi chiede conferma; senza «s» non chiude", async () => {
  const s = servizio({});
  const c = contesto(s.api);
  await eseguiComando("/chiudi", c);
  expect(s.chiamate).toHaveLength(0);
  c.chiedi = async () => "s";
  await eseguiComando("/chiudi", c);
  expect(s.chiamate[0].percorso).toBe("/runs/x/close");
  expect(c.avvisi.at(-1)).toBe("ESCI");
});

it("/stato: consumi per provider, costi, crediti e verifiche", () => {
  const righe = stato({
    agent: "anthropic",
    turnNumber: 3,
    providers: ["anthropic", "codex"],
    consumi: {
      anthropic: { entrata: 1000, uscita: 10, cache: 0, costo: 0.5 },
      codex: { entrata: 5, uscita: 1, cache: 0 },
    },
    esauriti: { openai: { credito: true } },
    checks: [{ id: "test", passed: true }],
  }).map((r) => r.testo);
  expect(righe[0]).toMatch(/anthropic · 3 turni/);
  expect(righe[1]).toMatch(/circa 0,50 \$/);
  expect(righe[2]).toMatch(/nell'abbonamento/);
  expect(righe[3]).toMatch(/openai: credito esaurito/);
  expect(righe[4]).toBe("✓ test");
});

it("/pubblica a mano: prima consegna il lavoro rimasto, dopo la prima volta chiede dell'automatica", async () => {
  const s = servizio({
    "/runs/x/changed": { files: ["b.ts"] },
    "/runs/x/apply": { applicati: ["b.ts"] },
    "/runs/x/github": {},
    "/runs/x/pubblica": (corpo: any) =>
      corpo?.conferma
        ? { ramo: "main" }
        : {
            destinazione: "io/sito",
            aggiunti: ["b.ts"],
            modificati: [],
            eliminati: [],
            sospetti: [],
            esclusi: [],
            piano: "p",
          },
  });
  const domande: string[] = [];
  const esiti = await pubblica(s.api, "x", {
    chiedi: async (d) => {
      domande.push(d);
      return "s";
    },
  });
  const percorsi = s.chiamate.map((c) => c.percorso);
  expect(percorsi.indexOf("/runs/x/apply")).toBeLessThan(percorsi.indexOf("/runs/x/pubblica"));
  expect(esiti.map((e) => e.testo).join(" | ")).toMatch(/Pubblicato su io\/sito/);
  expect(domande[0]).toMatch(/Pubblico da solo su GitHub/);
  expect(s.chiamate.at(-1)).toEqual({ percorso: "/runs/x/github", corpo: { automatica: true } });
});

it("un turno interrotto si chiude con la sua riga, con chi lavorava", () => {
  const s = applicaEventi(nuovaConversazione(), [
    ev(1, "user.request", "Lavora"),
    ev(2, "turn.started"),
    ev(3, "attempt.started", "claude reale avviato"),
    ev(9, "run.paused", "In pausa — lavoro salvato"),
  ]);
  expect(s.elementi.at(-1)).toMatchObject({
    tipo: "fineTurno",
    testo: "interrotto",
    ai: "claude",
    esito: "fermo",
    durata: "7s",
  });
});
