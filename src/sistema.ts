// Su quale sistema gira Continuity, e se un programma c'è. In comune fra le due
// distribuzioni (piattaforme/macos, piattaforme/linux-windows), che lo usano
// senza dipendere da src/piattaforma.ts.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export type Sistema = "mac" | "linux" | "wsl";

// WSL 2 è Linux, con Windows accanto: lo si riconosce dal kernel di Microsoft.
export function sistema(
  piattaforma = process.platform,
  ambiente: NodeJS.ProcessEnv = process.env,
  versioneKernel = () => {
    try {
      return readFileSync("/proc/version", "utf8");
    } catch {
      return "";
    }
  },
): Sistema {
  if (piattaforma === "darwin") return "mac";
  if (piattaforma === "linux")
    return ambiente.WSL_DISTRO_NAME || /microsoft/i.test(versioneKernel()) ? "wsl" : "linux";
  // Windows nativo non è supportato in questa versione (decisione del 29
  // ottobre: Windows con WSL 2). Gli altri sistemi si trattano come Linux.
  return "linux";
}

// Il programma c'è nel PATH?
export function esiste(comando: string): boolean {
  return spawnSync("sh", ["-c", 'command -v "$1" >/dev/null 2>&1', "_", comando]).status === 0;
}
