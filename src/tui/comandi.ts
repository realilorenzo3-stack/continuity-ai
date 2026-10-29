// I comandi della nuova interfaccia: gli stessi del terminale a righe, con i
// dialoghi al posto delle domande scritte. Ogni comando chiama il servizio con
// le stesse rotte di src/cli/session.ts, così il motore non cambia.
import type { Accessor } from "solid-js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lavoraSuiFile, PROVIDER, providerNoto } from "../core/provider.js";
import { portachiaviDiSistema } from "../core/portachiavi.js";
import { dollari } from "../core/modelsdev.js";
import {
  comandoSenzaBarra,
  intentoAutomatica,
  intentoPubblica,
} from "../cli/session.js";
import { normalizzaComando } from "../cli/comandi.js";
import { gruppoDi } from "../cli/collega.js";
import { provaCollegamento } from "../core/collega.js";
import { segnaCollegato } from "../core/collegati.js";
import { parole, scegliDalFinder } from "./allegati.js";
import type { Compito, ConfigIbrida } from "../core/ibrida.js";
import {
  ISTRUZIONI_REVISORE,
  descriviOgniTurni,
  rivedeConUnTurno,
  revisorePredefinito,
  sceltaRevisore,
  serveConsenso,
  type ConfigRevisore,
} from "../core/revisore.js";
import { messaggio, pubblica, testoConsegna, type Api, type Esito } from "./cliente.js";
import type { Voce } from "./tipi.js";
import { pannelloFlusso } from "./flusso.js";
import { configurazione } from "./configura.js";
import { impostaLingua, lingua, traduci, type Lingua } from "./lingua.js";

export type Contesto = {
  api: Api;
  id: string;
  cartellaDati: string;
  run: Accessor<any>;
  inTurno: Accessor<boolean>;
  avvisa: (tipo: "info" | "ok" | "avviso" | "errore", testo: string, ms?: number) => void;
  aggiungiLocale: (esiti: Esito[]) => void;
  aggiorna: () => Promise<void>;
  esci: () => void;
  ricaricaIbrida: () => Promise<void>;
  scegli: <T>(
    titolo: string,
    voci: Voce<T>[],
    opzioni?: { ricerca?: boolean; nota?: string; testo?: string },
  ) => Promise<Voce<T> | undefined>;
  // Lascia il terminale a un programma (il login ufficiale di Codex o Claude
  // Code) e poi torna all'interfaccia.
  nelTerminale?: (comando: string, argomenti: string[], ambiente: NodeJS.ProcessEnv, cartella: string) => Promise<void>;
  chiedi: (
    titolo: string,
    // link: la pagina che ctrl+o apre nel browser; errore: il tentativo
    // precedente, mostrato in rosso nello stesso riquadro.
    opzioni?: { testo?: string; nascosta?: boolean; link?: string; errore?: string },
  ) => Promise<string | undefined>;
};

// Il menu dei comandi (ctrl+p): azioni con un nome, in gruppi, e il comando
// con la barra a destra, come in opencode (docs/rea/confronto-interfaccia.md A3).
export const COMANDI_TUI: {
  nome: string;
  breve: string;
  titolo: string;
  gruppo: string;
}[] = [
  // Organizzati con Lorenzo il 25 ottobre: quattro gruppi, in quest'ordine.
  // /gratuiti e /ragionamento funzionano ancora ma non sono più nel menu: lo
  // fanno /ai, /collega e /modello.
  { nome: "/ai", breve: "scegli chi risponde (resta finché non la cambi)", titolo: "Scegli chi risponde", gruppo: "Le AI" },
  { nome: "/collega", breve: "aggiungi un'AI: abbonamento, chiave gratuita o a consumo", titolo: "Aggiungi un'AI", gruppo: "Le AI" },
  { nome: "/modello", breve: "modello e ragionamento dell'AI", titolo: "Modello e ragionamento", gruppo: "Le AI" },
  { nome: "/ibrida", breve: "il modello sul tuo Mac", titolo: "Il modello sul tuo Mac", gruppo: "Le AI" },
  { nome: "/revisore", breve: "l'AI che rivede il lavoro e suggerisce", titolo: "Il revisore", gruppo: "Le AI" },
  { nome: "/flusso", breve: "come lavorano le AI: da sola, con un controllo, con un piano", titolo: "Come lavorano le AI", gruppo: "Le AI" },
  { nome: "/connettori", breve: "accendi e spegni i connettori", titolo: "Connettori", gruppo: "Le AI" },
  { nome: "/allega", breve: "aggiungi un file al messaggio", titolo: "Allega un file", gruppo: "Il lavoro" },
  { nome: "/file", breve: "file cambiati in questa sessione", titolo: "File cambiati", gruppo: "Il lavoro" },
  { nome: "/applica", breve: "porta il lavoro nella tua cartella", titolo: "Porta il lavoro nella cartella", gruppo: "Il lavoro" },
  { nome: "/annulla", breve: "rimetti com'era", titolo: "Annulla l'ultima consegna", gruppo: "Il lavoro" },
  { nome: "/pubblica", breve: "pubblica su GitHub", titolo: "Pubblica su GitHub", gruppo: "Il lavoro" },
  { nome: "/stato", breve: "consumi, turni e verifiche", titolo: "Stato della sessione", gruppo: "La sessione" },
  { nome: "/chiudi", breve: "chiudi la sessione", titolo: "Chiudi la sessione", gruppo: "La sessione" },
  { nome: "/esci", breve: "esci (la sessione resta)", titolo: "Esci (la sessione resta)", gruppo: "La sessione" },
  { nome: "/tema", breve: "chiaro o scuro", titolo: "Tema chiaro o scuro", gruppo: "Altro" },
  { nome: "/linguaggio", breve: "italiano o inglese", titolo: "Lingua", gruppo: "Altro" },
  { nome: "/configura", breve: "rifai la configurazione iniziale", titolo: "Configurazione", gruppo: "Altro" },
  { nome: "/aiuto", breve: "tutti i comandi", titolo: "Aiuto", gruppo: "Altro" },
];

export function vociMenu(): Voce<string>[] {
  const inglese = lingua() === "en";
  const tradotti: Record<string, [string, string, string, string]> = {
    "/ai": ["Choose who responds", "choose who responds until you change it", "AI", "/ai"],
    "/collega": ["Add an AI", "add a subscription, free or paid API key", "AI", "/connect"],
    "/modello": ["Model and reasoning", "model and reasoning level", "AI", "/model"],
    "/ibrida": ["AI on your Mac", "the local model on your Mac", "AI", "/hybrid"],
    "/revisore": ["Reviewer", "the AI that reviews work and suggests changes", "AI", "/reviewer"],
    "/flusso": ["How AIs work", "solo work, review, or plan", "AI", "/workflow"],
    "/connettori": ["Connectors", "turn connectors on or off", "AI", "/connectors"],
    "/allega": ["Attach a file", "attach a file to the message", "Work", "/attach"],
    "/file": ["Changed files", "files changed in this session", "Work", "/files"],
    "/applica": ["Apply work to your folder", "bring the work into your folder", "Work", "/apply"],
    "/annulla": ["Undo last delivery", "restore the previous version", "Work", "/undo"],
    "/pubblica": ["Publish to GitHub", "publish your work to GitHub", "Work", "/publish"],
    "/stato": ["Session status", "usage, turns, and checks", "Session", "/status"],
    "/chiudi": ["Close session", "close this session", "Session", "/close"],
    "/esci": ["Exit", "exit and keep the session", "Session", "/exit"],
    "/tema": ["Theme", "light or dark", "Other", "/theme"],
    "/linguaggio": ["Language", "switch between Italian and English", "Other", "/language"],
    "/configura": ["Setup", "run the first-time setup again", "Other", "/setup"],
    "/aiuto": ["Help", "all commands", "Other", "/help"],
  };
  return COMANDI_TUI.map((x) => {
    const t = tradotti[x.nome];
    return {
      nome: inglese && t ? t[0] : x.titolo,
      descrizione: inglese && t ? t[1] : x.breve,
      valore: inglese && t ? t[3] : x.nome,
      gruppo: inglese && t ? t[2] : x.gruppo,
      tasto: inglese && t ? t[3] : x.nome,
    };
  });
}

