import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProjectConfig } from "./project.js";

// An average user should not have to write a config file to try the tool. If the
// project already says how it is tested, Continuity reads it; if it says nothing,
// it admits there is nothing to verify instead of inventing a check.
export function detectVerify(root: string): {
  verify: ProjectConfig["verify"];
  origine: string;
} {
  const pacchetto = join(root, "package.json");
  if (existsSync(pacchetto)) {
    try {
      const dati = JSON.parse(readFileSync(pacchetto, "utf8"));
      const gestore = existsSync(join(root, "pnpm-lock.yaml"))
        ? "pnpm"
        : existsSync(join(root, "yarn.lock"))
          ? "yarn"
          : "npm";
      const comandi: ProjectConfig["verify"] = [];
      if (dati.scripts?.test)
        comandi.push({
          id: "test",
          label: "Test del progetto",
          command: [gestore, "test"],
        });
      if (dati.scripts?.build)
        comandi.push({
          id: "build",
          label: "Build del progetto",
          command: [gestore, "run", "build"],
        });
      if (comandi.length) return { verify: comandi, origine: "package.json" };
    } catch {}
  }
  const altri: [string, ProjectConfig["verify"]][] = [
    [
      "Makefile",
      [{ id: "test", label: "make test", command: ["make", "test"] }],
    ],
    [
      "pyproject.toml",
      [{ id: "test", label: "pytest", command: ["pytest", "-q"] }],
    ],
    [
      "go.mod",
      [{ id: "test", label: "go test", command: ["go", "test", "./..."] }],
    ],
    [
      "Cargo.toml",
      [{ id: "test", label: "cargo test", command: ["cargo", "test"] }],
    ],
  ];
  for (const [file, verify] of altri)
    if (existsSync(join(root, file))) return { verify, origine: file };
  return { verify: [], origine: "nessuna" };
}

// Una cartella enorme, o la home, non è un progetto: copiarla sarebbe lentissimo
// e quasi certamente non è ciò che la persona intende.
export function cartellaAdatta(root: string) {
  const casa = homedir();
  if (root === casa || root === "/" || casa.startsWith(root + "/"))
    return {
      adatta: false,
      motivo: "è la tua cartella personale, non un progetto",
    };
  let file = 0;
  let byte = 0;
  const esclusi = new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    "out",
    "target",
    ".next",
    ".venv",
    "venv",
    "__pycache__",
    ".cache",
    "vendor",
  ]);
  const visita = (dir: string): boolean => {
    for (const voce of readdirSync(dir, { withFileTypes: true })) {
      if (esclusi.has(voce.name) || voce.name.startsWith(".")) continue;
      const completo = join(dir, voce.name);
      if (voce.isDirectory()) {
        if (!visita(completo)) return false;
      } else if (voce.isFile()) {
        file++;
        try {
          byte += statSync(completo).size;
        } catch {}
        if (file > 5000 || byte > 200 * 1024 * 1024) return false;
      }
    }
    return true;
  };
  try {
    if (!visita(root))
      return {
        adatta: false,
        motivo: "contiene troppi file per lavorarci in modo sicuro",
      };
  } catch {
    return { adatta: false, motivo: "non è leggibile del tutto" };
  }
  return { adatta: true, motivo: "" };
}
