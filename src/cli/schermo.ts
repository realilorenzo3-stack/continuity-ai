import { stdout } from "node:process";
import { PAROLE_COMANDO } from "./comandi.js";

// Nessuna libreria esterna: il terminale sa già disegnare, e l'installazione
// resta leggera. I colori spariscono quando l'output non è un terminale, così
// il testo resta leggibile anche in un file di log o in una pipe.
const colori = Boolean(stdout.isTTY) && !process.env.NO_COLOR;
const c = (codice: string) => (testo: string) =>
  colori ? `\u001b[${codice}m${testo}\u001b[0m` : testo;

export const accento = c("38;5;110");
export const forte = c("1");
export const tenue = c("38;5;245");
export const bene = c("38;5;108");
export const avviso = c("38;5;179");
export const errore = c("38;5;167");

const ANSI = /\u001b\[[0-9;]*m/g;
export const visibile = (testo: string) => testo.replace(ANSI, "").length;

export function larghezza() {
  return Math.min(Math.max(stdout.columns ?? 80, 60), 100);
}

function riempi(testo: string, quanto: number) {
  return testo + " ".repeat(Math.max(0, quanto - visibile(testo)));
}

export function avvolgi(testo: string, quanto: number) {
  const righe: string[] = [];
  for (const paragrafo of testo.split("\n")) {
    let riga = "";
    for (const parola of paragrafo.split(" ")) {
      if (riga && visibile(riga) + 1 + visibile(parola) > quanto) {
        righe.push(riga);
        riga = parola;
      } else riga = riga ? riga + " " + parola : parola;
    }
    righe.push(riga);
  }
  return righe;
}

// Una riga più larga della sua colonna spezzerebbe il riquadro: si taglia
// conservando i codici colore, che non occupano spazio sullo schermo.
export function taglia(testo: string, quanto: number) {
  if (visibile(testo) <= quanto) return testo;
  let risultato = "";
  let contati = 0;
  for (let i = 0; i < testo.length; ) {
    if (testo[i] === "\u001b") {
      const fine = testo.indexOf("m", i);
      if (fine === -1) break;
      risultato += testo.slice(i, fine + 1);
      i = fine + 1;
      continue;
    }
    if (contati >= quanto - 1) break;
    risultato += testo[i];
    contati++;
    i++;
  }
  return risultato + "…\u001b[0m";
}

export function colonne(
  sinistra: string[],
  destra: string[],
  largaSinistra: number,
) {
  const totale = Math.max(sinistra.length, destra.length);
  const righe: string[] = [];
  for (let i = 0; i < totale; i++)
    righe.push(
      riempi(taglia(sinistra[i] ?? "", largaSinistra), largaSinistra) +
        "  " +
        taglia(destra[i] ?? "", larghezza() - 4 - largaSinistra - 2),
    );
  return righe;
}

// Il titolo vive dentro il bordo, come nella schermata di Claude Code: si legge
// subito cosa si è aperto senza rubare una riga.
export function riquadro(titolo: string, righe: string[]) {
  const larga = larghezza();
  const interno = larga - 4;
  const testa =
    `╭─ ${accento(titolo)} ` +
    "─".repeat(Math.max(0, larga - visibile(titolo) - 5)) +
    "╮";
  const corpo = righe.map(
    (riga) => `│ ${riempi(taglia(riga, interno), interno)} │`,
  );
  return [testa, ...corpo, "╰" + "─".repeat(larga - 2) + "╯"];
}

export function scrivi(righe: string[]) {
  stdout.write(righe.join("\n") + "\n");
}

// Ogni AI ha il suo colore: guardando il prompt si sa chi risponderà, senza
// doverlo chiedere.
export const COLORI_AI: Record<string, string> = {
  claude: "38;5;209",
  codex: "38;5;255",
  antigravity: "38;5;114",
};
export function coloreAI(nome: string) {
  return c(COLORI_AI[nome] ?? "38;5;110");
}
// Lo spazio di lavoro: si scrive dentro il riquadro e sotto, sempre in vista,
// ci sono le cose che si possono fare, dette come azioni e non come comandi.
export function zonaInput(
  agente: string,
  modello?: string,
  allegati: string[] = [],
  ragionamento?: string,
) {
  const tinta = coloreAI(agente);
  const larga = larghezza();
  const cima = "╭" + "─".repeat(larga - 2) + "╮";
  const destra = allegati.length
    ? `${allegati.length} ${allegati.length === 1 ? "allegato" : "allegati"}`
    : "aiuto";
  // Le azioni più usate, ciascuna con la parola che la apre. Se lo schermo è
  // stretto si tolgono a partire dalla meno usata; l'AI attiva resta sempre.
  const voci: { testo: string; sacrificabile: number }[] = [
    { testo: tenue("+ allega"), sacrificabile: 0 },
    { testo: tenue("◈ ") + (modello ?? tenue("modello")), sacrificabile: 1 },
    ...(ragionamento
      ? [{ testo: tenue("◇ ragionamento ") + ragionamento, sacrificabile: 2 }]
      : []),
    { testo: tinta("● " + agente), sacrificabile: 0 },
  ];
  const unite = () => voci.map((v) => v.testo).join(tenue("   "));
  while (visibile(unite()) + visibile(destra) + 6 > larga) {
    const prossima = voci.reduce(
      (m, v, i) => (v.sacrificabile > (voci[m]?.sacrificabile ?? 0) ? i : m),
      -1,
    );
    if (prossima < 0) break;
    voci.splice(prossima, 1);
  }
  const sinistra = unite();
  const spazio = Math.max(
    1,
    larga - 4 - visibile(sinistra) - visibile(destra) - 1,
  );
  // Sotto lo stato, tutti i comandi: lo stesso elenco del riquadro iniziale e
  // di /aiuto, che va a capo se lo schermo è stretto.
  const comandi: string[] = [];
  let riga = "";
  for (const nome of PAROLE_COMANDO.map((c) => "/" + c)) {
    if (riga && visibile(riga + "  " + nome) > larga - 6) {
      comandi.push(riga);
      riga = nome;
    } else riga = riga ? riga + "  " + nome : nome;
  }
  if (riga) comandi.push(riga);
  const azioni = [
    "│  " + sinistra + " ".repeat(spazio) + tenue(destra) + " │",
    ...comandi.map(
      (r) =>
        "│  " +
        tenue(r) +
        " ".repeat(Math.max(0, larga - 5 - visibile(r))) +
        " │",
    ),
  ].join("\n");
  // La riga dell'input è l'ultima del riquadro, e sotto non si disegna nulla:
  // readline cancella fino a fine schermo ogni volta che scrive il prompt e a
  // ogni tasto premuto, quindi tutto ciò che stava sotto spariva — barra delle
  // azioni e bordo inferiore non sono mai stati visibili. Senza righe sotto
  // non serve nemmeno far risalire il cursore, che era la manovra che si
  // scombinava quando una riga andava a capo e lasciava il prompt altrove.
  const mezzo = "├" + "─".repeat(larga - 2) + "┤";
  return {
    cima: tinta(cima),
    invito: tinta("│ ") + "› ",
    azioni,
    mezzo: tinta(mezzo),
    // Compatibilità con chi disegnava solo l'intestazione (output non a schermo).
    linea: tinta(cima),
  };
}
