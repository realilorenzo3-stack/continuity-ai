import { it, expect, vi, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Un'AI che, contro le istruzioni, fa commit e cambia ramo nella copia.
const AI_CHE_COMMITTA = [
  'const { execFileSync: x } = require("node:child_process");',
  'require("node:fs").writeFileSync("git-ai.txt", "LAVORO DELL AI\\n");',
  'const g = (...a) => x("git", ["-c", "user.name=AI", "-c", "user.email=ai@l", ...a]);',
  'g("add", "git-ai.txt");',
  'g("commit", "-qm", "commit dell AI");',
  'g("checkout", "-qb", "ramo-dell-ai");',
  'process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "fatto" } }) + "\\n");',
  'process.stdout.write(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }) + "\\n");',
].join("\n");

vi.mock("../src/adapters/live.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/adapters/live.js")>();
  return {
    ...actual,
    requireSubscriptions: () => ({}),
    liveCommand: () => ({
      binary: process.execPath,
      args: ["-e", AI_CHE_COMMITTA],
    }),
  };
});
vi.mock("../src/adapters/connettori.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/adapters/connettori.js")>();
  return { ...actual, scopriConnettori: async () => [] };
});

import { openProject } from "../src/core/project.js";
import { Store } from "../src/persistence/store.js";
import { Engine, statoGitCopia } from "../src/core/engine.js";

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);
const git = (cwd: string, ...a: string[]) =>
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@l", ...a], {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  }).trim();

for (const conGit of [true, false])
  it(`fine turno ordinaria ${conGit ? "con Git e test" : "senza Git né test"}: il commit dell'AI viene annullato, il file consegnato e /annulla lo toglie`, async () => {
    const root = mkdtempSync(join(tmpdir(), "continuity-gitfine-"));
    const data = mkdtempSync(join(tmpdir(), "continuity-dati-"));
    dirs.push(root, data);
    writeFileSync(join(root, "base.txt"), "base\n");
    if (conGit) {
      writeFileSync(
        join(root, "continuity.json"),
        JSON.stringify({
          verify: [{ id: "ok", label: "Ok", command: ["node", "-e", "0"] }],
        }),
      );
      git(root, "init", "-q");
      git(root, "add", "-A");
      git(root, "commit", "-qm", "base");
    }
    const inspected = openProject(root);
    const db = new Store(data),
      engine = new Engine(db);
    try {
      const run = await engine.create(
        "Obiettivo",
        "live",
        "claude",
        {
          root: inspected.root,
          head: inspected.head,
          branch: inspected.branch,
          verify: inspected.config.verify,
          commandsDigest: inspected.commandsDigest,
          modificati: inspected.modificati,
          senzaGit: inspected.senzaGit,
        },
        { providers: ["codex", "claude"] },
      );
      const prima = statoGitCopia(engine.run(run.id).work)!;
      await engine.turn(run.id, "Crea git-ai.txt");
      await vi.waitFor(() => expect(engine.run(run.id).state).toBe("PAUSED"), {
        timeout: 20000,
      });
      // Come fa il terminale a fine turno.
      engine.applyToProject(run.id);
      const r = engine.run(run.id);
      const dopo = statoGitCopia(r.work)!;
      // La copia è tornata sul suo ramo e il commit dell'AI non è nella storia.
      expect(dopo.ramo).toBe(prima.ramo);
      expect(git(r.work, "log", "--format=%s")).not.toContain("commit dell AI");
      // Il lavoro è arrivato nella cartella della persona.
      expect(readFileSync(join(root, "git-ai.txt"), "utf8")).toBe(
        "LAVORO DELL AI\n",
      );
      expect(r.transcript.some((t: any) => /storia Git/.test(t.text))).toBe(
        true,
      );
      // E /annulla lo toglie.
      engine.annullaUltimo(run.id);
      expect(existsSync(join(root, "git-ai.txt"))).toBe(false);
      expect(readFileSync(join(root, "base.txt"), "utf8")).toBe("base\n");
    } finally {
      await engine.shutdown();
      db.close();
    }
  }, 40000);

it("a fine turno si ferma un processo lasciato in background nella copia, e solo quello", async () => {
  const { fermaProcessiNellaCartella } = await import(
    "../src/supervisor/process.js"
  );
  const { spawn } = await import("node:child_process");
  const copia = mkdtempSync(join(tmpdir(), "continuity-orfano-"));
  const altrove = mkdtempSync(join(tmpdir(), "continuity-altrove-"));
  dirs.push(copia, altrove);
  const avvia = (cwd: string) => {
    const p = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      cwd,
      detached: true,
      stdio: "ignore",
    });
    p.unref();
    return p.pid!;
  };
  const orfano = avvia(copia);
  const estraneo = avvia(altrove);
  const vivo = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    await new Promise((r) => setTimeout(r, 300));
    // Nato prima dell'inizio del turno: non è dell'AI di questo turno.
    expect(
      await fermaProcessiNellaCartella(copia, Date.now() + 60_000),
    ).toEqual([]);
    expect(vivo(orfano)).toBe(true);
    const fermati = await fermaProcessiNellaCartella(
      copia,
      Date.now() - 60_000,
    );
    expect(fermati).toContain(orfano);
    expect(fermati).not.toContain(estraneo);
    await vi.waitFor(() => expect(vivo(orfano)).toBe(false), {
      timeout: 5000,
    });
    expect(vivo(estraneo)).toBe(true);
  } finally {
    try {
      process.kill(estraneo, "SIGKILL");
    } catch {}
    try {
      process.kill(orfano, "SIGKILL");
    } catch {}
  }
}, 30000);

it("dopo un riavvio un processo con lo stesso numero ma nato in un altro momento non è nostro", async () => {
  const { identificaGruppo } = await import("../src/supervisor/process.js");
  const { spawn } = await import("node:child_process");
  const p = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  try {
    await new Promise((r) => setTimeout(r, 300));
    const adesso = new Date().toISOString();
    const ieri = new Date(Date.now() - 86_400_000).toISOString();
    expect(identificaGruppo(p.pid!, "sleep", adesso)).toBe("nostro");
    expect(identificaGruppo(p.pid!, "sleep", ieri)).toBe("altro");
  } finally {
    p.kill("SIGKILL");
  }
});
