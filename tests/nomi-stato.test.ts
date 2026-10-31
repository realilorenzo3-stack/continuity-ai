// I file cambiati letti da «git status -z» (collaudo su Windows del 31
// ottobre): senza -z Git metteva fra virgolette i nomi con spazi o accenti,
// e l'allegato «"allegati/nota prova.txt"» compariva fra le modifiche.
import { it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nomiDaStato } from "../src/core/engine.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

it("i nomi arrivano come sono, e un file rinominato conta una volta sola", () => {
  const repo = mkdtempSync(join(tmpdir(), "continuity-stato-"));
  dirs.push(repo);
  const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "vecchio.txt"), "a\n");
  git("add", "-A");
  git("-c", "user.name=P", "-c", "user.email=p@example.invalid", "commit", "-qm", "i");
  git("mv", "vecchio.txt", "nuovo nome.txt");
  writeFileSync(join(repo, "città.md"), "roma\n");
  mkdirSync(join(repo, "allegati"));
  writeFileSync(join(repo, "allegati", "nota prova.txt"), "x\n");
  const nomi = nomiDaStato(git("status", "--porcelain=v1", "-z", "--untracked-files=all"));
  expect(nomi.sort()).toEqual(["allegati/nota prova.txt", "città.md", "nuovo nome.txt"]);
});