const sì = (r?: string) => /^(s|si|sì|y|yes)$/i.test(r?.trim() ?? "");

// true se il testo era un comando (eseguito qui), false se va all'AI.
export async function eseguiComando(testo: string, c: Contesto): Promise<boolean> {
  let t = normalizzaComando(testo.trim());
  const automatica = intentoAutomatica(t);
  if (automatica !== undefined) {
    await c.api(`/runs/${c.id}/github`, { automatica }).then(
      () => c.avvisa("ok", `Pubblicazione automatica ${automatica ? "attiva" : "disattivata"}`),
      (e) => c.avvisa("errore", messaggio(e)),
    );
    return true;
  }
  const pubblicazione = !t.startsWith("/") ? intentoPubblica(t) : undefined;
  if (pubblicazione) t = "/pubblica " + (pubblicazione.destinazione ?? "");
  if (!t.startsWith("/")) {
    const comando = comandoSenzaBarra(t);
    if (comando === t) return false;
    t = comando;
  }
  const [nome, ...resto] = t.split(/\s+/);
  const argomento = resto.join(" ").trim();
  const fallito = (e: unknown) => c.avvisa("errore", messaggio(e));
  try {
    switch (nome.toLowerCase()) {
      case "/aiuto": {
        const v = await c.scegli("Comandi", vociMenu(), {
          ricerca: true,
          nota: "ctrl+p comandi · esc esc interrompe · ctrl+c ctrl+c esce · shift+invio va a capo",
        });
        if (v) await eseguiComando(v.valore, c);
        return true;
      }
      case "/esci":
        c.esci();
        return true;
      case "/chiudi": {
        if (!argomento.includes("forza")) {
          const r = await c.chiedi("Chiudere la sessione?", {
            testo: "La prossima volta si riparte da zero. Scrivi «s» per confermare.",
          });
          if (!sì(r)) return true;
        }
        await c.api(`/runs/${c.id}/close`, argomento.includes("forza") ? { forza: true } : {});
        c.esci();
        return true;
      }
      case "/ordine":
        await ordine(c, argomento);
        return true;
      case "/ibrida":
        await pannelloIbrida(c);
        return true;
      case "/modello":
        await modello(c, argomento);
        return true;
      case "/ragionamento":
        await ragionamento(c, argomento);
        return true;
      case "/collega":
        await collegaProvider(c, argomento);
        return true;
      case "/ai":
        await pannelloAI(c, argomento);
        return true;
      case "/revisore":
        await pannelloRevisore(c);
        return true;
      case "/flusso":
      case "/flussi":
        await pannelloFlusso(c, argomento);
        return true;
      case "/gratuiti":
        await pannelloGratuiti(c, argomento);
        return true;
      case "/connettori":
        await connettori(c);
        return true;
      case "/allega": {
        // Senza percorso si apre la finestra del Finder; i percorsi si possono
        // anche trascinare dal Finder direttamente nel campo.
        const percorsi = argomento ? parole(argomento) : await scegliDalFinder();
        if (!percorsi.length) return true;
        for (const percorso of percorsi) {
          await c.api(`/runs/${c.id}/attachments`, { path: percorso });
          c.avvisa("ok", `Allegato: ${percorso.split("/").pop()}`);
        }
        await c.aggiorna();
        return true;
      }
      case "/annulla": {
        const esito = await c.api(`/runs/${c.id}/undo`, argomento === "forza" ? { forza: true } : {});
        c.aggiungiLocale([
          {
            tipo: "info",
            testo:
              `Rimesso com'era: ${(esito.ripristinati ?? []).join(", ") || "niente da annullare"}` +
              (esito.ripristinati?.length ? " · /applica lo rimette" : "") +
              (esito.conservati ? ` · le versioni sostituite sono in ${esito.conservati}` : ""),
          },
        ]);
        return true;
      }
      case "/applica": {
        const esito = await c.api(`/runs/${c.id}/apply`, argomento === "forza" ? { forza: true } : {});
        c.aggiungiLocale([{ tipo: "ok", testo: testoConsegna(esito) }]);
        return true;
      }
      case "/pubblica": {
        if (c.inTurno()) {
          c.avvisa("avviso", "Pubblico alla fine del turno: ora un'AI sta lavorando");
          return true;
        }
        const auto = /^automatic[ao]\b\s*(.*)$/i.exec(argomento);
        if (auto) {
          const valore = /^(sì|si|s|on|attiva)/i.test(auto[1])
            ? true
            : /^(no|n|off|disattiva)/i.test(auto[1])
              ? false
              : undefined;
          if (valore === undefined) {
            const g = await c.api(`/runs/${c.id}/github`).catch(() => ({}));
            c.avvisa("info", `Pubblicazione automatica: ${g.automatica ? "attiva" : "non attiva"}${g.destinazione ? " · " + g.destinazione : ""}`);
          } else await eseguiComando(valore ? "attiva la pubblicazione automatica" : "disattiva la pubblicazione automatica", c);
          return true;
        }
        c.avvisa("info", "Pubblico su GitHub…", 3000);
        const esiti = await pubblica(c.api, c.id, {
          destinazione: argomento || undefined,
          chiedi: (domanda) => c.chiedi("Pubblicazione", { testo: domanda }),
        });
        c.aggiungiLocale(esiti);
        return true;
      }
      case "/file": {
        const r = c.run();
        const inAttesa: string[] = await c.api(`/runs/${c.id}/changed`).then((x: any) => x.files ?? [], () => []);
        const righe: Esito[] = [];
        if (r.consegnati?.length) righe.push({ tipo: "info", testo: "Già nella tua cartella: " + r.consegnati.join(", ") });
        if (r.eliminatiConsegnati?.length) righe.push({ tipo: "info", testo: "Eliminati dalla tua cartella: " + r.eliminatiConsegnati.join(", ") });
        if (inAttesa.length) righe.push({ tipo: "info", testo: "In attesa di consegna: " + inAttesa.join(", ") });
        if (!righe.length) righe.push({ tipo: "info", testo: "Nessun file modificato finora" });
        c.aggiungiLocale(righe);
        return true;
      }
      case "/tema": {
        let scelta = argomento.toLowerCase();
        if (scelta !== "chiaro" && scelta !== "scuro") {
          const v = await c.scegli("Tema", [
            { nome: "scuro", valore: "scuro" },
            { nome: "chiaro", valore: "chiaro" },
          ]);
          if (!v) return true;
          scelta = v.valore;
        }
        const file = join(c.cartellaDati, "interfaccia.json");
        let attuale: any = {};
        try {
          attuale = JSON.parse(readFileSync(file, "utf8"));
        } catch {}
        writeFileSync(file, JSON.stringify({ ...attuale, tema: scelta }, null, 2) + "\n");
        c.avvisa("ok", `Tema ${scelta}: vale dalla prossima apertura di Continuity`, 6000);
        return true;
      }
      case "/configura":
        await configurazione(c);
        return true;
      case "/linguaggio": {
        const richiesta = argomento.toLowerCase();
        let scelta: Lingua | undefined = richiesta as Lingua;
        if (richiesta === "italiano") scelta = "it";
        if (richiesta === "english" || richiesta === "inglese") scelta = "en";
        if (scelta !== "it" && scelta !== "en") {
          const v = await c.scegli<Lingua>(lingua() === "en" ? "Language" : "Lingua", [
            { nome: "Italiano", valore: "it", attuale: lingua() === "it" },
            { nome: "English", valore: "en", attuale: lingua() === "en" },
          ]);
          if (!v) return true;
          scelta = v.valore;
        }
        impostaLingua(c.cartellaDati, scelta);
        c.avvisa("ok", scelta === "en" ? "Language changed to English" : "Lingua cambiata in italiano", 4000);
        return true;
      }
      case "/stato":
        // Lo stato fresco: subito dopo l'apertura quello in memoria può
        // non essere ancora arrivato.
        c.aggiungiLocale(stato(await c.api(`/runs/${c.id}`).catch(() => c.run())));
        return true;
      default:
        c.avvisa("avviso", `Comando sconosciuto: ${nome}. ctrl+p per l'elenco`);
        return true;
    }
  } catch (e) {
    fallito(e);
    return true;
  }
}

