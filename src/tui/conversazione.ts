// La conversazione della nuova interfaccia, dagli eventi del servizio: le
// stesse regole della ristampa a righe (src/cli/storico.ts), ma in elementi
// con un tipo, che lo schermo disegna ciascuno a modo suo. Niente colori qui:
// è logica pura, provata con i test.
import { lingua } from "./lingua.js";

export type Elemento =
  // «locale»: mostrata subito all'invio, in attesa dell'evento del registro.
  | { tipo: "richiesta"; testo: string; locale?: boolean; verso?: string }
  | { tipo: "lavoro"; ai: string }
  | { tipo: "azione"; testo: string; delega: boolean; ai?: string }
  | { tipo: "messaggio"; testo: string; ai?: string }
  | { tipo: "pensiero"; testo: string; ai?: string }
  | { tipo: "passaggio"; testo: string }
  | { tipo: "ripresa"; testo: string }
  | { tipo: "verifica"; testo: string; esito: "ok" | "ko" | "nessuna" }
  | {
      tipo: "fineTurno";
      testo: string;
      // Chi ha lavorato per ultimo nel turno, per la riga «Codex · 30s».
      ai?: string;
      durata: string;
      consumo: string;
      esito: "ok" | "fermo";
    }
  | { tipo: "consegna"; testo: string; esito: "ok" | "avviso" | "annullata" }
  | { tipo: "pubblicazione"; testo: string }
  | {
      tipo: "modifiche";
      testo: string;
      file: { nome: string; piu: number; meno: number }[];
    }
  | { tipo: "avviso"; testo: string }
  | { tipo: "errore"; testo: string }
  | { tipo: "info"; testo: string }
  // I suggerimenti del revisore (Fase 2): chi li ha scritti e l'elenco.
  | { tipo: "revisione"; da: string; suggerimenti: string[] }
  // Un blocco di un flusso (Fase 3): il piano, la revisione, la verifica
  // finale, la risposta di un passo. «esito» colora la verifica finale.
  | { tipo: "flusso"; titolo: string; da?: string; righe: string[]; nota?: string; esito?: boolean };

export type Evento = {
  seq: number;
  type: string;
  recordedAt?: string;
  source?: string;
  payload?: { message?: string };
};

export type StatoConversazione = {
  elementi: Elemento[];
  inizioTurno?: string;
  consumo: string;
  ultimoSeq: number;
  ultimaAI?: string;
};

export function nuovaConversazione(): StatoConversazione {
  return { elementi: [], consumo: "", ultimoSeq: 0 };
}

