import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileFuoriProgetto, parole, soloFileTrascinati } from "../src/tui/allegati.js";

// Trascinando dal Finder il Terminale scrive il percorso fra apici o con
// gli spazi preceduti da «\».
it("i percorsi trascinati si leggono come li scrive il Terminale", () => {
  expect(parole("/Users/io/My\\ File.pdf /tmp/b.txt")).toEqual(["/Users/io/My File.pdf", "/tmp/b.txt"]);
  expect(parole("'/Users/io/Nota finale.md' \"/x/y z\"")).toEqual(["/Users/io/Nota finale.md", "/x/y z"]);
  expect(parole("ciao  mondo")).toEqual(["ciao", "mondo"]);
});

it("solo file esistenti diventano allegati; un messaggio resta un messaggio", () => {
  const d = mkdtempSync(join(tmpdir(), "continuity-allegati-"));
  const a = join(d, "Nota con spazi.pdf");
  writeFileSync(a, "x");
  expect(soloFileTrascinati(`'${a}' `)).toEqual([a]);
  expect(soloFileTrascinati(a.replace(/ /g, "\\ "))).toEqual([a]);
  expect(soloFileTrascinati(`leggi ${a}`)).toBeUndefined();
  expect(soloFileTrascinati(join(d, "manca.pdf"))).toBeUndefined();
  expect(soloFileTrascinati(d)).toBeUndefined();
});

it("all'invio si allegano solo i file fuori dal progetto", () => {
  const progetto = mkdtempSync(join(tmpdir(), "continuity-progetto-"));
  mkdirSync(join(progetto, "src"));
  const dentro = join(progetto, "src", "a.ts");
  writeFileSync(dentro, "x");
  const fuori = join(mkdtempSync(join(tmpdir(), "continuity-fuori-")), "spec.pdf");
  writeFileSync(fuori, "x");
  expect(fileFuoriProgetto(`segui ${fuori} e modifica ${dentro}`, progetto)).toEqual([fuori]);
});