export function stato(r: any): Esito[] {
  const fuori: Esito[] = [];
  const en = lingua() === "en";
  const numero = (n: number) => Number(n).toLocaleString(en ? "en-US" : "it-IT");
  fuori.push({
    tipo: "info",
    testo: en ? `${r.prossimo ?? r.agent} · ${r.turnNumber ?? 0} ${(r.turnNumber ?? 0) === 1 ? "turn" : "turns"} · ${r.switches ?? 0} ${(r.switches ?? 0) === 1 ? "switch" : "switches"} due to exhausted credits · sequence ${(r.providers ?? []).join(" → ")}` : `${r.prossimo ?? r.agent} · ${r.turnNumber ?? 0} turni · ${r.switches ?? 0} passaggi per crediti esauriti · sequenza ${(r.providers ?? []).join(" → ")}`,
  });
  for (const [p, v] of Object.entries<any>(r.consumi ?? {})) {
    const accesso = providerNoto(p)?.accesso;
    fuori.push({
      tipo: "info",
      testo:
        `${p}: ${numero(v.entrata)} in · ${numero(v.uscita)} out` +
        (v.cache ? ` · ${numero(v.cache)} ${en ? "cached" : "dalla cache"}` : "") +
        (v.costo !== undefined
          ? ` · ${en ? "about" : "circa"} ${dollari(v.costo)}`
          : accesso === "abbonamento"
            ? en ? " · included in subscription" : " · nell'abbonamento"
            : accesso === "locale"
              ? en ? " · free" : " · gratuito"
              : en ? " · cost not estimated" : " · costo non stimato"),
    });
  }
  for (const [p, v] of Object.entries<any>(r.esauriti ?? {}))
    fuori.push({
      tipo: "avviso",
      testo: v.credito
        ? en ? `${p}: out of credit · top up, then /order ${p}` : `${p}: credito esaurito · ricarica, poi /ordine ${p}`
        : en ? `${p}: usage limit reached · returns at ${new Date(v.riprendi).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}` : `${p}: quota esaurita · torna alle ${new Date(v.riprendi).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`,
    });
  for (const k of r.checks ?? [])
    fuori.push({ tipo: k.passed ? "ok" : "avviso", testo: `${k.passed ? "✓" : "✗"} ${k.label ?? k.id}` });
  return fuori;
}

// /ordine: con un argomento le regole brevi (nuovaSequenza); senza, si sceglie
// dall'elenco chi va in testa, o si scrive un ordine nuovo.
// Da /flusso («La sequenza»), e scritto a mano: /ordine non è più nel menu.
export async function ordine(c: Contesto, argomento: string) {
  let richiesta = argomento;
  if (!richiesta) {
    // La sequenza si sceglie a mano, un'AI alla volta: la prima, la seconda…
    // (decisione di Lorenzo del 29 ottobre: niente più «chi va in testa»).
    const en = lingua() === "en";
    const sequenza: string[] = c.run().providers ?? [];
    const disponibili = [
      ...sequenza,
      ...PROVIDER.filter((p) => !sequenza.includes(p.id) && lavoraSuiFile(p)).map((p) => p.id),
    ];
    const nomeDi = (id: string) => providerNoto(id)?.nome ?? id;
    const breve = (id: string) => nomeDi(id).split(" · ")[0].replace(/\s*\(.*\)$/, "");
    const scelti: string[] = [];
    for (;;) {
      const resto = disponibili.filter((p) => !scelti.includes(p));
      if (!resto.length) break;
      const n = scelti.length + 1;
      const voci: Voce<string>[] = [
        ...resto.map((p) => ({
          nome: nomeDi(p),
          valore: p,
          gruppo: en ? `AI number ${n}` : `${n}ª AI`,
          tasto: sequenza.includes(p) ? (en ? `now ${sequenza.indexOf(p) + 1}ª` : `ora ${sequenza.indexOf(p) + 1}ª`) : undefined,
        })),
        ...(scelti.length
          ? [
              { nome: en ? "✓ Confirm this sequence" : "✓ Conferma questa sequenza", valore: "\u0000fine", gruppo: en ? "Done" : "Fatto" },
              { nome: en ? "Start over" : "Ricomincia", valore: "\u0000capo", gruppo: en ? "Done" : "Fatto" },
            ]
          : []),
      ];
      const v = await c.scegli(en ? "Choose the AI work sequence" : "Scegli la sequenza di lavoro delle AI", voci, {
        nota: scelti.length
          ? en
            ? `So far: ${scelti.map(breve).join(" → ")}. Choose AI number ${n}, or confirm.`
            : `Finora: ${scelti.map(breve).join(" → ")}. Scegli la ${n}ª AI, oppure conferma.`
          : en
            ? `Choose which AI works first: when it runs out of credit, the work moves to the second, and so on. Now: ${sequenza.map(breve).join(" → ") || "none"}.`
            : `Scegli quale AI lavora per prima: quando finisce i crediti, il lavoro passa alla seconda, e così via. Ora: ${sequenza.map(breve).join(" → ") || "nessuna"}.`,
      });
      // esc: la sequenza resta com'era.
      if (!v) return;
      if (v.valore === "\u0000fine") break;
      if (v.valore === "\u0000capo") {
        scelti.length = 0;
        continue;
      }
      scelti.push(v.valore);
    }
    if (!scelti.length) return;
    richiesta = `solo ${scelti.join(" ")}`;
  }
  const r = await c.api(`/runs/${c.id}/providers`, { richiesta });
  c.avvisa("ok", `Sequenza: ${(r.providers ?? []).join(" → ")} · vale dal prossimo messaggio`);
  await c.aggiorna();
}

async function sceltaProvider(c: Contesto, titolo: string) {
  const sequenza: string[] = c.run().providers ?? [];
  const v = await c.scegli(
    titolo,
    sequenza.map((p) => ({ nome: providerNoto(p)?.nome ?? p, valore: p, tasto: p })),
  );
  return v?.valore;
}

