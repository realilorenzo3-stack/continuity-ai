// I permessi per le azioni fuori dal progetto (decisione di Lorenzo del 23
// ottobre, dopo il sito pubblicato senza permesso): Claude chiede ogni volta,
// Codex è bloccato e si chiede a fine turno. E il tempo massimo degli
// strumenti dei connettori (REA appeso, 23 e 24 ottobre). Nessuna AI vera.
import { it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decidi, soloLettura } from "../src/adapters/permessi-mcp.mjs";
import {
  liveCommand,
  normalizedLiveEvent,
  subscriptionEnvironment,
  TEMPO_MASSIMO_STRUMENTO_MS,
} from "../src/adapters/live.js";
import { openProject } from "../src/core/project.js";
import { Store } from "../src/persistence/store.js";
import { Engine } from "../src/core/engine.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

it("leggono soltanto: get, list, search… passano; pubblicare, cambiare, cancellare no", () => {
  for (const t of [
    "mcp__claude_ai_Vercel__get_project",
    "mcp__claude_ai_Vercel__list_deployments",
    "mcp__claude_ai_Vercel__search_vercel_documentation",
    "mcp__rea__capture_browser_scenario",
  ])
    expect(soloLettura(t)).toBe(true);
  for (const t of [
    "mcp__claude_ai_Vercel__create_deployment",
    "mcp__claude_ai_Vercel__update_project",
    "mcp__claude_ai_Gmail__send_message",
    "mcp__claude_ai_Supabase__execute_sql",
    "mcp__x__qualcosa_di_nuovo",
    // Un verbo che cambia, anche dopo «get» (collaudo del 25 ottobre).
    "mcp__x__get_or_create_record",
    "mcp__x__list_and_delete_files",
    "Bash",
  ])
    expect(soloLettura(t)).toBe(false);
});

