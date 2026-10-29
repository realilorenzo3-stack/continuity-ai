// Regressioni dei difetti del primo collaudo della 2.0 (16–17 ottobre 2026,
// ~/Desktop/Collaudo_Continuity_2.0_2026-10-16). Ognuna fallisce sul codice
// collaudato (4d5032c) e passa dopo la correzione.
import { it, expect, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine, differenzaUso } from "../src/core/engine.js";
import { normalizedLiveEvent } from "../src/adapters/live.js";
import { riassumiFile } from "../src/tui/conversazione.js";
import { testoConsegna } from "../src/tui/cliente.js";

// Un finto Ollama su una porta qualsiasi: conta le richieste e, per /api/chat,
// manda un pezzo e poi tiene lo stream aperto (come un modello lento).
const richieste: string[] = [];
const fintoOllama = createServer((req, res) => {
  richieste.push(req.url ?? "");
  if (req.url === "/api/version") return res.end(JSON.stringify({ version: "0.40.4" }));
  if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "qwen3.5:4b" }] }));
  if (req.url === "/api/chat") {
    res.write(JSON.stringify({ message: { content: "Inizio…" } }) + "\n");
    return; // resta aperto
  }
  res.statusCode = 404;
  res.end();
});
await new Promise<void>((ok) => fintoOllama.listen(0, "127.0.0.1", ok));
const indirizzo = `http://127.0.0.1:${(fintoOllama.address() as any).port}`;
afterAll(() => fintoOllama.close());

it("CT-2.0-002: l'uso di Codex è cumulativo sulla sessione: si somma la differenza", () => {
  // Turno breve del collaudo: da 334195/1726 a 363390/1735 nel registro nativo.
  const e = normalizedLiveEvent("codex", {
    type: "turn.completed",
    usage: { input_tokens: 363390, cached_input_tokens: 327040, output_tokens: 1735, reasoning_output_tokens: 16 },
  }) as any;
  expect(e.cumulativo).toBe(true);
  // output_tokens comprende già il ragionamento.
  expect(e.uso.uscita).toBe(1735);
  const prima = { entrata: 334195 - 299136, uscita: 1726, cache: 299136 };
  const d = differenzaUso(e.uso, prima);
  expect(d).toEqual({ entrata: 36350 - 35059, uscita: 9, cache: 27904 });
  expect(d.entrata).toBe(1291);
  // Una sessione nuova (totale più piccolo) vale per intero.
  expect(differenzaUso({ entrata: 10, uscita: 1, cache: 0 }, prima)).toEqual({ entrata: 10, uscita: 1, cache: 0 });
  expect(differenzaUso(e.uso, undefined)).toBe(e.uso);
});

function motoreFinto(stato = "READY") {
  const root = mkdtempSync(join(tmpdir(), "continuity-collaudo20-"));
  const motore = Object.create(Engine.prototype) as any;
  const eventi: { type: string; message: string }[] = [];
  const run: any = { id: "x", session: true, state: stato, transcript: [], project: { root: "/p" } };
  motore.store = { root, list: () => [run] };
  motore.run = () => run;
  motore.event = (_r: any, type: string, message: string) => eventi.push({ type, message });
  motore.remember = () => {};
  motore.busy = new Set();
  motore.children = new Map();
  motore.parziali = new Map();
  motore.locali = new Map();
  motore.stopRequests = new Map();
  return { motore, run, eventi, root };
}