async function modello(c: Contesto, argomento: string) {
  // Risponde un modello gratuito: si cambia il suo modello.
  const risponde = c.run().risponde as { provider: string; modello: string } | undefined;
  if (!argomento.trim() && risponde) {
    let elenco: { id: string; nome: string }[] = [];
    try {
      elenco = await c.api(`/gratuiti/${risponde.provider}/modelli`);
    } catch (e) {
      return c.avvisa("errore", messaggio(e), 8000);
    }
    const v = await c.scegli<string>(
      `Modelli gratuiti di ${providerNoto(risponde.provider)?.nome ?? risponde.provider}`,
      elenco.map((m) => ({ nome: m.nome, valore: m.id, attuale: m.id === risponde.modello, tasto: m.id === risponde.modello ? "● in uso" : undefined })),
      { ricerca: true },
    );
    if (!v) return;
    await c.api(`/runs/${c.id}/risponde`, { provider: risponde.provider, modello: v.valore });
    c.avvisa("ok", `Da ora risponde ${v.valore}`, 4000);
    return c.aggiorna();
  }
  const parti = argomento.split(/\s+/).filter(Boolean);
  let provider = parti[0] && providerNoto(parti[0]) ? providerNoto(parti.shift()!)!.id : "";
  let scelta = parti.join(" ");
  if (!scelta) {
    if (!provider) provider = (await sceltaProvider(c, "Modello di quale AI?")) ?? "";
    if (!provider) return;
    const elenco: { nome: string; descrizione?: string }[] =
      (await c.api(`/modelli`).catch(() => ({})))[provider] ?? [];
    const attuale = (c.run().modelli ?? {})[provider];
    const voci: Voce<string>[] = [
      { nome: "Predefinito del CLI", valore: "", attuale: !attuale },
      ...elenco.map((m) => ({
        nome: m.nome,
        descrizione: m.descrizione,
        tasto: m.descrizione?.includes("gratuito") ? "gratuito" : undefined,
        valore: m.nome,
        attuale: m.nome === attuale,
      })),
      { nome: "Scrivi il nome…", valore: "\u0000" },
      // Il ragionamento sta qui dal 25 ottobre (era /ragionamento).
      ...(["codex", "claude"].includes(provider)
        ? [{ nome: "Livello di ragionamento…", valore: "\u0001" }]
        : []),
    ];
    const v = await c.scegli(`Modelli di ${provider}`, voci, { ricerca: true });
    if (!v) return;
    if (v.valore === "\u0001") return ragionamento(c, provider);
    scelta = v.valore === "\u0000" ? ((await c.chiedi("Nome del modello")) ?? "") : v.valore;
    if (v.valore === "\u0000" && !scelta) return;
  }
  provider ||= c.run().prossimo ?? c.run().agent;
  try {
    await c.api(`/runs/${c.id}/model`, { provider, model: scelta });
  } catch (e) {
    if (!/non ha un modello/.test(messaggio(e))) throw e;
    const r = await c.chiedi("Modello non in elenco", { testo: `${messaggio(e)}. Provarlo lo stesso? (s/n)` });
    if (!sì(r)) return;
    await c.api(`/runs/${c.id}/model`, { provider, model: scelta, forzato: true });
  }
  c.avvisa("ok", scelta ? `${provider} userà ${scelta}` : `${provider} torna al modello predefinito`);
  await c.aggiorna();
}

async function ragionamento(c: Contesto, argomento: string) {
  const parti = argomento.split(/\s+/).filter(Boolean);
  let provider = parti[0] && providerNoto(parti[0]) ? providerNoto(parti.shift()!)!.id : "";
  let livello = parti[0] ?? "";
  if (!livello) {
    if (!provider) provider = (await sceltaProvider(c, "Ragionamento di quale AI?")) ?? "";
    if (!provider) return;
    // Senza scelta vale quello della configurazione del CLI della persona.
    const attuale = (c.run().ragionamento ?? {})[provider];
    const v = await c.scegli(
      `Ragionamento di ${provider}`,
      ["basso", "medio", "alto", "massimo"].map((l) => ({
        nome: l,
        valore: l,
        attuale: l === attuale,
        tasto: l === "massimo" ? "più lento" : undefined,
      })),
    );
    if (!v) return;
    livello = v.valore;
  }
  provider ||= c.run().prossimo ?? c.run().agent;
  await c.api(`/runs/${c.id}/ragionamento`, { provider, livello });
  c.avvisa("ok", `${provider} ragionerà a livello ${livello}`);
  await c.aggiorna();
}

async function collegaProvider(c: Contesto, argomento: string) {
  const en = () => lingua() === "en";
  const chiavi = portachiaviDiSistema(c.cartellaDati);
  // «/collega openai sk-…»: la chiave non si scrive nel campo, e non la si
  // ripete nemmeno nell'errore (revisione del 14 ottobre, punto 18).
  const [primo, ...altro] = argomento.split(/\s+/).filter(Boolean);
  if (altro.length || (primo && !providerNoto(primo) && primo.length > 15)) {
    c.avvisa(
      "avviso",
      en()
        ? "Do not type the key in the field: use /connect and paste it into the protected dialog."
        : "Non scrivere la chiave nel campo: usa /collega e incollala nel riquadro, dove non compare a schermo.",
      8000,
    );
    if (!primo || !providerNoto(primo)) return;
  }
  let nome = primo ?? "";
  if (!nome) {
    // Prima ciò che non costa nulla: chi non ha abbonamenti trova subito i
    // servizi gratuiti, senza scorrere (prova di Lorenzo del 25 ottobre).
    const ordine = ["abbonamento", "gratuito", "locale", "consumo"] as const;
    const titoli = {
      abbonamento: en() ? "Subscriptions (official sign-in)" : "Abbonamenti (login ufficiale)",
      gratuito: en() ? "Free with your account" : "Gratuiti con il tuo account",
      locale: en() ? "On your Mac" : "Sul tuo Mac",
      consumo: en() ? "Pay as you go" : "A consumo (paghi quello che usi)",
    };
    const v = await c.scegli(
      en() ? "Connect an AI" : "Collega un'AI",
      [...PROVIDER]
        .sort((a, b) => ordine.indexOf(gruppoDi(a)) - ordine.indexOf(gruppoDi(b)))
        .map((p) => ({
          nome: p.nome,
          valore: p.id,
          gruppo: titoli[gruppoDi(p)],
          tasto: p.accesso === "chiave" && chiavi.esiste(p.id) ? (en() ? "✓ connected" : "✓ collegato") : p.id,
        })),
      { ricerca: true, nota: en() ? "Type to search (e.g. “groq”, “gemini”), enter to select." : "Scrivi per cercare (es. «groq», «gemini»), invio per scegliere." },
    );
    if (!v) return;
    nome = v.valore;
  }
  const p = providerNoto(nome);
  if (!p) return c.avvisa("errore", en() ? `I don't know “${nome}”: use /connect and choose from the list` : `Non conosco «${nome}»: scrivi /collega e scegli dall'elenco`, 8000);
  if (p.accesso === "abbonamento")
    return c.avvisa("info", en() ? `Connect it with the official sign-in outside this session: continuity connect ${p.motore}` : `Si collega con il login ufficiale, fuori dalla sessione: continuity connect ${p.motore}`, 8000);
  if (p.accesso === "locale") {
    c.avvisa("info", en() ? `Looking for ${p.nome}…` : `Cerco ${p.nome}…`, 4000);
    const esito = await provaCollegamento(p, undefined);
    if (!esito.ok) return c.avvisa("errore", `${p.nome}: ${esito.dettaglio}`, 8000);
    segnaCollegato(c.cartellaDati, p.id, true);
    await c.api(`/providers/${p.id}/collegato`, {}).catch(() => {});
    return c.avvisa("ok", en() ? `${p.nome} connected · ${esito.dettaglio}` : `${p.nome} collegato · ${esito.dettaglio}`, 6000);
  }
  // Una chiave: tre passi corti, il sito a un tasto (ctrl+o), l'incolla che
  // funziona (cmd+V, o tab per gli appunti), e se va male si riprova nello
  // stesso riquadro invece di ricominciare da capo.
  const sito = p.console ? new URL(p.console).host : "";
  const passi = [
    p.console ? (en() ? `1. ctrl+o opens ${sito} (or go to ${p.console})` : `1. ctrl+o apre ${sito} (o vai su ${p.console})`) : (en() ? "1. open the provider website" : "1. apri il sito del servizio"),
    en() ? "2. create and copy a key" : "2. crea una chiave e copiala",
    en() ? "3. paste it below and press enter" : "3. incollala qui sotto e premi invio",
    ...(p.nota ? ["", traduci(p.nota) ?? p.nota] : []),
    ...(p.dati ? ["", `${en() ? "Data" : "Dati"}: ${traduci(p.dati) ?? p.dati}`] : []),
  ].join("\n");
  let prima = "";
  if (p.primaParte) {
    prima =
      (
        await c.chiedi(en() ? `Connect ${p.nome}` : `Collega ${p.nome}`, {
          testo: en() ? `${p.primaParte}: find it on your account page (ctrl+o opens it).` : `${p.primaParte}: lo trovi nella pagina del tuo account (ctrl+o la apre).`,
          link: p.console,
        })
      )?.trim() ?? "";
    if (!prima) return;
    if (/[\s:]/.test(prima)) return c.avvisa("errore", `${p.primaParte} non valido`, 8000);
  }
  let errore: string | undefined;
  for (let tentativo = 0; tentativo < 5; tentativo++) {
    const chiave = (
      await c.chiedi(en() ? `Connect ${p.nome}` : `Collega ${p.nome}`, { testo: passi, nascosta: true, link: p.console, errore })
    )?.trim();
    if (!chiave) return;
    if (/\s/.test(chiave)) {
      errore = en() ? "a key cannot contain spaces: copy it again from the website" : "una chiave non contiene spazi: copiala di nuovo dal sito";
      continue;
    }
    const completa = prima ? `${prima}:${chiave}` : chiave;
    c.avvisa("info", en() ? "Testing connection…" : "Provo il collegamento…", 2500);
    const esito = await provaCollegamento(p, completa);
    if (!esito.ok && esito.chiaveRifiutata) {
      errore = `${esito.dettaglio}: controlla di averla copiata intera, o creane una nuova`;
      continue;
    }
    if (!esito.ok) {
      const v = await c.scegli<boolean>(
        en() ? "The service did not respond as expected" : "Il servizio non ha risposto come previsto",
        [
          { nome: en() ? "Try again" : "Riprova", valore: false },
          { nome: en() ? "Save the key anyway" : "Salva comunque la chiave", valore: true },
        ],
        { nota: esito.dettaglio },
      );
      if (!v) return;
      if (!v.valore) {
        errore = esito.dettaglio;
        continue;
      }
    }
    try {
      chiavi.salva(p.id, completa);
    } catch (e) {
      return c.avvisa("errore", messaggio(e), 10000);
    }
    // La chiave è già nel Portachiavi: un elenco dei collegati che non si
    // scrive non deve far credere che il collegamento sia fallito.
    try {
      segnaCollegato(c.cartellaDati, p.id, true);
    } catch {}
    await c.api(`/providers/${p.id}/collegato`, {}).catch(() => {});
    c.avvisa("ok", en() ? `✓ ${p.nome} connected · ${esito.dettaglio}` : `✓ ${p.nome} collegato · ${esito.dettaglio}`, 6000);
    // Subito qualcosa da fare con la chiave appena messa: lavora come le altre.
    const ora = await c.scegli<boolean>(
      en() ? `✓ ${p.nome} connected` : `✓ ${p.nome} collegato`,
      [
        { nome: en() ? "Use it now" : "Fallo lavorare adesso", valore: true },
        { nome: en() ? "Later (/ai)" : "Più tardi (/ai)", valore: false },
      ],
      {
        nota: en() ? "It works on the project like the other AIs until you choose another with /ai. On first use after each launch, macOS asks to read the key: choose Allow." : "Lavora sul progetto come le altre AI, finché non ne scegli un'altra con /ai. Al primo uso dopo ogni avvio il Mac chiede il permesso di leggere la chiave: scegli «Consenti».",
      },
    );
    if (ora?.valore) await pannelloAI(c, p.id);
    return;
  }
  c.avvisa("errore", en() ? `${p.nome}: not connected after 5 attempts` : `${p.nome}: non collegato dopo 5 tentativi`, 8000);
}