// Un finto servizio di Continuity per la domanda di permesso.
async function servizioFinto(risposta: { consenti: boolean }) {
  const viste: any[] = [];
  const server = createServer((req, res) => {
    let corpo = "";
    req.on("data", (d) => (corpo += d));
    req.on("end", () => {
      viste.push({ url: req.url, auth: req.headers.authorization, corpo: JSON.parse(corpo || "{}") });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(risposta));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const cartella = mkdtempSync(join(tmpdir(), "continuity-permessi-"));
  dirs.push(cartella);
  const file = join(cartella, "service.json");
  writeFileSync(file, JSON.stringify({ origin: `http://127.0.0.1:${(server.address() as any).port}`, apiToken: "tok" }));
  return { file, viste, chiudi: () => server.close() };
}

it("il programma dei permessi: legge passa da sé, il resto lo chiede a Continuity", async () => {
  const s = await servizioFinto({ consenti: false });
  process.env.CONTINUITY_PERMESSI_SERVIZIO = s.file;
  try {
    expect(await decidi({ tool_name: "Bash", input: {} })).toMatchObject({ behavior: "deny" });
    expect(await decidi({ tool_name: "mcp__claude_ai_Vercel__get_project", input: { id: 1 } })).toEqual({
      behavior: "allow",
      updatedInput: { id: 1 },
    });
    expect(s.viste).toEqual([]);
    const no: any = await decidi({ tool_name: "mcp__claude_ai_Vercel__create_deployment", input: { project: "lorenzoreali" } });
    expect(no.behavior).toBe("deny");
    expect(no.message).toMatch(/non riprovare per altre vie/i);
    expect(s.viste[0].auth).toBe("Bearer tok");
    expect(s.viste[0].corpo).toEqual({ strumento: "mcp__claude_ai_Vercel__create_deployment", input: { project: "lorenzoreali" } });
  } finally {
    s.chiudi();
    delete process.env.CONTINUITY_PERMESSI_SERVIZIO;
  }
});

it("il programma dei permessi risponde come server MCP, avviato come lo avvia Claude Code", async () => {
  const s = await servizioFinto({ consenti: true });
  const programma = fileURLToPath(new URL("../src/adapters/permessi-mcp.mjs", import.meta.url));
  const figlio = spawn(process.execPath, [programma], {
    env: { ...process.env, CONTINUITY_PERMESSI_RUN: "r1", CONTINUITY_PERMESSI_SERVIZIO: s.file },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const risposte: any[] = [];
  let resto = "";
  figlio.stdout.on("data", (d) => {
    resto += d;
    const righe = resto.split("\n");
    resto = righe.pop()!;
    for (const r of righe) if (r.trim()) risposte.push(JSON.parse(r));
  });
  const manda = (m: any) => figlio.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
  const aspetta = async (n: number) => {
    for (let i = 0; i < 100 && risposte.length < n; i++) await new Promise((ok) => setTimeout(ok, 50));
  };
  try {
    manda({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    manda({ method: "notifications/initialized" });
    manda({ id: 2, method: "tools/list" });
    manda({ id: 3, method: "tools/call", params: { name: "permesso", arguments: { tool_name: "mcp__claude_ai_Vercel__update_project", input: { x: 1 } } } });
    await aspetta(3);
    expect(risposte[0].result.serverInfo.name).toBe("continuity");
    expect(risposte[1].result.tools[0].name).toBe("permesso");
    expect(JSON.parse(risposte[2].result.content[0].text)).toEqual({ behavior: "allow", updatedInput: { x: 1 } });
    expect(s.viste[0].url).toBe("/api/v1/runs/r1/permessi/chiedi");
  } finally {
    figlio.kill();
    s.chiudi();
  }
}, 15000);

it("Claude sul progetto: connettori non consentiti in anticipo, decide il programma dei permessi", () => {
  const gmail = { id: "claude:mcp:gmail", ai: "claude", nome: "Gmail", prefisso: "mcp__claude_ai_Gmail" } as any;
  const conPermessi = liveCommand("claude", "/tmp/lavoro", undefined, undefined, "project", undefined, { attivi: [gmail], spenti: [] }, {
    permessi: { run: "r1", servizio: "/dati/service.json" },
  }).args;
  const dopo = (a: string[], o: string) => a[a.indexOf(o) + 1];
  expect(dopo(conPermessi, "--permission-prompt-tool")).toBe("mcp__continuity__permesso");
  expect(dopo(conPermessi, "--allowedTools")).not.toContain("mcp__claude_ai_Gmail");
  const config = JSON.parse(dopo(conPermessi, "--mcp-config"));
  expect(config.mcpServers.continuity.args[0]).toMatch(/permessi-mcp\.mjs$/);
  expect(config.mcpServers.continuity.env).toEqual({ CONTINUITY_PERMESSI_RUN: "r1", CONTINUITY_PERMESSI_SERVIZIO: "/dati/service.json" });
  // Senza permessi (prove dimostrative, vecchie chiamate) resta com'era.
  const senza = liveCommand("claude", "/tmp/lavoro", undefined, undefined, "project", undefined, { attivi: [gmail], spenti: [] }).args;
  expect(senza).not.toContain("--permission-prompt-tool");
  expect(dopo(senza, "--allowedTools")).toContain("mcp__claude_ai_Gmail");
});

it("Codex sul progetto: gli strumenti che scrivono sono bloccati, salvo il permesso del turno", () => {
  const docs = { id: "codex:mcp:docs", ai: "codex", nome: "docs" } as any;
  const comando = (codexConsentito?: boolean) =>
    liveCommand("codex", "/tmp/lavoro", undefined, undefined, "project", undefined, { attivi: [docs], spenti: [] }, {
      permessi: { run: "r1", servizio: "/x", codexConsentito },
    }).args.join(" ");
  expect(comando()).toContain('apps._default.default_tools_approval_mode="writes"');
  expect(comando()).toContain('mcp_servers.docs.default_tools_approval_mode="writes"');
  expect(comando(true)).toContain('apps._default.default_tools_approval_mode="approve"');
  expect(comando(true)).toContain('mcp_servers.docs.default_tools_approval_mode="approve"');
});

it("Codex: uno strumento annullato perché senza permesso diventa una richiesta per la persona", () => {
  expect(
    normalizedLiveEvent("codex", {
      type: "item.completed",
      item: { type: "mcp_tool_call", server: "codex_apps", tool: "vercel.create_deployment", status: "failed", error: { message: "user cancelled MCP tool call" } },
    }),
  ).toMatchObject({ type: "permesso", text: "app: vercel.create_deployment" });
  // Un errore qualunque dello strumento non è una richiesta di permesso.
  expect(
    normalizedLiveEvent("codex", {
      type: "item.completed",
      item: { type: "mcp_tool_call", server: "x", tool: "y", status: "failed", error: { message: "timeout" } },
    }),
  ).not.toMatchObject({ type: "permesso" });
});

it("le AI ricevono la regola: una domanda non è una richiesta di agire", () => {
  const { args } = liveCommand("claude", "/tmp/lavoro", undefined, undefined, "project");
  void args;
  // La regola sta nelle istruzioni comuni del turno.
  const testo = require("node:fs").readFileSync(fileURLToPath(new URL("../src/adapters/live.ts", import.meta.url)), "utf8");
  expect(testo).toMatch(/una domanda \(«è online\?», «è pubblico\?»\) non è una richiesta di agire/);
});

it("ogni strumento dei connettori ha un tempo massimo anche con Claude", () => {
  expect(subscriptionEnvironment().MCP_TOOL_TIMEOUT).toBe(String(TEMPO_MASSIMO_STRUMENTO_MS));
  expect(TEMPO_MASSIMO_STRUMENTO_MS).toBe(180_000);
});

async function sessione() {
  const root = mkdtempSync(join(tmpdir(), "continuity-permessi-prog-"));
  const data = mkdtempSync(join(tmpdir(), "continuity-dati-"));
  dirs.push(root, data);
  writeFileSync(join(root, "a.txt"), "a\n");
  const aperto = openProject(root);
  const db = new Store(data);
  const engine = new Engine(db);
  const run = await engine.create(
    "Obiettivo",
    "simulation",
    "claude",
    { root: aperto.root, head: aperto.head, branch: aperto.branch, verify: aperto.config.verify, commandsDigest: aperto.commandsDigest, senzaGit: true },
    { providers: ["claude", "codex"] },
  );
  await engine.shutdown();
  return { engine, db, run };
}

it("il motore tiene la domanda finché la persona risponde; fermando il turno la risposta è no", async () => {
  const { engine, db, run } = await sessione();
  try {
    // Fuori da un turno nessuno può chiedere.
    expect(await engine.chiediPermesso(run.id, "mcp__claude_ai_Vercel__create_deployment", {})).toBe(false);
    (engine as any).children.set(run.id, {});
    const attesa = engine.chiediPermesso(run.id, "mcp__claude_ai_Vercel__create_deployment", { project: "p" });
    const p = engine.permessoInAttesa(run.id)!;
    expect(p.strumento).toBe("Vercel: create_deployment");
    expect(p.dettaglio).toContain('"project":"p"');
    engine.decidiPermesso(run.id, p.id, true);
    expect(await attesa).toBe(true);
    expect(engine.permessoInAttesa(run.id)).toBeUndefined();
    expect(() => engine.decidiPermesso(run.id, p.id, true)).toThrow(/già decisa/);
    const seconda = engine.chiediPermesso(run.id, "mcp__claude_ai_Vercel__update_project", {});
    engine.negaPermessiDi(run.id, "turno fermato");
    expect(await seconda).toBe(false);
    const tipi = engine.store.events(run.id).map((e: any) => e.type);
    expect(tipi).toEqual(expect.arrayContaining(["permission.requested", "permission.granted", "permission.denied"]));
    (engine as any).children.delete(run.id);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("Codex: il permesso dato a fine turno vale solo per il turno dopo", async () => {
  const { engine, db, run } = await sessione();
  try {
    expect(() => engine.consentiProssimoTurno(run.id, true)).toThrow(/Nessuna azione bloccata/);
    const r = engine.run(run.id);
    r.agent = "codex";
    r.permessiNegati = ["app: vercel.create_deployment"];
    engine.event(r, "engine.warning", "prova");
    const dopo = engine.consentiProssimoTurno(run.id, true);
    expect(dopo.permessoTurno).toEqual({ ai: "codex", strumenti: ["app: vercel.create_deployment"] });
    expect(dopo.permessiNegati).toEqual([]);
    await engine.turn(run.id, "Hai il mio permesso");
    const nel = engine.run(run.id);
    expect(nel.permessoAttivo).toEqual({ ai: "codex", strumenti: ["app: vercel.create_deployment"] });
    expect(nel.permessoTurno).toBeUndefined();
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 40000);
