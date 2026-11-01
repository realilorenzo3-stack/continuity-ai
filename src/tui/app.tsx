// La nuova interfaccia di Continuity: schermo intero con OpenTUI (Fase 2).
// Intestazione con l'AI attiva e la sequenza, conversazione che scorre,
// campo di scrittura, piè con consumo e scorciatoie; menu dei comandi con
// ctrl+p e dialoghi per ogni scelta. Parla con il servizio locale come il
// terminale a righe (src/cli/session.ts), che resta disponibile con --righe.
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { execFileSync, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { LIMITE_RICHIESTA } from "../core/limiti.js";
import { finisceConDomanda } from "../cli/session.js";
import {
  applicaEventi,
  nuovaConversazione,
  segnapostoIncolla,
  unaRiga,
  type StatoConversazione,
} from "./conversazione.js";
import {
  dopoIlTurno,
  interrompi,
  leggiEventi,
  messaggio,
  type Api,
  type Esito,
} from "./cliente.js";
import { nomeAI, Testo, VoceConversazione } from "./elementi.js";
import { Campo, Piede } from "./campo.js";
import { Barra } from "./barra.js";
import { versioneApp } from "../core/build.js";
import { logo } from "./logo.js";
import { fotogramma } from "./rotella.js";
import { modelloPredefinito } from "./modelli.js";
import { compitoDalTesto, nomeLocale, type ConfigIbrida } from "../core/ibrida.js";
import { fileFuoriProgetto, nomeFile, scegliDalFinder, soloFileTrascinati } from "./allegati.js";
import { providerNoto } from "../core/provider.js";
import { Avvisi, Domanda, Scelta, type Avviso, type Voce } from "./dialoghi.js";
import { coloreAI, tema } from "./tema.js";
import { COMANDI_TUI, eseguiComando, proponiCollegamento, vociMenu, type Contesto } from "./comandi.js";
import { configurazione, proponiConfigurazione } from "./configura.js";
import { controllaAggiornamento } from "../core/aggiornamenti.js";
import { fileURLToPath } from "node:url";
import { rispondiAlPiano } from "./flusso.js";
import { confermaIncarichi, scegliAI, testoMenzione } from "./incarichi.js";
import { incarichiDalMessaggio, type Incarico } from "../core/menzioni.js";
import { inizializzaLingua, lingua, ricordaNomiScelti, traduci } from "./lingua.js";
import { copiaNegliAppunti } from "../piattaforma.js";

export type Opzioni = {
  api: Api;
  id: string;
  cartella: string;
  cartellaDati: string;
  anticipate?: string[];
  // «continuity setup» / «continuity configura»: si apre la configurazione.
  configura?: boolean;
  // Prima apertura senza configurazione: la si propone.
  proponiConfigurazione?: boolean;
};

const FINI_TURNO = [
  "turn.completed",
  "turn.blocked",
  "turn.failed",
  "run.blocked",
  "run.paused",
  "run.cancelled",
  "run.failed",
  "run.succeeded",
];

export function App(props: Opzioni & { onEsci: () => void }) {
  const dim = useTerminalDimensions();
  const [conv, setConv] = createSignal<StatoConversazione>(
    nuovaConversazione(),
  );
  const [run, setRun] = createSignal<any>({});
  const [parziale, setParziale] = createSignal("");
  // Ciò che l'AI sta facendo adesso («esegue npm test»), da /live.
  const [attivita, setAttivita] = createSignal("");
  // Il primo esc (o ctrl+c) durante il turno: il piè dice «di nuovo».
  const [armato, setArmato] = createSignal(false);
  const [interrompendo, setInterrompendo] = createSignal(false);
  // Il ramo Git della cartella, accanto al percorso nel piè (come opencode).
  const ramo = (() => {
    try {
      return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: props.cartella,
        encoding: "utf8",
        timeout: 2000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return "";
    }
  })();
  // Il passo delle rotelle: ogni 80 ms, solo mentre l'AI lavora.
  const [passo, setPasso] = createSignal(0);
  // «occupato»: dall'invio di un turno fino alla fine della sua consegna.
  const [inTurno, setInTurno] = createSignal(false);
  const [inizioTurno, setInizioTurno] = createSignal(0);
  const [adesso, setAdesso] = createSignal(Date.now());
  const [avvisi, setAvvisi] = createSignal<Avviso[]>([]);
  // Il dialogo aperto, come dati: lo disegna l'albero dei componenti (un
  // componente creato in un gestore di eventi non trova il renderer).
  const [dialogo, setDialogo] = createSignal<Dialogo | undefined>();
  const [cronologia, setCronologia] = createSignal<string[]>([]);
  // Ciò che si scrive mentre un'AI lavora entra in coda e parte a fine turno,
  // come nel terminale a righe (in opencode la coda restava ferma: da evitare).
  const [coda, setCoda] = createSignal<string[]>([]);
  // L'AI ibrida: configurazione e stato di Ollama (/ibrida), e il destinatario
  // del prossimo messaggio scelto con shift+tab: la sequenza delle AI, il
  // modello locale solo per rispondere, o il modello locale sui file.
  const [ibrida, setIbrida] = createSignal<{ config: ConfigIbrida; ollama: any } | undefined>();
  const [destinatario, setDestinatario] = createSignal<"sequenza" | "risposte" | "file">("sequenza");
  const ricaricaIbrida = async () => {
    const x = await props.api("/ibrida").catch(() => undefined);
    if (x?.config) setIbrida(x);
    if (!x?.config?.attiva || !x?.config?.aComando) setDestinatario("sequenza");
  };
  let ultimaFineLocale = 0;
  let ultimaRichiestaFile = { seq: 0, testo: "" };
  // Un compito dell'AI ibrida in corso: si ferma con la sua rotta, non con la
  // pausa del turno (collaudo del 16 ottobre, CT-2.0-001).
  let localeInCorso = false;
  let posizioneCronologia = -1;
  // Un incolla lungo resta compatto nel campo, «[Incollate ~40 righe]», come in
  // opencode; il testo vero parte all'invio (docs/rea/interfaccia.md §3).
  const incollati = new Map<string, string>();
  const espandi = (testo: string) => {
    let fuori = testo;
    for (const [chiave, vero] of incollati) fuori = fuori.split(chiave).join(vero);
    return fuori;
  };
  // Allegare file dal loro percorso: trascinati dal Finder, scelti con «+»,
  // o citati in un messaggio quando stanno fuori dal progetto.
  const allega = async (percorsi: string[]) => {
    for (const percorso of percorsi) {
      try {
        await props.api(`/runs/${props.id}/attachments`, { path: percorso });
        avvisa("ok", `Allegato: ${nomeFile(percorso)}`, 3000);
      } catch (e) {
        avvisa("errore", messaggio(e), 6000);
      }
    }
    await aggiorna().catch(() => {});
  };
  const togliAllegato = async (nome: string) => {
    await props
      .api(`/runs/${props.id}/attachments/remove`, { nome })
      .then(() => avvisa("info", `Allegato tolto: ${nome}`, 3000))
      .catch((e) => avvisa("errore", messaggio(e)));
    await aggiorna().catch(() => {});
  };
  const dalFinder = async () => {
    const scelti = await scegliDalFinder();
    if (scelti.length) await allega(scelti);
  };
  // Se il Terminale scrive il percorso trascinato come testo (non come
  // incolla), il campo che contiene solo percorsi di file diventa allegati.
  let attesaTrascinati: ReturnType<typeof setTimeout> | undefined;
  // «@» scritto all'inizio o dopo uno spazio apre il pannello delle AI, come
  // /ai; la scelta mette il nome nel campo (27 ottobre). Un indirizzo email
  // («anna@») non lo apre.
  let testoPrima = "";
  const pannelloMenzione = async () => {
    const id = await scegliAI(contesto, "Chiama un'AI");
    if (id && !chiusa) campo?.insertText?.(testoMenzione(id));
  };
  const contenutoCambiato = () => {
    const ora = campo?.plainText ?? "";
    // Il menu dei comandi sotto il campo segue ciò che si scrive dopo «/».
    if (ora !== testoCampo()) {
      setTestoCampo(ora);
      setSceltaComando(0);
      setComandiNascosti(false);
    }
    // Una @ nuova in fondo, mentre si scrive (non cancellando).
    const nuova = ora.length > testoPrima.length && /(^|\s)@$/.test(ora) && !/(^|\s)@$/.test(testoPrima);
    testoPrima = ora;
    if (nuova && !dialogo()) void pannelloMenzione();
    if (attesaTrascinati) clearTimeout(attesaTrascinati);
    attesaTrascinati = setTimeout(() => {
      if (chiusa) return;
      const testo = campo?.plainText ?? "";
      if (!/\s$/.test(testo) && !testo.endsWith("'")) return;
      const trascinati = soloFileTrascinati(testo);
      if (!trascinati) return;
      campo?.clear?.();
      void allega(trascinati);
    }, 200);
  };
  const incolla = (evento: any) => {
    const testo = new TextDecoder()
      .decode(evento?.bytes ?? new Uint8Array())
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    // File trascinati dal Finder: diventano allegati, non testo.
    const trascinati = soloFileTrascinati(testo);
    if (trascinati) {
      evento.preventDefault?.();
      void allega(trascinati);
      return;
    }
    const segnaposto = segnapostoIncolla(testo);
    if (!segnaposto || !campo) return;
    evento.preventDefault?.();
    const chiave =
      incollati.size === 0 ? segnaposto : segnaposto.replace("]", ` #${incollati.size + 1}]`);
    incollati.set(chiave, testo);
    campo.insertText?.(chiave);
  };
  let campo: any;
  const [testoCampo, setTestoCampo] = createSignal("");
  const [sceltaComando, setSceltaComando] = createSignal(0);
  const [comandiNascosti, setComandiNascosti] = createSignal(false);
  let scorrimento: any;
  let ultimoEsc = 0;
  let ultimoCtrlC = 0;
  let idAvviso = 0;
  // Chiusa l'interfaccia, niente deve più partire da qui: né consegne, né
  // pubblicazioni, né messaggi in coda (revisione del 14 ottobre, punto 2).
  let chiusa = false;
  const timerAvvisi = new Set<ReturnType<typeof setTimeout>>();
  // L'ultima fine di turno letta dal registro, chiunque l'abbia letta: un
  // comando che aggiorna durante il turno non deve «mangiarla» (punto 1).
  let ultimaFine = { seq: 0, tipo: "", testo: "" };
  // Lo stesso per i flussi (Fase 3): la fine del flusso e l'ultimo piano.
  let ultimaFineFlusso = { seq: 0, tipo: "", testo: "" };
  let ultimoPiano = 0;
  let ultimaRipresa = 0;
  let ultimoMessaggio = "";

  const avvisa = (tipo: Avviso["tipo"], testo: string, ms = 5000) => {
    if (chiusa) return;
    const a = { id: ++idAvviso, tipo, testo: unaRiga(traduci(testo) ?? testo, 300) };
    setAvvisi((l) => [...l.slice(-3), a]);
    const t = setTimeout(() => {
      timerAvvisi.delete(t);
      setAvvisi((l) => l.filter((x) => x.id !== a.id));
    }, ms);
    timerAvvisi.add(t);
  };
  // Il testo selezionato col mouse si copia da solo, come in opencode: con il
  // mouse acceso il Terminale non seleziona più per conto suo (prova di
  // Lorenzo del 19 ottobre, «non posso selezionare o copiare il testo»).
  // pbcopy funziona in ogni terminale del Mac; OSC 52 copre le sessioni SSH.
  const schermo = useRenderer();
  const copiaSelezione = (selezione: any) => {
    const testo = String(selezione?.getSelectedText?.() ?? "");
    if (!testo.trim() || selezione?.isDragging) return;
    let copiato = false;
    copiato = copiaNegliAppunti(testo);
    if (!copiato)
      try {
        copiato = Boolean((schermo as any).copyToClipboardOSC52?.(testo));
      } catch {}
    if (copiato) avvisa("ok", "Copiato negli appunti", 2000);
  };
  schermo.on("selection", copiaSelezione);
  onCleanup(() => schermo.off("selection", copiaSelezione));
  // Solo ciò che il registro non racconta (avvisi, informazioni): consegne,
  // annullamenti e pubblicazioni arrivano già come eventi (punto 14).
  const aggiungiLocale = (esiti: Esito[]) => {
    const da = esiti.filter((x) => x.tipo !== "ok");
    if (!da.length) return;
    setConv((c) => ({
      ...c,
      elementi: [
        ...c.elementi,
        ...da.map((x) =>
          x.tipo === "modifiche"
            ? ({ tipo: "modifiche", testo: x.testo, file: x.file } as const)
            : x.tipo === "avviso"
              ? ({ tipo: "avviso", testo: x.testo } as const)
              : ({ tipo: "info", testo: x.testo } as const),
        ),
      ],
    }));
  };

  // L'unico lettore del registro: aggiorna la conversazione e annota fine dei
  // turni, riprese automatiche, ultimo messaggio e passaggi.
  const aggiorna = async () => {
    const eventi = await leggiEventi(props.api, props.id, conv().ultimoSeq);
    if (eventi.length) {
      setConv((c) => applicaEventi(c, eventi));
      for (const e of eventi) {
        if (FINI_TURNO.includes(e.type) && e.seq > ultimaFine.seq)
          ultimaFine = { seq: e.seq, tipo: e.type, testo: String(e.payload?.message ?? "") };
        if (e.type === "resume.started") ultimaRipresa = e.seq;
        if ((e.type === "flow.completed" || e.type === "flow.stopped") && e.seq > ultimaFineFlusso.seq)
          ultimaFineFlusso = { seq: e.seq, tipo: e.type, testo: String(e.payload?.message ?? "") };
        if (e.type === "flow.plan_ready" && e.seq > ultimoPiano) ultimoPiano = e.seq;
        if (
          ["local.message", "local.failed", "direct.message", "direct.failed"].includes(e.type) &&
          e.seq > ultimaFineLocale
        )
          ultimaFineLocale = e.seq;
        // Il modello che risponde soltanto dice che servono modifiche ai file.
        if (e.type === "direct.files" && e.seq > ultimaRichiestaFile.seq)
          ultimaRichiestaFile = { seq: e.seq, testo: String(e.payload?.message ?? "") };
        if (e.type === "agent.message") {
          ultimoMessaggio = String(e.payload?.message ?? "");
          setParziale("");
        }
        if (e.type === "switch.started" && inTurno())
          avvisa("avviso", String(e.payload?.message ?? ""), 8000);
      }
    }
    const r = await props.api(`/runs/${props.id}`).catch(() => undefined);
    if (r) setRun(r);
    return eventi;
  };

  // Il ciclo di un turno: dal registro, finché arriva una fine con un numero
  // successivo all'invio (una fine vecchia non conta, punto 6). Rete di
  // sicurezza: se il turno non risulta più in corso per tre letture di fila,
  // è finito anche senza evento.
  // Il riquadro dei permessi (decisione di Lorenzo del 23 ottobre, «chiede
  // ogni volta»): l'AI aspetta, e senza risposta non parte nulla. Esc vale no.
  let permessoMostrato = "";
  const chiediPermessoAllaPersona = async (p: { id: string; ai: string; strumento: string; dettaglio?: string }) => {
    const v = await contesto.scegli<boolean>(
      `${nomeAI(p.ai)} chiede il permesso`,
      [
        { nome: "Consenti", valore: true },
        { nome: "Nega", valore: false },
      ],
      {
        nota: `Vuole usare ${p.strumento}${p.dettaglio && p.dettaglio !== "{}" ? ` · ${unaRiga(p.dettaglio, 220)}` : ""}. Senza risposta entro 3 minuti non parte nulla.`,
      },
    );
    await props
      .api(`/runs/${props.id}/permessi/${p.id}`, { consenti: v?.valore === true })
      .catch((e: unknown) => avvisa("errore", messaggio(e)));
  };
  const seguiTurno = async (daSeq: number) => {
    setInTurno(true);
    setInizioTurno(Date.now());
    let fermo = 0;
    while (!chiusa && ultimaFine.seq <= daSeq) {
      await new Promise((ok) => setTimeout(ok, 400));
      await aggiorna().catch(() => []);
      if (ultimaFine.seq > daSeq) break;
      const stato = run().state;
      // Si smette di seguire solo con il turno davvero fermo. Anche la
      // verifica, la fotografia e il passaggio a un'altra AI sono il turno:
      // prima contava solo RUNNING e STARTING, e con una verifica di più di
      // un secondo («npm test» su Windows, collaudo della beta.18) il turno
      // si lasciava prima della sua fine e il lavoro non veniva consegnato.
      fermo = ["PAUSED", "BLOCKED", "CANCELLED", "FAILED", "SUCCEEDED", "READY"].includes(stato) ? fermo + 1 : 0;
      if (fermo >= 3) break;
      if (stato === "RUNNING") await osservaVivo();
    }
    setParziale("");
    setAttivita("");
    setInterrompendo(false);
    if (chiusa) return;
    await dopoLaFine(ultimaFine.seq > daSeq ? ultimaFine.tipo : "", daSeq);
  };
  // Mentre un'AI lavora: il testo in arrivo, l'attività, i permessi.
  const osservaVivo = async () => {
    const vivo = await props.api(`/runs/${props.id}/live`).catch(() => ({}));
    setParziale(String((vivo as any).parziale ?? ""));
    // Ferma da più di tre minuti su uno strumento: si dice quale, e come
    // uscirne (prova di Lorenzo del 23 ottobre: un connettore restava
    // appeso e sembrava che Continuity fosse bloccata).
    const fermoDa = Number((vivo as any).fermoDa ?? 0);
    const azione = String((vivo as any).ultimaAzione ?? "");
    setAttivita(
      fermoDa >= 180
        ? lingua() === "en" ? `no activity for ${Math.floor(fermoDa / 60)} min${azione ? ` · stuck on “${azione}”` : ""} · press esc twice to stop` : `nessun segno da ${Math.floor(fermoDa / 60)} min${azione ? ` · fermo su «${azione}»` : ""} · esc due volte per interrompere`
        : String((vivo as any).attivita ?? ""),
    );
    // Un'azione fuori dal progetto aspetta la tua risposta (Claude).
    const permesso = (vivo as any).permesso;
    if (permesso?.id && permesso.id !== permessoMostrato) {
      permessoMostrato = permesso.id;
      void chiediPermessoAllaPersona(permesso);
    }
  };
  // Un flusso (Fase 3): si segue fino alla sua fine, passo dopo passo. Il
  // piano chiede la risposta; il lavoro si consegna una volta, alla fine.
  const seguiFlusso = async (daSeq: number) => {
    setInTurno(true);
    setInizioTurno(Date.now());
    let pianoMostrato = 0;
    let senza = 0;
    while (!chiusa && ultimaFineFlusso.seq <= daSeq) {
      await new Promise((ok) => setTimeout(ok, 400));
      await aggiorna().catch(() => []);
      if (ultimaFineFlusso.seq > daSeq) break;
      const r = run();
      // Rete di sicurezza: nessun flusso in corso per tre letture di fila.
      senza = r.esecuzione ? 0 : senza + 1;
      if (senza >= 3) break;
      if (r.state === "RUNNING") await osservaVivo();
      else {
        setParziale("");
        setAttivita("");
      }
      if (r.esecuzione?.attesa === "piano" && ultimoPiano > pianoMostrato) {
        pianoMostrato = ultimoPiano;
        setParziale("");
        if (!(await rispondiAlPiano(contesto))) {
          // Esc: il piano resta in attesa, il terminale torna libero; invio
          // lo riapre.
          aggiungiLocale([{ tipo: "info", testo: "⏸ Il piano aspetta il tuo sì: premi invio per rispondere" }]);
          avvisa("info", "Il piano aspetta: premi invio per rispondere", 6000);
          setInTurno(false);
          return;
        }
      }
    }
    setParziale("");
    setAttivita("");
    setInterrompendo(false);
    setInTurno(false);
    if (chiusa) return;
    const fine = ultimaFineFlusso.seq > daSeq ? ultimaFineFlusso : undefined;
    const concluso = fine && (fine.tipo === "flow.completed" || /concluso con problemi/.test(fine.testo));
    if (concluso) {
      // NON pronto o problemi rimasti: si chiede prima di portare il lavoro.
      let porta = true;
      if (/NON pronto|concluso con problemi/.test(fine!.testo)) {
        const v = await contesto.scegli<boolean>(
          /NON pronto/.test(fine!.testo) ? "La verifica finale dice NON PRONTO" : "Restano dei problemi",
          [
            { nome: "Lascia il lavoro nella copia", valore: false },
            { nome: "Portalo lo stesso nella mia cartella", valore: true },
          ],
          { nota: "Nella copia puoi farlo correggere con un altro messaggio; /applica lo porta nella cartella quando vuoi." },
        );
        porta = v?.valore === true;
      }
      if (porta) {
        const esiti = await dopoIlTurno(props.api, props.id).catch((e) => [{ tipo: "avviso" as const, testo: messaggio(e) }]);
        aggiungiLocale(esiti);
        for (const x of esiti)
          if (x.tipo === "ok" || x.tipo === "avviso") avvisa(x.tipo === "ok" ? "ok" : "avviso", x.testo);
        await aggiorna().catch(() => {});
      } else aggiungiLocale([{ tipo: "info", testo: "Il lavoro resta nella copia: /applica lo porta nella tua cartella quando vuoi." }]);
    } else if (fine)
      aggiungiLocale([{ tipo: "info", testo: "Il lavoro fatto finora è nella copia: /applica lo porta nella tua cartella, oppure scrivi come proseguire." }]);
    if (finisceConDomanda(ultimoMessaggio) && concluso) avvisa("info", "L'AI aspetta una tua risposta");
    await prossimoInCoda();
  };
  const dopoLaFine = async (fine: string, daSeq: number) => {
    // Il turno si è fermato perché l'AI non è collegata: si propone di
    // collegarla subito (/collega), invece di lasciare solo la riga.
    if ((fine === "run.blocked" || fine === "turn.failed" || fine === "turn.blocked") && !chiusa)
      await proponiCollegamento(contesto, ultimaFine.testo).catch(() => false);
    // Un turno ripreso dal motore lo consegna il motore stesso: consegnarlo
    // anche da qui dava messaggi contraddittori (punto 15).
    if (fine === "turn.completed" && ultimaRipresa <= daSeq) {
      const esiti = await dopoIlTurno(props.api, props.id).catch((e) => [
        { tipo: "avviso" as const, testo: messaggio(e) },
      ]);
      aggiungiLocale(esiti);
      for (const x of esiti)
        if (x.tipo === "ok" || x.tipo === "avviso")
          avvisa(x.tipo === "ok" ? "ok" : "avviso", x.testo);
      await aggiorna().catch(() => {});
    }
    if (fine === "turn.completed" && finisceConDomanda(ultimoMessaggio)) {
      aggiungiLocale([{ tipo: "info", testo: "❓ L'AI aspetta una tua risposta" }]);
      avvisa("info", "L'AI aspetta una tua risposta");
    }
    if (fine === "run.paused")
      aggiungiLocale([
        {
        tipo: "info",
          testo:
            "Il lavoro fatto finora è salvato nella copia di lavoro: /applica lo porta nella tua cartella, oppure scrivi come proseguire.",
        },
      ]);
    setInTurno(false);
    // Codex non può chiedere a metà turno: lo strumento è stato bloccato, e
    // si chiede adesso se consentirlo per il turno dopo. La sessione si
    // rilegge prima: una lettura vecchia non deve far saltare la domanda.
    if (fine === "turn.completed") await aggiorna().catch(() => {});
    const negati: string[] = fine === "turn.completed" ? (run().permessiNegati ?? []) : [];
    if (negati.length && !chiusa) {
      const v = await contesto.scegli<boolean>(
        `${nomeAI(run().agent)} voleva fare un'azione fuori dal progetto`,
        [
          { nome: "Consenti e continua", valore: true },
          { nome: "Non consentire", valore: false },
        ],
        { nota: `Bloccato: ${negati.join(", ")}. Il permesso vale solo per il prossimo turno.` },
      );
      const sì = v?.valore === true;
      const ok = await props
        .api(`/runs/${props.id}/permessi-turno`, { consenti: sì })
        .then(() => true, (e: unknown) => (avvisa("errore", messaggio(e)), false));
      if (sì && ok) {
        await aggiorna().catch(() => {});
        await invia(lingua() === "en" ? `You have my permission for: ${negati.join(", ")}. Do only this, then tell me what happened.` : `Hai il mio permesso per: ${negati.join(", ")}. Fai solo questo, poi dimmi com'è andata.`);
        return;
      }
    }
    if (fine === "run.cancelled") {
      if (coda().length)
        avvisa("avviso", `${coda().length} messaggi in coda non inviati: la sessione è stata annullata`);
      setCoda([]);
      return props.onEsci();
    }
    // Senza crediti nessuna richiesta in coda può essere servita: si dice una
    // volta sola, invece di ripetere lo stesso errore per ciascuna.
    if (fine === "turn.blocked" || fine === "run.blocked") {
      if (coda().length)
        avvisa(
          "avviso",
          `${coda().length} messaggi in coda messi da parte: riscrivili quando i crediti tornano`,
          8000,
        );
      setCoda([]);
      return;
    }
    await prossimoInCoda();
  };

  // Un compito dell'AI ibrida: come un turno per lo schermo (rotella, testo in
  // arrivo, coda), ma finisce con «local.message» o «local.failed».
  const seguiLocale = async (daSeq: number) => {
    localeInCorso = true;
    while (!chiusa && ultimaFineLocale <= daSeq) {
      await new Promise((ok) => setTimeout(ok, 300));
      await aggiorna().catch(() => []);
      if (ultimaFineLocale > daSeq) break;
      const vivo = await props.api(`/runs/${props.id}/live`).catch(() => ({}));
      setParziale(String((vivo as any).parziale ?? ""));
    }
    setParziale("");
    localeInCorso = false;
    setInTurno(false);
    // Servono modifiche ai file: chi risponde soltanto non le fa. Lo si dice e
    // si propone l'AI della sequenza (decisione di Lorenzo del 25 ottobre).
    if (!chiusa && ultimaRichiestaFile.seq > daSeq && run().risponde) {
      const chi = providerNoto((run().providers ?? [])[0] ?? "")?.nome ?? "l'AI della sequenza";
      const v = await contesto.scegli<boolean>(
        `${nomeAI(run().risponde.provider)} non modifica i file`,
        [
          { nome: `Passa la richiesta a ${chi}`, valore: true },
          { nome: "Resta qui", valore: false },
        ],
        { nota: "Questa richiesta cambia i file del progetto: serve un'AI che ci lavori. Da lì in poi risponde lei." },
      );
      if (v?.valore) {
        const testo = ultimaRichiestaFile.testo;
        await props.api(`/runs/${props.id}/risponde`, { provider: null }).catch(() => {});
        await aggiorna().catch(() => {});
        await invia(testo);
        return;
      }
    }
    if (!chiusa) await prossimoInCoda();
  };

  const prossimoInCoda = async () => {
    const prossimo = coda()[0];
    if (!prossimo || chiusa) return;
    setCoda((c) => c.slice(1));
    await invia(prossimo, { dallaCoda: true });
  };

  // Durante un turno solo questi comandi partono subito: gli altri cambiano
  // file o sessione e vanno in coda, come nel terminale a righe (punto 3).
  const INNOCUI = ["/stato", "/file", "/aiuto"];

  const invia = async (
    testo: string,
    opzioni: { dallaCoda?: boolean } = {},
  ): Promise<boolean> => {
    const t = testo.trim();
    // Il piano aspetta il sì (dopo un esc, o riaprendo Continuity): invio,
    // anche a campo vuoto, riapre il riquadro; un messaggio scritto resta nel
    // campo. Prima veniva rifiutato e non si capiva come rispondere (prova di
    // Lorenzo del 27 ottobre). I comandi partono come sempre.
    if (!chiusa && !inTurno() && run().esecuzione?.attesa === "piano" && !t.startsWith("/")) {
      const daSeq = conv().ultimoSeq;
      if (await rispondiAlPiano(contesto)) await seguiFlusso(daSeq);
      return !t;
    }
    if (!t || chiusa) return true;
    // Una chiave non deve mai finire nella cronologia (punto 18).
    if (!/^\/collega\b/i.test(t) && !opzioni.dallaCoda) {
      setCronologia((c) => [t, ...c.filter((x) => x !== t)].slice(0, 50));
      posizioneCronologia = -1;
    }
    if (inTurno() && !INNOCUI.includes(t.split(/\s+/)[0].toLowerCase())) {
      setCoda((c) => [...c, t]);
      avvisa("info", t.startsWith("/esci") ? "Esco a fine turno" : "In coda: parte a fine turno", 3000);
      return true;
    }
    if (await eseguiComando(t, contesto)) {
      if (!inTurno()) await prossimoInCoda();
      return true;
    }
    if (t.length > LIMITE_RICHIESTA) {
      avvisa(
        "avviso",
        lingua() === "en" ? `Your request has ${t.length.toLocaleString("en-US")} characters; the maximum is ${LIMITE_RICHIESTA.toLocaleString("en-US")}. Save it to a file and attach it with /attach.` : `La richiesta è di ${t.length.toLocaleString("it-IT")} caratteri: il massimo è ${LIMITE_RICHIESTA.toLocaleString("it-IT")}. Salvala in un file e allegala con /allega.`,
        8000,
      );
      return false;
    }
    // Le AI chiamate con @ (27 ottobre): prima di partire il riepilogo «chi
    // fa cosa», da confermare o cambiare (salvo «Parti sempre senza
    // chiedere»). Annullato, il messaggio torna nel campo.
    let incarichi: Incarico[] | undefined;
    const letti = incarichiDalMessaggio(t).incarichi;
    if (letti.length) {
      const config: any = await props.api("/flussi").catch(() => ({}));
      incarichi = config.confermaIncarichi === false ? letti : await confermaIncarichi(contesto, letti);
      if (!incarichi) return false;
    }
    // Segnato prima della chiamata: il controllo periodico non deve vedere il
    // turno partito e mettersi a seguirlo una seconda volta. Il registro si
    // legge fino in fondo prima dell'invio: le fine vecchie restano indietro.
    setInTurno(true);
    setInizioTurno(Date.now());
    await aggiorna().catch(() => {});
    const daSeq = conv().ultimoSeq;
    // Il messaggio compare subito, come in opencode: la conversazione non
    // resta vuota per mezzo secondo (confronto REA, A4). L'evento
    // «user.request» del registro lo sostituisce.
    setConv((c) => ({
      ...c,
      elementi: [...c.elementi, { tipo: "richiesta", testo: t, locale: true }],
    }));
    // Dove va il messaggio: un compito con la sua parola («#spiega …»), il
    // modello locale scelto con shift+tab, o la sequenza delle AI.
    const conf = ibrida()?.config;
    const compito = conf && !incarichi ? compitoDalTesto(conf, t) : undefined;
    // Con le @ decide il messaggio: niente modello locale né chi risponde soltanto.
    const locale = !incarichi && (compito || (conf?.attiva && destinatario() === "risposte"));
    // Un modello che risponde soltanto, scelto con /ai (25 ottobre): resta
    // finché non se ne sceglie un altro.
    const diretto = !incarichi && !locale && Boolean(run().risponde);
    let avviato: any;
    try {
      if (diretto) await props.api(`/runs/${props.id}/diretto`, { testo: t });
      else if (locale)
        await props.api(`/runs/${props.id}/locale`, {
          testo: compito ? compito.testo || t : t,
          compito: compito?.compito.id ?? "chiedi",
        });
      else
        avviato = await props.api(`/runs/${props.id}/turn`, {
          text: t,
          ...(incarichi ? { incarichi } : conf?.attiva && destinatario() === "file" ? { provider: "ollama" } : {}),
        });
    } catch (e) {
      setConv((c) => ({
        ...c,
        elementi: c.elementi.filter((x) => !(x.tipo === "richiesta" && (x as any).locale)),
      }));
      setInTurno(false);
      // Un'AI non collegata: il riquadro per collegarla, non un errore.
      if (!(await proponiCollegamento(contesto, messaggio(e)).catch(() => false))) avvisa("errore", messaggio(e));
      // Un messaggio della coda non si perde: torna in testa (punto 8).
      if (opzioni.dallaCoda) setCoda((c) => [t, ...c]);
      return false;
    }
    if (locale || diretto) await seguiLocale(daSeq);
    else if (avviato?.esecuzione) await seguiFlusso(daSeq);
    else await seguiTurno(daSeq);
    return true;
  };

  const contesto: Contesto = {
    // Ogni lettura dei flussi aggiorna i nomi scelti dalla persona, che la
    // traduzione non deve toccare (ottavo collaudo, CT-2.0-606).
    api: (async (percorso: string, ...resto: any[]) => {
      const r = await (props.api as any)(percorso, ...resto);
      if (percorso === "/flussi") ricordaNomiScelti(r);
      return r;
    }) as Api,
    id: props.id,
    cartellaDati: props.cartellaDati,
    run,
    inTurno,
    avvisa,
    aggiungiLocale,
    aggiorna: async () => {
      await aggiorna();
    },
    esci: () => props.onEsci(),
    ricaricaIbrida,
    scegli: (titolo, voci, opzioni) =>
      new Promise((risolvi) =>
        setDialogo({
          tipo: "scelta",
          titolo: traduci(titolo) ?? titolo,
          voci: voci.map((v) => ({ ...v, nome: traduci(v.nome) ?? v.nome, descrizione: traduci(v.descrizione), gruppo: traduci(v.gruppo), tasto: traduci(v.tasto) })),
          ricerca: opzioni?.ricerca,
          nota: traduci(opzioni?.nota),
          testo: opzioni?.testo,
          risolvi: (v) => {
            setDialogo(undefined);
            risolvi(v as any);
          },
        }),
      ),
    chiedi: (titolo, opzioni) =>
      new Promise((risolvi) =>
        setDialogo({
          tipo: "domanda",
          titolo: traduci(titolo) ?? titolo,
          testo: traduci(opzioni?.testo),
          nascosta: opzioni?.nascosta,
          link: opzioni?.link,
          errore: opzioni?.errore,
          risolvi: (r) => {
            setDialogo(undefined);
            risolvi(r);
          },
        }),
      ),
    // Il login ufficiale di Codex o Claude Code (configurazione iniziale):
    // l'interfaccia si sospende, il programma ha il terminale, poi si torna.
    nelTerminale: async (comando, argomenti, ambiente, cartella) => {
      await schermo.suspend();
      try {
        spawnSync(comando, argomenti, { env: ambiente, cwd: cartella, stdio: "inherit" });
      } finally {
        await schermo.resume();
      }
    },
  };

  // I comandi suggeriti mentre si scrive «/…» (richiesta di Lorenzo del 30
  // ottobre): un piccolo menu sopra il campo, che si restringe lettera dopo
  // lettera. Si cerca nel nome del comando in tutte e due le lingue
  // («/conn» trova /collega anche in italiano). ↑↓ sceglie, tab completa,
  // invio esegue, esc chiude.
  const comandiSuggeriti = createMemo(() => {
    const scritto = testoCampo().toLowerCase();
    if (comandiNascosti() || !/^\/[^\s]*$/.test(scritto)) return [];
    const voci = vociMenu();
    return voci
      .filter((v, i) => String(v.valore).toLowerCase().startsWith(scritto) || COMANDI_TUI[i]?.nome.toLowerCase().startsWith(scritto))
      .slice(0, 8);
  });
  const menuComandi = async () => {
    const scelta = await contesto.scegli("Comandi", vociMenu(), { ricerca: true });
    if (scelta) await invia(scelta.valore as string);
  };

  useKeyboard((tasto) => {
    if (dialogo()) return;
    if (tasto.ctrl && tasto.name === "p") return void menuComandi();
    const suggeriti = comandiSuggeriti();
    if (suggeriti.length) {
      if (tasto.name === "up" || tasto.name === "down") {
        setSceltaComando((i) => (i + (tasto.name === "down" ? 1 : -1) + suggeriti.length) % suggeriti.length);
        return;
      }
      if (tasto.name === "tab" && !tasto.shift) {
        campo?.setText?.(String(suggeriti[Math.min(sceltaComando(), suggeriti.length - 1)].valore) + " ");
        campo?.gotoBufferEnd?.();
        return;
      }
      if (tasto.name === "escape") {
        setComandiNascosti(true);
        return;
      }
    }
    // shift+tab: dove va il prossimo messaggio, se l'AI ibrida è a comando.
    if (tasto.name === "tab" && tasto.shift) {
      const conf = ibrida()?.config;
      if (!conf?.attiva || !conf.aComando) {
        avvisa("info", "AI ibrida non a comando: accendila con /ibrida", 4000);
        return;
      }
      const ordine = ["sequenza", "risposte", "file"] as const;
      const prossimo = ordine[(ordine.indexOf(destinatario()) + 1) % ordine.length];
      setDestinatario(prossimo);
      // Tornando alle altre AI, il modello del Mac lascia subito la memoria.
      if (prossimo === "sequenza") void props.api("/ibrida/libera", {}).catch(() => {});
      // Si dice sempre dove vanno i messaggi: il giro di tre posizioni senza
      // avviso faceva tornare a Codex senza accorgersene (25 ottobre).
      const locale = nomeAI(nomeLocale(conf.modello));
      avvisa(
        "info",
        prossimo === "risposte"
          ? `Messaggi a ${locale} sul computer · solo risposte`
          : prossimo === "file"
            ? `Messaggi a ${locale} sul computer · lavora sui file`
            : `Messaggi a ${nomeAI(ai())}`,
        4000,
      );
      return;
    }
    // Scorrere la conversazione: pagina su e giù.
    if ((tasto.name === "pageup" || tasto.name === "pagedown") && scorrimento) {
      const passo = Math.max(3, dim().height - 8);
      scorrimento.scrollBy?.(tasto.name === "pageup" ? -passo : passo);
      return;
    }
    // ctrl+c con del testo lo svuota e basta, anche durante un turno (punto 4).
    if (tasto.ctrl && tasto.name === "c" && campo?.plainText) {
      campo.clear?.();
      return;
    }
    // esc due volte (come opencode) o ctrl+c due volte (come il terminale a
    // righe) interrompono il turno; il lavoro fatto resta.
    if (inTurno() && (tasto.name === "escape" || (tasto.ctrl && tasto.name === "c"))) {
      const ora = Date.now();
      const ultimo = tasto.name === "escape" ? ultimoEsc : ultimoCtrlC;
      if (ora - ultimo < 5000) {
        // Azzerati: una terza pressione non deve far uscire (punto 7).
        ultimoEsc = 0;
        ultimoCtrlC = 0;
        setArmato(false);
        setInterrompendo(true);
        avvisa("avviso", localeInCorso ? "Fermo il compito locale…" : "Interrompo il turno…");
        const ferma = localeInCorso
          ? props
              .api(`/runs/${props.id}/locale/stop`, {})
              .then(() => true, () => false)
          : run().esecuzione
            ? props.api(`/runs/${props.id}/flusso/ferma`, {}).then(() => true, () => false)
            : interrompi(props.api, props.id);
        void ferma.then((ok) => {
          if (!ok) avvisa("errore", "Non sono riuscito a interrompere: riprova");
        });
        return;
      }
      // Al primo tasto la scritta del piè cambia per 5 secondi, come in
      // opencode (confronto REA, M8), invece di un avviso in alto.
      setArmato(true);
      setTimeout(() => setArmato(false), 5000);
      if (tasto.name === "escape") ultimoEsc = ora;
      else ultimoCtrlC = ora;
      return;
    }
    if (tasto.ctrl && tasto.name === "c") {
      const ora = Date.now();
      if (ora - ultimoCtrlC < 3000) return props.onEsci();
      ultimoCtrlC = ora;
      avvisa("info", "Premi di nuovo ctrl+c per uscire (la sessione resta)", 3000);
      return;
    }
    // La cronologia degli invii con le frecce, quando il campo è vuoto o
    // contiene già una voce della cronologia.
    if ((tasto.name === "up" || tasto.name === "down") && campo) {
      const voci = cronologia();
      const testo = campo.plainText ?? "";
      if (testo && !voci.includes(testo)) return;
      if (tasto.name === "up" && posizioneCronologia < voci.length - 1)
        posizioneCronologia++;
      else if (tasto.name === "down" && posizioneCronologia > -1)
        posizioneCronologia--;
      campo.setText?.(posizioneCronologia >= 0 ? voci[posizioneCronologia] : "");
      campo.gotoBufferEnd?.();
    }
  });

  onCleanup(() => {
    chiusa = true;
    // Uscendo, un compito locale non resta a girare da solo.
    if (localeInCorso) void props.api(`/runs/${props.id}/locale/stop`, {}).catch(() => {});
    if (attesaTrascinati) clearTimeout(attesaTrascinati);
    for (const t of timerAvvisi) clearTimeout(t);
  });

  // Gli intervalli si registrano subito, prima di ogni await: un onCleanup
  // chiamato dopo un await è fuori dal proprietario di Solid e non scatta
  // mai, e l'intervallo teneva vivo il processo dopo l'uscita.
  // Il cronometro ogni 250 ms; le rotelle ogni 80 ms, solo durante il turno.
  const orologio = setInterval(() => setAdesso(Date.now()), 250);
  const giro = setInterval(() => {
    if (inTurno()) setPasso((p) => p + 1);
  }, 80);
  // Fuori dai turni il registro si guarda ogni 2 secondi: una richiesta in
  // attesa dei crediti riparte da sola (ripresa automatica del motore), e
  // va seguita come un turno scritto qui.
  let pronto = false;
  const sguardo = setInterval(async () => {
    if (!pronto || inTurno() || chiusa) return;
    const prima = ultimaFine.seq;
    await aggiorna().catch(() => {});
    if (chiusa || inTurno()) return;
    // Un flusso che va avanti da solo (dopo la risposta al piano da /flusso).
    if (run().esecuzione && !run().esecuzione.attesa) void seguiFlusso(ultimaFineFlusso.seq);
    else if (!run().esecuzione && ["RUNNING", "STARTING"].includes(run().state)) void seguiTurno(prima);
  }, 2000);
  onCleanup(() => {
    clearInterval(orologio);
    clearInterval(giro);
    clearInterval(sguardo);
  });

  onMount(async () => {
    inizializzaLingua(props.cartellaDati);
    props.api("/flussi").then(ricordaNomiScelti, () => {});
    await aggiorna().catch(() => {});
    void ricaricaIbrida();
    // A ogni apertura si rileggono i connettori delle piattaforme, in
    // sottofondo, come nel terminale a righe (punto 11).
    props.api(`/runs/${props.id}/connettori?aggiorna=1`).catch(() => {});
    // Una sessione ripresa a turno in corso: lo si segue.
    // Una versione nuova pubblicata: un avviso a ogni apertura, che resta 30 secondi.
    void controllaAggiornamento(props.cartellaDati, fileURLToPath(new URL("../..", import.meta.url))).then((nuova) => {
      if (nuova)
        avvisa(
          "info",
          lingua() === "en"
            ? `Continuity ${nuova} is available: to update, quit and type continuity update`
            : `È disponibile Continuity ${nuova}: per aggiornare esci e scrivi continuity update`,
          30000,
        );
    });
    if (props.configura) void configurazione(contesto);
    else if (props.proponiConfigurazione) void proponiConfigurazione(contesto);
    if (run().esecuzione) void seguiFlusso(ultimaFineFlusso.seq);
    else if (["RUNNING", "STARTING"].includes(run().state)) void seguiTurno(ultimaFine.seq);
    pronto = true;
    for (const riga of props.anticipate ?? []) await invia(riga);
  });

  // Durante un turno, chi lavora davvero (run().agent); fuori, chi risponderà
  // al prossimo messaggio. Prima si leggeva sempre «prossimo», che a turno in
  // corso poteva essere vecchio: «Codex sta lavorando» mentre lavorava Claude.
  // Chi risponde: un modello scelto con /ai, se c'è; altrimenti durante un
  // turno chi lavora davvero, fuori chi risponderà al prossimo messaggio.
  const ai = () =>
    (run().risponde?.provider ??
      (["STARTING", "RUNNING", "QUIESCING"].includes(run().state)
        ? run().agent
        : run().prossimo ?? run().agent)) ?? "";
  // Il modello scelto, o quello della configurazione del CLI (confronto, M4).
  // Ollama in sequenza usa il modello dell'AI ibrida, se non se n'è scelto un altro.
  const modello = () =>
    (run().risponde ? run().risponde.modello : undefined) ??
    (run().modelli ?? {})[ai()] ??
    (ai() === "ollama" ? ibrida()?.config.modello : undefined) ??
    modelloPredefinito(ai());
  const accesso = () => {
    const p = providerNoto(ai());
    return p?.accesso === "abbonamento"
      ? p.motore === "codex"
        ? lingua() === "en" ? "ChatGPT subscription" : "abbonamento ChatGPT"
        : lingua() === "en" ? "Claude subscription" : "abbonamento Claude"
      : p?.motore === "diretto"
        ? lingua() === "en" ? "free" : "gratuito"
        : p?.accesso === "chiave"
        ? lingua() === "en" ? "API key" : "chiave API"
        : p?.accesso === "locale"
          ? lingua() === "en" ? "on your computer" : "sul tuo computer"
          : "";
  };
  const consumo = () => {
    const tot = Object.values<any>(run().consumi ?? {});
    const entrata = tot.reduce((s, c) => s + (c.entrata ?? 0), 0);
    const uscita = tot.reduce((s, c) => s + (c.uscita ?? 0), 0);
    const costo = tot.reduce((s, c) => s + (c.costo ?? 0), 0);
    if (!entrata && !uscita && run().uso)
      return `${compatto(run().uso.entrata)} in · ${compatto(run().uso.uscita)} out`;
    return (
      (entrata || uscita
        ? `${compatto(entrata)} in · ${compatto(uscita)} out`
        : "") + (costo ? ` · circa ${costo.toFixed(2).replace(".", ",")} $` : "")
    );
  };
  const quota = () =>
    Object.entries<any>(run().esauriti ?? {})
      .map(([p, v]) =>
        v.credito
          ? lingua() === "en" ? `${p} out of credit` : `${p} senza credito`
          : v.riprendi && Date.parse(v.riprendi) > adesso()
            ? lingua() === "en"
              ? `${p} returns at ${new Date(v.riprendi).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`
              : `${p} torna alle ${new Date(v.riprendi).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`
            : "",
      )
      .filter(Boolean)
      .join(" · ");
  const casa = () => !conv().elementi.length && !inTurno();
  // L'uscita delle verifiche fallite va sotto l'ultima verifica non riuscita,
  // se è anche l'ultima verifica della conversazione.
  const ultimaVerificaFallita = () => {
    const v = [...conv().elementi].reverse().find((x) => x.tipo === "verifica");
    return v && (v as any).esito === "ko" ? v : undefined;
  };
  const dettagliVerifiche = () =>
    ((run().checks ?? []) as any[])
      .filter((k) => k.passed === false && k.dettaglio)
      .flatMap((k) => [`${k.label ?? k.id}:`, ...String(k.dettaglio).split("\n")])
      .filter((r) => r.trim());
  // La barra laterale solo oltre 120 colonne, come opencode (confronto, A2).
  const conBarra = () => !casa() && dim().width > 120;
  const nomeCartella = () => nomeFile(props.cartella);
  // Il titolo della scheda: la prima richiesta, accorciata, o la cartella.
  const titoloSessione = () => {
    const prima = conv().elementi.find((x) => x.tipo === "richiesta") as any;
    const testo = prima ? String(prima.testo).split("\n")[0] : nomeCartella();
    return testo.length > 34 ? testo.slice(0, 33) + "…" : testo;
  };
  // A destra il consumo; la quota sta nella barra laterale e negli avvisi, e
  // sotto le 100 colonne cede il posto alla cartella (confronto, M1).
  const versionePiede = () => (!casa() && !conBarra() && dim().width >= 100 ? versioneApp() : undefined);
  const scorciatoiePiede = (): [string, string][] =>
    ibrida()?.config.attiva && ibrida()?.config.aComando && dim().width >= 100
      ? [["shift+tab", lingua() === "en" ? "Hybrid AI" : "AI ibrida"], ["ctrl+p", lingua() === "en" ? "commands" : "comandi"]]
      : [["ctrl+p", lingua() === "en" ? "commands" : "comandi"]];
  const destraPiede = () =>
    [consumo(), dim().width >= 100 ? quota() : "", coda().length ? `${coda().length} in coda` : ""]
      .filter(Boolean)
      .join(" · ");
  // Il segnaposto solo nella schermata iniziale, come opencode (confronto, M3).
  const segnaposto = () =>
    casa() ? `${lingua() === "en" ? "Ask anything…" : "Chiedi qualcosa…"} «${traduci(ESEMPI[Math.floor(inizio / 60000) % ESEMPI.length]) ?? ESEMPI[Math.floor(inizio / 60000) % ESEMPI.length]}»` : "";
  const inizio = Date.now();

  const campoEPiede = () => (
    <>
      <Show when={comandiSuggeriti().length}>
        <box flexDirection="column" backgroundColor={tema.pannello} paddingLeft={2} paddingRight={2} flexShrink={0}>
          <For each={comandiSuggeriti()}>
            {(v, i) => (
              <text wrapMode="none" truncate>
                <span style={{ fg: i() === sceltaComando() ? tema.accento : tema.testo }}>
                  {(i() === sceltaComando() ? "› " : "  ") + String(v.valore).padEnd(16)}
                </span>
                <span style={{ fg: tema.tenue }}>{v.descrizione ?? v.nome}</span>
              </text>
            )}
          </For>
          <text wrapMode="none" truncate fg={tema.tenue}>
            {lingua() === "en" ? "↑↓ choose · tab completes · enter runs · esc closes" : "↑↓ scegli · tab completa · invio esegue · esc chiude"}
          </text>
        </box>
      </Show>
      <Campo
        ai={destinatario() !== "sequenza" ? nomeLocale(ibrida()?.config.modello ?? "") : ai()}
        modello={destinatario() !== "sequenza" ? ibrida()?.config.modello : modello()}
        accesso={
          destinatario() === "risposte"
            ? "sul tuo computer · solo risposte"
            : destinatario() === "file"
              ? "sul tuo computer · lavora sui file"
              : accesso()
        }
        destinatario={destinatario() !== "sequenza" ? "AI ibrida" : undefined}
        ragionamento={(run().ragionamento ?? {})[ai()]}
        focused={!dialogo()}
        inTurno={inTurno()}
        segnaposto={segnaposto()}
        rif={(r: any) => (campo = r)}
        onIncolla={incolla}
        onCambio={contenutoCambiato}
        allegati={run().allegati ?? []}
        onTogliAllegato={(nome) => void togliAllegato(nome)}
        onPiu={() => void dalFinder()}
        onInvia={() => {
          // Invio con il menu dei comandi aperto: si esegue il comando scelto,
          // se quello scritto non è già un comando intero.
          const suggeriti = comandiSuggeriti();
          if (suggeriti.length) {
            const scrittoOra = (campo?.plainText ?? "").trim().toLowerCase();
            if (!suggeriti.some((v) => String(v.valore).toLowerCase() === scrittoOra))
              campo?.setText?.(String(suggeriti[Math.min(sceltaComando(), suggeriti.length - 1)].valore));
          }
          setComandiNascosti(true);
          const scritto = campo?.plainText ?? "";
          const testo = espandi(scritto);
          incollati.clear();
          campo?.clear?.();
          // Solo percorsi di file: si allegano, senza mandare nulla all'AI.
          const soloFile = soloFileTrascinati(testo);
          if (soloFile) return void allega(soloFile);
          // File fuori dal progetto citati nel messaggio: allegati prima
          // dell'invio, perché l'AI dalla sua copia non li vedrebbe.
          const fuori = fileFuoriProgetto(testo, props.cartella);
          if (fuori.length && !testo.trim().startsWith("/")) {
            void allega(fuori).then(() =>
              invia(testo).then((ok) => {
                if (!ok && !chiusa && !campo?.plainText) campo?.setText?.(testo);
              }),
            );
            return;
          }
          // Se l'invio fallisce il testo torna nel campo (punto 17).
          void invia(testo).then((ok) => {
            if (!ok && !chiusa && !campo?.plainText) campo?.setText?.(testo);
          });
        }}
      />
      <Piede
        inTurno={inTurno()}
        armato={armato()}
        interrompendo={interrompendo()}
        rotella={fotogramma(passo(), coloreAI(ai()), tema.fondo)}
        sinistra={
          inTurno()
            ? `${nomeAI(ai())} lavora da ${Math.max(0, Math.round((adesso() - inizioTurno()) / 1000))}s${attivita() ? " · " + attivita() : ""}`
            : percorsoBreve(
                props.cartella,
                // Lo spazio vero: anche versione e scorciatoie occupano il
                // piè. Prima non si contavano e il terminale tagliava la fine,
                // cioè il nome del progetto (31 ottobre). Nella schermata
                // iniziale il piè è più stretto: al massimo 48.
                Math.max(
                  16,
                  Math.min(
                    casa() ? 48 : Infinity,
                    (casa() ? Math.min(dim().width, 76) : dim().width) -
                      (casa() ? 0 : destraPiede().length + (versionePiede()?.length ?? 0)) -
                      scorciatoiePiede().reduce((n, [t, s]) => n + t.length + s.length + 4, 0) -
                      16 -
                      ramo.length,
                  ),
                ),
              ) + (ramo && ramo !== "HEAD" ? ":" + ramo : "")
        }
        destra={casa() ? "" : destraPiede()}
        versione={versionePiede()}
        scorciatoie={scorciatoiePiede()}
      />
    </>
  );

  return (
    <box
      flexDirection="row"
      width={dim().width}
      height={dim().height}
      backgroundColor={tema.fondo}
    >
      <Show
        when={!casa()}
        fallback={
          <box
            flexDirection="column"
            flexGrow={1}
            alignItems="center"
            paddingLeft={dim().width < 44 ? 1 : 2}
            paddingRight={dim().width < 44 ? 1 : 2}
          >
            <box flexGrow={1} minHeight={0} />
            <Show when={dim().height >= 14}>
              <box flexDirection="column" alignItems="center" flexShrink={0}>
                <For each={logo(dim().width < 44 ? "cy" : "continuity")}>
                  {(riga) => <text fg={tema.accento}>{riga}</text>}
                </For>
                <Show when={dim().width >= 90}>
                  <text fg={tema.tenue} marginTop={dim().height >= 30 ? 2 : 1}>
                    {lingua() === "en"
                      ? "Multiple AIs on the same project: when one runs out of credits, the next continues."
                      : "Più AI sullo stesso progetto: quando una finisce i crediti, continua la successiva."}
                  </text>
                </Show>
              </box>
            </Show>
            {/* Più aria fra logo e campo quando lo schermo lo permette (prova
                di Lorenzo del 19 ottobre). */}
            <box width="100%" maxWidth={75} paddingTop={dim().height >= 30 ? 4 : 2} flexShrink={0}>
              {campoEPiede()}
            </box>
            <box flexGrow={1} minHeight={0} />
            <box width="100%" flexDirection="row" justifyContent="space-between" flexShrink={0}>
              <text fg={tema.tenue}>
                {(run().risponde ? `risponde ${nomeAI(run().risponde.provider)} · ` : "") +
                  (run().providers ?? []).map(nomeAI).join(" → ")}
              </text>
              <Show when={dim().width >= 44}>
                <text fg={tema.tenue}>{`Continuity ${versioneApp()}`}</text>
              </Show>
            </box>
          </box>
        }
      >
        <box
          flexDirection="column"
          flexGrow={1}
          paddingLeft={dim().width < 44 ? 1 : 2}
          paddingRight={dim().width < 44 ? 1 : 2}
        >
          {/* La scheda in alto, come in opencode (confronto, M2): fondo
              rialzato, rotella mentre l'AI lavora, titolo in grassetto. */}
          <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between" gap={2}>
            <box backgroundColor={tema.rialzato} paddingLeft={1} paddingRight={2} maxWidth={40} flexShrink={1}>
              <text wrapMode="none" truncate>
                <span style={{ fg: inTurno() ? coloreAI(ai()) : tema.tenue }}>
                  {inTurno() ? PUNTINI[passo() % PUNTINI.length] + " " : "  "}
                </span>
                <span style={{ fg: tema.testo }}>
                  <b>{titoloSessione()}</b>
                </span>
              </text>
            </box>
            <Show when={!conBarra()}>
              <text fg={tema.tenue} wrapMode="none" truncate flexShrink={1}>
                {(run().risponde ? `risponde ${nomeAI(run().risponde.provider)} · ` : "") +
                  (run().providers ?? []).map(nomeAI).join(" → ")}
              </text>
            </Show>
          </box>
          <scrollbox
            ref={(r: any) => (scorrimento = r)}
            flexGrow={1}
            stickyScroll
            stickyStart="bottom"
            verticalScrollbarOptions={{ visible: false }}
          >
            <Show when={conv().elementi.length > VOCI_A_SCHERMO}>
              <box paddingLeft={3}>
                <text fg={tema.tenue}>
                  {`… ${conv().elementi.length - VOCI_A_SCHERMO} voci precedenti (il registro completo resta nel servizio)`}
                </text>
              </box>
            </Show>
            <For each={conv().elementi.slice(-VOCI_A_SCHERMO)}>
              {(e) => (
                <VoceConversazione
                  e={e}
                  modelloDi={(x) => (x ? ((run().modelli ?? {})[x] ?? modelloPredefinito(x)) : undefined)}
                  locale={(x) => !!x && x === nomeLocale(ibrida()?.config.modello ?? "")}
                  dettagli={e === ultimaVerificaFallita() ? dettagliVerifiche() : undefined}
                />
              )}
            </For>
            <Show when={parziale()}>
              <box paddingLeft={3} marginTop={1}>
                <Testo testo={parziale()} inArrivo />
              </box>
            </Show>
            {/* Mentre l'AI lavora, dove arriverà la risposta: rotella e cosa
                sta facendo (confronto REA, A4). */}
            <Show when={inTurno() && !parziale()}>
              <box paddingLeft={3} marginTop={1}>
                <text>
                  <span style={{ fg: coloreAI(ai()) }}>{PUNTINI[passo() % PUNTINI.length] + " "}</span>
                  <span style={{ fg: tema.tenue }}>
                    {attivita() || `${nomeAI(ai())} sta lavorando`}
                  </span>
                </text>
              </box>
            </Show>
            <box height={1} />
          </scrollbox>
          <box flexShrink={0} marginTop={1}>
            {campoEPiede()}
          </box>
        </box>
        <Show when={conBarra()}>
          <Barra
            titolo={nomeCartella()}
            run={run()}
            adesso={adesso()}
            consumo={consumo()}
            coda={coda().length}
            ibrida={ibrida()}
          />
        </Show>
      </Show>
      <Show when={dialogo()?.tipo === "scelta" && (dialogo() as DialogoScelta)}>
        {(d) => (
          <Scelta
            titolo={d().titolo}
            voci={d().voci}
            ricerca={d().ricerca}
            nota={d().nota}
            testo={d().testo}
            onScegli={(v) => d().risolvi(v)}
            onChiudi={() => d().risolvi(undefined)}
          />
        )}
      </Show>
      <Show when={dialogo()?.tipo === "domanda" && (dialogo() as DialogoDomanda)}>
        {(d) => (
          <Domanda
            titolo={d().titolo}
            testo={d().testo}
            nascosta={d().nascosta}
            link={d().link}
            errore={d().errore}
            onRisposta={(r) => d().risolvi(r)}
          />
        )}
      </Show>
      <Avvisi elenco={avvisi()} />
    </box>
  );
}

type DialogoScelta = {
  tipo: "scelta";
  titolo: string;
  voci: Voce<any>[];
  ricerca?: boolean;
  nota?: string;
  testo?: string;
  risolvi: (v: Voce<any> | undefined) => void;
};
type DialogoDomanda = {
  tipo: "domanda";
  titolo: string;
  testo?: string;
  nascosta?: boolean;
  link?: string;
  errore?: string;
  risolvi: (r: string | undefined) => void;
};
type Dialogo = DialogoScelta | DialogoDomanda;

// La rotella del piè mentre l'AI lavora, a blocchi come in opencode.
// I puntini della scheda e della riga «sta lavorando», come in opencode.
const PUNTINI = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
// Gli esempi nel campo vuoto, come i segnaposto di opencode.
const ESEMPI = [
  "Correggi i test che falliscono",
  "Qual è la struttura di questo progetto?",
  "Aggiungi una pagina di contatti",
  "Rendi il sito più veloce",
];
// Le sessioni lunghe hanno migliaia di voci: se ne disegnano le ultime
// (revisione del 14 ottobre, punto 12).
const VOCI_A_SCHERMO = 300;

export function compatto(n: number) {
  if (!n) return "0";
  return n >= 1_000_000
    ? (n / 1_000_000).toFixed(1).replace(".", ",") + "M"
    : n >= 1000
      ? (n / 1000).toFixed(1).replace(".", ",") + "K"
      : String(n);
}

// Il percorso nel piè: «~» per la cartella personale, poi si tolgono le
// cartelle centrali («~/…/progetto»), mai a metà di un nome (confronto, M1).
// Su Windows la cartella personale è in USERPROFILE (non c'è HOME) e le
// cartelle si separano con «\»: prima il percorso si tagliava a metà di un
// nome (collaudo del 31 ottobre).
export function percorsoBreve(percorso: string, massimo: number, casa = homedir()) {
  const p = casa && percorso.startsWith(casa) ? "~" + percorso.slice(casa.length) : percorso;
  if (p.length <= massimo) return p;
  const separatore = p.includes("\\") ? "\\" : "/";
  const parti = p.split(separatore);
  const ultima = parti[parti.length - 1];
  for (let primi = parti.length - 2; primi >= 1; primi--) {
    const prova = [...parti.slice(0, primi), "…", ultima].join(separatore);
    if (prova.length <= massimo) return prova;
  }
  return ultima.length <= massimo ? ultima : "…" + ultima.slice(-(massimo - 1));
}
export function abbrevia(percorso: string, massimo: number, casa = homedir()) {
  const p = casa && percorso.startsWith(casa) ? "~" + percorso.slice(casa.length) : percorso;
  return p.length <= massimo ? p : "…" + p.slice(-(massimo - 1));
}
