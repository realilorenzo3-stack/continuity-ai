// La struttura del 30 ottobre: codice comune in src/, e ciò che vale per un
// sistema solo nella sua distribuzione (piattaforme/macos,
// piattaforme/linux-windows). Così una modifica al codice comune vale per
// tutti, e le due distribuzioni restano allineate. Questa prova fallisce se un
// comando di un sistema solo finisce nel codice comune.
import { it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function fileDi(cartella: string): string[] {
  return readdirSync(cartella).flatMap((n) => {
    const p = join(cartella, n);
    return statSync(p).isDirectory() ? fileDi(p) : /\.(ts|tsx|mjs)$/.test(n) ? [p] : [];
  });
}

// I comandi e i controlli che esistono su un sistema solo.
const DI_UN_SISTEMA = /process\.platform|["'`](\/usr\/bin\/)?(pbcopy|pbpaste|osascript|security|lsof|secret-tool|powershell\.exe|clip\.exe|wslpath|wslview|explorer\.exe|xdg-open|zenity|ditto|git\.exe)["'`]/;

// Le eccezioni note, con il motivo. Aggiungerne una va spiegato qui.
const ECCEZIONI: Record<string, string> = {
  // Il dispatcher: sceglie la distribuzione.
  "src/piattaforma.ts": "sceglie fra le due distribuzioni",
  "src/sistema.ts": "riconosce il sistema",
  // Il controllo del sistema della configurazione iniziale elenca ciò che
  // serve su ciascun sistema: è una tabella, non un comportamento.
  "src/core/requisiti.ts": "elenco dei requisiti per sistema",
  // Gemini CLI con account personale (non supportato nelle sessioni): il
  // percorso delle sue impostazioni gestite, solo per bloccarlo.
  "src/adapters/gemini.ts": "impostazioni gestite di Gemini CLI",
};

it("i comandi di un sistema solo stanno nella sua distribuzione, non nel codice comune", () => {
  const fuoriPosto = fileDi("src")
    .filter((f) => !ECCEZIONI[f])
    .flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((riga, i) => ({ f, i: i + 1, riga: riga.trim() }))
        .filter((x) => !x.riga.startsWith("//") && !x.riga.startsWith("*") && DI_UN_SISTEMA.test(x.riga.split(" //")[0])),
    )
    .map((x) => `${x.f}:${x.i} ${x.riga}`);
  expect(fuoriPosto).toEqual([]);
});

it("le due distribuzioni hanno le stesse funzioni di sistema e i loro documenti", () => {
  const esportate = (f: string) =>
    [...readFileSync(f, "utf8").matchAll(/^export function (\w+)/gm)].map((m) => m[1]).sort();
  for (const f of ["sistema.ts", "allegati.ts"])
    expect(esportate(join("piattaforme/linux-windows", f)), f).toEqual(esportate(join("piattaforme/macos", f)));
  for (const doc of ["piattaforme/macos/LEGGIMI.md", "piattaforme/linux-windows/LEGGIMI.md", "piattaforme/linux-windows/CONTESTO_LAVORI.md"])
    expect(existsSync(doc), doc).toBe(true);
});
