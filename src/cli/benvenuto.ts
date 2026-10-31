import { userInfo, homedir } from "node:os";
import {
  accento,
  avviso,
  avvolgi,
  bene,
  colonne,
  forte,
  larghezza,
  riquadro,
  tenue,
} from "./schermo.js";
import { COMANDI } from "./comandi.js";

const LARGO_COMANDO = Math.max(...COMANDI.map((c) => c.nome.length)) + 1;

export type Apertura = {
  versione: string;
  aggiornamento?: string;
  cartella: string;
  senzaGit: boolean;
  verifiche: string[];
  origineVerifiche: string;
  modificati: number;
  rotazione: string[];
  ripresa?: { turni: number; quando: string; recuperata?: boolean };
};

// Il percorso serve per riconoscere dove si è, non per copiarlo: quando è lungo
// bastano le ultime cartelle.
function corto(percorso: string, quanto = 30) {
  const casa = percorso.startsWith(homedir())
    ? "~" + percorso.slice(homedir().length)
    : percorso;
  if (casa.length <= quanto) return casa;
  // Su Windows le cartelle si separano con «\».
  const separatore = casa.includes("\\") ? "\\" : "/";
  const parti = casa.split(separatore).filter(Boolean);
  let coda = parti[parti.length - 1] ?? casa;
  for (let i = parti.length - 2; i >= 0; i--) {
    const prova = parti[i] + separatore + coda;
    if (prova.length + 2 > quanto) break;
    coda = prova;
  }
  return "…" + separatore + coda;
}

export function schermataIniziale(a: Apertura) {
  const nome = userInfo().username;
  const larga = larghezza();
  const sinistra = Math.min(34, Math.floor(larga * 0.38));
  const stretto = larga < 78;
  const destra = stretto ? larga - 4 : larga - 4 - sinistra - 2;

  const colonnaSinistra = [
    forte(`Ciao ${nome}!`),
    "",
    accento("   ◐ ──▶ ◑"),
    "",
    a.rotazione
      .map((p, i) => (i === 0 ? bene(p) : tenue(p)))
      .join(tenue(" → ")),
    tenue(corto(a.cartella, sinistra)),
    tenue(a.senzaGit ? "cartella senza Git" : "repository Git"),
  ];

  const colonnaDestra = [
    accento("Come funziona"),
    ...avvolgi(
      "Scrivi cosa vuoi fare. Le modifiche finiscono nella tua cartella appena sono pronte; /annulla le rimette com'erano.",
      destra,
    ),
    ...avvolgi(
      "Quando un'AI esaurisce i crediti passo a quella dopo, senza perdere il filo del discorso.",
      destra,
    ),
    "",
    accento("Comandi"),
    ...COMANDI.map(
      (c) => tenue(("/" + c.nome).padEnd(LARGO_COMANDO)) + " " + c.breve,
    ),
  ];

  // Sotto una certa larghezza due colonne diventano illeggibili: meglio impilarle
  // che tagliare le parole.
  const righe = stretto
    ? ["", ...colonnaSinistra, "", ...colonnaDestra, ""]
    : ["", ...colonne(colonnaSinistra, colonnaDestra, sinistra), ""];
  const schermata = riquadro(`Continuity v${a.versione}`, righe);

  const note: string[] = [];
  // Sotto il riquadro, in piccolo: basta uno sguardo per sapere se la
  // versione in uso contiene le ultime modifiche.
  if (a.aggiornamento) note.push(tenue("   " + a.aggiornamento), "");
  if (a.verifiche.length)
    note.push(
      bene("✓") +
        `  Verifico con: ${a.verifiche.join(", ")} ` +
        tenue(`(da ${a.origineVerifiche})`),
    );
  else
    note.push(
      avviso("⚠") +
        "  Nessun test dichiarato qui: l'AI prova il suo lavoro, ma Continuity non ha verifiche sue da ripetere",
    );
  if (a.modificati)
    note.push(
      tenue("│") +
        `  ${a.modificati} file con modifiche non salvate: li porto nella copia di lavoro`,
    );
  if (a.ripresa)
    note.push(
      accento("↩") +
        `  Riprendo la sessione di ${a.ripresa.quando}: ${a.ripresa.turni} turni già fatti` +
        (a.ripresa.recuperata
          ? " · era rimasta bloccata da un guasto, il lavoro è intatto"
          : ""),
    );
  note.push(
    tenue("│") +
      "  Le modifiche arrivano nella tua cartella: /annulla per tornare indietro",
  );

  return [...schermata, "", ...note, ""];
}
