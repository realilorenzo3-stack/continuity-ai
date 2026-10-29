// Le AI chiamate con @ nel messaggio (decisioni di Lorenzo del 27 ottobre):
// «Crea un sito web completo. @codex occupati del backend. @groq fai una
// revisione alla fine di ogni modifica». Ogni @ è un incarico: chi, che cosa,
// se fa il lavoro o ricontrolla, e per chi ricontrolla quando. Con gli
// incarichi Continuity costruisce un flusso al volo: le AI lavorano una dopo
// l'altra, nell'ordine scritto; chi controlla rivede dopo ogni pezzo di
// lavoro (di serie) oppure una volta alla fine, se il messaggio lo dice.
import {
  GIRI_PREDEFINITI,
  type Flusso,
  type Passo,
  type Ruolo,
} from "./flussi.js";
import { PROVIDER, providerNoto, type ProviderNoto } from "./provider.js";

export type Incarico = {
  // L'id del provider («codex», «groq», «ollama»…).
  ai: string;
  // Che cosa deve fare, come l'ha scritto la persona.
  compito: string;
  tipo: "scrive" | "legge";
  // Solo per chi controlla: dopo ogni pezzo di lavoro o una volta alla fine.
  quando?: "ogni" | "fine";
};

// «@codex», «@Claude», «@qwen»: solo all'inizio o dopo uno spazio o una
// punteggiatura, così un indirizzo email («anna@esempio.it») non conta.
const MENZIONE = /(^|[\s(,;:.!?])@([\p{L}\p{N}][\p{L}\p{N}._-]*)/gu;

// Le parole che dicono «controlla, non scrivere».
const CONTROLLA = /\b(rivedi|rivede|revision[ei]|ricontroll\w*|controll\w*|verific\w*|analizz\w*|valut\w*|review\w*|check\w*|verif(y|ies)|inspect\w*|audit\w*|esamin\w*|cerca (gli |eventuali )?errori|look for (bugs|errors))\b/i;
// «alla fine di tutto», «solo alla fine», «una volta alla fine», «alla fine del
// lavoro»: una revisione sola. «alla fine di ogni modifica», «dopo ogni …»:
// dopo ogni pezzo.
const UNA_VOLTA = /\b(alla fine di tutto|solo alla fine|una (sola )?volta alla fine|alla fine del lavoro|quando (tutti|tutte le ai) hanno finito|alla fine|(only |once )?at the end( of everything| of the work)?|when (everyone|all( the)? ais?) (is|are|has|have) (done|finished))\b(?!\s+(di\s+ogni|of\s+(each|every)))/i;
// Un compito che comincia con un verbo di scrittura scrive, anche se poi
// nomina un controllo («crea audit.txt», «scrivi un test che verifica…»).
// «fai» non c'è: «fai una revisione» è un controllo (ottavo collaudo, CT-2.0-701).
const SCRIVE_ALL_INIZIO =
  /^(?:(?:per favore|please)[,\s]+)?(?:crea\w*|scriv\w*|riscriv\w*|modific\w*|aggiung\w*|costruisc\w*|costruir\w*|gener\w*|implement\w*|sistem\w*|corregg\w*|aggiorn\w*|cambi\w*|traduc\w*|spost\w*|rinomin\w*|elimin\w*|togli\w*|create|write|rewrite|add|build|make|fix|update|change|generate|edit|translate|move|rename|delete|remove)\b/i;
// Nomi di file, identificatori e testi fra virgolette non sono istruzioni:
// «result.txt contenente AUDIT_OK» non chiede un audit.
export function senzaNomiDiFile(compito: string) {
  return compito
    // Non gli apostrofi: «l'analisi dell'app» resta com'è.
    .replace(/«[^»]*»|"[^"]*"|`[^`]*`/g, " ")
    .replace(/\S*[._/\\]\S*/g, " ")
    .replace(/\S*\d\S*/g, " ");
}
export function tipoDelCompito(compito: string): "scrive" | "legge" {
  if (SCRIVE_ALL_INIZIO.test(compito.trim())) return "scrive";
  return CONTROLLA.test(senzaNomiDiFile(compito)) ? "legge" : "scrive";
}
const OGNI = /\b(dopo ogni|alla fine di ogni|a ogni|ad ogni|per ogni|after (each|every)|at the end of (each|every)|for (each|every))\s+(modifica|pezzo|passo|parte|cambiamento|turno|change|piece|step|part|turn|edit)/i;

// Il nome da mostrare: «Groq (gratuito)» → «Groq»; «Codex · abbonamento
// ChatGPT» → «Codex». Chi gira attraverso Codex o Claude Code si chiama con la
// seconda parte («Codex · OpenRouter …» → «OpenRouter»); Ollama è Qwen sul Mac.
export function nomeCorto(id: string): string {
  if (id === "ollama") return "Qwen sul Mac";
  const parti = (providerNoto(id)?.nome ?? id).split(" · ");
  const scelta = id !== "codex" && id !== "claude" && /^(Codex|Claude Code)$/.test(parti[0]) && parti[1] ? parti[1] : parti[0];
  return scelta.replace(/\s*\(.*\)\s*$/, "").trim();
}

// I nomi che si possono scrivere dopo la @, dal più lungo.
function nomiDiMenzione(): string[] {
  const nomi = new Set<string>(["qwen"]);
  for (const p of PROVIDER) {
    nomi.add(p.id.toLowerCase());
    for (const a of p.alias ?? []) nomi.add(String(a).toLowerCase());
  }
  return [...nomi].filter((n) => /^[a-z]+$/.test(n)).sort((a, b) => b.length - a.length);
}

// Il provider di una menzione, se Continuity lo conosce.
export function aiMenzionata(nome: string): ProviderNoto | undefined {
  const n = nome.toLowerCase().replace(/[._-]+$/, "");
  return providerNoto(n);
}

// Il messaggio diviso: la parte comune (prima della prima @) e gli incarichi,
// nell'ordine in cui sono scritti. Il compito di un'AI va dalla sua @ alla @
// successiva. Le @ sconosciute restano testo.
export function incarichiDalMessaggio(testo: string): { comune: string; incarichi: Incarico[] } {
  const trovate: { inizio: number; fine: number; p: ProviderNoto }[] = [];
  for (const m of testo.matchAll(MENZIONE)) {
    const inizio = (m.index ?? 0) + m[1].length;
    const p = aiMenzionata(m[2]);
    if (p) {
      trovate.push({ inizio, fine: inizio + 1 + m[2].length, p });
      continue;
    }
    // Lo spazio dimenticato dopo il nome: «@codexaggiungi una sezione» è
    // Codex con il compito «aggiungi una sezione» (28 ottobre). Solo con un
    // nome di almeno 4 lettere seguito da almeno 3 lettere.
    const attaccato = nomiDiMenzione().find((n) => n.length >= 4 && m[2].toLowerCase().startsWith(n) && /^[a-zàèéìòù]{3,}$/i.test(m[2].slice(n.length)));
    const q = attaccato && aiMenzionata(attaccato);
    if (q) trovate.push({ inizio, fine: inizio + 1 + attaccato!.length, p: q });
  }
  if (!trovate.length) return { comune: testo.trim(), incarichi: [] };
  const comune = testo.slice(0, trovate[0].inizio).trim();
  const incarichi = trovate.map((t, i) => {
    const compito = testo
      .slice(t.fine, trovate[i + 1]?.inizio ?? testo.length)
      .trim()
      .replace(/^[,:;.\-–—\s]+/, "")
      .replace(/[,;\s]+$/, "")
      // «@groq occupati della revisione e @codex …»: la congiunzione prima
      // della @ seguente non fa parte del compito.
      .replace(/(?:[,;\s]+(?:e|ed|poi|and|then))+$/i, "")
      .trim();
    // Tutte le AI lavorano sui file (28 ottobre): controlla chi ha un
    // compito di controllo, lo dicono le parole.
    const tipo: Incarico["tipo"] = tipoDelCompito(compito);
    return {
      ai: t.p.id,
      compito: compito || (tipo === "legge" ? "Rivedi il lavoro" : "Fai la tua parte del lavoro"),
      tipo,
      ...(tipo === "legge" ? { quando: OGNI.test(compito) ? "ogni" : UNA_VOLTA.test(compito) ? "fine" : "ogni" } : {}),
    } satisfies Incarico;
  });
  return { comune, incarichi };
}

// Un problema degli incarichi (scelti o corretti dalla persona), o undefined.
export function problemaIncarichi(incarichi: Incarico[]): string | undefined {
  if (!incarichi.length) return "nessuna AI chiamata con @";
  if (incarichi.length > 8) return "al massimo 8 AI in un messaggio";
  for (const x of incarichi) {
    const p = providerNoto(x.ai);
    if (!p) return `non conosco @${x.ai}`;
    if (!x.compito.trim() || x.compito.length > 4000) return `il compito di @${x.ai} è vuoto o troppo lungo`;
  }
  return undefined;
}

// Il flusso al volo. Chi lavora va in ordine; chi controlla «ogni» rivede
// dopo ciascuno di loro e fa correggere a chi ha appena lavorato; chi
// controlla «fine» rivede una volta, in fondo. Senza nessuno che lavora, chi
// controlla risponde con un testo (non ha niente da far correggere).
export function flussoDaIncarichi(incarichi: Incarico[]): { flusso: Flusso; ruoli: Ruolo[]; soloUnTurno?: Incarico } {
  const chiLavora = incarichi.filter((x) => x.tipo === "scrive");
  const chiControlla = incarichi.filter((x) => x.tipo === "legge");
  const nome = (x: Incarico) => nomeCorto(x.ai);
  const altri = (x: Incarico) =>
    incarichi
      .filter((y) => y !== x)
      .map((y) => `${nome(y)}: ${y.compito}`)
      .join("; ");
  const ruoli: Ruolo[] = incarichi.map((x, i) => ({
    id: `incarico-${i + 1}`,
    nome: `${nome(x)} · ${x.compito.length > 40 ? x.compito.slice(0, 39) + "…" : x.compito}`,
    tipo: x.tipo,
    esito: x.tipo === "scrive" ? "lavoro" : chiLavora.length ? "suggerimenti" : "testo",
    istruzioni:
      `Il tuo compito in questo lavoro: ${x.compito}.` +
      (altri(x) ? ` Le altre parti le fanno altre AI (${altri(x)}): fai solo la tua.` : "") +
      (x.tipo === "scrive" ? " Alla fine di' in breve che cosa hai fatto." : ""),
  }));
  const ruoloDi = (x: Incarico) => ruoli[incarichi.indexOf(x)];
  const passo = (x: Incarico): Passo => ({ ruolo: ruoloDi(x).id, ai: x.ai });
  const passi: Passo[] = [];
  for (const x of chiLavora) {
    passi.push(passo(x));
    for (const c of chiControlla) if (c.quando !== "fine") passi.push(passo(c));
  }
  for (const c of chiControlla) if (c.quando === "fine" || !chiLavora.length) passi.push(passo(c));
  return {
    flusso: {
      id: "menzioni",
      nome: "Chi fa cosa",
      descrizione: "Le AI chiamate con @ nel messaggio",
      passi,
      giri: GIRI_PREDEFINITI,
    },
    ruoli,
    // Una sola AI che lavora e nessuno che controlla: un turno normale.
    ...(incarichi.length === 1 && chiLavora.length === 1 ? { soloUnTurno: chiLavora[0] } : {}),
  };
}

// Il riepilogo in parole, per la persona.
export function descriviIncarico(x: Incarico): string {
  const chi = nomeCorto(x.ai);
  const come = x.tipo === "scrive" ? "fa il lavoro" : x.quando === "fine" ? "ricontrolla · una volta alla fine" : "ricontrolla · dopo ogni pezzo di lavoro";
  return `${chi}: ${x.compito} (${come})`;
}
