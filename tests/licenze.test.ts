// Il controllo prima di distribuire (docs/LICENZE.md §3.4): il codice adattato
// da opencode è dichiarato nel file e negli avvisi di terzi, il testo MIT di
// opencode c'è, ogni dipendenza del programma installato è negli avvisi, e il
// nome «opencode» non compare in nessun testo che la persona vede.
import { it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function fileDi(cartella: string): string[] {
  return readdirSync(cartella).flatMap((n) => {
    const p = join(cartella, n);
    return statSync(p).isDirectory() ? fileDi(p) : /\.(ts|tsx|mjs|js)$/.test(n) ? [p] : [];
  });
}
const sorgenti = fileDi("src");
const avvisi = readFileSync("THIRD_PARTY_NOTICES.md", "utf8");

it("ogni file adattato da opencode ha l'intestazione completa ed è negli avvisi di terzi", () => {
  const adattati = sorgenti.filter((f) => readFileSync(f, "utf8").startsWith("// Adattato da opencode"));
  expect(adattati.length).toBeGreaterThan(0);
  for (const f of adattati) {
    const testa = readFileSync(f, "utf8").split("\n").slice(0, 8).join("\n");
    expect(testa, f).toMatch(/^\/\/ Pacchetto: \S+ +File: \S+ +Versione: \S+$/m);
    expect(testa, f).toContain("// Licenza originale: MIT, Copyright (c) 2025 opencode");
    expect(testa, f).toMatch(/^\/\/ Modifiche: .{10,}$/m);
    expect(avvisi, f).toContain(f.split("/").pop()!);
  }
  // Chi dice di aver ripreso codice da opencode deve avere l'intestazione.
  const senza = sorgenti.filter((f) => {
    const t = readFileSync(f, "utf8");
    return /(ripres[aeio]|adattat[aeio]|copiat[aeio]) da opencode/i.test(t) && !t.startsWith("// Adattato da opencode");
  });
  expect(senza).toEqual([]);
});

it("gli avvisi di terzi contengono la licenza MIT di opencode e ogni dipendenza del programma", () => {
  expect(avvisi).toContain("Copyright (c) 2025 opencode");
  expect(avvisi).toContain("Permission is hereby granted, free of charge");
  const dipendenze = Object.keys(JSON.parse(readFileSync("package.json", "utf8")).dependencies);
  for (const d of dipendenze) expect(avvisi, d).toContain(d);
});

it("il nome opencode non compare nei testi che la persona vede", () => {
  const visibili = sorgenti.flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .map((riga, i) => ({ f, i: i + 1, codice: riga.trim().startsWith("//") || riga.trim().startsWith("*") ? "" : riga.split("//")[0] }))
      .filter((x) => /["'`][^"'`]*opencode/i.test(x.codice)),
  );
  expect(visibili).toEqual([]);
});

it("Continuity ha la licenza Apache 2.0: testo ufficiale, NOTICE, package.json e installatore", () => {
  const licenza = readFileSync("LICENSE", "utf8");
  expect(licenza).toContain("Apache License\n                           Version 2.0, January 2004");
  expect(licenza).toContain("END OF TERMS AND CONDITIONS");
  expect(readFileSync("NOTICE", "utf8")).toMatch(/^Continuity\nCopyright 2026 Lorenzo Reali\n/);
  expect(JSON.parse(readFileSync("package.json", "utf8")).license).toBe("Apache-2.0");
  // LICENSE e NOTICE vanno con il programma installato (Apache 2.0, articolo 4).
  expect(readFileSync("scripts/install.sh", "utf8")).toMatch(/README\.md LICENSE NOTICE THIRD_PARTY_NOTICES\.md/);
});

