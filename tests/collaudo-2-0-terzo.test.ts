// Regressioni del terzo collaudo della 2.0 (26 ottobre 2026,
// ~/Desktop/Collaudo_3_Continuity_2.0/rapporto_codex). Ognuna rifà la prova
// del collaudatore; servizi finti, niente rete, segreti inventati.
import { it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { differenze } from "../src/core/revisore.js";
import { percorsoSensibile } from "../src/core/sensibili.js";
import { liberaModello } from "../src/core/ibrida.js";
import { Store } from "../src/persistence/store.js";
import { Engine } from "../src/core/engine.js";

const dirs: string[] = [];
const ollamaPrima = process.env.CONTINUITY_OLLAMA_URL;
afterEach(() => {
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
  process.env.CONTINUITY_OLLAMA_URL = ollamaPrima;
});
const git = (cwd: string, ...a: string[]) =>
  execFileSync("git", ["-c", "user.name=Prova", "-c", "user.email=prova@example.invalid", ...a], { cwd, stdio: "ignore" });
const temp = (n: string) => {
  const d = mkdtempSync(join(tmpdir(), n));
  dirs.push(d);
  return d;
};

// Un Ollama finto con un modello caricato; `generate` risponde con lo stato
// scelto e, se 200, toglie il modello.
async function ollamaFinto(statoGenerate = 200) {
  const caricati = ["qwen3.5:4b"];
  const richieste: string[] = [];
  const server = createServer((req, res) => {
    let corpo = "";
    req.on("data", (x) => (corpo += x));
    req.on("end", () => {
      richieste.push(req.url ?? "");
      if (req.url === "/api/ps") return res.end(JSON.stringify({ models: caricati.map((name) => ({ name })) }));
      if (req.url === "/api/generate") {
        if (statoGenerate === 200) caricati.splice(caricati.indexOf(JSON.parse(corpo).model), 1);
        res.statusCode = statoGenerate;
        return res.end("{}");
      }
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const indirizzo = `http://127.0.0.1:${(server.address() as any).port}`;
  return { indirizzo, caricati, richieste, chiudi: () => new Promise((ok) => server.close(ok)) };
}

it("CT-2.0-201: al revisore non va config/segreti.json, né altri file di credenziali con nomi italiani o composti", () => {
  for (const nome of [
    "config/segreti.json",
    "segreto.yaml",
    "credenziali.toml",
    "chiavi-prod.yml",
    "app.secrets.json",
    "api_keys.txt",
    "passwords.csv",
    "db_password.ini",
  ])
    expect(percorsoSensibile(nome), nome).toBeTruthy();
  // Il codice e i dati qualsiasi restano.
  for (const nome of ["src/token.ts", "tokenizer.json", "segretario.json", "chiavetta.md", "package.json", "src/carrello.js"])
    expect(percorsoSensibile(nome), nome).toBeUndefined();

  const root = temp("continuity-ct3-");
  writeFileSync(join(root, "app.js"), "export const a = 1;\n");
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  mkdirSync(join(root, "config"));
  writeFileSync(join(root, "config", "segreti.json"), '{"key":"CHIAVE_FINTA_JSON"}\n');
  writeFileSync(join(root, "app.js"), "export const a = 2;\n");
  const d = differenze(root);
  expect(d.testo).toContain("export const a = 2;");
  expect(d.testo).not.toContain("CHIAVE_FINTA_JSON");
  expect(d.esclusi).toContain("config/segreti.json");
});

it("CT-2.0-202: lo spegnimento aspetta che Ollama abbia tolto il modello", async () => {
  const ollama = await ollamaFinto();
  process.env.CONTINUITY_OLLAMA_URL = ollama.indirizzo;
  try {
    const engine = new Engine(new Store(temp("continuity-dati-")));
    await engine.shutdown();
    // Appena finito lo spegnimento (il servizio poi esce): già tolto.
    expect(ollama.richieste).toEqual(["/api/ps", "/api/generate"]);
    expect(ollama.caricati).toEqual([]);
  } finally {
    await ollama.chiudi();
  }
});

it("CT-2.0-203: se Ollama rifiuta di togliere il modello, non risulta liberato", async () => {
  const ollama = await ollamaFinto(503);
  try {
    process.env.CONTINUITY_OLLAMA_URL = ollama.indirizzo;
    expect(await liberaModello("qwen3.5:4b")).toBe(false);
    expect(ollama.caricati).toEqual(["qwen3.5:4b"]);
  } finally {
    await ollama.chiudi();
  }
});
