// Windows nativo (31 ottobre): una copia di lavoro con un file oltre 260
// caratteri non nasceva («Filename too long»). Le fine riga invece restano
// come sul Mac: con core.autocrlf=true le consegne dei progetti con file LF
// andavano tutte in conflitto (piattaforme/windows/git.ts).
import { it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ambienteGit } from "../src/git/ambiente.js";

const suWindows = process.platform === "win32";
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

it("Windows: percorsi lunghi sempre, nessuna conversione delle fine riga", () => {
  const env = ambienteGit("C:\\Users\\anna\\sito", "windows");
  expect(env).toMatchObject({
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.longpaths",
    GIT_CONFIG_VALUE_0: "true",
  });
  expect(Object.values(env)).not.toContain("core.autocrlf");
  // Sul Mac nulla di questo.
  expect(ambienteGit("/Users/anna/sito", "mac").GIT_CONFIG_COUNT).toBeUndefined();
});

it.runIf(suWindows)("Windows: la copia con percorsi lunghi nasce, e un file LF resta LF", () => {
  const radice = mkdtempSync(join(tmpdir(), "cgw-"));
  dirs.push(radice);
  const repo = join(radice, "r");
  mkdirSync(repo);
  const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", env: ambienteGit(cwd) });
  git(repo, "init", "-q", "-b", "main");
  const profonda = ["a".repeat(60), "b".repeat(60), "c".repeat(60)].join("\\");
  mkdirSync(join(repo, profonda), { recursive: true });
  writeFileSync(join(repo, profonda, "f.txt"), "x\n");
  writeFileSync(join(repo, "a.txt"), "riga uno\nriga due\n");
  git(repo, "add", "-A");
  git(repo, "-c", "user.name=P", "-c", "user.email=p@example.invalid", "commit", "-qm", "i");
  const copia = join(radice, "dati-di-continuity-abbastanza-in-profondita", "runs", "0".repeat(36), "worktree");
  expect(join(copia, profonda, "f.txt").length).toBeGreaterThan(260);
  git(repo, "worktree", "add", "-q", "-b", "prova", copia, "HEAD");
  expect(git(copia, "status", "--porcelain")).toBe("");
  expect(readFileSync(join(copia, "a.txt"), "utf8")).toBe("riga uno\nriga due\n");
});