async function connettori(c: Contesto) {
  for (;;) {
    const { elenco = [], spenti = [] } = await c.api(`/runs/${c.id}/connettori`);
    if (!elenco.length) {
      c.avvisa("info", "Nessun connettore per questa sessione");
      return;
    }
    const v = await c.scegli(
      "Connettori (invio accende o spegne)",
      elenco.map((k: any) => ({
        nome: `${spenti.includes(k.id) ? "○" : "●"} ${k.nome}${k.stato !== "collegato" ? " · " + k.stato : ""}`,
        valore: k.id as string,
        gruppo: k.ai === "codex" ? "Codex" : k.ai === "claude" ? "Claude" : k.ai,
        tasto: spenti.includes(k.id) ? "spento" : "acceso",
      })),
      { ricerca: true },
    );
    if (!v) return;
    const nuovi = spenti.includes(v.valore)
      ? spenti.filter((s: string) => s !== v.valore)
      : [...spenti, v.valore];
    await c.api(`/runs/${c.id}/connettori`, { spenti: nuovi });
  }
}

// Il pannello dell'AI ibrida: accesa o spenta, il modello locale, i ruoli
// (riserva, a comando) e i compiti, da accendere, spegnere, modificare e
// aggiungere. Ogni scelta si salva subito.
// Il revisore (Fase 2, CONTINUITY_2.0.md §5.16). In alto i suggerimenti in
// attesa, che si scartano o si rimettono prima che vadano all'AI del turno
// dopo; sotto le impostazioni: acceso, chi rivede, modello, ogni quanti
// turni, che cosa controlla. Il consenso sui dati si chiede quando
// serve: accendendolo o scegliendo un servizio che con il piano gratuito usa
// i dati.
// «Google AI Studio · Gemini (gratuito)» → «Google AI Studio».
const nomeBreve = (nome: string) => nome.split(" · ")[0].replace(/\s*\(.*\)\s*$/, "").trim();
// «chiave»: il revisore, o uno degli altri controlli sempre attivi (Fase 3,
// passo 4), con le stesse impostazioni.
export async function pannelloRevisore(c: Contesto, chiave = "revisore") {
  const principale = chiave === "revisore";
  const imposta = (modifiche: Record<string, unknown>) =>
    c.api(`/runs/${c.id}/revisore`, principale ? modifiche : { ...modifiche, controllo: chiave });
  // Il sì per il servizio, se serve. false = la persona ha detto no.
  const consenso = async (id: string, config: ConfigRevisore): Promise<boolean> => {
    const p = providerNoto(id);
    if (!p || !serveConsenso(p, config)) return true;
    const v = await c.scegli<boolean>(
      `${nomeBreve(p.nome)} riceverà il codice cambiato`,
      [
        { nome: "Sì, per questo progetto", valore: true },
        { nome: "No", valore: false },
      ],
      { nota: `${traduci(p.dati) ?? ""} ${lingua() === "en" ? "The reviewer sends only the changes, not the whole project." : "Il revisore gli manda solo le modifiche, non tutto il progetto."}` },
    );
    if (!v?.valore) return false;
    await imposta({ consensi: [...new Set([...(config.consensi ?? []), id])] });
    return true;
  };
  for (;;) {
    await c.aggiorna();
    const run = c.run();
    const altri: any[] = run.controlli ?? [];
    const questo = principale ? undefined : altri.find((x) => x.id === chiave);
    if (!principale && !questo) return;
    const config: ConfigRevisore = {
      ...revisorePredefinito(),
      ...(principale ? (run.revisore ?? {}) : questo),
      consensi: run.revisore?.consensi ?? [],
    };
    const risposta = await c.api("/gratuiti").catch(() => []);
    const servizi: any[] = Array.isArray(risposta) ? risposta : [];
    const collegati = new Set(servizi.filter((x) => x.collegato && !x.lavoraSuiFile).map((x) => x.id));
    const chi = sceltaRevisore(config, (id) => collegati.has(id));
    // A fine turno, con un turno vero: chi corregge, o Codex, Claude, Qwen.
    const aTurno = Boolean(chi && rivedeConUnTurno(chi, config));
    const tutti: any[] = principale ? (run.suggerimenti ?? []) : [];
    const inAttesa = tutti.filter((x) => x.stato === "nuovo" || x.stato === "scartato");
    const ogni = config.ogniTurni ?? 1;
    const v = await c.scegli<string>(
      principale ? "Il revisore" : `Controllo «${questo.nome}»`,
      [
        ...inAttesa.map((x) => ({
          nome: x.testo,
          valore: "s:" + x.id,
          gruppo: "Suggerimenti per il prossimo turno",
          tasto: x.stato === "scartato" ? "✗ scartato" : "✓ va all'AI",
        })),
        // Acceso, ma il servizio scelto in automatico aspetta ancora il sì.
        ...(config.attivo && chi && serveConsenso(chi, config)
          ? [{ nome: `⚠ ${nomeBreve(chi.nome)} aspetta il tuo sì`, valore: "consenso", gruppo: "Impostazioni", tasto: "rispondi" }]
          : []),
        {
          nome: config.attivo ? "Acceso" : "Spento",
          valore: "attivo",
          gruppo: "Impostazioni",
          tasto: config.attivo ? "spegni" : "accendi",
          attuale: config.attivo,
        },
        {
          nome: `Chi rivede: ${chi ? nomeBreve(chi.nome) : "nessun gratuito collegato"}`,
          valore: "chi",
          gruppo: "Impostazioni",
          tasto: config.provider ? "scelto" : "automatico",
        },
        {
          nome: `Correggi da solo: ${config.corregge ? "sì" : "no"}`,
          descrizione: "a fine turno corregge lui gli errori, invece di suggerire",
          valore: "corregge",
          gruppo: "Impostazioni",
          tasto: config.corregge ? "corregge" : "suggerisce",
          attuale: Boolean(config.corregge),
        },
        ...(chi?.motore === "diretto"
          ? [
              {
                nome: `Modello: ${config.modello ?? "il consigliato che risponde"}`,
                valore: "modello",
                gruppo: "Impostazioni",
              },
            ]
          : []),
        {
          nome: `Quando: ${descriviOgniTurni(ogni)}`,
          valore: "quando",
          gruppo: "Impostazioni",
          tasto: aTurno ? "dopo chi ha lavorato" : "a fine turno",
        },
        {
          nome: "Che cosa controlla…",
          valore: "istruzioni",
          gruppo: "Impostazioni",
          tasto: config.istruzioni === ISTRUZIONI_REVISORE ? "di serie" : "personalizzato",
        },
        // Gli altri controlli sempre attivi, ognuno con le sue istruzioni.
        ...(principale
          ? [
              ...altri.map((x) => ({
                nome: x.nome,
                valore: "c:" + x.id,
                gruppo: "Altri controlli sempre attivi",
                tasto: x.attivo ? `acceso · ${descriviOgniTurni(x.ogniTurni ?? 1)}` : "spento",
                attuale: x.attivo,
              })),
              { nome: "+ Aggiungi un controllo…", valore: "nuovo", gruppo: "Altri controlli sempre attivi" },
            ]
          : [{ nome: "Togli questo controllo", valore: "togli", gruppo: "Impostazioni" }]),
      ],
      {
        nota: inAttesa.length
          ? "Invio su un suggerimento lo scarta o lo rimette: quelli con ✓ vanno all'AI all'inizio del prossimo turno."
          : "Il revisore legge le modifiche e suggerisce, senza toccare i file.",
      },
    );
    if (!v) return;
    try {
      if (v.valore.startsWith("c:")) {
        await pannelloRevisore(c, v.valore.slice(2));
        continue;
      }
      if (v.valore === "nuovo") {
        await nuovoControllo(c);
        continue;
      }
      if (v.valore === "togli") {
        await imposta({ togli: true });
        c.avvisa("ok", `Controllo «${questo.nome}» tolto`, 4000);
        return;
      }
      if (v.valore.startsWith("s:")) {
        const x = inAttesa.find((y) => "s:" + y.id === v.valore);
        await c.api(`/runs/${c.id}/suggerimenti/${x.id}`, { scartato: x.stato !== "scartato" });
      } else if (v.valore === "consenso") {
        if (chi && !(await consenso(chi.id, config))) {
          c.avvisa("info", "Senza il sì il revisore non manda il codice: scegli un altro servizio in «Chi rivede»", 8000);
        }
      } else if (v.valore === "attivo") {
        if (!config.attivo) {
          if (!chi) {
            c.avvisa("avviso", "Serve un servizio gratuito collegato: /collega groq (o google)", 8000);
            continue;
          }
          if (!(await consenso(chi.id, config))) continue;
        }
        await imposta({ attivo: !config.attivo });
        const chiè = principale ? "Revisore" : `Controllo «${questo.nome}»`;
        c.avvisa("ok", config.attivo ? `${chiè} spento` : `${chiè} acceso: ${chi?.nome} · ${descriviOgniTurni(ogni)}`, 5000);
      } else if (v.valore === "corregge") {
        await imposta({ corregge: !config.corregge });
        c.avvisa(
          "ok",
          config.corregge ? "Il revisore torna a suggerire" : "Il revisore corregge da solo, a fine turno, dopo chi ha lavorato",
          5000,
        );
      } else if (v.valore === "chi") {
        // Tutte le AI, sullo stesso piano (28 ottobre).
        const tutte = [...new Set([...(run.providers ?? []), ...servizi.filter((x) => x.collegato).map((x) => String(x.id)), "ollama"])].filter((id) => providerNoto(id));
        const voci = tutte.map((id) => ({
          nome: providerNoto(id)!.nome,
          valore: id,
          attuale: config.provider === id,
          tasto: providerNoto(id)!.accesso === "abbonamento" ? "consuma l'abbonamento" : "",
        }));
        const scelta = await c.scegli<string>(
          "Chi rivede",
          [{ nome: "Automatico: il primo gratuito collegato (Groq, Cloudflare, Google…)", valore: "", attuale: !config.provider }, ...voci, { nome: "+ Aggiungi un'AI…", valore: "+" }],
          { nota: "Un gratuito che suggerisce soltanto rivede anche durante il lavoro; chi corregge, e Codex, Claude o Qwen, rivedono a fine turno, dopo chi ha lavorato." },
        );
        if (!scelta) continue;
        if (scelta.valore === "+") {
          await collegaProvider(c, "");
          continue;
        }
        if (scelta.valore && config.attivo && !(await consenso(scelta.valore, config))) continue;
        await imposta({ provider: scelta.valore || null, modello: null });
      } else if (v.valore === "modello") {
        if (!chi) continue;
        let elenco: { id: string; nome: string }[] = [];
        try {
          elenco = await c.api(`/gratuiti/${chi.id}/modelli`);
        } catch (e) {
          c.avvisa("errore", messaggio(e), 8000);
          continue;
        }
        const scelta = await c.scegli<string>(
          `Modello del revisore (${chi.nome})`,
          [
            { nome: "Il consigliato che risponde (automatico)", valore: "", attuale: !config.modello },
            ...elenco.map((m) => ({ nome: m.nome, valore: m.id, attuale: m.id === config.modello })),
          ],
          { ricerca: true, nota: "Se il modello scelto è sovraccarico, il revisore prova da solo i successivi." },
        );
        if (scelta) await imposta({ modello: scelta.valore || null });
      } else if (v.valore === "quando") {
        const scelta = await c.scegli<number>(
          "Quando rivede",
          [1, 2, 3, 4, 5, 10].map((n) => ({ nome: n === 1 ? "A ogni turno" : `Ogni ${n} turni`, valore: n, attuale: n === ogni })),
          { nota: "Rivede a fine turno, mai mentre un'AI sta lavorando. Contano i turni che hanno cambiato qualcosa." },
        );
        if (scelta) await imposta({ ogniTurni: scelta.valore });
      } else if (v.valore === "istruzioni") {
        const scelta = await c.scegli<string>(
          "Che cosa controlla",
          [
            { nome: "Scrivi istruzioni nuove…", valore: "scrivi" },
            { nome: "Torna alle istruzioni di serie", valore: "serie", attuale: config.istruzioni === ISTRUZIONI_REVISORE },
          ],
           { nota: `${lingua() === "en" ? "Current" : "Ora"}: ${traduci(config.istruzioni) ?? config.istruzioni}` },
        );
        if (scelta?.valore === "serie") await imposta({ istruzioni: ISTRUZIONI_REVISORE });
        else if (scelta?.valore === "scrivi") {
          const testo = (
            await c.chiedi("Che cosa deve controllare il revisore", {
              testo: "Per esempio: «controlla la sicurezza dei form e che i testi siano in italiano corretto».",
            })
          )?.trim();
          if (testo) await imposta({ istruzioni: testo });
        }
      }
    } catch (e) {
      c.avvisa("errore", messaggio(e), 8000);
    }
  }
}

