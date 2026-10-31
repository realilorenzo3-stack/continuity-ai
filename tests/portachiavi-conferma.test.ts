// La conferma del Mac sulle chiavi (decisione del 17 ottobre 2026): la voce si
// salva senza app fidate, il segreto si legge una volta sola finché la voce
// non cambia, e «collegato» non legge il segreto. Con un finto «security»:
// il Portachiavi vero della persona non si tocca.
import { it, expect, beforeEach, afterAll } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { portachiaviMac } from "../src/core/portachiavi.js";

const cartella = mkdtempSync(join(tmpdir(), "continuity-portachiavi-"));
const voci = join(cartella, "voci");
const registro = join(cartella, "registro");
const finto = join(cartella, "security");
afterAll(() => rmSync(cartella, { recursive: true, force: true }));

// Una voce è un file per account; «nega» simula il «Rifiuta» del riquadro.
writeFileSync(
  finto,
  `#!/bin/bash
mkdir -p "${voci}"
if [ "$1" = "-i" ]; then
  read -r riga
  echo "-i $riga" >> "${registro}"
  eval set -- $riga
  while [ $# -gt 0 ]; do
    case "$1" in -a) a="$2"; shift ;; -w) w="$2"; shift ;; esac; shift
  done
  printf %s "$w" > "${voci}/$a"
  exit 0
fi
echo "$*" >> "${registro}"
cmd="$1"; shift
while [ $# -gt 0 ]; do
  case "$1" in -a) a="$2"; shift ;; -w) segreto=1 ;; esac; shift
done
f="${voci}/$a"
case "$cmd" in
  delete-generic-password) [ -f "$f" ] && rm "$f" && exit 0; exit 44 ;;
  find-generic-password)
    [ -f "$f" ] || exit 44
    if [ -n "$segreto" ]; then
      [ -f "${cartella}/nega" ] && exit 51
      cat "$f"; echo
    else
      echo "attributi: $(cat "$f" | shasum)"
    fi ;;
esac
`,
);
chmodSync(finto, 0o755);

const letture = () =>
  existsSync(registro)
    ? readFileSync(registro, "utf8").split("\n").filter((r) => r.startsWith("find") && r.endsWith(" -w")).length
    : 0;

beforeEach(() => {
  rmSync(voci, { recursive: true, force: true });
  rmSync(registro, { force: true });
  rmSync(join(cartella, "nega"), { force: true });
});

// Il Portachiavi del Mac (security finto in sh).
it.skipIf(process.platform === "win32")("la chiave si salva senza app fidate, togliendo la voce vecchia", () => {
  const chiavi = portachiaviMac(join(cartella, "dati-a"), finto);
  chiavi.salva("openai", "sk-finta");
  const righe = readFileSync(registro, "utf8").trim().split("\n");
  expect(righe[0]).toMatch(/^delete-generic-password -s Continuity · dati-a · [0-9a-f]{8} -a openai$/);
  expect(righe[1]).toMatch(/^-i add-generic-password .* -T "" -w "sk-finta"$/);
  // Niente -U: la voce nuova nasce con la conferma.
  expect(righe[1]).not.toMatch(/ -U /);
});

// Il Portachiavi del Mac (security finto in sh).
it.skipIf(process.platform === "win32")("il segreto si legge una volta: poi resta in memoria finché la voce non cambia", () => {
  const chiavi = portachiaviMac(join(cartella, "dati-b"), finto);
  chiavi.salva("openai", "sk-uno");
  expect(chiavi.leggi("openai")).toBe("sk-uno");
  expect(chiavi.leggi("openai")).toBe("sk-uno");
  // Un'altra istanza nello stesso processo (il servizio ne crea più d'una).
  expect(portachiaviMac(join(cartella, "dati-b"), finto).leggi("openai")).toBe("sk-uno");
  expect(letture()).toBe(1);
  // Cambiata da un altro processo (per esempio «continuity collega»): si rilegge.
  writeFileSync(join(voci, "openai"), "sk-due");
  expect(chiavi.leggi("openai")).toBe("sk-due");
  expect(letture()).toBe(2);
});

// Il Portachiavi del Mac (security finto in sh).
it.skipIf(process.platform === "win32")("«collegato» e la sequenza non leggono il segreto", () => {
  const chiavi = portachiaviMac(join(cartella, "dati-c"), finto);
  expect(chiavi.esiste("zai")).toBe(false);
  chiavi.salva("zai", "k");
  expect(chiavi.esiste("zai")).toBe(true);
  expect(letture()).toBe(0);
  expect(chiavi.togli("zai")).toBe(true);
  expect(chiavi.esiste("zai")).toBe(false);
  expect(chiavi.leggi("zai")).toBeUndefined();
});

// Il Portachiavi del Mac (security finto in sh).
it.skipIf(process.platform === "win32")("se il Mac rifiuta, l'errore lo dice (non «manca la chiave»)", () => {
  const chiavi = portachiaviMac(join(cartella, "dati-d"), finto);
  chiavi.salva("deepseek", "k");
  writeFileSync(join(cartella, "nega"), "");
  expect(() => chiavi.leggi("deepseek")).toThrow(/permesso.*Consenti/);
});
