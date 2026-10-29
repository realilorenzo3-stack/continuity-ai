import { it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compitoDalTesto,
  configPredefinita,
  eseguiCompito,
  leggiIbrida,
  nomeLocale,
  salvaIbrida,
} from "../src/core/ibrida.js";

const cartella = () => mkdtempSync(join(tmpdir(), "continuity-ibrida-"));
// Qui l'AI ibrida serve accesa (vitest.config.ts la spegne per gli altri test).
delete process.env.CONTINUITY_IBRIDA;

it("la configurazione: predefinita, salvata, compiti nuovi che entrano da soli", () => {
  const d = cartella();
  const base = leggiIbrida(d);
  expect(base).toMatchObject({ attiva: true, modello: "qwen3.5:4b", riserva: true, aComando: true });
  expect(base.compiti.map((c) => c.parola)).toEqual(["#chiedi", "#spiega", "#traduci", "#riassumi"]);
  salvaIbrida(d, {
    ...base,
    riserva: false,
    compiti: [{ id: "mio", nome: "Test", parola: "#test", istruzioni: "Scrivi i test", attivo: true }],
  });
  const dopo = leggiIbrida(d);
  expect(dopo.riserva).toBe(false);
  // I predefiniti mancanti tornano, il compito della persona resta.
  expect(dopo.compiti.map((c) => c.parola)).toEqual(["#test", "#chiedi", "#spiega", "#traduci", "#riassumi"]);
});

it("parole doppie o non valide non si salvano", () => {
  const d = cartella();
  const base = configPredefinita();
  expect(() =>
    salvaIbrida(d, { ...base, compiti: [...base.compiti, { ...base.compiti[0], id: "x" }] }),
  ).toThrow(/già usata/);
  expect(() =>
    salvaIbrida(d, { ...base, compiti: [{ id: "y", nome: "Y", parola: "senza-cancelletto", istruzioni: "x", attivo: true }] }),
  ).toThrow(/non valido/);
});

it("«#parola testo» sceglie il compito acceso; spento o sconosciuto resta un messaggio", () => {
  const c = configPredefinita();
  expect(compitoDalTesto(c, "#spiega TypeError: x is undefined")).toMatchObject({
    compito: { id: "spiega" },
    testo: "TypeError: x is undefined",
  });
  expect(compitoDalTesto(c, "#SPIEGA ciao")?.compito.id).toBe("spiega");
  expect(compitoDalTesto(c, "#inesistente ciao")).toBeUndefined();
  expect(compitoDalTesto(c, "Correggi il bug")).toBeUndefined();
  c.compiti[1].attivo = false;
  expect(compitoDalTesto(c, "#spiega x")).toBeUndefined();
  expect(compitoDalTesto({ ...c, attiva: false }, "#chiedi x")).toBeUndefined();
  expect(nomeLocale("qwen3.5:4b")).toBe("qwen");
});

it("la risposta di Ollama arriva a pezzi, senza ragionamento, con le istruzioni del compito", async () => {
  let corpo: any;
  const finto = (async (_u: string, o: any) => {
    corpo = JSON.parse(o.body);
    const righe = ['{"message":{"content":"Cia"}}', '{"message":{"content":"o!"}}', '{"done":true}']
      .map((r) => r + "\n")
      .join("");
    return new Response(righe);
  }) as unknown as typeof fetch;
  const pezzi: string[] = [];
  const r = await eseguiCompito(
    { modello: "qwen3.5:4b", istruzioni: "Rispondi breve", contesto: "Persona: ciao", testo: "Saluta", ogniPezzo: (p) => pezzi.push(p) },
    finto,
  );
  expect(r).toBe("Ciao!");
  expect(pezzi).toEqual(["Cia", "o!"]);
  expect(corpo).toMatchObject({ model: "qwen3.5:4b", stream: true, think: false });
  expect(corpo.messages[0].content).toMatch(/Rispondi breve[\s\S]*Persona: ciao/);
  const assente = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
  await expect(eseguiCompito({ modello: "x", istruzioni: "", testo: "" }, assente)).rejects.toThrow(/ollama pull x/);
});
