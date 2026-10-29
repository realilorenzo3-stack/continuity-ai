// Il JSX dell'interfaccia (Solid per OpenTUI) si compila con Babel, la stessa
// configurazione di @opentui/solid/scripts/solid-transform.js: su Node non c'è
// il «preload» di Bun (prototipi/opentui/README.md). Su Node «solid-js» va
// indicato come solid-js/dist/solid.js: la versione per server non è reattiva.
import { transformSync } from "@babel/core";

export function compilaTui(codice, nomeFile) {
  return transformSync(codice, {
    filename: nomeFile,
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
  }).code;
}
