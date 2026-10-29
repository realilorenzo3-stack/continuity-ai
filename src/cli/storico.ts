import { accento, avviso, bene, coloreAI, errore, tenue } from "./schermo.js";

// La conversazione già fatta, ristampata alla riapertura com'era apparsa dal
// vivo: richieste, AI al lavoro, azioni, risposte, consegne. Come in Claude
// Code e Codex, chi riapre ritrova la chat dall'inizio invece di uno schermo
// vuoto. Si costruisce dal registro degli eventi del servizio; le richieste
// delle sessioni nate prima dell'evento «user.request» si recuperano dalla
// conversazione tenuta per le AI, abbinandole per data.

type Evento = {
  seq: number;
  type: string;
  recordedAt?: string;
  payload?: { message?: string };
};
type Voce = { role: string; text: string; at?: string };

// Una richiesta incollata di centinaia di righe sommergerebbe tutto il resto:
// se ne mostra l'inizio, e quante righe aveva.
const RIGHE_RICHIESTA = 12;

function durata(da?: string, a?: string) {
  if (!da || !a) return "";
  const s = Math.max(0, Math.round((Date.parse(a) - Date.parse(da)) / 1000));
  return s < 60
    ? `${s}s`
    : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}`;
}

function richiesta(testo: string) {
  const righe = testo.trim().split("\n");
  const visibili = righe.slice(0, RIGHE_RICHIESTA);
  return (
    accento("› ") +
    visibili.join("\n  ") +
    (righe.length > RIGHE_RICHIESTA
      ? "\n  " +
        tenue(
          `… (${righe.length} righe in tutto, ${testo.length.toLocaleString("it-IT")} caratteri)`,
        )
      : "")
  );
}

export function rendiStorico(
  eventi: Evento[],
  trascritto: Voce[] = [],
): string {
  const ordinati = [...eventi].sort((a, b) => a.seq - b.seq);
  if (!ordinati.some((e) => e.type === "turn.started")) return "";
  const richiesteVecchie = trascritto
    .filter((v) => v.role === "utente" && v.at)
    .sort((a, b) => (a.at! < b.at! ? -1 : 1));
  const usate = new Set<Voce>();
  const fuori: string[] = [];
  let richiestaDelTurno = false;
  let inizioTurno: string | undefined;
  let consumo = "";
  let fineTurnoPrecedente = "";
  for (let i = 0; i < ordinati.length; i++) {
    const e = ordinati[i];
    let testo = String(e.payload?.message ?? "").trim();
    switch (e.type) {
      case "user.request":
        fuori.push("", richiesta(testo));
        richiestaDelTurno = true;
        break;
      case "turn.started": {
        inizioTurno = e.recordedAt;
        consumo = "";
        if (!richiestaDelTurno) {
          // Sessioni di prima: la richiesta dell'utente più vicina prima
          // dell'inizio del turno, non ancora usata.
          const candidata = [...richiesteVecchie]
            .reverse()
            .find(
              (v) =>
                !usate.has(v) &&
                (!e.recordedAt || v.at! <= e.recordedAt) &&
                v.at! >= fineTurnoPrecedente,
            );
          if (candidata) usate.add(candidata);
          fuori.push(
            "",
            candidata
              ? richiesta(candidata.text)
              : accento("› ") + tenue("(richiesta non conservata)"),
          );
        }
        richiestaDelTurno = false;
        break;
      }
      case "attempt.started": {
        const agente = testo.split(" ")[0];
        fuori.push(coloreAI(agente)(`  ${agente}`) + tenue(" ha lavorato"));
        break;
      }
      case "agent.action":
        // Un comando su più righe (uno script incollato) resta su una riga.
        testo = testo.replace(/\s*\n\s*/g, " ");
        fuori.push(
          testo.startsWith("delega")
            ? accento("   ⤷ " + testo)
            : tenue("   · " + testo),
        );
        break;
      case "agent.message":
        if (testo) fuori.push("  " + testo.replace(/\n/g, "\n  "));
        break;
      case "switch.started":
        fuori.push(accento("  ⟳ " + testo));
        break;
      case "resume.started":
        fuori.push("", accento("  ↩ " + testo));
        break;
      case "usage.reported":
        consumo =
          " · " +
          testo
            .replace(" token in ingresso", " in")
            .replace(" in uscita", " out");
        break;
      case "verification.completed": {
        if (testo.startsWith("Stato salvato per il passaggio")) {
          fuori.push(tenue("   · " + testo));
          break;
        }
        const quanti = testo.match(/^(\d+)\/(\d+) criteri/);
        fuori.push(
          (testo.includes("Nessuna verifica")
            ? avviso("  ⚠ ")
            : quanti && quanti[1] === quanti[2]
              ? bene("  ✓ ")
              : errore("  ✗ ")) + testo,
        );
        break;
      }
      case "turn.completed":
      case "turn.failed":
      case "turn.blocked": {
        const tempo = durata(inizioTurno, e.recordedAt);
        const riga = "  " + testo + (tempo ? " · " + tempo : "") + consumo;
        fuori.push(e.type === "turn.completed" ? tenue(riga) : avviso(riga));
        fineTurnoPrecedente = e.recordedAt ?? fineTurnoPrecedente;
        break;
      }
      case "work.applied":
        fuori.push(bene("  ✓ ") + testo);
        break;
      case "publish.completed":
        fuori.push(bene("  ⇪ ") + testo);
        break;
      case "work.conflict":
      case "work.apply_failed":
        fuori.push(avviso("  ⚠ ") + testo);
        break;
      case "work.undone":
        fuori.push(tenue("  ↶ " + testo));
        break;
      case "engine.warning":
      case "turn.silent":
        fuori.push(avviso("  ⚠ " + testo));
        break;
      case "run.paused":
        fuori.push(avviso("  ‖ " + testo));
        break;
      // I comandi dati durante la sessione, in una riga.
      case "sequence.changed":
      case "model.changed":
      case "reasoning.changed":
      case "connectors.updated":
      case "work.synced":
        fuori.push(tenue("  · " + testo));
        break;
      case "agent.reported":
        // Solo ciò che la persona ha visto: la fine dei crediti.
        if (/quota|crediti|limite/i.test(testo))
          fuori.push(avviso("  ⚠ " + testo));
        break;
    }
  }
  return fuori.join("\n").replace(/^\n+/, "") + "\n";
}

export function cornice(titolo: string, larghezza = 80) {
  const testo = ` ${titolo} `;
  const lato = Math.max(3, Math.floor((larghezza - testo.length) / 2));
  return tenue("─".repeat(lato) + testo + "─".repeat(lato));
}
