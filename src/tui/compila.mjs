// Il JSX dell'interfaccia (Solid per OpenTUI) si compila con Babel, la stessa
// configurazione di @opentui/solid/scripts/solid-transform.js: su Node non c'è
// il «preload» di Bun (prototipi/opentui/README.md). Su Node «solid-js» va
// indicato come solid-js/dist/solid.js: la versione per server non è reattiva.
//
// Babel costa a ogni avvio circa un secondo e mezzo (31 ottobre, PC Windows:
// mezzo secondo per caricarlo, quasi uno per app.tsx), e nel frattempo
// l'interfaccia non risponde: un «/» scritto subito apriva il menu dopo 2-3
// secondi. Il risultato si conserva su disco, con il nome dato dall'impronta
// del file e di questa configurazione; Babel si carica solo se manca.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const OPZIONI = {
  babelrc: false,
  configFile: false,
  sourceMaps: "inline",
  plugins: [
    [
      "babel-plugin-module-resolver",
      { alias: { "^solid-js$": "solid-js/dist/solid.js" } },
    ],
  ],
  presets: [
    [
      "babel-preset-solid",
      { moduleName: "@opentui/solid", generate: "universal" },
    ],
    ["@babel/preset-typescript", { isTSX: true, allExtensions: true }],
  ],
};

let babel;
export function compilaTui(codice, nomeFile) {
  babel ??= createRequire(import.meta.url)("@babel/core");
  return babel.transformSync(codice, { filename: nomeFile, ...OPZIONI }).code;
}

// Questo file stesso entra nell'impronta: cambiando la configurazione (o
// aggiornando Continuity) le vecchie compilazioni non valgono più.
// La cartella sta dentro Continuity (node_modules/.cache, l'uso comune), non
// nella cartella temporanea: su Linux /tmp è di tutti, e un altro utente
// potrebbe lasciarci codice da eseguire.
const QUESTO = readFileSync(fileURLToPath(import.meta.url), "utf8");
const CARTELLA = fileURLToPath(new URL("../../node_modules/.cache/continuity-tui", import.meta.url));

export function compilaTuiConCache(codice, nomeFile, cartella = CARTELLA) {
  const impronta = createHash("sha256")
    .update(QUESTO)
    .update("\0" + process.version + "\0" + nomeFile + "\0")
    .update(codice)
    .digest("hex");
  const file = join(cartella, impronta + ".mjs");
  try {
    return readFileSync(file, "utf8");
  } catch {}
  const compilato = compilaTui(codice, nomeFile);
  // Scritto a parte e poi rinominato: due Continuity aperti insieme non
  // leggono mai un file a metà. Se la cartella non si può scrivere, si
  // compila ogni volta come prima.
  try {
    mkdirSync(cartella, { recursive: true });
    const temporaneo = `${file}.${process.pid}.tmp`;
    writeFileSync(temporaneo, compilato);
    renameSync(temporaneo, file);
  } catch {}
  return compilato;
}
