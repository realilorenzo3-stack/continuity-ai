import { it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectVerify } from "../src/core/detect.js";
import { openProject } from "../src/core/project.js";
import { inventory } from "../src/git/snapshot.js";

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "continuity-rileva-"));
  dirs.push(dir);
  return dir;
};
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);

function git(args: string[], cwd: string) {
  execFileSync("git", args, {
    cwd,
    env: {
      PATH: process.env.PATH,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
    stdio: "ignore",
  });
}

it("rileva i comandi di verifica dal progetto e usa il gestore giusto", () => {
  const root = temp();
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ scripts: { test: "vitest", build: "vite build" } }),
  );
  writeFileSync(join(root, "pnpm-lock.yaml"), "");
  const rilevato = detectVerify(root);
  expect(rilevato.origine).toBe("package.json");
  expect(rilevato.verify.map((v) => v.command.join(" "))).toEqual([
    "pnpm test",
    "pnpm run build",
  ]);
});

it("senza indizi non inventa criteri", () => {
  const rilevato = detectVerify(temp());
  expect(rilevato.verify).toEqual([]);
  expect(rilevato.origine).toBe("nessuna");
});

it("apre un progetto senza configurazione e con lavoro non salvato", () => {
  const root = temp();
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ scripts: { test: "node t.mjs" } }),
  );
  writeFileSync(join(root, "app.mjs"), "export const a = 1;\n");
  git(["init", "-q"], root);
  git(["add", "-A"], root);
  git(
    ["-c", "user.name=T", "-c", "user.email=t@l", "commit", "-qm", "base"],
    root,
  );
  writeFileSync(join(root, "app.mjs"), "export const a = 2;\n");
  const aperto = openProject(root);
  expect(aperto.origine).toBe("package.json");
  expect(aperto.modificati).toEqual(["app.mjs"]);
  expect(aperto.config.verify[0].command).toEqual(["npm", "test"]);
});

it("lo snapshot ignora ciò che è in gitignore: i test scrivono cache senza falsare la verifica", () => {
  const root = temp();
  writeFileSync(join(root, ".gitignore"), "cache/\n*.log\n");
  writeFileSync(join(root, "app.mjs"), "export const a = 1;\n");
  git(["init", "-q"], root);
  git(["add", "-A"], root);
  git(
    ["-c", "user.name=T", "-c", "user.email=t@l", "commit", "-qm", "base"],
    root,
  );
  const prima = inventory(root);
  mkdirSync(join(root, "cache"), { recursive: true });
  writeFileSync(join(root, "cache", "run.json"), "{}");
  writeFileSync(join(root, "prova.log"), "output");
  const dopo = inventory(root);
  expect(dopo.files.map((f) => f.path)).toEqual(prima.files.map((f) => f.path));
  expect(prima.files.map((f) => f.path)).toContain("app.mjs");
});
