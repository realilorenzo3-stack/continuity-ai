// «continuity uninstall --all» su Windows: toglie dall'archivio credenziali
// di Windows le chiavi dei servizi di questa cartella dati, per nome, senza
// leggerle. Il nome è quello del programma (servizioPortachiavi). Scrive quante
// voci ha tolto. Parte della distribuzione Windows (piattaforme/windows/LEGGIMI.md).
//   node --import tsx piattaforme/windows/togli-chiavi.ts <cartella dati>
import { spawnSync } from "node:child_process";
import { servizioPortachiavi } from "../../src/core/archivio.js";
import { codificaPowerShell, scriptVault } from "../linux-windows/portachiavi.js";

const dati = process.argv[2];
if (!dati) {
  console.error("Uso: togli-chiavi.ts <cartella dati>");
  process.exit(2);
}
const r = spawnSync(
  "powershell.exe",
  ["-NoProfile", "-NonInteractive", "-EncodedCommand", codificaPowerShell(scriptVault("togliTutte", servizioPortachiavi(dati)))],
  { encoding: "utf8", windowsHide: true, timeout: 60_000 },
);
const tolte = Number(String(r.stdout ?? "").trim());
console.log(Number.isFinite(tolte) ? String(tolte) : "0");
