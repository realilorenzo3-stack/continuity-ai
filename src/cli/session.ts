import { LIMITE_RICHIESTA } from "../core/limiti.js";
import { PROVIDER, elencoDisponibili, providerNoto } from "../core/provider.js";
import { portachiaviDiSistema } from "../core/portachiavi.js";
import { dollari } from "../core/modelsdev.js";
import { collega } from "./collega.js";
import { inSilenzio, uscitaLettore } from "./muto.js";
import { join as unisci } from "node:path";

// La cartella dati del servizio, come la calcola il comando «continuity».
function cartellaDati() {
  return cartellaDatiPredefinita();
}
import { homedir } from "node:os";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  accento,
  avviso,
  bene,
  coloreAI,
  errore,
  forte,
  tenue,
  zonaInput,
} from "./schermo.js";
import { MODELLI_NOTI } from "../adapters/live.js";
import { PAROLE_COMANDO, comandoSimile, normalizzaComando, testoAiuto } from "./comandi.js";
import { cornice, rendiStorico } from "./storico.js";
import { cartellaDatiPredefinita } from "../piattaforma.js";

type Api = (path: string, body?: unknown) => Promise<any>;

const AIUTO = testoAiuto();

// Che cosa è successo nella cartella, in una riga: scritti, eliminati, uniti
// alle modifiche della persona, e ciò che non è stato consegnato. Una
// cancellazione taciuta faceva credere che non fosse successo nulla.
export function descriviConsegna(esito: any) {
  const parti: string[] = [];
  // Un file unito compare una volta sola, fra gli uniti.
  const scritti = (esito.applicati ?? []).filter(
    (f: string) => !(esito.uniti ?? []).includes(f),
  );
  if (scritti.length) parti.push(scritti.join(", "));
  if (esito.eliminati?.length)
    parti.push("eliminati: " + esito.eliminati.join(", "));
  if (esito.uniti?.length)
    parti.push("uniti alle tue modifiche: " + esito.uniti.join(", "));
  const riga = parti.length
    ? bene("  ✓ ") +
      `nella tua cartella: ${parti.join(" · ")}` +
      tenue("   /annulla per tornare indietro")
    : tenue(`  ${esito.messaggio ?? "Nessuna modifica da applicare"}`);
  const saltati = esito.saltati?.length
    ? "\n" +
      avviso("  ⚠ ") +
      `non consegnati (collegamenti simbolici): ${esito.saltati.join(", ")}`
    : "";
  return riga + saltati + "\n";
}

// «ordine claude, codex» scritto senza barra arrivava all'AI come richiesta, e
// l'AI si metteva a cercare nel sito dove cambiare «l'ordine». Una parola del
// riquadro seguita da un argomento è un comando solo se l'argomento non lascia
// dubbi: nomi di AI, un modello noto, un file che esiste. «ordine alfabetico
// dei file» resta una richiesta.
// «pubblica su git», «fai il push su github», «carica il sito su GitHub»:
// una richiesta di pubblicazione, non una domanda su come si fa. Con
// eventualmente il repository scritto nella frase (utente/nome).
export function intentoPubblica(
  testo: string,
): { destinazione?: string } | undefined {
  const t = testo.trim();
  if (t.length > 200 || t.includes("\n")) return undefined;
  if (
    /\?\s*$/.test(t) ||
    /^(come|perch[eé]|cosa|quando|posso|puoi spiegar|why|how)\b/i.test(t)
  )
    return undefined;
  // Un'azione di pubblicazione verso git/GitHub, oppure «fai il push».
  // «aggiorna il README del repo» non lo è: va all'AI.
  const verso =
    /\b(pubblica\w*|carica\w*|manda\w*|invia\w*|metti\w*|porta\w*|publish|upload|push)\b.*\b(su|in|nel|sul|nella|on|to)\s+(il\s+|la\s+)?(git|github|repo|repository)\b/i;
  const push =
    /^(fai|esegui|fammi|lancia)\s+(il\s+|un\s+)?push\b|^(push|pusha)\b/i;
  if (!verso.test(t) && !push.test(t)) return undefined;
  const destinazione = /\b([\w.-]+\/[\w.-]+)\b/.exec(t)?.[1];
  return { destinazione };
}

// «attiva la pubblicazione automatica», «disattiva il push automatico»: cambia
// la scelta fatta dopo la prima pubblicazione. Va riconosciuta prima di
// intentoPubblica, che altrimenti la prenderebbe per un «pubblica su git».
export function intentoAutomatica(testo: string): boolean | undefined {
  const t = testo.trim();
  if (t.length > 200 || t.includes("\n") || /\?\s*$/.test(t)) return undefined;
  if (!/\b(pubblicazion\w*|push|pubblica\w*)\s+(\w+\s+)?automatic\w*/i.test(t))
    return undefined;
  if (
    /\b(disattiv\w*|disabilit\w*|spegn\w*|togli\w*|ferm\w*|blocc\w*|non\s+voglio)\b/i.test(
      t,
    )
  )
    return false;
  if (/\b(attiv\w*|riattiv\w*|abilit\w*|accend\w*|voglio|metti\w*)\b/i.test(t))
    return true;
  return undefined;
}

