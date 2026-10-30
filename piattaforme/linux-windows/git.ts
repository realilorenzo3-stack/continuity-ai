// Windows con WSL 2: i progetti sul disco di Windows (/mnt/c/…) e le fine riga
// di Git per Windows. Parte della distribuzione Linux/Windows
// (piattaforme/linux-windows/LEGGIMI.md); src/git/ambiente.ts la usa.
import { execFileSync } from "node:child_process";

// Il disco di Windows visto da WSL: /mnt/c, /mnt/d…
export function sulDiscoDiWindows(percorso: string) {
  return /^\/mnt\/[a-z](\/|$)/i.test(percorso);
}

// Le impostazioni da aggiungere, come variabili d'ambiente di Git
// (GIT_CONFIG_COUNT, Git 2.31 e successivi): valgono più dei file di
// configurazione, senza scrivere nulla nel repository della persona.
export function impostazioniPerWindows(autocrlf: string | undefined): Record<string, string> {
  const voci: [string, string][] = [["core.fileMode", "false"]];
  if (autocrlf && /^(true|input|false)$/.test(autocrlf)) voci.push(["core.autocrlf", autocrlf]);
  return Object.fromEntries([
    ["GIT_CONFIG_COUNT", String(voci.length)],
    ...voci.flatMap(([k, v], i) => [
      [`GIT_CONFIG_KEY_${i}`, k],
      [`GIT_CONFIG_VALUE_${i}`, v],
    ]),
  ]);
}

// La scelta di Git per Windows sulle fine riga per quel repository, chiesta a
// git.exe (dal lato Windows), se c'è.
export function autocrlfDiWindows(repository: string): string | undefined {
  try {
    const cartellaWindows = execFileSync("wslpath", ["-w", repository], { encoding: "utf8", timeout: 5000 }).trim();
    return execFileSync("git.exe", ["-C", cartellaWindows, "config", "--get", "core.autocrlf"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15_000,
    }).trim();
  } catch {
    return undefined;
  }
}
