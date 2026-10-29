import { it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectProject } from "../src/core/project.js";
import { projectPrompt, liveCommand } from "../src/adapters/live.js";
import { Store } from "../src/persistence/store.js";
import { Engine } from "../src/core/engine.js";

const dirs: string[] = [];
afterEach(() =>
  dirs
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);

function repo() {
  const root = mkdtempSync(join(tmpdir(), "continuity-rhp-"));
  dirs.push(root);
  writeFileSync(
    join(root, "somma.mjs"),
    "export function somma() { return 0; }\n",
  );
  writeFileSync(join(root, "altro.mjs"), "export const intatto = true;\n");
  writeFileSync(
    join(root, "continuity.json"),
    JSON.stringify({
      verify: [
        { id: "vero", label: "Sempre verde", command: ["node", "-e", "0"] },
        {
          id: "falso",
          label: "Sempre rosso",
          command: ["node", "-e", "process.exit(3)"],
        },
      ],
    }),
  );
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
      stdio: "ignore",
    });
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["-c", "user.name=T", "-c", "user.email=t@l", "commit", "-qm", "base"]);
  return root;
}

it("il prompt del successore dice di continuare e porta lo stato, quello del writer no", () => {
  const criteri = [
    { id: "a", label: "Criterio verde", passed: true },
    { id: "b", label: "Criterio rosso", passed: false },
  ];
  const writer = projectPrompt({
    role: "writer",
    goal: "Obiettivo utente",
    work: "/tmp/lavoro",
    criteria: criteri,
  });
  expect(writer).toContain("/tmp/lavoro");
  expect(writer).toContain("Obiettivo utente");
  expect(writer).not.toContain("ricominciare");

  const successore = projectPrompt({
    role: "successor",
    goal: "Obiettivo utente",
    work: "/tmp/lavoro",
    criteria: criteri,
    handoff: { snapshot: { changedFiles: ["somma.mjs"] } },
  });
  expect(successore).toContain("non ricominciare da zero");
  expect(successore).toContain("esaurimento quota");
  expect(successore).toContain("già superato, non romperlo");
  expect(successore).toContain("NON superato, va risolto");
  expect(successore).toContain('"changedFiles"');
});

it("i permessi sul progetto: modifiche nella copia, terminale nella sandbox, Git che scrive vietato", () => {
  const comando = liveCommand(
    "claude",
    "/tmp/lavoro",
    undefined,
    undefined,
    "project",
  );
  const args = comando.args;
  expect(args[args.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
  expect(args).not.toContain("bypassPermissions");
  expect(args).not.toContain("--dangerously-skip-permissions");
  const vietati = args[args.indexOf("--disallowedTools") + 1].split(",");
  expect(vietati).toContain("Bash(git commit:*)");
  expect(vietati).toContain("Bash(git checkout:*)");
  expect(vietati).not.toContain("Bash(git status:*)");
});

it("il pacchetto trasferisce stato reale: file cambiati, criteri, dichiarazioni e cosa resta da fare", async () => {
  const root = repo();
  const data = mkdtempSync(join(tmpdir(), "continuity-dati-"));
  dirs.push(data);
  const inspected = inspectProject(root);
  const db = new Store(data),
    engine = new Engine(db);
  try {
    const created = await engine.create(
      "Obiettivo utente",
      "simulation",
      "claude",
      {
        root: inspected.root,
        head: inspected.head,
        branch: inspected.branch,
        verify: inspected.config.verify,
        commandsDigest: inspected.commandsDigest,
      },
    );
    const r = engine.run(created.id);
    writeFileSync(
      join(r.work, "somma.mjs"),
      "export function somma() { return 1; }\n",
    );
    engine.event(r, "agent.message", "Ho riscritto la somma", "codex");
    // Percorso reale del motore: quiesce, checkpoint, verifica, pacchetto.
    await engine.action(created.id, "switch");
    const rhp = JSON.parse(readFileSync(join(r.dir, "handoff.json"), "utf8"));
    // Solo ciò che è cambiato, non l'inventario del repository.
    expect(rhp.snapshot.changedFiles).toEqual(["somma.mjs"]);
    expect(rhp.constraints[0]).toContain("worktree");
    expect(rhp.acceptance.map((c: any) => [c.id, c.status])).toEqual([
      ["vero", "passed"],
      ["falso", "failed"],
    ]);
    expect(rhp.nextActions[0]).toContain("Sempre rosso");
    expect(rhp.agentReported.map((a: any) => a.text)).toContain(
      "Ho riscritto la somma",
    );
    expect(rhp.agentReported[0].status).toContain("non verificato");
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);
