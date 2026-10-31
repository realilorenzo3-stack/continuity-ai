// I comandi di Codex a schermo senza la shell che li avvolge (31 ottobre: su
// Windows restava solo il percorso di PowerShell).
import { it, expect } from "vitest";
import { comandoCodex } from "../src/adapters/live.js";

it("toglie /bin/sh -lc e il PowerShell di Windows, con i loro apici", () => {
  expect(comandoCodex("/bin/zsh -lc 'npm test'")).toBe("npm test");
  expect(comandoCodex('"C:\\\\WINDOWS\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command \'node test.mjs\'')).toBe("node test.mjs");
  expect(comandoCodex('"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "rg --files"')).toBe("rg --files");
  expect(comandoCodex("ls -la")).toBe("ls -la");
  expect(comandoCodex(undefined)).toBe("");
});
