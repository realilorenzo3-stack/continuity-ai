import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cartellaDatiPredefinita } from "../piattaforma.js";
// I colori della nuova interfaccia, propri di Continuity (mai quelli del tema
// di opencode), organizzati per ruoli come in opencode: fondo, fondo
// rialzato per campo, messaggi e dialoghi, testo, testo tenue, accento.
// Due varianti, scura e chiara.
const SCURO = {
  // Tre gradini di fondo, come in opencode (fondo, pannello, elemento), con
  // il fondo dipinto su ogni cella: lo schermo resta uguale su ogni terminale
  // (confronto REA del 14 ottobre, docs/rea/confronto-interfaccia.md A1).
  fondo: "#0f1115",
  fondoMessaggio: "#171a20",
  testo: "#e8e6e3",
  tenue: "#8d9099",
  bordo: "#3a3f4b",
  accento: "#e8a75c",
  persona: "#7aa7e8",
  bene: "#74c69d",
  avviso: "#e9c46a",
  errore: "#ef6f6c",
  // L'elemento: campo e scheda in alto.
  rialzato: "#1f232b",
  // Dialoghi e avvisi: il gradino del pannello.
  pannello: "#171a20",
  // La voce scelta in un elenco: accento pieno, testo nel colore del fondo.
  scelta: "#e8a75c",
  testoSuScelta: "#0f1115",
  // Nomi storici, usati dai dialoghi.
  fondoDialogo: "#171a20",
  fondoScelta: "#e8a75c",
};
const CHIARO: typeof SCURO = {
  fondo: "#ffffff",
  fondoMessaggio: "#f3f4f6",
  testo: "#1f2328",
  tenue: "#646a73",
  bordo: "#cfd4dc",
  accento: "#b0661a",
  persona: "#2f6fcf",
  bene: "#23804f",
  avviso: "#9a6a00",
  errore: "#c0352f",
  rialzato: "#e9ecf0",
  pannello: "#f3f4f6",
  scelta: "#b0661a",
  testoSuScelta: "#ffffff",
  fondoDialogo: "#f3f4f6",
  fondoScelta: "#b0661a",
};

// Il tema si sceglie all'avvio: CONTINUITY_TEMA, oppure la scelta salvata con
// «/tema» nella cartella dati (interfaccia.json). Senza scelta, scuro.
export function temaScelto(): "chiaro" | "scuro" {
  const env = process.env.CONTINUITY_TEMA;
  if (env === "chiaro" || env === "scuro") return env;
  try {
    const cartella = cartellaDatiPredefinita();
    const salvato = JSON.parse(readFileSync(join(cartella, "interfaccia.json"), "utf8"));
    if (salvato?.tema === "chiaro" || salvato?.tema === "scuro") return salvato.tema;
  } catch {}
  return "scuro";
}

export const tema: typeof SCURO = temaScelto() === "chiaro" ? CHIARO : SCURO;

// Ogni AI col suo colore: la barra del campo, i messaggi e la riga di fine
// turno lo riprendono, come gli agenti di opencode.
const COLORI: Record<string, string> = {
  codex: "#6cc4a4",
  openai: "#6cc4a4",
  claude: "#e39a6b",
  anthropic: "#e39a6b",
  openrouter: "#b49cf0",
  deepseek: "#6fa8f0",
  kimi: "#f0a6c8",
  zai: "#8fd0e0",
  ollama: "#b69cff",
  qwen: "#b69cff",
  lmstudio: "#c7b2f0",
};
export function coloreAI(nome?: string) {
  // Con il nome vuoto (AI non ancora nota all'apertura) «"" ?? …» restava
  // vuoto e OpenTUI ripiegava sul magenta.
  return (nome ? COLORI[nome] : undefined) ?? "#9fb7d9";
}

// Lo stile del Markdown nelle risposte. In OpenTUI 0.6.4 appartiene alla scena
// nativa del renderer (SyntaxStyle.create vuole un «proprietario» delle
// risorse): uno solo per renderer.
import { SyntaxStyle, RGBA } from "@opentui/core";
const stili = new WeakMap<object, SyntaxStyle>();
const SINTASSI =
  temaScelto() === "chiaro"
    ? { parola: "#8a3fb8", funzione: "#1f6fbf", tipo: "#a35a00", stringa: "#2f7d32", numero: "#b0661a", operatore: "#5a6270", proprieta: "#0f7c8c" }
    : { parola: "#c79bf2", funzione: "#7fb6f5", tipo: "#e9c46a", stringa: "#9fd28a", numero: "#f2a96b", operatore: "#a0a6b2", proprieta: "#7fd3d9" };
export function stileMarkdown(renderer: any): SyntaxStyle {
  const scena = renderer?.nativeScene ?? renderer;
  let stile = stili.get(scena);
  if (!stile) {
    const c = (x: string) => RGBA.fromHex(x);
    stile = SyntaxStyle.fromStyles(
      {
        default: { fg: c(tema.testo) },
        "markup.heading": { fg: c(tema.accento), bold: true },
        "markup.heading.1": { fg: c(tema.accento), bold: true, underline: true },
        "markup.strong": { fg: c(tema.testo), bold: true },
        "markup.italic": { fg: c(tema.testo), italic: true },
        "markup.strikethrough": { fg: c(tema.tenue) },
        "markup.raw": { fg: c("#c8b68e") },
        "markup.link": { fg: c(tema.persona), underline: true },
        "markup.link.label": { fg: c(tema.persona) },
        "markup.link.url": { fg: c(tema.tenue) },
        "markup.list": { fg: c(tema.accento) },
        "markup.quote": { fg: c(tema.tenue), italic: true },
        "markup.raw.block": { fg: c(tema.testo) },
        // La sintassi nei blocchi di codice, con i colori di Continuity.
        keyword: { fg: c(SINTASSI.parola) },
        "keyword.function": { fg: c(SINTASSI.parola) },
        function: { fg: c(SINTASSI.funzione) },
        "function.method": { fg: c(SINTASSI.funzione) },
        type: { fg: c(SINTASSI.tipo) },
        string: { fg: c(SINTASSI.stringa) },
        number: { fg: c(SINTASSI.numero) },
        boolean: { fg: c(SINTASSI.numero) },
        comment: { fg: c(tema.tenue), italic: true },
        operator: { fg: c(SINTASSI.operatore) },
        variable: { fg: c(tema.testo) },
        property: { fg: c(SINTASSI.proprieta) },
        punctuation: { fg: c(tema.tenue) },
        "punctuation.bracket": { fg: c(tema.tenue) },
        constant: { fg: c(SINTASSI.numero) },
        tag: { fg: c(SINTASSI.parola) },
        attribute: { fg: c(SINTASSI.proprieta) },
      },
      scena,
    );
    stili.set(scena, stile);
  }
  return stile;
}