export function durata(da?: string, a?: string) {
  if (!da || !a) return "";
  const s = Math.max(0, Math.round((Date.parse(a) - Date.parse(da)) / 1000));
  return s < 60
    ? `${s}s`
    : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}`;
}

// Applica eventi nuovi (in qualunque ordine, anche ripetuti): restituisce uno
// stato nuovo, senza toccare il precedente.
export function applicaEventi(
  stato: StatoConversazione,
  eventi: Evento[],
): StatoConversazione {
  const nuovi = eventi
    .filter((e) => e.seq > stato.ultimoSeq)
    .sort((a, b) => a.seq - b.seq);
  if (!nuovi.length) return stato;
  const elementi = [...stato.elementi];
  let { inizioTurno, consumo, ultimaAI } = stato;
  const metti = (x: Elemento) => elementi.push(x);
  for (const e of nuovi) {
    let testo = String(e.payload?.message ?? "").trim();
    switch (e.type) {
      case "user.request": {
        // Il messaggio mostrato subito all'invio lascia il posto a questo.
        const provvisoria = elementi.findIndex(
          (x) => x.tipo === "richiesta" && x.locale && x.testo.trim() === testo,
        );
        if (provvisoria >= 0) elementi.splice(provvisoria, 1);
        metti({ tipo: "richiesta", testo });
        break;
      }
      case "turn.started":
        inizioTurno = e.recordedAt;
        consumo = "";
        break;
      case "attempt.started": {
        const ai = testo.split(" ")[0];
        if (ai) {
          ultimaAI = ai;
          metti({ tipo: "lavoro", ai });
        }
        break;
      }
      case "agent.action":
        testo = testo.replace(/\s*\n\s*/g, " ").replace(/^\s*↳\s*/, "");
        metti({
          tipo: "azione",
          testo,
          delega: testo.startsWith("delega"),
          ai: e.source,
        });
        break;
      case "agent.message":
        if (testo) metti({ tipo: "messaggio", testo, ai: e.source });
        break;
      // L'AI ibrida: i compiti del modello locale, fuori dai turni.
      case "local.request": {
        // Il provvisorio porta ancora la parola del compito («#spiega …»).
        let ultimo = -1;
        elementi.forEach((x, i) => {
          if (x.tipo === "richiesta" && x.locale) ultimo = i;
        });
        if (ultimo >= 0) elementi.splice(ultimo, 1);
        metti({ tipo: "richiesta", testo, verso: "AI ibrida" });
        break;
      }
      // Un modello che risponde soltanto, scelto con /ai (25 ottobre).
      case "direct.request": {
        let ultimo = -1;
        elementi.forEach((x, i) => {
          if (x.tipo === "richiesta" && x.locale) ultimo = i;
        });
        if (ultimo >= 0) elementi.splice(ultimo, 1);
        metti({ tipo: "richiesta", testo, verso: e.source });
        break;
      }
      case "direct.message":
      case "local.message":
        metti({ tipo: "messaggio", testo, ai: e.source });
        break;
      case "direct.failed":
      case "local.failed":
        metti({ tipo: "errore", testo: unaRiga(testo) });
        break;
      case "agent.thinking":
        if (testo) metti({ tipo: "pensiero", testo, ai: e.source });
        break;
      case "agent.error":
        if (testo) metti({ tipo: "errore", testo: unaRiga(testo) });
        break;
      case "switch.started":
        metti({ tipo: "passaggio", testo });
        break;
      case "resume.started":
        metti({ tipo: "ripresa", testo });
        break;
      case "usage.reported":
        consumo = testo
          .replace(" token in ingresso", " in")
          .replace(" in uscita", " out");
        break;
      case "verification.completed": {
        if (testo.startsWith("Stato salvato per il passaggio")) {
          metti({ tipo: "info", testo });
          break;
        }
        const quanti = testo.match(/^(\d+)\/(\d+) criteri/);
        metti({
          tipo: "verifica",
          testo,
          esito: testo.includes("Nessuna verifica")
            ? "nessuna"
            : quanti && quanti[1] === quanti[2]
              ? "ok"
              : "ko",
        });
        break;
      }
      case "turn.completed":
      case "turn.failed":
      case "turn.blocked":
        metti({
          tipo: "fineTurno",
          testo,
          durata: durata(inizioTurno, e.recordedAt),
          consumo,
          ai: ultimaAI,
          esito: e.type === "turn.completed" ? "ok" : "fermo",
        });
        break;
      case "work.applied":
        metti({ tipo: "consegna", testo: riassumiFile(testo), esito: "ok" });
        break;
      case "work.conflict":
      case "work.apply_failed":
        metti({ tipo: "consegna", testo, esito: "avviso" });
        break;
      case "work.undone":
        metti({ tipo: "consegna", testo, esito: "annullata" });
        break;
      case "publish.completed":
        metti({ tipo: "pubblicazione", testo });
        break;
      // Un turno interrotto si chiude con la sua riga, come in opencode
      // («Codex · modello · 12s · interrotto»).
      case "run.paused":
        metti({
          tipo: "fineTurno",
          testo: "interrotto",
          durata: durata(inizioTurno, e.recordedAt),
          consumo,
          ai: ultimaAI,
          esito: "fermo",
        });
        break;
      case "engine.warning":
      case "turn.silent":
      case "provider.credit":
      case "permission.requested":
      case "permission.denied":
      case "permission.blocked":
        metti({ tipo: "avviso", testo });
        break;
      // Un permesso dato: una riga sua. Prima il caso non aveva il suo
      // «break» e finiva nel revisore («Revisore · Nessun suggerimento» a ogni
      // comando consentito, collaudo su Windows del 31 ottobre).
      case "permission.granted":
        metti({ tipo: "info", testo: "✓ " + testo });
        break;
      // Il revisore (Fase 2).
      case "review.completed": {
        // Il revisore che corregge da solo (28 ottobre): le correzioni fatte.
        if (testo.startsWith("Corretto da ")) {
          const righe = testo.split("\n");
          metti({
            tipo: "flusso",
            titolo: "Correzioni",
            da: e.source,
            righe: righe.filter((r) => r.startsWith("• ")).map((r, i) => `${i + 1}. ${r.slice(2).trim()}`),
            nota: "Già fatte nella copia di lavoro",
          });
          break;
        }
        const voci = testo
          .split("\n")
          .filter((r) => r.startsWith("• "))
          .map((r) => r.slice(2).trim());
        metti({ tipo: "revisione", da: e.source ?? "revisore", suggerimenti: voci });
        break;
      }
      case "review.started":
      case "review.queued":
      case "review.sent":
      case "review.marked":
      case "review.settings":
        metti({ tipo: "info", testo: "◇ " + testo });
        break;
      case "review.failed":
      case "review.consent_needed":
        metti({ tipo: "avviso", testo });
        break;
      case "responder.changed":
      case "sequence.changed":
      case "model.changed":
      case "reasoning.changed":
      case "connectors.updated":
      case "work.synced":
      case "provider.reconnected":
      case "provider.waiting":
        metti({ tipo: "info", testo });
        break;
      // I flussi (Fase 3).
      case "flow.started":
        metti({ tipo: "info", testo: "▸ " + testo });
        break;
      case "flow.step":
        metti({ tipo: "info", testo: "◆ " + testo });
        break;
      case "flow.plan_ready":
        metti({
          tipo: "flusso",
          titolo: "Piano",
          da: e.source,
          righe: testo.split("\n").filter((r) => r.trim()),
          nota: "Aspetta il tuo sì: approvalo, chiedi di cambiarlo o annullalo",
        });
        break;
      case "flow.plan_approved":
        metti({ tipo: "info", testo: "✓ Piano approvato" });
        break;
      case "flow.plan_change":
        metti({ tipo: "info", testo: "✎ Il piano si rifà: " + unaRiga(testo) });
        break;
      case "flow.review":
        if (testo.startsWith("• "))
          metti({
            tipo: "flusso",
            titolo: "Revisione",
            da: e.source,
            righe: testo
              .split("\n")
              .filter((r) => r.startsWith("• "))
              .map((r, i) => `${i + 1}. ${r.slice(2).trim()}`),
          });
        else metti({ tipo: "info", testo: `◇ Revisione${e.source && e.source !== "continuity" ? " · " + e.source : ""}: ${testo}` });
        break;
      case "flow.correction":
        metti({ tipo: "info", testo: "↺ " + testo });
        break;
      case "flow.verdict": {
        const righe = testo.split("\n").filter((r) => r.trim());
        const pronto = /\bPRONTO\b/i.test(righe[0] ?? "") && !/\bNON\s+PRONTO\b/i.test(righe[0] ?? "");
        metti({ tipo: "flusso", titolo: "Verifica finale", da: e.source, righe, esito: pronto });
        break;
      }
      case "flow.output":
        metti({ tipo: "flusso", titolo: "Risposta", da: e.source, righe: testo.split("\n").filter((r) => r.trim()) });
        break;
      case "flow.completed":
      case "flow.changed":
        // Concluso con problemi rimasti: si vede come avviso.
        if (/concluso con problemi/.test(testo)) metti({ tipo: "avviso", testo });
        else metti({ tipo: "info", testo: "■ " + testo });
        break;
      case "flow.stopped":
      case "flow.readonly_violation":
      case "flow.consent_needed":
        metti({ tipo: "avviso", testo });
        break;
      case "agent.reported":
        // I provider la dicono in inglese («usage limit», «credit balance»).
        if (/quota|crediti|credito|limite|limit|credit/i.test(testo))
          metti({ tipo: "avviso", testo: unaRiga(testo) });
        break;
    }
  }
  return {
    elementi,
    inizioTurno,
    consumo,
    ultimaAI,
    // reduce, non Math.max(...): con decine di migliaia di eventi lo spread
    // supera il limite degli argomenti di V8.
    ultimoSeq: nuovi.reduce((m, e) => Math.max(m, e.seq), stato.ultimoSeq),
  };
}

// Un errore su più righe rompeva l'impaginazione (segnalazione dell'11
// ottobre): a schermo la prima riga, il resto nel dettaglio.
export function unaRiga(testo: string, massimo = 240) {
  const prima = testo.split("\n").find((r) => r.trim()) ?? "";
  return prima.length > massimo ? prima.slice(0, massimo - 1) + "…" : prima;
}

// Un testo incollato lungo resta compatto nel campo, come in opencode: il
// segnaposto dice quante righe, il testo vero parte all'invio.
export function segnapostoIncolla(testo: string) {
  const righe = testo.split("\n").length;
  return righe >= 3 || testo.length > 150
    ? (lingua() === "en" ? `[Pasted ~${righe} lines]` : `[Incollate ~${righe} righe]`)
    : undefined;
}

// «File portati nella cartella: a, b, c, …» con decine di file usciva dallo
// schermo (prova di Lorenzo del 14 ottobre): oltre 8 file, il numero, i primi
// nomi e dove vedere il resto.
export function riassumiFile(testo: string, massimo = 8) {
  const m = /^([^:]+):\s*(.+)$/s.exec(testo);
  if (!m) return testo;
  const nomi = m[2].split(/,\s*/).filter(Boolean);
  if (nomi.length <= massimo) return testo;
  return `${m[1]}: ${nomi.length} file (${nomi.slice(0, 3).join(", ")}, …) · /file per l'elenco`;
}
