// NVIDIA elenca molti modelli che l'account non può usare (404 «Function …
// Not found for account»): il controllo diretto li salta senza contarli, e
// Continuity ricorda su disco quelli buoni e quelli assenti (28 ottobre).
import { it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chiediRevisione } from "../src/core/revisore.js";
import { providerNoto } from "../src/core/provider.js";
import { Engine } from "../src/core/engine.js";
import { Store } from "../src/persistence/store.js";
import { portachiaviInMemoria } from "../src/core/portachiavi.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

it("i modelli assenti per l'account non contano fra i tre tentativi e vengono scartati", async () => {
  const chiesti: string[] = [];
  const scartati: string[] = [];
  const esito = await chiediRevisione({
    provider: providerNoto("nvidia")!,
    chiave: "nvapi-finta",
    modelli: ["a/uno", "a/due", "a/tre", "a/quattro", "a/cinque"],
    messaggi: [{ role: "user", content: "rivedi" }],
    scarta: (m) => scartati.push(m),
    scarica: (async (_url: any, init: any) => {
      const m = JSON.parse(init.body).model;
      chiesti.push(m);
      if (m !== "a/cinque") return new Response(JSON.stringify({ status: 404, title: "Not Found", detail: "Function 'x': Not found for account 'y'" }), { status: 404 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "NESSUN SUGGERIMENTO" } }] }), { headers: { "content-type": "application/json" } });
    }) as any,
  });
  expect(esito.modello).toBe("a/cinque");
  expect(scartati).toEqual(["a/uno", "a/due", "a/tre", "a/quattro"]);
});

it("il modello buono e quelli scartati restano dopo un riavvio, e il buono si prova per primo", async () => {
  const dati = mkdtempSync(join(tmpdir(), "continuity-modelli-"));
  dirs.push(dati);
  const elenco = { data: [{ id: "nvidia/nemotron-3-super" }, { id: "deepseek-ai/deepseek-v4.1-flash" }, { id: "nvidia/nemotron-3.5-super-vl" }] };
  const prima = new Engine(new Store(dati));
  (prima as any).ricordaModelloBuono("nvidia", "nvidia/nemotron-3.5-super-vl");
  (prima as any).scartaModello("nvidia", "nvidia/nemotron-3-super");
  await prima.shutdown();
  expect(existsSync(join(dati, "ponte", "modelli.json"))).toBe(true);
  expect(readFileSync(join(dati, "ponte", "modelli.json"), "utf8")).not.toMatch(/nvapi/);
  const dopo = new Engine(new Store(dati));
  dopo.chiavi = portachiaviInMemoria({ nvidia: "nvapi-finta" });
  dopo.scaricaGratuiti = (async () => new Response(JSON.stringify(elenco))) as any;
  try {
    const modelli = (await dopo.modelliGratuitiDi("nvidia")).map((m) => m.id);
    expect(modelli).not.toContain("nvidia/nemotron-3-super");
    expect((dopo as any).modelloBuono.get("nvidia")).toBe("nvidia/nemotron-3.5-super-vl");
  } finally {
    await dopo.shutdown();
  }
});
