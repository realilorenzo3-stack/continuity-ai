// Quali provider la persona ha collegato, senza segreti: le chiavi stanno nel
// Portachiavi, qui solo i nomi, per proporli nella sequenza delle sessioni nuove
// e per ricordare i server locali (che non hanno una chiave da cercare).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROVIDER, providerNoto } from "./provider.js";

const file = (root: string) => join(root, "provider-collegati.json");

export function collegati(root: string): string[] {
  try {
    const elenco = JSON.parse(readFileSync(file(root), "utf8"));
    return Array.isArray(elenco)
      ? elenco.filter((p) => typeof p === "string" && providerNoto(p))
      : [];
  } catch {
    return [];
  }
}

export function segnaCollegato(root: string, id: string, collegato: boolean) {
  const prima = collegati(root).filter((p) => p !== id);
  const dopo = collegato ? [...prima, id] : prima;
  writeFileSync(file(root), JSON.stringify(dopo, null, 2) + "\n", {
    mode: 0o600,
  });
}

// Gli abbonamenti per primi, come ha deciso Lorenzo il 14 ottobre 2026
// (CONTINUITY_2.0.md §5.8), poi i provider collegati nell'ordine del registro.
// L'ordine conta poco: la persona lo cambia con «/ordine».
export function sequenzaPredefinita(root: string): string[] {
  const scelti = new Set(collegati(root));
  return [
    "codex",
    "claude",
    ...PROVIDER.filter(
      // Anche i gratuiti: lavorano sui file attraverso il ponte (Fase 4).
      (p) => p.accesso !== "abbonamento" && scelti.has(p.id),
    ).map((p) => p.id),
  ];
}