// Un controllo sempre attivo nuovo: da un ruolo che legge (/flusso → Ruoli,
// per esempio «Sicurezza») oppure scritto qui.
async function nuovoControllo(c: Contesto) {
  const config: any = await c.api("/flussi").catch(() => ({ ruoli: [] }));
  const ruoli: any[] = (config.ruoli ?? []).filter((r: any) => r.tipo === "legge" && r.id !== "pianifica");
  const v = await c.scegli<string>(
    "Nuovo controllo sempre attivo",
    [
       ...ruoli.map((r) => ({ nome: r.nome, descrizione: (traduci(r.istruzioni) ?? r.istruzioni).slice(0, 90), valore: r.id, gruppo: "Da un ruolo" })),
      { nome: "Scrivi un controllo nuovo…", valore: "+", gruppo: "Altro" },
    ],
    { nota: "Lavora come il revisore: legge le modifiche e suggerisce, con le sue istruzioni. Usa un servizio gratuito." },
  );
  if (!v) return;
  let nome: string | undefined;
  let istruzioni: string | undefined;
  if (v.valore === "+") {
    nome = (await c.chiedi("Nome del controllo", { testo: "Per esempio «Sicurezza» o «Testi in italiano»" }))?.trim();
    if (!nome) return;
    istruzioni = (await c.chiedi("Che cosa controlla", { testo: "Per esempio: «controlla che i form non accettino dati pericolosi»" }))?.trim();
  } else {
    const r = ruoli.find((x) => x.id === v.valore);
    nome = r?.nome;
    istruzioni = r?.istruzioni;
  }
  if (!nome || !istruzioni) return;
  const run = await c.api(`/runs/${c.id}/controlli`, { nome, istruzioni });
  await c.aggiorna();
  const nuovo = (run.controlli ?? []).at(-1);
  c.avvisa("ok", `Controllo «${nome}» aggiunto: accendilo qui`, 5000);
  if (nuovo) await pannelloRevisore(c, nuovo.id);
}

