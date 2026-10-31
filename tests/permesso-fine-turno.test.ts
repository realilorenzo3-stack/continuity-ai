// Prova di Lorenzo del 31 ottobre: Codex bloccato su «app:
// vercel.create_deployment», e a fine turno nessun modo di consentirlo.
import { it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CODEX_BLOCCATO = [
  'const scrivi = (x) => process.stdout.write(JSON.stringify(x) + "\\n");',
  'scrivi({ type: "item.started", item: { type: "mcp_tool_call", server: "codex_apps", tool: "vercel.create_deployment" } });',
  'scrivi({ type: "item.completed", item: { type: "mcp_tool_call", server: "codex_apps", tool: "vercel.create_deployment", status: "failed", error: { message: "user cancelled MCP tool call" } } });',
  'scrivi({ type: "item.completed", item: { type: "agent_message", text: "Il deploy è stato bloccato: serve il tuo permesso." } });',
  'scrivi({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });',
].join("\n");

vi.mock("../src/adapters/live.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/adapters/live.js")>();
  return {
    ...actual,
    requireSubscriptions: () => ({}),
    liveCommand: () => ({ binary: process.execPath, args: ["-e", CODEX_BLOCCATO] }),
  };
});
vi.mock("../src/adapters/connettori.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/adapters/connettori.js")>();
  return { ...actual, scopriConnettori: async () => [] };
});

import { openProject } from "../src/core/project.js";
import { Store } from "../src/persistence/store.js";
import { Engine } from "../src/core/engine.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const temp = (n: string) => {
  const d = mkdtempSync(join(tmpdir(), n));
  dirs.push(d);
  return d;
};

it("a fine turno l'app bloccata resta da consentire, anche se il campo si perde; il sì vale per il turno dopo", async () => {
  const root = temp("permesso-progetto-");
  writeFileSync(join(root, "index.html"), "<h1>x</h1>\n");
  // Come il progetto di Lorenzo: test e build a fine turno.
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "sito", scripts: { test: "node -e 0", build: "node -e 0" } }),
  );
  const p = openProject(root);
  const db = new Store(temp("permesso-dati-"));
  const engine = new Engine(db);
  try {
    const run = await engine.create(
      "Sito",
      "live",
      "claude",
      { root: p.root, head: p.head, branch: p.branch, verify: p.config.verify, commandsDigest: p.commandsDigest, modificati: p.modificati, senzaGit: p.senzaGit },
      { providers: ["codex", "claude"] },
    );
    await engine.turn(run.id, "Fai il deploy su Vercel");
    await vi.waitFor(() => expect(engine.run(run.id).state).toBe("PAUSED"), { timeout: 20000 });
    const tipi = db.events(run.id).map((e: any) => e.type);
    expect(tipi).toContain("permission.blocked");
    expect(tipi).toContain("turn.completed");
    // Ciò che legge l'interfaccia per fare la domanda.
    expect(engine.current(run.id).permessiNegati).toEqual(["app: vercel.create_deployment"]);
    // Anche se il campo della sessione si perde, le azioni bloccate si
    // ritrovano dagli eventi del turno.
    const r = engine.run(run.id);
    r.permessiNegati = [];
    engine.event(r, "engine.warning", "prova: campo svuotato");
    expect(engine.current(run.id).permessiNegati).toEqual(["app: vercel.create_deployment"]);
    // Il sì vale per il turno dopo, e dopo il sì non si richiede più.
    const dopo = engine.consentiProssimoTurno(run.id, true);
    expect(dopo.permessoTurno).toEqual({ ai: "codex", strumenti: ["app: vercel.create_deployment"] });
    expect(engine.current(run.id).permessiNegati).toEqual([]);
    expect(() => engine.consentiProssimoTurno(run.id, true)).toThrow(/Nessuna azione bloccata/);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 40000);
