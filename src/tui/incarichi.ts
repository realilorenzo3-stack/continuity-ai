// Le AI chiamate con @ nel terminale (27 ottobre): il pannello che si apre
// scrivendo «@», con le AI come in /ai, e il riepilogo «chi fa cosa» da
// confermare prima di partire.
import { descriviIncarico, nomeCorto, problemaIncarichi, type Incarico } from "../core/menzioni.js";
import { providerNoto } from "../core/provider.js";
import { messaggio } from "./cliente.js";
import type { Contesto } from "./comandi.js";
import type { Voce } from "./tipi.js";
import { lingua } from "./lingua.js";

const nomeBreve = (id: string) => id === "ollama" && lingua() === "en" ? "Qwen on your computer" : nomeCorto(id);
const descriviIncaricoUI = (x: Incarico) => lingua() === "en"
  ? `${nomeBreve(x.ai)}: ${x.compito} (${x.tipo === "scrive" ? "does the work" : x.quando === "fine" ? "reviews · once at the end" : "reviews · after each work step"})`
  : descriviIncarico(x);
// Come si scrive l'AI dopo la @: il nome del provider; per Ollama «qwen».
const maniglia = (id: string) => (id === "ollama" ? "qwen" : id);

// Le AI che si possono chiamare: la sequenza, Qwen sul computer e i gratuiti
// collegati, tutte sullo stesso piano (28 ottobre).
export async function scegliAI(c: Contesto, titolo: string): Promise<string | undefined> {
  const sequenza: string[] = c.run().providers ?? ["codex", "claude"];
  const servizi: any[] = await c.api("/gratuiti").catch(() => []);
  const gratuiti = servizi.filter((x) => x.collegato).map((x) => String(x.id));
  const tutte = [...new Set([...sequenza, ...gratuiti, "ollama"])].filter((id) => providerNoto(id));
  const voci: Voce<string>[] = tutte.map((id) => ({
    nome: nomeBreve(id),
    valore: id,
    gruppo: "Le tue AI",
    tasto: "@" + maniglia(id),
  }));
  const v = await c.scegli<string>(titolo, voci, {
    ricerca: true,
    nota: "Scrivi dopo il nome che cosa deve fare, per esempio «@codex occupati del backend». Le AI lavorano una dopo l'altra, nell'ordine in cui le scrivi.",
  });
  return v?.valore;
}

// Il nome da mettere nel campo dopo la @ scelta nel pannello.
export function testoMenzione(id: string): string {
  return maniglia(id) + " ";
}

// Il riepilogo «chi fa cosa»: si parte, si cambia un incarico (chi, se
// lavora o controlla, quando controlla), si toglie; «Parti sempre senza
// chiedere» lo salta d'ora in poi. undefined = annullato.
export async function confermaIncarichi(c: Contesto, iniziali: Incarico[]): Promise<Incarico[] | undefined> {
  let incarichi = iniziali.map((x) => ({ ...x }));
  for (;;) {
    const v = await c.scegli<string>(
      "Chi fa cosa",
      [
        { nome: "▸ Parti", valore: "parti", gruppo: "In ordine, una dopo l'altra" },
        ...incarichi.map((x, i) => ({
          nome: `${i + 1}. ${nomeBreve(x.ai)}: ${x.compito}`,
          valore: "i:" + i,
          gruppo: "In ordine, una dopo l'altra",
          tasto: x.tipo === "scrive" ? "lavora" : x.quando === "fine" ? "controlla alla fine" : "controlla",
        })),
        { nome: "Parti sempre senza chiedere", valore: "sempre", gruppo: "Altro", tasto: "/flusso per tornare" },
      ],
      {
        nota:
           incarichi.map((x, i) => `${i + 1}. ${descriviIncaricoUI(x)}`).join("\n") +
           (lingua() === "en" ? "\n\nThe reviewer checks the work and can request fixes up to twice. Enter edits an AI; esc cancels and returns your message to the input." : "\n\nChi controlla rivede e fa correggere fino a 2 volte. Invio su un'AI per cambiarla; esc annulla e il messaggio torna nel campo."),
      },
    );
    if (!v) return undefined;
    if (v.valore === "parti" || v.valore === "sempre") {
      const problema = problemaIncarichi(incarichi);
      if (problema) {
        c.avvisa("avviso", `Chi fa cosa: ${problema}`, 7000);
        continue;
      }
      if (v.valore === "sempre") {
        try {
          const config = await c.api("/flussi");
          await c.api("/flussi", { ...config, confermaIncarichi: false });
          c.avvisa("ok", "D'ora in poi le AI chiamate con @ partono subito (/flusso per tornare a chiedere)", 6000);
        } catch (e) {
          c.avvisa("errore", messaggio(e), 6000);
        }
      }
      return incarichi;
    }
    const i = Number(v.valore.slice(2));
    const x = incarichi[i];
    const a = await c.scegli<string>(
      `${nomeBreve(x.ai)}: ${x.compito}`,
      [
        { nome: "Fa il lavoro", valore: "scrive", attuale: x.tipo === "scrive" },
        { nome: "Ricontrolla", valore: "legge", attuale: x.tipo === "legge" },
        ...(x.tipo === "legge"
          ? [
              { nome: "Ricontrolla dopo ogni pezzo di lavoro", valore: "ogni", attuale: x.quando !== "fine" },
              { nome: "Ricontrolla una volta alla fine", valore: "fine", attuale: x.quando === "fine" },
            ]
          : []),
        { nome: "Cambia AI…", valore: "ai" },
        ...(incarichi.length > 1 ? [{ nome: "Togli", valore: "togli" }] : []),
      ],
    );
    if (!a) continue;
    if (a.valore === "scrive") incarichi[i] = { ai: x.ai, compito: x.compito, tipo: "scrive" };
    else if (a.valore === "legge") incarichi[i] = { ...x, tipo: "legge", quando: x.quando ?? "ogni" };
    else if (a.valore === "ogni" || a.valore === "fine") incarichi[i] = { ...x, quando: a.valore };
    else if (a.valore === "togli") incarichi = incarichi.filter((_, j) => j !== i);
    else if (a.valore === "ai") {
      const nuova = await scegliAI(c, `Chi fa «${x.compito}»`);
      if (!nuova) continue;
      incarichi[i] = { ...x, ai: nuova };
    }
  }
}
