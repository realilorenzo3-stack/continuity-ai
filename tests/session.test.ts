import { it, expect, vi, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LIMITE =
  "You've hit your usage limit. Upgrade to Pro or try again at 11:24 PM.";
const SOLUZIONE =
  "export function somma(n) { return n.reduce((a, b) => a + b, 0); }\\n";

// codex esaurisce la quota al primo turno; claude subentra e scrive davvero.
vi.mock("../src/adapters/live.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/adapters/live.js")>();
  return {
    ...actual,
    requireSubscriptions: () => ({}),
    liveCommand: (agent: string) => ({
      binary: process.execPath,
      args: [
        "-e",
        agent === "codex"
          ? `process.stdout.write(JSON.stringify({type:"error",message:${JSON.stringify(LIMITE)}})+"\\n");process.exit(1);`
          : `require("node:fs").writeFileSync("somma.mjs","${SOLUZIONE}");` +
            `process.stdout.write(JSON.stringify({type:"system",subtype:"init"})+"\\n");` +
            `process.stdout.write(JSON.stringify({type:"result",is_error:false})+"\\n");`,
      ],
    }),
  };
});

import { inspectProject } from "../src/core/project.js";
import { Store } from "../src/persistence/store.js";
import { Engine } from "../src/core/engine.js";

const dirs: string[] = [];
afterEach(() =>
  dirs
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);

function progetto() {
  const root = mkdtempSync(join(tmpdir(), "continuity-sessione-"));
  dirs.push(root);
  writeFileSync(
    join(root, "somma.mjs"),
    "export function somma() { return 0; }\n",
  );
  writeFileSync(
    join(root, "test.mjs"),
    'import { somma } from "./somma.mjs";\nimport assert from "node:assert";\nassert.strictEqual(somma([1, 2, 3]), 6);\n',
  );
  writeFileSync(
    join(root, "continuity.json"),
    JSON.stringify({
      verify: [{ id: "test", label: "Test", command: ["node", "test.mjs"] }],
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

async function sessione(providers: string[]) {
  const root = progetto();
  const data = mkdtempSync(join(tmpdir(), "continuity-dati-"));
  dirs.push(data);
  const inspected = inspectProject(root);
  const db = new Store(data),
    engine = new Engine(db);
  const run = await engine.create(
    "Obiettivo di sessione",
    "live",
    "claude",
    {
      root: inspected.root,
      head: inspected.head,
      branch: inspected.branch,
      verify: inspected.config.verify,
      commandsDigest: inspected.commandsDigest,
    },
    { providers },
  );
  return { engine, db, run, root };
}

it("la sessione attende il primo messaggio invece di partire da sola", async () => {
  const { engine, db, run } = await sessione(["codex", "claude"]);
  try {
    expect(engine.run(run.id).state).toBe("READY");
    expect(engine.run(run.id).agent).toBe("codex");
    expect(engine.children.size).toBe(0);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("quota esaurita: passa al provider successivo, conserva il filo e fa lavorare il successore", async () => {
  const { engine, db, run } = await sessione(["codex", "claude"]);
  try {
    await engine.turn(run.id, "Implementa la somma");
    await vi.waitFor(() => expect(engine.run(run.id).state).toBe("PAUSED"), {
      timeout: 15000,
    });
    const r = engine.run(run.id);
    expect(r.agent).toBe("claude");
    expect(r.switches).toBe(1);
    expect(r.checks.every((c: any) => c.passed)).toBe(true);
    // Il filo: la richiesta dell'utente resta nel trascritto tenuto da Continuity.
    expect(r.transcript.map((t: any) => t.text)).toContain(
      "Implementa la somma",
    );
    const rhp = JSON.parse(readFileSync(join(r.dir, "handoff.json"), "utf8"));
    expect(rhp.toAgent).toBe("claude");
    const tipi = db.events(run.id).map((e: any) => e.type);
    expect(tipi).toContain("turn.started");
    expect(tipi).toContain("switch.started");
    expect(tipi).toContain("turn.completed");
    // Il turno dopo lavora ancora Claude, ma Codex saltato lo si dice: senza
    // la riga sembrava un guasto (Lorenzo, 31 ottobre).
    const prima = db.events(run.id).length;
    await engine.turn(run.id, "Aggiungi un commento");
    // Su Windows, con le altre prove in parallelo, il turno e le verifiche
    // superano a volte i 15 secondi.
    await vi.waitFor(() => expect(engine.run(run.id).state).toBe("PAUSED"), {
      timeout: 40000,
    });
    const nuovi = db.events(run.id).slice(prima);
    const passaggio = nuovi.find((e: any) => e.type === "switch.started");
    expect(passaggio?.payload.message).toMatch(
      /^codex ha esaurito i crediti dell'abbonamento \(torna alle \d\d:\d\d\) · questo turno lo fa claude$/,
    );
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 90000);

it("senza altri provider nella rotazione il turno si ferma e lo dice", async () => {
  const { engine, db, run } = await sessione(["codex"]);
  try {
    await engine.turn(run.id, "Implementa la somma");
    await vi.waitFor(() => expect(engine.run(run.id).state).toBe("PAUSED"), {
      timeout: 15000,
    });
    const messaggi = db
      .events(run.id)
      .map((e: any) => e.payload.message)
      .join(" ");
    expect(messaggi).toContain("esaurito la quota");
    expect(engine.run(run.id).switches).toBe(0);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 40000);
