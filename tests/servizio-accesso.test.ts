import { it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Il controllo d'accesso del servizio non si scavalca scrivendo «/api/» in
// forma codificata: Fastify decodifica il percorso prima di scegliere la rotta.
it("senza credenziali le rotte /api sono chiuse anche con il percorso codificato", async () => {
  const dati = mkdtempSync(join(tmpdir(), "continuity-accesso-"));
  const porta = 4800 + Math.floor(Math.random() * 400);
  const servizio = spawn(
    process.execPath,
    ["--import", "tsx", "src/server/main.ts"],
    {
      env: { ...process.env, CONTINUITY_DATA_DIR: dati, PORT: String(porta) },
      stdio: "ignore",
    },
  );
  const base = `http://127.0.0.1:${porta}`;
  try {
    for (let i = 0; i < 100; i++) {
      const ok = await fetch(base + "/api/v1/health")
        .then((r) => r.ok)
        .catch(() => false);
      if (ok) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const stato = async (percorso: string, metodo = "GET") =>
      (await fetch(base + percorso, { method: metodo })).status;
    expect(await stato("/api/v1/health")).toBe(200);
    expect(await stato("/api/v1/runs")).toBe(401);
    expect(await stato("/%61pi/v1/runs")).toBe(401);
    expect(await stato("/%2561pi/v1/runs")).not.toBe(200);
    expect(await stato("/api/v1/%72uns")).toBe(401);
    expect(await stato("/%61pi/v1/runs/x/close", "POST")).toBe(401);
  } finally {
    servizio.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    rmSync(dati, { recursive: true, force: true });
  }
}, 40000);
