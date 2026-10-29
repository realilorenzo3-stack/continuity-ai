import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  COMANDI,
  PAROLE_COMANDO,
  comandoSimile,
  normalizzaComando,
  testoAiuto,
} from "../src/cli/comandi.js";
import { schermataIniziale } from "../src/cli/benvenuto.js";
import { comandoSenzaBarra, finisceConDomanda } from "../src/cli/session.js";
import { zonaInput, visibile } from "../src/cli/schermo.js";

const apertura = {
  versione: "0.1.0",
  cartella: "/tmp/progetto",
  senzaGit: true,
  verifiche: [],
  origineVerifiche: "nessuna",
  modificati: 0,
  rotazione: ["codex", "claude"],
};

it("ogni comando che il terminale gestisce è nell'elenco, e viceversa", () => {
  const sorgente = readFileSync("src/cli/session.ts", "utf8");
  const gestiti = new Set(
    [...sorgente.matchAll(/testo(?: ===|\.startsWith\()\s*"\/([a-z]+)/g)].map(
      (m) => m[1],
    ),
  );
  expect([...gestiti].sort()).toEqual([...PAROLE_COMANDO].sort());
});

it("il riquadro iniziale e /aiuto mostrano tutti i comandi", () => {
  const schermata = schermataIniziale(apertura).join("\n");
  const aiuto = testoAiuto();
  for (const c of COMANDI) {
    expect(schermata).toContain("/" + c.nome);
    expect(aiuto).toContain("/" + c.nome);
  }
  expect(aiuto).toContain("Ctrl+C");
});

it("una parola simile a un comando viene riconosciuta, un testo normale no", () => {
  expect(comandoSimile("connettore")).toBe("connettori");
  expect(comandoSimile("modelli")).toBe("modello");
  expect(comandoSimile("/aiutp")).toBe("aiuto");
  expect(comandoSimile("ragionameno")).toBe("ragionamento");
  expect(comandoSimile("connettori")).toBeUndefined();
  expect(comandoSimile("ciao")).toBeUndefined();
  expect(comandoSimile("grazie")).toBeUndefined();
  expect(comandoSimile("crea un sito")).toBeUndefined();
});

it("la barra sotto la casella mostra lo stato e tutti i comandi, a ogni larghezza", () => {
  const prima = process.stdout.columns;
  try {
    for (const colonne of [120, 80, 40]) {
      Object.defineProperty(process.stdout, "columns", {
        value: colonne,
        configurable: true,
      });
      const barra = zonaInput("codex", undefined, [], "alto").azioni;
      expect(barra).toContain("codex");
      for (const nome of PAROLE_COMANDO) expect(barra).toContain("/" + nome);
      const larghezze = new Set(barra.split("\n").map((r) => visibile(r)));
      expect(larghezze.size).toBe(1);
      expect([...larghezze][0]).toBeLessThanOrEqual(
        Math.max(60, Math.min(colonne, 100)),
      );
    }
    Object.defineProperty(process.stdout, "columns", {
      value: 120,
      configurable: true,
    });
    expect(zonaInput("codex", undefined, [], "alto").azioni).toContain(
      "ragionamento alto",
    );
  } finally {
    Object.defineProperty(process.stdout, "columns", {
      value: prima,
      configurable: true,
    });
  }
});

it("i comandi con argomento funzionano anche senza barra, senza mandare nulla all'AI", () => {
  expect(comandoSenzaBarra("ragionamento alto")).toBe("/ragionamento alto");
  expect(comandoSenzaBarra("Ragionamento Claude massimo")).toBe(
    "/ragionamento claude massimo",
  );
  expect(comandoSenzaBarra("ragionamento sul design del sito")).toBe(
    "ragionamento sul design del sito",
  );
});

it("gli alias inglesi conservano i comandi italiani compatibili", () => {
  expect(normalizzaComando("/language english")).toBe("/linguaggio english");
  expect(normalizzaComando("/status")).toBe("/stato");
  expect(normalizzaComando("/connect groq")).toBe("/collega groq");
  expect(normalizzaComando("/modello opus")).toBe("/modello opus");
});

it("riconosce quando l'AI chiude il turno con una domanda", () => {
  expect(
    finisceConDomanda(
      "Fatto il sito.\n\nPer completare: **qual è il nome del file della foto?**",
    ),
  ).toBe(true);
  expect(finisceConDomanda("Vuoi usare l'organizzazione A?\n- Sì\n- No")).toBe(
    true,
  );
  expect(finisceConDomanda("Ho finito. Tutti i test passano.")).toBe(false);
});

it("riconosce le richieste di pubblicazione su GitHub, non le domande né le modifiche al repo", async () => {
  const { intentoPubblica } = await import("../src/cli/session.js");
  for (const frase of [
    "pubblica su git",
    "Pubblica il sito su GitHub",
    "fai il push",
    "carica tutto su github",
    "pubblica su git realilorenzo3-stack/Continuity_Website",
    "push",
  ])
    expect(intentoPubblica(frase), frase).toBeDefined();
  expect(
    intentoPubblica("pubblica su git realilorenzo3-stack/Continuity_Website")
      ?.destinazione,
  ).toBe("realilorenzo3-stack/Continuity_Website");
  for (const frase of [
    "come posso pubblicare su git?",
    "aggiorna il README del repo",
    "aggiungi una sezione con il link al repository GitHub",
    "perché il push non funziona",
  ])
    expect(intentoPubblica(frase), frase).toBeUndefined();
});
