import { it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  strumentoClaude,
  liveCommand,
  projectPrompt,
  ambienteCache,
  DOMINI_SVILUPPO,
} from "../src/adapters/live.js";
import { inspectProject } from "../src/core/project.js";
import { Store } from "../src/persistence/store.js";
import {
  Engine,
  statoGitCopia,
  sessioneNativaEsiste,
} from "../src/core/engine.js";

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);
const dopo = (args: string[], opzione: string) =>
  args[args.indexOf(opzione) + 1];
const impostazioni = (args: string[]) =>
  args.filter((_, i) => args[i - 1] === "-c");

it("Codex sul progetto: rete, cache, ricerca web e ragionamento scelto, nella sua sandbox", () => {
  const { args } = liveCommand(
    "codex",
    "/w",
    undefined,
    undefined,
    "project",
    undefined,
    undefined,
    { ragionamento: "massimo", cache: "/dati/cache" },
  );
  expect(args.slice(0, 1)).toEqual(["exec"]);
  expect(dopo(args, "--sandbox")).toBe("workspace-write");
  expect(dopo(args, "-C")).toBe("/w");
  expect(impostazioni(args)).toEqual(
    expect.arrayContaining([
      "sandbox_workspace_write.network_access=true",
      'sandbox_workspace_write.writable_roots=["/dati/cache"]',
      'web_search="live"',
      'model_reasoning_effort="xhigh"',
    ]),
  );
  expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
});

it("Codex riprende la sua sessione nativa con le stesse regole", () => {
  const { args } = liveCommand(
    "codex",
    "/w",
    undefined,
    undefined,
    "project",
    "gpt-6-astra",
    undefined,
    { ragionamento: "alto", riprendi: "0199aaaa-bbbb-cccc", cache: "/c" },
  );
  expect(args.slice(0, 2)).toEqual(["exec", "resume"]);
  expect(args.slice(-2)).toEqual(["0199aaaa-bbbb-cccc", "-"]);
  expect(impostazioni(args)).toEqual(
    expect.arrayContaining([
      'sandbox_mode="workspace-write"',
      'model_reasoning_effort="high"',
    ]),
  );
  expect(dopo(args, "-m")).toBe("gpt-6-astra");
});

it("Claude sul progetto: ragionamento, ripresa e sandbox con la cache e i domini di sviluppo", () => {
  const { args } = liveCommand(
    "claude",
    "/w",
    undefined,
    undefined,
    "project",
    undefined,
    undefined,
    { ragionamento: "massimo", riprendi: "abcd-1234-efgh", cache: "/c" },
  );
  expect(dopo(args, "--effort")).toBe("max");
  expect(dopo(args, "--resume")).toBe("abcd-1234-efgh");
  expect(args).not.toContain("--no-session-persistence");
  const s = JSON.parse(dopo(args, "--settings"));
  expect(s.sandbox.filesystem.allowWrite).toEqual(["/c"]);
  expect(s.sandbox.network.allowedDomains).toEqual(DOMINI_SVILUPPO);
  // Un server di prova su 127.0.0.1 deve poter ascoltare (CT-027).
  expect(s.sandbox.network.allowLocalBinding).toBe(true);
  expect(s.disableAllHooks).toBe(true);
  expect(dopo(args, "--allowedTools").split(",")).toEqual(
    expect.arrayContaining(["Bash", "WebFetch", "WebSearch", "Skill"]),
  );
});

it("le prove dimostrative restano isolate come prima", () => {
  const claude = liveCommand("claude", "/w").args;
  expect(dopo(claude, "--tools")).toBe("Read,Edit,Write");
  expect(claude).toContain("--no-session-persistence");
  const codex = liveCommand("codex", "/w").args;
  expect(codex).toContain("--ephemeral");
  expect(codex.join(" ")).not.toContain("network_access");
});