it("CT-2.0-001: un compito locale si ferma davvero, con la sua fine", async () => {
  process.env.CONTINUITY_OLLAMA_URL = indirizzo;
  const prima = process.env.CONTINUITY_IBRIDA;
  delete process.env.CONTINUITY_IBRIDA;
  const { motore, eventi, root } = motoreFinto();
  try {
    motore.avviaCompitoLocale("x", "spiega ENOENT", "spiega");
    await new Promise((ok) => setTimeout(ok, 300));
    expect(motore.parziali.get("x")).toBe("Inizio…");
    expect(motore.fermaCompitoLocale("x")).toBe(true);
    await new Promise((ok) => setTimeout(ok, 100));
    expect(motore.locali.size).toBe(0);
    expect(eventi.at(-1)).toEqual({ type: "local.failed", message: "Compito interrotto" });
    expect(motore.fermaCompitoLocale("x")).toBe(false);
  } finally {
    process.env.CONTINUITY_IBRIDA = prima;
    rmSync(root, { recursive: true, force: true });
  }
});

it("CT-2.0-001: la pausa su una sessione ferma non la blocca", async () => {
  const { motore, run } = motoreFinto("READY");
  const dopo = await motore.action("x", "pause");
  expect(dopo.state).toBe("READY");
  expect(run.state).toBe("READY");
});

// Il servizio vero, con cartella dati e porta proprie, e il finto Ollama.
async function servizio(env: Record<string, string>) {
  const dati = mkdtempSync(join(tmpdir(), "continuity-collaudo20-servizio-"));
  const porta = 47000 + Math.floor(Math.random() * 2000);
  const figlio = spawn(process.execPath, ["--import", "tsx", "src/server/main.ts"], {
    env: { ...process.env, CONTINUITY_DATA_DIR: dati, PORT: String(porta), ...env },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${porta}`;
  for (let i = 0; i < 100; i++) {
    const ok = await fetch(base + "/api/v1/health").then((r) => r.ok, () => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const { readFileSync } = await import("node:fs");
  const token = JSON.parse(readFileSync(join(dati, "service.json"), "utf8")).apiToken;
  const chiama = (percorso: string, corpo?: unknown) =>
    fetch(base + "/api/v1" + percorso, {
      method: corpo ? "POST" : "GET",
      headers: {
        authorization: "Bearer " + token,
        ...(corpo ? { "content-type": "application/json", "x-continuity-csrf": "same-origin", "idempotency-key": String(Math.random()) } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  const chiudi = () => {
    figlio.kill();
    rmSync(dati, { recursive: true, force: true });
  };
  return { chiama, chiudi };
}

it("CT-2.0-004: con l'AI ibrida spenta lo stato non interroga Ollama; il pannello sì", async () => {
  const s = await servizio({ CONTINUITY_IBRIDA: "spenta", CONTINUITY_OLLAMA_URL: indirizzo });
  try {
    richieste.length = 0;
    const r = await (await s.chiama("/ibrida")).json();
    expect(r.config.attiva).toBe(false);
    expect(richieste).toEqual([]);
    await s.chiama("/ibrida?verifica=1");
    expect(richieste).toContain("/api/version");
  } finally {
    s.chiudi();
  }
}, 30000);

it("CT-2.0-005: un compito locale accetta un incolla lungo come un turno", async () => {
  const s = await servizio({ CONTINUITY_IBRIDA: "spenta" });
  try {
    const r = await s.chiama("/runs/inesistente/locale", { testo: "a".repeat(40000) });
    const corpo = await r.json();
    // Il corpo arriva: l'errore è sulla run, non sulla dimensione.
    expect(String(corpo.message ?? "")).not.toMatch(/too large/i);
  } finally {
    s.chiudi();
  }
}, 30000);

it("la riga della consegna con molti file resta corta", () => {
  const molti = Array.from({ length: 30 }, (_, i) => `portfolio/file${i}.ts`);
  const riga = riassumiFile(`File portati nella cartella: ${molti.join(", ")}`);
  expect(riga).toBe(
    "File portati nella cartella: 30 file (portfolio/file0.ts, portfolio/file1.ts, portfolio/file2.ts, …) · /file per l'elenco",
  );
  expect(riassumiFile("File portati nella cartella: a.ts, b.ts")).toBe("File portati nella cartella: a.ts, b.ts");
  expect(testoConsegna({ applicati: molti })).toMatch(/^nella tua cartella: 30 file \(/);
});