// Una domanda all'utente nelle ultime righe del messaggio finale dell'AI.
export function finisceConDomanda(testo: string) {
  const righe = testo
    .trim()
    .split("\n")
    .map((r) => r.replace(/[*_`>\s-]+$/g, "").trim())
    .filter(Boolean);
  return righe.slice(-4).some((r) => r.endsWith("?"));
}

export function comandoSenzaBarra(testo: string) {
  // «esci» da solo vuol dire uscire, non una richiesta per l'AI (prova di
  // Lorenzo del 19 ottobre: Claude rispondeva «da qui non posso chiudere»).
  if (/^(esci|exit|quit)$/i.test(testo.trim())) return "/esci";
  if (/^(applica|annulla|chiudi)\s+forza$/i.test(testo.trim()))
    return "/" + testo.trim().toLowerCase().replace(/\s+/, " ");
  // «ragionamento alto», «ragionamento claude massimo»: solo con un livello
  // valido, altrimenti è una frase per l'AI.
  const r =
    /^ragionamento\s+(?:(codex|claude)\s+)?(basso|medio|alto|massimo)$/i.exec(
      testo.trim(),
    );
  if (r)
    return (
      "/ragionamento " +
      [r[1], r[2]]
        .filter(Boolean)
        .map((x) => x!.toLowerCase())
        .join(" ")
    );
  const m = /^(ordine|modello|allega)\s+(.+)$/i.exec(testo.trim());
  if (!m) return testo;
  const [, parola, argomento] = m;
  const comando = "/" + parola.toLowerCase() + " " + argomento.trim();
  if (parola.toLowerCase() === "ordine") {
    // Solo se ogni parola è un'AI nota (o «solo»): «ordine alfabetico dei
    // file» resta una richiesta per l'AI.
    const nomi = argomento.split(/[\s,→>]+/).filter(Boolean);
    return nomi.length &&
      nomi.every((n, i) => providerNoto(n) || (i === 0 && /^solo$/i.test(n)))
      ? comando
      : testo;
  }
  if (parola.toLowerCase() === "modello") {
    const noti = Object.values(MODELLI_NOTI).flat() as string[];
    return noti.includes(argomento.trim()) ? comando : testo;
  }
  const percorso = argomento.trim().replace(/^~(?=\/|$)/, homedir());
  return /^[~/.]/.test(argomento.trim()) && existsSync(percorso)
    ? comando
    : testo;
}

// The terminal shows what happens while it happens: the agent's own words, the
// switch when a provider runs out, and Continuity's verdict on the files.
// Che cosa fa Ctrl+C mentre un turno è in corso: lo imposta follow(), lo
// chiama il lettore della sessione. Fuori da un turno Ctrl+C esce, come «esci».
let ctrlCDuranteTurno: (() => void) | undefined;

async function follow(api: Api, id: string, from: number) {
  let seq = from;
  let running = true;
  let ultimoMessaggio = "";
  let agent = "";
  let bloccato = false;
  // Come è finito il turno, quando è finito da fuori.
  let fine: "annullata" | "pausa" | "fallito" | undefined;
  // Quanto testo dell'AI è già comparso: serve per aggiungere solo il nuovo e
  // per non ristampare il messaggio completo che arriva alla fine.
  let mostrato = "";
  // La riga che l'AI sta ancora scrivendo resta qui finché non è intera: il
  // cronometro si aggiorna sulla stessa riga del terminale e, trovandola a
  // metà, ne cancellava dei pezzi — la risposta ricompariva spezzata
  // («ive.», «tramite CSS.») e poi ripetuta per intero alla fine.
  let resto = "";
  // Il testo del messaggio in corso che è già comparso a schermo.
  let blocco = "";
  let aCapo = true;
  let consumo = "";
  const inizio = Date.now();
  const durata = () => {
    const s = Math.round((Date.now() - inizio) / 1000);
    return s < 60
      ? `${s}s`
      : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}`;
  };
  // Una riga che si aggiorna al posto di restare ferma: dice chi lavora e da
  // quanto, così un minuto di silenzio non sembra un blocco.
  const battito = setInterval(() => {
    if (!agent || !aCapo || !stdout.isTTY) return;
    stdout.write(
      "\r" +
        coloreAI(agent)(`  ${agent}`) +
        tenue(` sta lavorando… ${durata()}${consumo}`) +
        "\u001b[K",
    );
  }, 1000);
  const pulisci = () => {
    if (stdout.isTTY) stdout.write("\r\u001b[K");
  };
  // Ctrl+C non interrompeva nulla: il terminale restava appeso e l'AI
  // continuava (collaudo del 3 ottobre, CT-011). Ora interrompe il turno, ma
  // solo alla seconda pressione entro 3 secondi: il lavoro delle AI non deve
  // andare perso per un tasto premuto per sbaglio. Interrompere non butta
  // niente: ciò che è stato fatto resta nella copia di lavoro.
  let primaPressione = 0;
  let interrottoDaTe = false;
  ctrlCDuranteTurno = () => {
    const ora = Date.now();
    if (ora - primaPressione > 3000) {
      primaPressione = ora;
      pulisci();
      stdout.write(
        (aCapo ? "" : "\n") +
          avviso(
            "  ⚠ Premi di nuovo Ctrl+C entro 3 secondi per interrompere il turno. Il lavoro fatto finora resta salvato.",
          ) +
          "\n",
      );
      aCapo = true;
      return;
    }
    primaPressione = 0;
    if (interrottoDaTe) return;
    interrottoDaTe = true;
    pulisci();
    stdout.write(avviso("  Interrompo il turno…") + "\n");
    void (async () => {
      // La pausa vale per questo turno e solo finché è in corso: se nel
      // frattempo è finito, o ne è partito un altro, non si tocca nulla.
      let turno: number | undefined;
      for (let i = 0; i < 5; i++) {
        try {
          const r = await api(`/runs/${id}`);
          turno ??= r.turnNumber;
          if (r.turnNumber !== turno || r.state !== "RUNNING") return;
          await api(`/runs/${id}/actions`, {
            action: "pause",
            expectedVersion: r.version,
          });
          return;
        } catch {
          await new Promise((ok) => setTimeout(ok, 300));
        }
      }
      // Non è riuscita: Ctrl+C torna utilizzabile per riprovare.
      interrottoDaTe = false;
      stdout.write(
        errore("  ! ") +
          `Non sono riuscito a interrompere il turno: riprova con Ctrl+C due volte, oppure «continuity cancel --run ${id}» da un altro terminale.\n`,
      );
    })();
  };
  try {
    let errori = 0;
    while (running) {
      // Un servizio occupato (verifiche lunghe) può non rispondere per un po':
      // non è un motivo per abbandonare il turno a metà.
      let events: any[];
      try {
        ({ events } = await api(`/runs/${id}/events?afterSeq=${seq}`));
        errori = 0;
      } catch (e) {
        if (++errori > 120) throw e;
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      for (const e of events) {
        seq = e.seq;
        const testo = String(e.payload?.message ?? "");
        if (e.type === "agent.action") {
          pulisci();
          if (!aCapo) {
            stdout.write("\n");
            aCapo = true;
          }
          // La delega è il momento in cui il lavoro si divide: deve saltare
          // all'occhio, non confondersi con le letture di file.
          // Un comando su più righe (uno script) resta su una riga: andando
          // a capo spezzava l'elenco delle azioni.
          const azione = testo.trim().replace(/\s*\n\s*/g, " ");
          stdout.write(
            (azione.startsWith("delega")
              ? accento("   ⤷ " + azione)
              : tenue("   · " + azione)) + "\n",
          );
        } else if (e.type === "agent.message") {
          ultimoMessaggio = testo;
          pulisci();
          // La riga rimasta a metà non si stampa: il messaggio completo la
          // contiene già. Stampandola si vedeva la stessa frase spezzata in
          // due — «prima di risp» e poi «ondere.».
          resto = "";
          // Il confronto è con ciò che è davvero comparso, non con ciò che è
          // stato letto dal servizio: si stampa solo la coda che manca.
          const completo = testo.trim();
          const gia = blocco.trim();
          const daScrivere = !gia
            ? completo
            : completo.startsWith(gia)
              ? completo.slice(gia.length)
              : gia.includes(completo)
                ? ""
                : "\n" + completo;
          if (daScrivere.trim()) {
            if (!aCapo && !gia) stdout.write("\n");
            stdout.write(
              (aCapo ? "  " : "") + daScrivere.replace(/\n/g, "\n  ") + "\n",
            );
          } else if (!aCapo) stdout.write("\n");
          aCapo = true;
          // Il messaggio è chiuso: il servizio svuota il suo buffer del testo
          // in diretta, quindi anche qui si riparte da zero.
          blocco = "";
          mostrato = "";
        } else if (e.type === "engine.warning" || e.type === "turn.silent") {
          // Avvisi che non fermano nulla: si vedono, e il lavoro prosegue.
          pulisci();
          if (!aCapo) {
            stdout.write("\n");
            aCapo = true;
          }
          stdout.write(avviso("  ⚠ " + testo) + "\n");
        } else if (e.type === "switch.started") {
          pulisci();
          stdout.write("\n" + accento("  ⟳ " + testo) + "\n");
          mostrato = "";
          resto = "";
          blocco = "";
          aCapo = true;
        } else if (e.type === "resume.started") {
          pulisci();
          stdout.write("\n" + accento("  ↩ " + testo) + "\n");
          aCapo = true;
        } else if (e.type === "attempt.started") {
          agent = testo.split(" ")[0];
          mostrato = "";
          resto = "";
          blocco = "";
          pulisci();
          stdout.write(
            coloreAI(agent)(`  ${agent}`) + tenue(" sta lavorando…") + "\n",
          );
          aCapo = true;
        } else if (e.type === "usage.reported") {
          consumo =
            " · " +
            testo
              .replace(" token in ingresso", " in")
              .replace(" in uscita", " out");
        } else if (e.type === "verification.completed") {
          pulisci();
          // La spunta verde la merita solo chi ha superato tutto. Un «0/2
          // criteri» stampato in verde è il prodotto che mente proprio nel
          // punto in cui promette di verificare.
          const quanti = testo.match(/^(\d+)\/(\d+) criteri/);
          // Durante un passaggio fra AI non c'è un esito da giudicare.
          if (testo.startsWith("Stato salvato per il passaggio")) {
            stdout.write(tenue("   · " + testo) + "\n");
            continue;
          }
          stdout.write(
            (testo.includes("Nessuna verifica")
              ? avviso("  ⚠ ")
              : quanti && quanti[1] === quanti[2]
                ? bene("  ✓ ")
                : errore("  ✗ ")) +
              testo +
              "\n",
          );
        } else if (
          e.type === "turn.completed" ||
          e.type === "turn.blocked" ||
          e.type === "turn.failed"
        ) {
          pulisci();
          if (e.type === "turn.blocked") bloccato = true;
          if (e.type === "turn.failed") fine = "fallito";
          // Un turno interrotto non può avere lo stesso grigio di uno riuscito:
          // finirebbe invisibile in fondo a uno schermo pieno di output.
          const riga = "  " + testo + " · " + durata() + consumo;
          stdout.write(
            (e.type === "turn.completed" ? tenue(riga) : avviso(riga)) + "\n",
          );
          // L'AI ha chiuso con una domanda: la risposta si scrive qui, ed è il
          // prossimo messaggio. Senza dirlo sembrava che non si potesse
          // rispondere (prova dell'8 ottobre).
          if (e.type === "turn.completed" && finisceConDomanda(ultimoMessaggio))
            stdout.write(
              accento("  ❓ ") +
                "L'AI aspetta una tua risposta: scrivila qui sotto, riprende da dove si è fermata.\n",
            );
          running = false;
        } else if (e.type === "run.blocked") {
          pulisci();
          bloccato = true;
          stdout.write(errore("  ! " + testo) + "\n");
          running = false;
        } else if (
          e.type === "run.cancelled" ||
          e.type === "run.paused" ||
          e.type === "run.failed" ||
          e.type === "run.succeeded"
        ) {
          // Il turno può finire da fuori: annullato da un altro terminale, o
          // messo in pausa perché il servizio si è fermato. Senza questo il
          // terminale restava ad aspettare una conclusione che non arriva più.
          pulisci();
          stdout.write(
            avviso(
              e.type === "run.cancelled"
                ? "  Turno annullato: i file nella tua cartella non sono stati toccati."
                : e.type === "run.paused" && interrottoDaTe
                  ? "  Turno interrotto da te. Il lavoro fatto finora è salvato nella copia di lavoro: /applica lo porta nella tua cartella, oppure scrivi come proseguire."
                  : e.type === "run.paused"
                    ? "  Turno interrotto: il servizio si è fermato. Il lavoro fatto finora è salvato; riscrivi la richiesta per riprendere."
                    : "  " + testo,
            ) + "\n",
          );
          if (e.type === "run.cancelled") fine = "annullata";
          if (e.type === "run.paused") fine = "pausa";
          running = false;
        }
      }
      if (!running) break;
      // Il testo che l'AI sta scrivendo adesso compare subito, senza aspettare
      // che la risposta sia finita.
      const parziale = await api(`/runs/${id}/live`)
        .then((x: any) => String(x.parziale ?? ""))
        .catch(() => "");
      if (parziale.length > mostrato.length) {
        resto += parziale.slice(mostrato.length);
        mostrato = parziale;
        const righe = resto.split("\n");
        resto = righe.pop() ?? "";
        if (righe.length) {
          pulisci();
          for (const riga of righe) stdout.write("  " + riga + "\n");
          blocco += righe.join("\n") + "\n";
          aCapo = true;
        }
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  } finally {
    clearInterval(battito);
    ctrlCDuranteTurno = undefined;
    pulisci();
  }
  return { seq, bloccato, fine };
}

// Di un testo lungo si mostra la prima riga: il resto è già sullo schermo, e
// ripeterlo renderebbe illeggibile la sessione.
export function riassunto(messaggio: string) {
  const righe = messaggio.split("\n").filter((r) => r.trim());
  if (righe.length <= 1) return messaggio;
  return `${righe[0].slice(0, 70)} … (${righe.length} righe)`;
}
export function creaLettore() {
  return createInterface({ input: stdin, output: uscitaLettore });
}
export async function runSession(
  api: Api,
  id: string,
  intestazione: string[] | (() => string[]),
  esistente?: ReturnType<typeof creaLettore>,
  anticipate: string[] = [],
) {
  // Le righe scritte prima che arrivi il prompt vanno messe in coda, non perse:
  // durante l'avvio o mentre un'AI lavora si continua a digitare, e quel testo
  // è una richiesta come le altre.
  const interattivo = Boolean(stdin.isTTY);
  const rl = esistente ?? (interattivo ? creaLettore() : undefined);
  // Ciò che è stato scritto durante l'avvio è già una richiesta: entra in coda.
  const coda: string[] = anticipate.splice(0).filter((r) => r.trim());
  const attese: ((riga: string | null) => void)[] = [];
  let chiuso = false;
  // Un testo incollato arriva come tante righe in pochi millisecondi: sono un
  // messaggio solo. Trattarle una per una significherebbe chiedere all'AI di
  // rispondere a «- iPhone» e bruciare un turno per ogni riga.
  const PAUSA_INCOLLA = 80;
  let buffer: string[] = [];
  let attesaFine: NodeJS.Timeout | undefined;
  // Il terminale segnala inizio e fine di un incollaggio, se glielo si chiede
  // (modalità «bracketed paste»): readline li riconosce come tasti
  // paste-start e paste-end. Ciò che sta in mezzo resta nella casella finché
  // la persona non preme invio, come in ogni editor. Prima la modalità non
  // veniva mai attivata e si indovinava dal ritmo delle righe: un testo lungo
  // partiva da solo a metà, e la sua ultima riga restava nella casella per
  // tutto il turno, occupandola.
  let dentroIncolla = false;
  let incollato: string[] = [];
  const consegna = () => {
    const messaggio = buffer.join("\n");
    buffer = [];
    const attesa = attese.shift();
    if (attesa) attesa(messaggio);
    else coda.push(messaggio);
  };
  const tasto = (_s: unknown, k: { name?: string } | undefined) => {
    if (k?.name === "paste-start") dentroIncolla = true;
    if (k?.name === "paste-end") {
      dentroIncolla = false;
      // Le righe incollate sono già a schermo; l'ultima è nella casella.
      if (incollato.length && interattivo) {
        stdout.write(
          "\n" +
            tenue(
              `  ${incollato.length + 1} righe incollate: premi invio per inviarle`,
            ) +
            "\n",
        );
        rl?.prompt(true);
      }
    }
  };
  // I tasti di incollaggio arrivano solo da un terminale vero; ascoltarli
  // comunque non costa nulla e permette di provare questo comportamento.
  if (rl) stdin.on("keypress", tasto);
  if (rl && interattivo) {
    stdout.write("\u001b[?2004h");
    // Comunque finisca il programma, il terminale torna come prima.
    process.once("exit", () => stdout.write("\u001b[?2004l"));
  }
  let annullatoDaTe = false;
  if (rl) {
    rl.removeAllListeners("SIGINT");
    rl.on("SIGINT", () => {
      if (ctrlCDuranteTurno) return ctrlCDuranteTurno();
      // Con un testo incollato in attesa, Ctrl+C lo annulla: è il gesto di
      // chi ci ha ripensato. Prima la chiusura lo spediva all'AI.
      if (incollato.length || buffer.length || rl!.line) {
        clearTimeout(attesaFine);
        incollato = [];
        buffer = [];
        rl!.write(null, { ctrl: true, name: "u" });
        stdout.write(
          "\n" + tenue("  Testo annullato: non è stato inviato.") + "\n",
        );
        rl!.prompt();
        return;
      }
      annullatoDaTe = true;
      rl!.close();
    });
    // Chi raccoglieva le righe durante l'avvio ha finito: se restasse in
    // ascolto, ogni riga verrebbe contata due volte.
    rl.removeAllListeners("line");
    rl.on("line", (riga: string) => {
      riga = riga.replace(/\u001b\[20[01]~/g, "");
      // Dentro un incollaggio un a capo è testo, non un invio.
      if (dentroIncolla) {
        incollato.push(riga);
        return;
      }
      // Il primo invio dopo un incollaggio lo spedisce tutto, con l'ultima
      // riga che era rimasta nella casella.
      if (incollato.length) {
        clearTimeout(attesaFine);
        buffer = [...buffer, ...incollato, riga];
        incollato = [];
        consegna();
        return;
      }
      buffer.push(riga);
      clearTimeout(attesaFine);
      // Ripiego per i terminali che non segnalano l'incollaggio: una riga sola
      // si consegna subito; un blocco arrivato di fila si aspetta di più.
      attesaFine = setTimeout(
        consegna,
        buffer.length >= 3
          ? Math.min(PAUSA_INCOLLA * 25, PAUSA_INCOLLA * buffer.length)
          : PAUSA_INCOLLA,
      );
    });
    rl.on("close", () => {
      chiuso = true;
      clearTimeout(attesaFine);
      stdin.off("keypress", tasto);
      if (interattivo) stdout.write("\u001b[?2004l");
      // Chi esce con Ctrl+C non sta inviando nulla; chi chiude l'input (una
      // pipe che finisce) sì.
      if (annullatoDaTe) buffer = [];
      else if (incollato.length) buffer = [...buffer, ...incollato];
      incollato = [];
      if (buffer.length) consegna();
      while (attese.length) attese.shift()!(null);
    });
  }
  let daFile: string[] | undefined;
  const leggiTutto = async () => {
    let testo = "";
    for await (const pezzo of stdin) testo += pezzo;
    return testo.split("\n");
  };
  // Una domanda secondaria (un menu, un percorso da indicare) non deve pescare
  // dalla coda: lì dentro c'è una richiesta per l'AI scritta prima, e usarla
  // come risposta la farebbe sparire.
  const chiedi = async (
    invito = accento("› "),
    dallaCoda = true,
  ): Promise<string | null> => {
    if (rl) {
      if (dallaCoda && coda.length) {
        const messaggio = coda.shift()!;
        stdout.write(invito + riassunto(messaggio) + "\n");
        return messaggio.trim();
      }
      if (chiuso) return null;
      rl.setPrompt(invito);
      rl.prompt();
      return new Promise<string | null>((risolvi) =>
        attese.push((riga) => risolvi(riga === null ? null : riga.trim())),
      );
    }
    daFile ??= await leggiTutto();
    const riga = daFile.shift();
    if (riga === undefined) return null;
    stdout.write(invito + riassunto(riga) + "\n");
    return riga.trim();
  };
  // Riprendendo una sessione il registro contiene già tutto il passato: partire
  // da zero significherebbe ristamparlo come se stesse accadendo adesso.
  // Il registro si legge a pagine di 500: fermarsi alla prima ristampava il
  // passato e scambiava un vecchio «turno concluso» per quello in corso.
  let seq = 0;
  // Legge il registro fino in fondo; «raccogli» riceve gli eventi letti.
  const raggiungiFine = async (raccogli?: (eventi: any[]) => void) => {
    try {
      for (;;) {
        const { events = [] } = await api(`/runs/${id}/events?afterSeq=${seq}`);
        if (!events.length) break;
        raccogli?.(events);
        seq = Math.max(seq, ...events.map((e: any) => e.seq));
        if (events.length < 500) break;
      }
    } catch {}
  };
  const passati: any[] = [];
  await raggiungiFine((eventi) => passati.push(...eventi));
  // Testo digitato mentre Continuity faceva una domanda: va trattato come
  // richiesta al turno successivo, non buttato via.
  let pendente: string | undefined;
  // Stampata dopo l'apertura di readline: prima di allora il terminale può non
  // aver ancora dichiarato la propria larghezza e il riquadro esce storto.
  for (const riga of typeof intestazione === "function"
    ? intestazione()
    : intestazione)
    stdout.write(riga + "\n");
  // A ogni avvio si rileggono i connettori di tutte le AI, in sottofondo: quelli
  // aggiunti nel frattempo sulle piattaforme ufficiali entrano da soli, accesi.
  // Il primo turno aspetta questa lettura invece di usarne una vecchia.
  api(`/runs/${id}/connettori?aggiorna=1`).catch(() => {});
  // Riaprendo, la conversazione già fatta torna sullo schermo, dall'inizio,
  // com'era apparsa: come in Claude Code e Codex.
  const storico = rendiStorico(
    passati,
    await api(`/runs/${id}`)
      .then((r: any) => r.transcript ?? [])
      .catch(() => []),
  );
  if (storico) {
    const larga = Math.min(stdout.columns ?? 80, 100);
    stdout.write(
      "\n" +
        cornice("Conversazione precedente", larga) +
        "\n\n" +
        storico +
        "\n" +
        cornice("Riprendi da qui", larga) +
        "\n",
    );
  }
  stdout.write("\nScrivi cosa vuoi fare. /aiuto per i comandi.\n");
  // La pubblicazione su GitHub: prima consegna il lavoro rimasto nella copia,
  // poi pubblica subito. Si ferma a chiedere solo se su GitHub verrebbero
  // eliminati file o se ci sono possibili segreti: decisioni da non prendere
  // al posto della persona.
  // La scelta sulla pubblicazione automatica, cambiabile in ogni momento con
  // /pubblica automatica (o «attiva/disattiva la pubblicazione automatica»).
  const impostaAutomatica = async (valore?: boolean) => {
    const dire = (riga: string) => stdout.write(riga + "\n");
    const attuale = await api(`/runs/${id}/github`).catch(() => ({}));
    if (valore === undefined) {
      dire(
        tenue(
          `  Pubblicazione automatica su GitHub: ${attuale.automatica ? "attiva" : "non attiva"}` +
            (attuale.destinazione ? ` · ${attuale.destinazione}` : ""),
        ),
      );
      const risposta = (
        (await chiedi(
          tenue(
            "  Vuoi attivare la pubblicazione automatica su GitHub a seguito di ogni modifica? [s/n] ",
          ),
          false,
        )) ?? ""
      ).trim();
      if (/^(s|si|sì|y|yes)$/i.test(risposta)) valore = true;
      else if (/^(n|no)$/i.test(risposta)) valore = false;
      else {
        dire(tenue("  Nessun cambiamento."));
        return;
      }
    }
    try {
      const nuova = await api(`/runs/${id}/github`, { automatica: valore });
      dire(
        valore
          ? bene("  ✓ ") +
              "Pubblicazione automatica attiva: dopo ogni modifica consegnata pubblico su GitHub" +
              (nuova.destinazione ? ` (${nuova.destinazione})` : "") +
              tenue(" · /pubblica automatica per cambiarla")
          : bene("  ✓ ") +
              "Pubblicazione automatica spenta: pubblichi tu con «pubblica su git»" +
              tenue(" · /pubblica automatica per cambiarla"),
      );
      if (valore && !nuova.destinazione)
        dire(
          tenue(
            "  Prima volta: scrivi «pubblica su git utente/repository» per dirmi dove.",
          ),
        );
    } catch (e) {
      dire(avviso("  ⚠ ") + (e instanceof Error ? e.message : String(e)));
    }
  };
  const pubblicaSuGithub = async (
    destinazioneScritta: string,
    opzioni: { automatica?: boolean } = {},
  ) => {
    const dire = (riga: string) => stdout.write(riga + "\n");
    try {
      const inSospeso = await api(`/runs/${id}/changed`).then(
        (x: any) => x.files ?? [],
        () => [],
      );
      if (inSospeso.length) {
        const esito = await api(`/runs/${id}/apply`, {});
        stdout.write(descriviConsegna(esito));
      }
    } catch (e) {
      dire(
        avviso("  ⚠ ") +
          "Prima di pubblicare va consegnato il lavoro dell'AI, ma non è riuscito: " +
          (e instanceof Error ? e.message : String(e)),
      );
      return;
    }
    dire(
      tenue(
        opzioni.automatica
          ? "  Pubblicazione automatica su GitHub…"
          : "  Preparo la pubblicazione su GitHub…",
      ),
    );
    let anteprima: any;
    let destinazione = destinazioneScritta;
    for (let tentativo = 0; tentativo < 2; tentativo++) {
      try {
        anteprima = await api(`/runs/${id}/pubblica`, {
          ...(destinazione ? { destinazione } : {}),
        });
        break;
      } catch (e) {
        const messaggio = e instanceof Error ? e.message : String(e);
        // Prima volta, senza repository: si chiede una volta sola.
        if (
          /Dimmi dove pubblicare/.test(messaggio) &&
          tentativo === 0 &&
          !opzioni.automatica
        ) {
          destinazione = (
            (await chiedi(
              tenue("  Su quale repository GitHub? (utente/nome) "),
              false,
            )) ?? ""
          ).trim();
          if (destinazione) continue;
          dire(tenue("  Niente pubblicato."));
          return;
        }
        dire(avviso("  ⚠ ") + messaggio);
        return;
      }
    }
    if (!anteprima) return;
    const n = (x: string[]) => x.length;
    const cambi =
      n(anteprima.aggiunti) + n(anteprima.modificati) + n(anteprima.eliminati);
    if (!cambi) {
      dire(
        bene("  ✓ ") + `Su ${anteprima.destinazione} è già tutto aggiornato.`,
      );
      return;
    }
    // Da sola, la pubblicazione automatica non decide mai su eliminazioni o
    // possibili segreti: si ferma e lascia la scelta alla persona.
    if (
      opzioni.automatica &&
      (anteprima.eliminati.length || anteprima.sospetti.length)
    ) {
      dire(
        avviso("  ⚠ ") +
          "Pubblicazione automatica sospesa: " +
          [
            anteprima.eliminati.length
              ? `su GitHub verrebbero eliminati ${anteprima.eliminati.length} file`
              : "",
            anteprima.sospetti.length
              ? `possibili password o token in ${anteprima.sospetti.join(", ")}`
              : "",
          ]
            .filter(Boolean)
            .join("; ") +
          ". Scrivi «pubblica su git» per vedere e decidere.",
      );
      return;
    }
    if (anteprima.eliminati.length || anteprima.sospetti.length) {
      if (anteprima.eliminati.length)
        dire(
          avviso(
            `  ⚠ Su GitHub verrebbero eliminati ${anteprima.eliminati.length} file che non sono nella tua cartella: `,
          ) +
            anteprima.eliminati.slice(0, 15).join(", ") +
            (anteprima.eliminati.length > 15 ? ", …" : ""),
        );
      if (anteprima.sospetti.length)
        dire(
          avviso("  ⚠ Possibili password o token in: ") +
            anteprima.sospetti.join(", "),
        );
      const conferma = (
        (await chiedi(tenue("  Pubblico lo stesso? [s/n] "), false)) ?? ""
      ).trim();
      if (!/^(s|si|sì|y|yes)$/i.test(conferma)) {
        dire(tenue("  Niente pubblicato."));
        return;
      }
    }
    try {
      const esito = await api(`/runs/${id}/pubblica`, {
        conferma: anteprima.piano,
        forza: anteprima.sospetti.length > 0,
      });
      const conta = (k: number, uno: string, tanti: string) =>
        k ? `${k} ${k === 1 ? uno : tanti}` : "";
      const parti = [
        conta(n(anteprima.aggiunti), "file nuovo", "file nuovi"),
        conta(n(anteprima.modificati), "modificato", "modificati"),
        conta(n(anteprima.eliminati), "eliminato", "eliminati"),
      ].filter(Boolean);
      dire(
        bene("  ✓ ") +
          `Pubblicato su ${anteprima.destinazione} (${esito.ramo}): ${parti.join(", ")}` +
          (esito.url ? tenue("  " + esito.url) : ""),
      );
      if (anteprima.esclusi.length)
        dire(
          tenue(
            `    Non pubblicati perché sembrano credenziali: ${anteprima.esclusi.join(", ")}`,
          ),
        );
      // Dopo la prima pubblicazione fatta a mano, una domanda sola: la
      // risposta resta per il progetto e si cambia con /pubblica automatica.
      if (!opzioni.automatica && esito.automatica === undefined)
        await impostaAutomatica();
    } catch (e) {
      dire(avviso("  ⚠ ") + (e instanceof Error ? e.message : String(e)));
    }
  };
  try {
    for (;;) {
      const testoPendente = pendente;
      pendente = undefined;
      // Ciò che è successo durante il comando precedente (una consegna, un
      // conflitto) l'ha già detto la sessione: il sorvegliante del prompt deve
      // partire da qui, o lo ristampava una seconda volta.
      await raggiungiFine();
      const stato = await api(`/runs/${id}`).catch(() => ({}) as any);
      const attivo = stato.prossimo ?? stato.agent ?? "codex";
      const zona = zonaInput(
        attivo,
        (stato.modelli ?? {})[attivo],
        stato.allegati ?? [],
        providerNoto(attivo)
          ? (stato.ragionamento ?? {})[attivo]
          : undefined,
      );
      // Il riquadro finisce con la riga dell'input: sotto non c'è nulla da
      // cancellare e nessun cursore da far risalire.
      const disegna = () => {
        if (stdin.isTTY)
          stdout.write(
            "\n" + zona.cima + "\n" + zona.azioni + "\n" + zona.mezzo + "\n",
          );
        else stdout.write("\n" + zona.cima + "\n");
      };
      disegna();
      // Mentre si aspetta, il servizio può riprendere da solo un lavoro rimasto
      // in sospeso: se succede va visto, non scoperto dopo nella cartella.
      const vigile = setInterval(() => {
        void api(`/runs/${id}/events?afterSeq=${seq}`)
          .then(({ events }: any) => {
            if (!events?.length) return;
            seq = events[events.length - 1].seq;
            // Anche i fermi vanno mostrati: il sorvegliante fa avanzare il
            // registro, quindi ciò che non mostra qui non lo vedrà nessuno.
            // Mentre si aspetta al prompt l'unica consegna possibile è quella
            // della ripresa automatica: i file arrivano, e va detto.
            const utili = events.filter((e: any) =>
              [
                "work.applied",
                "work.conflict",
                "resume.started",
                "resume.failed",
                "attempt.started",
                "agent.message",
                "switch.started",
                "engine.warning",
                "turn.silent",
                "turn.completed",
                "turn.failed",
                "turn.blocked",
                "run.blocked",
              ].includes(e.type),
            );
            if (!utili.length) return;
            stdout.write("\r\u001b[K");
            for (const e of utili)
              stdout.write(
                (e.type === "resume.started"
                  ? accento("\n  ↩ ")
                  : e.type === "work.applied"
                    ? bene("  ✓ ")
                    : e.type === "work.conflict"
                      ? avviso("  ⚠ ")
                      : tenue("  ")) +
                  String(e.payload?.message ?? "").trim() +
                  "\n",
              );
            // Ciò che è stato stampato ha mangiato il riquadro: si ridisegna,
            // altrimenti resta uno schermo senza posto dove scrivere.
            disegna();
            rl?.prompt(true);
          })
          .catch(() => {});
      }, 2000);
      let testo: string | null;
      try {
        testo = testoPendente ?? (await chiedi(zona.invito));
      } finally {
        clearInterval(vigile);
      }
      // Una riga di respiro fra la richiesta e la risposta.
      if (stdin.isTTY) stdout.write("\n");
      if (testoPendente) stdout.write(tenue(testoPendente) + "\n");
      if (testo === null) break;
      if (!testo) continue;
      // Di un testo incollato nella casella resta visibile solo l'ultima riga:
      // sembrava che fosse partita solo quella.
      const righeInviate = testo.split("\n").length;
      if (righeInviate > 1 && !testo.startsWith("/"))
        stdout.write(
          tenue(
            `  ↳ inviata per intero: ${righeInviate} righe, ${testo.length.toLocaleString("it-IT")} caratteri\n`,
          ),
        );
      // Nel riquadro si legge «allega», «modello»: vanno accettate anche scritte
      // così, senza barra, altrimenti mostrano una parola e ne pretendono un'altra.
      const PAROLE = PAROLE_COMANDO;
      testo = normalizzaComando(testo);
      if (PAROLE.includes(testo.toLowerCase()))
        testo = "/" + testo.toLowerCase();
      else testo = comandoSenzaBarra(testo);
      if (testo === "/linguaggio" || testo.startsWith("/linguaggio ")) {
        const scelta = testo.split(/\s+/, 2)[1]?.toLowerCase();
        const lingua = scelta === "en" || scelta === "english" || scelta === "inglese"
          ? "en"
          : scelta === "it" || scelta === "italiano"
            ? "it"
            : undefined;
        if (!lingua) {
          stdout.write(tenue("  Usa /linguaggio italiano oppure /language english.\n"));
          continue;
        }
        const file = unisci(cartellaDati(), "interfaccia.json");
        let interfaccia: Record<string, unknown> = {};
        try {
          interfaccia = JSON.parse(readFileSync(file, "utf8"));
        } catch {}
        writeFileSync(file, JSON.stringify({ ...interfaccia, lingua }, null, 2) + "\n");
        stdout.write(bene(`  ✓ ${lingua === "en" ? "Language changed to English" : "Lingua cambiata in italiano"}\n`));
        continue;
      }
      if (testo === "/esci") break;
      if (testo === "/chiudi" || testo === "/chiudi forza") {
        try {
          await api(`/runs/${id}/close`, { forza: testo.endsWith("forza") });
        } catch (e) {
          const messaggio = e instanceof Error ? e.message : String(e);
          stdout.write(
            avviso("  Non ho chiuso la sessione: ") + messaggio + "\n",
          );
          // File non consegnati: si chiude solo con un «sì» esplicito, e
          // quei file vengono messi da parte invece di sparire.
          if (/non ancora consegnati/.test(messaggio)) {
            const conferma = (
              (await chiedi(
                tenue("  Chiudo comunque conservandoli a parte? [s/n] "),
                false,
              )) ?? ""
            ).trim();
            if (/^(s|si|sì|y|yes)$/i.test(conferma)) {
              const chiusa = await api(`/runs/${id}/close`, {
                forza: true,
              }).catch((x) => {
                stdout.write(
                  errore("  ") +
                    (x instanceof Error ? x.message : String(x)) +
                    "\n",
                );
                return null;
              });
              if (chiusa) {
                stdout.write(
                  tenue(
                    "  Sessione chiusa. I file non consegnati sono in " +
                      String(
                        /conservati in (.+)$/.exec(
                          (chiusa.events ?? []).at?.(-1)?.message ?? "",
                        )?.[1] ?? "una cartella di Continuity (vedi /stato)",
                      ) +
                      "\n",
                  ),
                );
                return;
              }
            }
          }
          continue;
        }
        stdout.write(tenue("  Sessione chiusa: la prossima parte da zero.\n"));
        return;
      }
      if (testo === "/aiuto") {
        stdout.write(AIUTO + "\n");
        continue;
      }
      if (testo === "/ordine" || testo.startsWith("/ordine ")) {
        let richiesta = testo.slice(7).trim();
        if (!richiesta) {
          const r = await api(`/runs/${id}`);
          const sequenza: string[] = r.providers ?? [];
          stdout.write("\n  Sequenza delle AI:\n");
          sequenza.forEach((p, i) => {
            const nome = providerNoto(p)?.nome ?? p;
            stdout.write(
              `  ${i + 1}. ${p === r.agent ? bene(p) : p}  ${tenue(nome)}\n`,
            );
          });
          const fuori = PROVIDER.filter(
            (p) => !sequenza.includes(p.id),
          );
          if (fuori.length)
            stdout.write(
              tenue(
                `  Fuori sequenza: ${fuori.map((p) => p.id).join(", ")}\n`,
              ),
            );
          stdout.write(
            tenue(
              "  Scrivi un nome o un numero per metterlo in testa (es. 2), più nomi per un ordine nuovo, «solo …» per tenere solo quelli.\n",
            ),
          );
          richiesta = (
            (await chiedi(tenue("  nuovo ordine (invio per lasciarlo): "), false)) ??
            ""
          ).trim();
          if (!richiesta) {
            stdout.write(tenue("  Lasciata com'era.\n"));
            continue;
          }
        }
        try {
          const r = await api(`/runs/${id}/providers`, { richiesta });
          stdout.write(
            bene("  Sequenza aggiornata: ") +
              (r.providers ?? []).join(" → ") +
              "\n" +
              tenue("  Vale dal prossimo messaggio.\n"),
          );
        } catch (e) {
          stdout.write(
            errore("  ") +
              (e instanceof Error ? e.message : String(e)) +
              "\n" +
              tenue(`  AI disponibili: ${elencoDisponibili()}\n`),
          );
        }
        continue;
      }
      if (testo === "/connettori") {
        // L'elenco viene dalle piattaforme ufficiali: qui si accendono e si
        // spengono soltanto, per questa sessione.
        stdout.write(
          tenue("  Leggo i connettori delle AI dalle piattaforme ufficiali…\n"),
        );
        let dati: any;
        try {
          dati = await api(`/runs/${id}/connettori?aggiorna=1`);
        } catch (e) {
          stdout.write(
            errore("  ! ") +
              (e instanceof Error ? e.message : String(e)) +
              "\n",
          );
          continue;
        }
        const elenco: any[] = dati.elenco ?? [];
        const spenti = new Set<string>(dati.spenti ?? []);
        if (!elenco.length) {
          stdout.write(
            tenue(
              "  Nessun connettore: si aggiungono da claude.ai (Impostazioni → Connettori) o da ChatGPT/Codex, non da Continuity.\n",
            ),
          );
          continue;
        }
        const mostra = () => {
          let n = 0;
          for (const ai of [...new Set(elenco.map((c) => c.ai))]) {
            const suoi = elenco.filter((c) => c.ai === ai);
            if (!suoi.length) continue;
            stdout.write("\n  " + coloreAI(ai)(forte(ai)) + "\n");
            for (const c of suoi) {
              n++;
              const acceso = !spenti.has(c.id) && c.stato !== "da autorizzare";
              const nota =
                c.stato === "da autorizzare"
                  ? avviso(
                      `da autorizzare su ${({ claude: "claude.ai", codex: "ChatGPT" } as Record<string, string>)[ai] ?? "la sua piattaforma"}`,
                    )
                  : c.stato === "non raggiungibile"
                    ? avviso("non raggiungibile")
                    : acceso
                      ? bene("acceso")
                      : tenue("spento");
              c.numero = n;
              stdout.write(
                `   ${bene(String(n).padStart(2))}  ${acceso ? bene("●") : tenue("○")} ${c.nome.padEnd(26)} ${nota}\n`,
              );
            }
          }
        };
        mostra();
        const risposta =
          (await chiedi(
            tenue(
              "\n  numeri da accendere o spegnere (es. 3 7), invio per uscire: ",
            ),
            false,
          )) ?? "";
        const numeri = risposta
          .split(/[\s,]+/)
          .map(Number)
          .filter(Boolean);
        if (!numeri.length) continue;
        for (const n of numeri) {
          const c = elenco.find((x) => x.numero === n);
          if (!c || c.stato === "da autorizzare") continue;
          if (spenti.has(c.id)) spenti.delete(c.id);
          else spenti.add(c.id);
        }
        try {
          await api(`/runs/${id}/connettori`, { spenti: [...spenti] });
          const nomi = (spento: boolean) =>
            elenco
              .filter(
                (c) =>
                  numeri.includes(c.numero) &&
                  c.stato !== "da autorizzare" &&
                  spenti.has(c.id) === spento,
              )
              .map((c) => c.nome)
              .join(", ");
          if (nomi(true))
            stdout.write(`  ${tenue("○")} spenti: ${nomi(true)}\n`);
          if (nomi(false))
            stdout.write(`  ${bene("●")} accesi: ${nomi(false)}\n`);
          stdout.write(tenue("  Vale dal prossimo messaggio.\n"));
        } catch (e) {
          stdout.write(
            errore("  ! ") +
              (e instanceof Error ? e.message : String(e)) +
              "\n",
          );
        }
        continue;
      }
      if (testo === "/ragionamento" || testo.startsWith("/ragionamento ")) {
        // Quanto a fondo ragiona ciascuna AI. Alto se nessuno l'ha scelto;
        // massimo consuma più crediti ed è più lento.
        const r = await api(`/runs/${id}`);
        const livelli = ["basso", "medio", "alto", "massimo"];
        const attuali = r.ragionamento ?? {};
        const parti = testo.slice(13).trim().split(/\s+/).filter(Boolean);
        let provider =
          parti[0] && providerNoto(parti[0])
            ? providerNoto(parti.shift()!)!.id
            : "";
        let livello = parti[0] ?? "";
        if (!livello) {
          if (!provider) {
            const ai = (r.providers ?? []).filter((p: string) =>
              providerNoto(p),
            );
            stdout.write("\n  " + forte("Quale AI?") + "\n");
            ai.forEach((p: string, i: number) =>
              stdout.write(
                `   ${bene(String(i + 1))}  ${coloreAI(p)(p)}  ${tenue("ragionamento " + (attuali[p] ?? "come nella configurazione del CLI"))}\n`,
              ),
            );
            provider =
              ai[
                Number((await chiedi(tenue("   scegli: "), false)) ?? "") - 1
              ] ?? "";
            if (!provider) {
              stdout.write(tenue("  Annullato.\n"));
              continue;
            }
          }
          stdout.write("\n  " + forte(`Ragionamento di ${provider}`) + "\n");
          livelli.forEach((l, i) =>
            stdout.write(
              `   ${bene(String(i + 1))}  ${l}` +
                (attuali[provider] === l
                  ? bene("  ← in uso")
                  : "") +
                (l === "massimo"
                  ? tenue("  più lento, consuma più crediti")
                  : "") +
                "\n",
            ),
          );
          livello =
            livelli[
              Number((await chiedi(tenue("   scegli: "), false)) ?? "") - 1
            ] ?? "";
          if (!livello) {
            stdout.write(tenue("  Annullato.\n"));
            continue;
          }
        }
        provider ||= r.prossimo ?? r.agent;
        try {
          await api(`/runs/${id}/ragionamento`, { provider, livello });
          stdout.write(
            bene("  ✓ ") +
              `${provider} ragionerà a livello ${livello}` +
              tenue("  · vale dal prossimo messaggio\n"),
          );
        } catch (e) {
          stdout.write(
            errore("  ") + (e instanceof Error ? e.message : String(e)) + "\n",
          );
        }
        continue;
      }
      if (testo === "/pubblica" || testo.startsWith("/pubblica ")) {
        const argomento = testo.slice(9).trim();
        const auto = /^automatic[ao]\b\s*(.*)$/i.exec(argomento);
        if (auto) {
          const v = auto[1].trim();
          await impostaAutomatica(
            /^(s|si|sì|on|attiva)$/i.test(v)
              ? true
              : /^(n|no|off|spenta|disattiva)$/i.test(v)
                ? false
                : undefined,
          );
          continue;
        }
        await pubblicaSuGithub(argomento);
        continue;
      }
      if (testo === "/modello" || testo.startsWith("/modello ")) {
        const r = await api(`/runs/${id}`);
        const modelli = r.modelli ?? {};
        const richiesta = testo.slice(8).trim();
        // Senza argomenti si sceglie da un elenco: prima l'AI, poi i suoi
        // modelli. Ricordare i nomi a memoria non è compito di chi lavora.
        let provider = "";
        let scelta = "";
        if (!richiesta) {
          const disponibili: string[] = r.providers ?? [];
          stdout.write("\n  " + forte("Quale AI?") + "\n");
          disponibili.forEach((p: string, i: number) =>
            stdout.write(
              `   ${bene(String(i + 1))}  ${coloreAI(p)(p)}  ${tenue(modelli[p] ?? "modello predefinito")}\n`,
            ),
          );
          const quale = (await chiedi(tenue("   scegli: "), false)) ?? "";
          provider = disponibili[Number(quale) - 1] ?? "";
          if (!provider) {
            stdout.write(tenue("  Annullato.\n"));
            continue;
          }
          const nonDisponibili: string[] =
            (r.modelliNonDisponibili ?? {})[provider] ?? [];
          // Un modello già rifiutato dal provider resta in elenco ma è marcato:
          // riproporlo come buono farebbe sprecare un altro turno.
          // L'elenco viene dal servizio: per Codex è il suo catalogo, con le
          // descrizioni; per Claude gli alias dell'ultima versione in cima.
          const descritti: { nome: string; descrizione?: string }[] =
            (await api(`/modelli`).catch(() => ({})))[provider] ??
            (MODELLI_NOTI[provider] ?? []).map((nome) => ({ nome }));
          const tutti = descritti.map((m) => m.nome);
          // OpenRouter ne ha centinaia: si mostrano i primi (i gratuiti sono
          // in cima) e il nome esatto si può sempre scrivere.
          const elenco = tutti.slice(0, 40);
          const larghezzaNome = Math.max(...elenco.map((m) => m.length), 8);
          stdout.write("\n  " + forte(`Modelli di ${provider}`) + "\n");
          if (!tutti.length)
            stdout.write(
              tenue("   nessun elenco per questo provider: scrivi il nome del modello\n"),
            );
          elenco.forEach((m, i) =>
            stdout.write(
              `   ${bene(String(i + 1).padStart(2))}  ${(nonDisponibili.includes(m) ? tenue : (x: string) => x)(m.padEnd(larghezzaNome))}` +
                tenue("  " + (descritti[i].descrizione ?? "")) +
                (modelli[provider] === m ? bene("  ← in uso") : "") +
                (nonDisponibili.includes(m)
                  ? tenue("  non disponibile sul tuo piano")
                  : "") +
                "\n",
            ),
          );
          stdout.write(
            `   ${bene("0")}  ${tenue("predefinito del provider")}\n`,
          );
          if (tutti.length > elenco.length)
            stdout.write(
              tenue(`   … altri ${tutti.length - elenco.length}: scrivi il nome esatto\n`),
            );
          const quandoModello =
            (await chiedi(tenue("   scegli (numero o nome): "), false)) ?? "";
          if (quandoModello.trim() === "0") scelta = "";
          else {
            scelta = /^\d+$/.test(quandoModello.trim())
              ? (elenco[Number(quandoModello) - 1] ?? "")
              : quandoModello.trim();
            if (!scelta) {
              stdout.write(tenue("  Annullato.\n"));
              continue;
            }
          }
        } else {
          const parti = richiesta.split(/\s+/);
          provider =
            parti[0] && providerNoto(parti[0])
              ? providerNoto(parti.shift()!)!.id
              : r.agent;
          scelta = parti.join(" ");
        }
        try {
          const dopo = await api(`/runs/${id}/model`, {
            provider,
            model: scelta,
          });
          const usato = (dopo.modelli ?? {})[provider];
          stdout.write(
            bene("  ✓ ") +
              (usato
                ? `${provider} userà ${usato}`
                : `${provider} torna al modello predefinito`) +
              tenue("  · vale dal prossimo messaggio\n"),
          );
        } catch (e) {
          const messaggio = e instanceof Error ? e.message : String(e);
          stdout.write(errore("  ") + messaggio + "\n");
          // Un nome fuori elenco può essere nuovo davvero: si chiede, non si
          // impone, ma non passa mai in silenzio.
          if (/non ha un modello/.test(messaggio)) {
            const conferma =
              (await chiedi(tenue("  Provarlo lo stesso? [s/n] "), false)) ??
              "";
            if (/^(s|si|sì|y|yes)$/i.test(conferma.trim()))
              await api(`/runs/${id}/model`, {
                provider,
                model: scelta,
                forzato: true,
              })
                .then(() =>
                  stdout.write(bene(`  ✓ ${provider} userà ${scelta}\n`)),
                )
                .catch(() => null);
          }
        }
        continue;
      }
      if (testo === "/allega" || testo.startsWith("/allega ")) {
        let percorsoScelto = testo.slice(7).trim();
        // Chi legge «allega» si aspetta che gli venga chiesto cosa: spiegare la
        // sintassi è un compito in più, non una risposta.
        if (!percorsoScelto) {
          const r = await api(`/runs/${id}`);
          const elenco = r.allegati ?? [];
          if (elenco.length)
            stdout.write(tenue(`  Già allegati: ${elenco.join(", ")}\n`));
          percorsoScelto = (
            (await chiedi(tenue("  percorso del file: "), false)) ?? ""
          ).trim();
          if (!percorsoScelto) {
            stdout.write(tenue("  Annullato.\n"));
            continue;
          }
        }
        try {
          const dopo = await api(`/runs/${id}/attachments`, {
            path: percorsoScelto,
          });
          stdout.write(
            bene("  ✓ ") +
              `allegato: ${(dopo.allegati ?? []).join(", ")}` +
              tenue("  · l'AI lo leggerà al prossimo messaggio\n"),
          );
        } catch (e) {
          stdout.write(
            errore("  ") + (e instanceof Error ? e.message : String(e)) + "\n",
          );
        }
        continue;
      }
      if (testo === "/stato") {
        const r = await api(`/runs/${id}`);
        const apertura = Date.parse(r.createdAt);
        const minuti = Math.max(
          0,
          Math.floor((Date.now() - apertura) / 60_000),
        );
        const durata = Number.isFinite(minuti)
          ? `aperta da ${minuti} ${minuti === 1 ? "minuto" : "minuti"}`
          : "durata non disponibile";
        stdout.write(
          `  ${bene(r.agent)} ${r.state === "RUNNING" ? "al lavoro" : "pronto per la prossima richiesta"} · ${r.turnNumber ?? 0} turni · ${r.switches ?? 0} passaggi per crediti esauriti · ${durata}\n`,
        );
        if (r.uso)
          stdout.write(
            tenue(
              `  Token della sessione: ${Number(r.uso.entrata).toLocaleString("it-IT")} in ingresso · ${Number(r.uso.uscita).toLocaleString("it-IT")} in uscita\n`,
            ),
          );
        // Consumo per provider: i token sempre, il costo stimato per chi si
        // paga a consumo (prezzi di models.dev). Nessun tetto: decide la
        // persona.
        for (const [p, c] of Object.entries<any>(r.consumi ?? {})) {
          const costo =
            c.costo !== undefined
              ? ` · circa ${dollari(c.costo)}${c.costoIgnoto ? " (in parte non stimato)" : ""}`
              : providerNoto(p)?.accesso === "chiave"
                ? " · costo non stimato (modello assente dal catalogo)"
                : providerNoto(p)?.accesso === "abbonamento"
                  ? " · nell'abbonamento"
                  : " · gratuito";
          stdout.write(
            tenue(
              `  ${p}: ${Number(c.entrata).toLocaleString("it-IT")} in · ${Number(c.uscita).toLocaleString("it-IT")} out` +
                (c.cache ? ` · ${Number(c.cache).toLocaleString("it-IT")} dalla cache` : "") +
                costo +
                "\n",
            ),
          );
        }
        for (const [p, v] of Object.entries<any>(r.esauriti ?? {}))
          if (v?.credito)
            stdout.write(
              avviso(`  ${p}: credito esaurito · ricarica, poi «/ordine ${p}»\n`),
            );
        for (const c of r.checks ?? [])
          stdout.write(
            (c.passed ? bene("  ✓ ") : errore("  ✗ ")) +
              (c.label ?? c.id) +
              "\n",
          );
        continue;
      }
      if (testo === "/collega" || testo.startsWith("/collega ")) {
        if (!rl) {
          stdout.write(tenue("  /collega serve un terminale interattivo.\n"));
          continue;
        }
        const chiavi = portachiaviDiSistema(cartellaDati());
        try {
          const esito = await collega(
            cartellaDati(),
            chiavi,
            {
              chiedi: (invito) => chiedi(tenue(invito), false),
              // La chiave non compare a schermo: si scrive solo l'invito.
              chiediNascosto: (invito) =>
                inSilenzio(tenue(invito), () => chiedi("", false)),
              scrivi: (t) => void stdout.write(tenue(t)),
            },
            testo.slice(8).trim() || undefined,
          );
          if (esito.stato === "collegato") {
            await api(`/providers/${esito.provider.id}/collegato`, {}).catch(
              () => {},
            );
            stdout.write(
              bene(`  ✓ ${esito.provider.id} collegato`) +
                tenue(
                  ` · ${esito.dettaglio}\n  Per usarlo in questa sessione: «/ordine ${esito.provider.id}» (in testa) o «/ordine» per sceglierne il posto.\n`,
                ),
            );
          } else if (esito.stato === "abbonamento")
            stdout.write(
              tenue(
                `  Si collega con il login ufficiale, fuori dalla sessione: «continuity connect ${esito.provider.motore}».\n`,
              ),
            );
          else if (esito.stato === "fallito")
            stdout.write(
              errore(`  ✗ ${esito.provider?.id ?? ""} `) +
                (esito.dettaglio ?? "") +
                "\n",
            );
          else stdout.write(tenue("  Nessun cambiamento.\n"));
        } catch (e) {
          stdout.write(errore("  ") + (e instanceof Error ? e.message : String(e)) + "\n");
        }
        continue;
      }
      if (testo === "/file") {
        // Quelli già consegnati più quelli in attesa: il pacchetto di handoff
        // descrive un turno passato e resta vuoto finché non c'è un cambio AI.
        const stato = await api(`/runs/${id}`).catch(() => ({}) as any);
        const inAttesa = await api(`/runs/${id}/changed`).then(
          (x: any) => x.files ?? [],
          () => [],
        );
        const consegnati: string[] = stato.consegnati ?? [];
        const eliminati: string[] = stato.eliminatiConsegnati ?? [];
        if (eliminati.length) {
          stdout.write(tenue("  eliminati dalla tua cartella:\n"));
          for (const f of eliminati) stdout.write(`  ${f}\n`);
        }
        if (!consegnati.length && !inAttesa.length && !eliminati.length)
          stdout.write(tenue("  nessun file modificato finora\n"));
        if (consegnati.length) {
          stdout.write(tenue("  già nella tua cartella:\n"));
          for (const f of consegnati) stdout.write(`  ${f}\n`);
        }
        if (inAttesa.length) {
          stdout.write(tenue("  non ancora consegnati (/applica):\n"));
          for (const f of inAttesa) stdout.write(`  ${f}\n`);
        }
        continue;
      }
      if (testo === "/annulla" || testo === "/annulla forza") {
        try {
          const esito = await api(`/runs/${id}/undo`, {
            forza: testo.endsWith("forza"),
          });
          stdout.write(
            bene("  ✓ ") +
              `rimesso com'era: ${(esito.ripristinati ?? []).join(", ")}` +
              "\n" +
              (esito.conservati
                ? tenue(
                    `  Le versioni sostituite non sono perse: le trovi in ${esito.conservati}`,
                  ) + "\n"
                : ""),
          );
        } catch (e) {
          stdout.write(
            tenue("  " + (e instanceof Error ? e.message : String(e))) + "\n",
          );
        }
        continue;
      }
      if (testo === "/applica" || testo === "/applica forza") {
        try {
          const esito = await api(`/runs/${id}/apply`, {
            forza: testo.endsWith("forza"),
          });
          stdout.write(descriviConsegna(esito));
        } catch (e) {
          stdout.write(
            `Non applicate: ${e instanceof Error ? e.message : String(e)}\n`,
          );
        }
        continue;
      }
      // Una parola sola che somiglia a un comando: si chiede, invece di
      // spendere un turno dell'AI su «connettore» o «modelo».
      // «pubblica su git», «fai il push», «carica su GitHub»: lo fa Continuity
      // subito, senza passare dall'AI (che non può fare push dalla copia).
      const automatica = intentoAutomatica(testo);
      if (automatica !== undefined) {
        await impostaAutomatica(automatica);
        continue;
      }
      const pubblicazione = intentoPubblica(testo);
      if (pubblicazione) {
        await pubblicaSuGithub(pubblicazione.destinazione ?? "");
        continue;
      }
      const simile = comandoSimile(testo);
      if (simile) {
        // Solo una risposta esplicita conta: invio vuoto o Ctrl+C non fanno
        // nulla. Prima valevano «sì», e «chiudo» + invio chiudeva la sessione.
        const conferma = (
          (await chiedi(
            tenue(
              `  Intendevi /${simile}? [s = esegui /${simile}, n = mandalo all'AI, invio = niente] `,
            ),
            false,
          )) ?? ""
        ).trim();
        if (/^(s|si|sì|y|yes)$/i.test(conferma)) {
          pendente = "/" + simile;
          continue;
        }
        if (!/^(n|no)$/i.test(conferma)) {
          stdout.write(tenue("  Niente inviato.\n"));
          continue;
        }
        if (testo.startsWith("/")) {
          stdout.write("Comando sconosciuto. /aiuto per l'elenco.\n");
          continue;
        }
      } else if (/^\/[a-zà-ù]+(\s|$)/i.test(testo) && !testo.includes("\n")) {
        stdout.write("Comando sconosciuto. /aiuto per l'elenco.\n");
        continue;
      }
      // Se il turno non parte (login scaduto, CLI assente) l'errore va detto e
      // il prompt deve restare: prima la CLI usciva e la sessione era persa.
      // Oltre il limite il servizio rifiuterebbe la richiesta: meglio dirlo
      // prima, con il numero e con un'alternativa che funziona.
      if (testo.length > LIMITE_RICHIESTA) {
        stdout.write(
          avviso("  ⚠ ") +
            `La richiesta è di ${testo.length.toLocaleString("it-IT")} caratteri: il massimo è ${LIMITE_RICHIESTA.toLocaleString("it-IT")}. ` +
            "Salvala in un file, allegala con /allega e chiedi all'AI di seguirla.\n",
        );
        continue;
      }
      const avviato = await api(`/runs/${id}/turn`, { text: testo }).then(
        () => true,
        (e: any) => {
          stdout.write(
            errore("  ! ") +
              (e instanceof Error ? e.message : String(e)) +
              "\n",
          );
          return false;
        },
      );
      if (!avviato) continue;
      const esitoTurno = await follow(api, id, seq);
      seq = esitoTurno.seq;
      // Un turno annullato non consegna nulla e chiude la sessione; uno
      // interrotto dal servizio non consegna un lavoro a metà: resta salvato e
      // il prossimo turno lo porterà a termine.
      if (esitoTurno.fine === "annullata") return;
      if (esitoTurno.fine === "pausa" || esitoTurno.fine === "fallito")
        continue;
      // Senza crediti nessun messaggio in coda può essere servito: ripeterlo per
      // ciascuno riempirebbe lo schermo di errori identici.
      if (esitoTurno.bloccato) {
        if (coda.length) {
          stdout.write(
            avviso("  ⚠ ") +
              `${coda.length} messaggi in attesa messi da parte: riscrivili quando i crediti tornano.` +
              "\n",
          );
          coda.length = 0;
        }
        continue;
      }
      // I file consegnati sono quelli cambiati adesso: il pacchetto di handoff
      // descrive un turno precedente e rielencherebbe lavoro già portato.
      const prodotti = await api(`/runs/${id}/changed`).then(
        (x: any) => x.files ?? [],
        () => [],
      );
      if (prodotti.length) {
        // I file vanno dove la persona li ha chiesti, senza domande. La rete di
        // sicurezza è /annulla, non un permesso da dare ogni volta.
        try {
          const esito = await api(`/runs/${id}/apply`, {});
          stdout.write(descriviConsegna(esito));
          // Con la pubblicazione automatica attiva, ciò che è appena arrivato
          // nella cartella va anche su GitHub.
          if (esito.applicati?.length || esito.eliminati?.length) {
            const github = await api(`/runs/${id}/github`).catch(() => ({}));
            if (github.automatica && github.destinazione)
              await pubblicaSuGithub("", { automatica: true });
          }
        } catch (e) {
          stdout.write(
            avviso("  ⚠ ") +
              `Non ho potuto scrivere nella tua cartella: ${e instanceof Error ? e.message : String(e)}` +
              "\n" +
              tenue(`  I file restano pronti qui: ${prodotti.join(", ")}`) +
              "\n",
          );
        }
      }
    }
  } finally {
    rl?.close();
  }
  const finale = await api(`/runs/${id}`).catch(() => ({ work: "" }));
  stdout.write(
    "\n" +
      tenue(
        "A dopo. Riaprendo Continuity in questa cartella riprendo da qui.\n",
      ),
  );
}