it("le cache dei pacchetti puntano dentro la cartella di Continuity", () => {
  const env = ambienteCache("/dati/cache");
  // Con il separatore del sistema (su Windows «\»).
  expect(env.npm_config_cache).toBe(join("/dati/cache", "npm"));
  expect(env.PIP_CACHE_DIR).toBe(join("/dati/cache", "pip"));
  expect(env.CARGO_HOME).toBeUndefined();
  // Una variabile che npm non conosce produce un avviso a ogni comando.
  expect(env.npm_config_store_dir).toBeUndefined();
});

it("le istruzioni chiedono di provare il lavoro, e alla ripresa portano solo il nuovo", () => {
  const base = {
    role: "writer" as const,
    goal: "Gioco",
    work: "/w",
    criteria: [],
  };
  const piena = projectPrompt(base);
  expect(piena).toMatch(/Prova davvero ciò che costruisci/);
  expect(piena).not.toMatch(/Non eseguire i test/);
  // Costi e scelte di account sono decisioni dell'utente: l'AI le chiede.
  expect(piena).toMatch(/fermati e chiedila/);
  expect(piena).not.toMatch(/senza chiedere conferma\./);
  const ripresa = projectPrompt({
    ...base,
    ripresa: true,
    request: "Aggiungi il punteggio",
    transcript: [
      {
        role: "continuity",
        text: "La persona ha annullato l'ultima consegna",
      },
      { role: "utente", text: "Aggiungi il punteggio" },
    ],
  });
  expect(ripresa).toMatch(/^Riprendi la tua sessione/);
  expect(ripresa).toContain("annullato l'ultima consegna");
  expect(ripresa).toContain("Richiesta corrente: Aggiungi il punteggio");
  // La richiesta non è ripetuta due volte e l'obiettivo non è riproposto.
  expect(ripresa.split("Aggiungi il punteggio").length).toBe(2);
  expect(ripresa).not.toContain("Obiettivo");
});

it("una sessione nativa si riprende solo se il suo file esiste", () => {
  const casa = mkdtempSync(join(tmpdir(), "codex-home-"));
  dirs.push(casa);
  const prima = process.env.CODEX_HOME;
  process.env.CODEX_HOME = casa;
  try {
    mkdirSync(join(casa, "sessions", "2026", "10", "06"), { recursive: true });
    writeFileSync(
      join(
        casa,
        "sessions",
        "2026",
        "10",
        "06",
        "rollout-x-0199abcd-1234.jsonl",
      ),
      "{}\n",
    );
    expect(sessioneNativaEsiste("codex", "0199abcd-1234")).toBe(true);
    expect(sessioneNativaEsiste("codex", "0199ffff-0000")).toBe(false);
    expect(sessioneNativaEsiste("codex", "../../etc")).toBe(false);
  } finally {
    if (prima === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prima;
  }
});

it("un commit dell'AI nella copia viene annullato lasciando i file come li ha lasciati", async () => {
  const root = mkdtempSync(join(tmpdir(), "continuity-git-"));
  const data = mkdtempSync(join(tmpdir(), "continuity-dati-"));
  dirs.push(root, data);
  const git = (cwd: string, ...a: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], {
      cwd,
      encoding: "utf8",
    }).trim();
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, "a.txt"), "uno\n");
  writeFileSync(join(root, "continuity.json"), JSON.stringify({ verify: [] }));
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
  const inspected = inspectProject(root);
  const engine = new Engine(new Store(data));
  const created = await engine.create(
    "Obiettivo",
    "simulation",
    "claude",
    {
      root: inspected.root,
      head: inspected.head,
      branch: inspected.branch,
      verify: inspected.config.verify,
      commandsDigest: inspected.commandsDigest,
    },
    { providers: ["codex", "claude"] },
  );
  const r = engine.run(created.id);
  r.gitInizioTurno = statoGitCopia(r.work);
  const partenza = r.gitInizioTurno!.head;
  // L'AI modifica, fa un commit e cambia ramo.
  writeFileSync(join(r.work, "a.txt"), "due\n");
  git(r.work, "commit", "-qam", "commit dell'AI");
  git(r.work, "checkout", "-qb", "ramo-ai");
  engine.ripristinaGitCopia(r);
  const ora = statoGitCopia(r.work)!;
  expect(ora.head).toBe(partenza);
  expect(ora.ramo).not.toBe("refs/heads/ramo-ai");
  // Il lavoro resta nei file, pronto per la consegna.
  expect(readFileSync(join(r.work, "a.txt"), "utf8")).toBe("due\n");
  expect(git(r.work, "status", "--porcelain")).toContain("a.txt");
  expect((r.transcript ?? []).some((t: any) => /storia Git/.test(t.text))).toBe(
    true,
  );
});