// Chi lavora (25 ottobre; dal 28 ottobre tutte le AI sullo stesso piano):
// qualunque AI si scelga, anche gratuita, lavora sui file e diventa la prima
// della sequenza finché non se ne sceglie un'altra. Il modello si sceglie da
// solo (il consigliato): cambiarlo è in /modello.
async function pannelloAI(c: Contesto, argomento: string) {
  const sequenza: string[] = c.run().providers ?? [];
  let scelta = argomento.trim().toLowerCase();
  if (!scelta) {
    const servizi: any[] = await c.api("/gratuiti").catch(() => []);
    const altre = servizi.filter((x) => x.collegato && !sequenza.includes(x.id)).map((x) => String(x.id));
    const v = await c.scegli<string>(
      "Scegli l'AI",
      [
        ...[...sequenza, ...altre].map((id, i) => ({
          nome: providerNoto(id)?.nome ?? id,
          valore: id,
          gruppo: "Le tue AI",
          tasto: i === 0 && !c.run().risponde ? "● lavora" : "",
          attuale: i === 0 && !c.run().risponde,
        })),
        { nome: "+ Aggiungi un'AI…", valore: "collega", gruppo: "Altre" },
      ],
      { nota: "L'AI scelta lavora sul progetto e resta finché non la cambi. Se finisce i crediti continua la successiva della sequenza." },
    );
    if (!v) return;
    scelta = v.valore;
  } else {
    const p = providerNoto(scelta);
    if (!p) return c.avvisa("errore", `Non conosco «${scelta}»: /ai e scegli dall'elenco`, 6000);
    scelta = p.id;
  }
  if (scelta === "collega") return collegaProvider(c, "");
  // Qualunque AI si scelga qui, il modello del Mac non serve più in memoria.
  void c.api("/ibrida/libera", {}).catch(() => {});
  try {
    // Chi rispondeva soltanto (sessioni di prima del 28 ottobre) lascia il posto.
    if (c.run().risponde) await c.api(`/runs/${c.id}/risponde`, { provider: null });
    if (sequenza[0] !== scelta) await c.api(`/runs/${c.id}/providers`, { richiesta: scelta });
    c.avvisa("ok", `Da ora lavora ${providerNoto(scelta)?.nome ?? scelta}`, 4000);
  } catch (e) {
    c.avvisa("errore", messaggio(e), 8000);
  }
  await c.aggiorna();
}

// I modelli gratuiti (Fase 1 del 21 ottobre, docs/MODELLI_GRATUITI.md): i
// servizi con un piano gratuito, collegati o da collegare; per uno collegato,
// i suoi modelli gratuiti letti dal servizio e una domanda di prova.
async function pannelloGratuiti(c: Contesto, argomento: string) {
  let scelto = argomento.trim() ? providerNoto(argomento.trim())?.id : undefined;
  for (;;) {
    if (!scelto) {
      // Prima i collegati: i gruppi non si ripetono.
      const servizi: any[] = [...(await c.api("/gratuiti"))].sort(
        (a: any, b: any) => Number(b.collegato) - Number(a.collegato),
      );
      const v = await c.scegli<string>(
        "Modelli gratuiti",
        servizi.map((x) => ({
          nome: x.nome,
          valore: x.id,
          gruppo: x.collegato ? "Collegati" : "Da collegare (account gratuito)",
          tasto: x.collegato ? "collegato" : "collega",
        })),
        {
          ricerca: true,
          nota: "Ognuno con il tuo account gratuito e i suoi limiti. Lavorano sul progetto come le altre AI.",
        },
      );
      if (!v) return;
      const s = servizi.find((x) => x.id === v.valore);
      if (!s.collegato) {
        await collegaProvider(c, s.id);
        continue;
      }
      scelto = s.id;
    }
    const id = scelto!;
    scelto = undefined;
    let modelli: { id: string; nome: string }[] = [];
    try {
      c.avvisa("info", "Leggo i modelli gratuiti…", 4000);
      modelli = await c.api(`/gratuiti/${id}/modelli`);
    } catch (e) {
      c.avvisa("errore", messaggio(e), 8000);
      continue;
    }
    if (!modelli.length) {
      c.avvisa("avviso", `${providerNoto(id)?.nome ?? id}: nessun modello gratuito in questo momento`, 6000);
      continue;
    }
    const m = await c.scegli<string>(
      `${providerNoto(id)?.nome ?? id} · ${modelli.length} gratuiti`,
      modelli.map((x) => ({ nome: x.nome, valore: x.id, tasto: x.nome !== x.id ? x.id : undefined })),
      { ricerca: true, nota: "Scegli un modello per una domanda di prova." },
    );
    if (!m) continue;
    const domanda = (
      await c.chiedi(`Prova ${m.valore}`, {
        testo: "Una domanda breve: Continuity la manda al modello e ti mostra risposta e tempo.",
      })
    )?.trim();
    if (!domanda) continue;
    c.avvisa("info", `Chiedo a ${m.valore}…`, 60000);
    try {
      const r = await c.api(`/gratuiti/${id}/prova`, { modello: m.valore, domanda });
      c.avvisa("ok", `${m.valore} ha risposto in ${(r.millisecondi / 1000).toFixed(1)} s`, 4000);
      c.aggiungiLocale([
        {
          tipo: "info",
          testo: `${providerNoto(id)?.nome ?? id} · ${m.valore} · ${(r.millisecondi / 1000).toFixed(1)} s\n${r.risposta || "(nessuna risposta)"}`,
        },
      ]);
    } catch (e) {
      c.avvisa("errore", messaggio(e), 10000);
    }
    return;
  }
}

