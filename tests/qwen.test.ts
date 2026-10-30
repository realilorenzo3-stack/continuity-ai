// Qwen sa dove gira (25 ottobre: «non posso sapere se giro in locale», una
// «ricerca» inventata, caratteri cinesi). Con un finto Ollama: si legge che
// cosa riceve davvero il modello.
import { it, expect, afterAll } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/core/engine.js";

const corpi: any[] = [];
const ollama = createServer((req, res) => {
  let dati = "";
  req.on("data", (d) => (dati += d));
  req.on("end", () => {
    if (req.url === "/api/version") return res.end(JSON.stringify({ version: "0.40.4" }));
    if (req.url === "/api/chat") {
      corpi.push(JSON.parse(dati));
      res.write(JSON.stringify({ message: { content: "Ciao" }, done: false }) + "\n");
      return res.end(JSON.stringify({ message: { content: "" }, done: true }) + "\n");
    }
    res.statusCode = 404;
    res.end();
  });
});
await new Promise<void>((ok) => ollama.listen(0, "127.0.0.1", ok));
afterAll(() => ollama.close());

it("le istruzioni dicono a Qwen che gira sul Mac, senza internet e senza file", async () => {
  process.env.CONTINUITY_OLLAMA_URL = `http://127.0.0.1:${(ollama.address() as any).port}`;
  const prima = process.env.CONTINUITY_IBRIDA;
  delete process.env.CONTINUITY_IBRIDA;
  const root = mkdtempSync(join(tmpdir(), "continuity-qwen-"));
  const motore = Object.create(Engine.prototype) as any;
  const run: any = { id: "x", session: true, state: "READY", transcript: [], project: { root: "/p" } };
  Object.assign(motore, {
    store: { root, list: () => [run] },
    run: () => run,
    event: () => {},
    remember: () => {},
    busy: new Set(),
    children: new Map(),
    parziali: new Map(),
    locali: new Map(),
  });
  try {
    motore.avviaCompitoLocale("x", "Fai una ricerca su Dante", "chiedi");
    for (let i = 0; i < 50 && !corpi.length; i++) await new Promise((ok) => setTimeout(ok, 50));
    const sistema = corpi[0].messages[0].content as string;
    expect(sistema).toMatch(/gira sul computer della persona con Ollama, senza internet/);
    expect(sistema).toMatch(/non puoi cercare sul web/);
    expect(sistema).toMatch(/Rispondi alla persona in italiano/);
    expect(corpi[0].model).toBe("qwen3.5:4b");
    // Due minuti in memoria, non dieci (26 ottobre: 4 GB su un Mac da 8).
    expect(corpi[0].keep_alive).toBe("2m");
  } finally {
    process.env.CONTINUITY_IBRIDA = prima;
    rmSync(root, { recursive: true, force: true });
  }
});

it("liberaModello toglie dalla memoria solo il modello dell'AI ibrida, senza avviare Ollama", async () => {
  const { liberaModello } = await import("../src/core/ibrida.js");
  const richieste: any[] = [];
  const caricati = ["qwen3.5:4b", "altro:7b"];
  const finto = (async (url: any, init?: any) => {
    richieste.push({ url: String(url), corpo: init?.body ? JSON.parse(init.body) : undefined });
    if (String(url).endsWith("/api/ps")) return new Response(JSON.stringify({ models: caricati.map((name) => ({ name })) }));
    return new Response("{}");
  }) as any;
  expect(await liberaModello("qwen3.5:4b", finto)).toBe(true);
  expect(richieste.at(-1)).toMatchObject({ url: expect.stringContaining("/api/generate"), corpo: { model: "qwen3.5:4b", keep_alive: 0 } });
  // Un modello non caricato: nessuna richiesta di scarico.
  richieste.length = 0;
  expect(await liberaModello("assente:1b", finto)).toBe(false);
  expect(richieste.map((r) => r.url).some((u) => u.endsWith("/api/generate"))).toBe(false);
  // Ollama spento: niente errori, niente avvii.
  const spento = (async () => {
    throw new Error("ECONNREFUSED");
  }) as any;
  expect(await liberaModello("qwen3.5:4b", spento)).toBe(false);
});