it("a schermo si vede quale comando Claude esegue", () => {
  expect(strumentoClaude("Bash", { command: "npm  test\n" })).toBe(
    "esegue  npm test",
  );
  expect(strumentoClaude("WebSearch", { query: "node:test tap" })).toBe(
    "cerca sul web  «node:test tap»",
  );
  expect(strumentoClaude("Read", {})).toBeUndefined();
});

it("gli agenti del progetto arrivano a Claude con tutti gli strumenti ammessi, e le istruzioni chiedono di leggere CLAUDE.md", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import(
    "node:fs"
  );
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const work = mkdtempSync(join(tmpdir(), "continuity-agenti-"));
  try {
    mkdirSync(join(work, ".claude", "agents"), { recursive: true });
    writeFileSync(
      join(work, ".claude", "agents", "tester.md"),
      "---\nname: tester\ndescription: esegue i test\ntools: Bash, Read, Inventato\n---\nEsegui i test.\n",
    );
    const { args } = liveCommand(
      "claude",
      work,
      undefined,
      undefined,
      "project",
    );
    const agenti = JSON.parse(dopo(args, "--agents"));
    expect(agenti.tester.tools).toEqual(["Bash", "Read"]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  expect(
    projectPrompt({ role: "writer", goal: "x", work: "/w", criteria: [] }),
  ).toContain("CLAUDE.md");
});

// Dal 23 ottobre (sito pubblicato senza permesso) Codex non approva più da sé
// gli strumenti che scrivono: «writes» lascia passare solo quelli che leggono.
it("Codex blocca da sé gli strumenti che scrivono delle app accese; Claude chiede nel testo, non con un menu", () => {
  const codex = liveCommand(
    "codex",
    "/w",
    undefined,
    undefined,
    "project",
    undefined,
    {
      attivi: [
        {
          id: "codex:mcp:docs",
          ai: "codex",
          nome: "docs",
          stato: "disponibile",
        },
      ],
      spenti: [],
    },
  ).args;
  expect(impostazioni(codex)).toEqual(
    expect.arrayContaining([
      'apps._default.default_tools_approval_mode="writes"',
      'mcp_servers.docs.default_tools_approval_mode="writes"',
    ]),
  );
  const claude = liveCommand(
    "claude",
    "/w",
    undefined,
    undefined,
    "project",
  ).args;
  expect(dopo(claude, "--disallowedTools").split(",")).toContain(
    "AskUserQuestion",
  );
});

it("rete di Claude: tutti i domini dalla 2.1.186, l'elenco di sviluppo prima", async () => {
  const { retePerClaude } = await import("../src/adapters/live.js");
  expect(retePerClaude("2.1.294 (Claude Code)")).toEqual(["*"]);
  expect(retePerClaude("2.1.186 (Claude Code)")).toEqual(["*"]);
  expect(retePerClaude("2.1.165 (Claude Code)")).toEqual(DOMINI_SVILUPPO);
  expect(retePerClaude(undefined)).toEqual(DOMINI_SVILUPPO);
});
