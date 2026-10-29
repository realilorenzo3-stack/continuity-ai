import { it, expect } from "vitest";
import {
  taglia,
  visibile,
  riquadro,
  colonne,
  avvolgi,
} from "../src/cli/schermo.js";
import { schermataIniziale } from "../src/cli/benvenuto.js";

it("taglia conservando i colori e senza sforare", () => {
  const colorato = "\u001b[31mrosso molto lungo\u001b[0m";
  const tagliato = taglia(colorato, 8);
  expect(visibile(tagliato)).toBeLessThanOrEqual(8);
  expect(tagliato).toContain("\u001b[31m");
});

it("il riquadro resta allineato anche con righe troppo lunghe", () => {
  const righe = riquadro("Titolo", ["x".repeat(500), "corta"]);
  const larghezze = new Set(righe.map((r) => visibile(r)));
  expect(larghezze.size).toBe(1);
});

it("le colonne non sfondano il riquadro", () => {
  const unite = colonne(["a".repeat(200)], ["b".repeat(200)], 20);
  expect(visibile(unite[0])).toBeLessThanOrEqual(100);
});

it("manda a capo senza spezzare le parole", () => {
  const righe = avvolgi(
    "una frase di prova abbastanza lunga da andare a capo",
    20,
  );
  expect(righe.every((r) => visibile(r) <= 20)).toBe(true);
  expect(righe.join(" ")).toContain("abbastanza");
});

it("la schermata dice cosa verifica, o che non può verificare nulla", () => {
  const senzaTest = schermataIniziale({
    versione: "0.1.0",
    cartella: "/tmp/progetto",
    senzaGit: true,
    verifiche: [],
    origineVerifiche: "nessuna",
    modificati: 0,
    rotazione: ["codex", "claude"],
  }).join("\n");
  expect(senzaTest).toContain("Nessun test dichiarato");
  expect(senzaTest).toContain("non ha verifiche sue");

  const conRipresa = schermataIniziale({
    versione: "0.1.0",
    cartella: "/tmp/progetto",
    senzaGit: false,
    verifiche: ["npm test"],
    origineVerifiche: "package.json",
    modificati: 2,
    rotazione: ["codex", "claude"],
    ripresa: { turni: 3, quando: "ieri" },
  }).join("\n");
  expect(conRipresa).toContain("npm test");
  expect(conRipresa).toContain("Riprendo la sessione di ieri");
  expect(conRipresa).toContain("2 file con modifiche non salvate");
});