async function pannelloIbrida(c: Contesto) {
  for (;;) {
    const { config, ollama } = await c.api("/ibrida?verifica=1");
    const sì_no = (b: boolean) => (b ? "sì" : "no");
    const v = await c.scegli<string>(
      "AI ibrida",
      [
        { nome: config.attiva ? "Accesa" : "Spenta", valore: "attiva", gruppo: "Stato", tasto: config.attiva ? "spegni" : "accendi", attuale: config.attiva },
        {
          nome: `Modello: ${config.modello}`,
          valore: "modello",
          gruppo: "Stato",
          tasto: ollama.acceso
            ? `Ollama ${ollama.versione ?? ""}`.trim()
            : (ollama.modelli ?? []).includes(config.modello)
              ? "scaricato · Ollama spento"
              : "Ollama spento",
        },
        ...(ollama.acceso
          ? []
          : [
              {
                nome: ollama.installato === false ? "Ollama non è installato" : "Avvia Ollama adesso",
                valore: "avvia",
                gruppo: "Stato",
                tasto: ollama.installato === false ? "ollama.com" : "avvia",
              },
            ]),
        { nome: "Riserva: senza crediti lavora lei", valore: "riserva", gruppo: "Ruoli", tasto: sì_no(config.riserva), attuale: config.riserva },
        { nome: "A comando, con shift+tab", valore: "aComando", gruppo: "Ruoli", tasto: sì_no(config.aComando), attuale: config.aComando },
        ...config.compiti.map((k: Compito) => ({
          nome: `${traduci(k.nome) ?? k.nome}  ${k.parola}`,
          valore: "compito:" + k.id,
          gruppo: "Compiti (la parola all'inizio del messaggio)",
          tasto: k.attivo ? "acceso" : "spento",
          attuale: k.attivo,
        })),
        { nome: "Aggiungi un compito…", valore: "nuovo", gruppo: "Compiti (la parola all'inizio del messaggio)" },
      ],
      { nota: "Invio cambia la voce scelta. Il modello lavora sul tuo Mac: gratis, più lento delle AI in abbonamento." },
    );
    if (!v) {
      await c.ricaricaIbrida();
      return;
    }
    const salva = async (nuova: ConfigIbrida) => {
      try {
        await c.api("/ibrida", nuova);
      } catch (e) {
        c.avvisa("errore", messaggio(e), 6000);
      }
    };
    if (v.valore === "attiva" || v.valore === "riserva" || v.valore === "aComando") {
      await salva({ ...config, [v.valore]: !config[v.valore] });
      if (v.valore === "attiva" && config.attiva) void c.api("/ibrida/libera", {}).catch(() => {});
      continue;
    }
    if (v.valore === "avvia") {
      if (ollama.installato === false) {
        c.avvisa("avviso", "Ollama non è installato: scaricalo da ollama.com, poi «ollama pull qwen3.5:4b»", 8000);
        continue;
      }
      c.avvisa("info", "Avvio Ollama…", 15000);
      const esito = await c.api("/ibrida/avvia", {}).catch(() => ({ acceso: false }));
      c.avvisa(
        esito.acceso ? "ok" : "errore",
        esito.acceso ? "Ollama è acceso" : "Ollama non si è avviato: aprilo dal Launchpad",
        6000,
      );
      continue;
    }
    if (v.valore === "modello") {
      const modelli: string[] = ollama.modelli ?? [];
      if (!modelli.length) {
        c.avvisa(
          "avviso",
          "Nessun modello in Ollama: scaricane uno, per esempio «ollama pull qwen3.5:4b»",
          7000,
        );
        continue;
      }
      const m = await c.scegli(
        "Modello locale",
        modelli.map((nome) => ({ nome, valore: nome, attuale: nome === config.modello })),
      );
      if (m) await salva({ ...config, modello: m.valore });
      continue;
    }
    if (v.valore === "nuovo") {
      const nome = (await c.chiedi("Nuovo compito", { testo: "Come si chiama? Per esempio «Scrivi i test»" }))?.trim();
      if (!nome) continue;
      let parola = (await c.chiedi("Parola del compito", { testo: "Con che parola lo chiami? Per esempio #test" }))?.trim() ?? "";
      if (!parola) continue;
      if (!parola.startsWith("#")) parola = "#" + parola;
      const istruzioni = (await c.chiedi("Istruzioni", { testo: "Che cosa deve fare il modello? Scrivilo come lo diresti a una persona." }))?.trim();
      if (!istruzioni) continue;
      await salva({
        ...config,
        compiti: [
          ...config.compiti,
          { id: "mio-" + Date.now().toString(36), nome, parola, istruzioni, attivo: true },
        ],
      });
      c.avvisa("ok", `Compito «${nome}»: scrivi ${parola} all'inizio del messaggio`, 6000);
      continue;
    }
    if (v.valore.startsWith("compito:")) {
      const id = v.valore.slice("compito:".length);
      const k: Compito | undefined = config.compiti.find((x: Compito) => x.id === id);
      if (!k) continue;
      const azione = await c.scegli(k.nome, [
        { nome: k.attivo ? "Spegni" : "Accendi", valore: "interruttore" },
        { nome: "Modifica le istruzioni", valore: "istruzioni" },
        { nome: "Cambia la parola", valore: "parola", tasto: k.parola },
        ...(k.predefinito ? [] : [{ nome: "Elimina", valore: "elimina" }]),
       ], { nota: (traduci(k.istruzioni) ?? k.istruzioni).slice(0, 200) });
      if (!azione) continue;
      let compiti = config.compiti as Compito[];
      if (azione.valore === "interruttore")
        compiti = compiti.map((x) => (x.id === id ? { ...x, attivo: !x.attivo } : x));
      else if (azione.valore === "elimina") compiti = compiti.filter((x) => x.id !== id);
      else {
        const nuovo = (await c.chiedi(azione.valore === "parola" ? "Nuova parola" : "Nuove istruzioni", {
          testo: azione.valore === "parola" ? `Ora è ${k.parola}` : k.istruzioni.slice(0, 300),
        }))?.trim();
        if (!nuovo) continue;
        const valore = azione.valore === "parola" && !nuovo.startsWith("#") ? "#" + nuovo : nuovo;
        compiti = compiti.map((x) => (x.id === id ? { ...x, [azione.valore]: valore } : x));
      }
      await salva({ ...config, compiti });
    }
  }
}
