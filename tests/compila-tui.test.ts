// La compilazione dell'interfaccia conservata su disco (31 ottobre): la
// seconda volta lo stesso file si rilegge, un file cambiato si ricompila.
import { it, expect, afterEach } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compilaTui, compilaTuiConCache } from "../src/tui/compila.mjs";

const cartelle: string[] = [];
afterEach(() => cartelle.splice(0).forEach((c) => rmSync(c, { recursive: true, force: true })));

it("conserva il risultato di Babel e lo rilegge finché il file non cambia", () => {
  const cache = mkdtempSync(join(tmpdir(), "continuity-cache-tui-"));
  cartelle.push(cache);
  const file = join(cache, "prova.tsx");
  const codice = "export const A = () => <text>ciao</text>;";
  const prima = compilaTuiConCache(codice, file, cache);
  expect(prima).toBe(compilaTui(codice, file));
  const salvati = readdirSync(cache).filter((f) => f.endsWith(".mjs"));
  expect(salvati).toHaveLength(1);
  // Ciò che è su disco è ciò che si usa: lo si cambia e la seconda lettura
  // lo restituisce senza ricompilare.
  writeFileSync(join(cache, salvati[0]), "// dalla cache");
  expect(compilaTuiConCache(codice, file, cache)).toBe("// dalla cache");
  // Un file cambiato ha un'altra impronta: si ricompila.
  const dopo = compilaTuiConCache(codice + "\nexport const B = 1;", file, cache);
  expect(dopo).toContain("B = 1");
  expect(readdirSync(cache).filter((f) => f.endsWith(".mjs"))).toHaveLength(2);
});

it("senza una cartella scrivibile compila come prima", () => {
  const cache = mkdtempSync(join(tmpdir(), "continuity-cache-tui-"));
  cartelle.push(cache);
  // Un file al posto della cartella: mkdir fallisce, il risultato arriva lo stesso.
  const finta = join(cache, "file");
  writeFileSync(finta, "");
  const codice = "export const A = () => <text>ciao</text>;";
  expect(compilaTuiConCache(codice, join(cache, "a.tsx"), finta)).toBe(compilaTui(codice, join(cache, "a.tsx")));
});
