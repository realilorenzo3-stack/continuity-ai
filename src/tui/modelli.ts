// Il modello che userà l'AI quando la persona non ne ha scelto uno con
// /modello: quello della configurazione del suo CLI. Serve alla riga sotto il
// campo e alla fine del turno, che in opencode mostrano sempre il modello.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { providerNoto } from "../core/provider.js";

export function modelloPredefinito(ai: string): string | undefined {
  const p = providerNoto(ai);
  if (!p) return undefined;
  if (p.modelloPredefinito) return p.modelloPredefinito;
  if (p.accesso !== "abbonamento") return undefined;
  try {
    if (p.motore === "codex") {
      const cartella = process.env.CODEX_HOME ?? join(homedir(), ".codex");
      const testo = readFileSync(join(cartella, "config.toml"), "utf8");
      // Solo la chiave in cima al file, prima di qualunque [sezione].
      const cima = testo.split(/^\s*\[/m)[0];
      return /^\s*model\s*=\s*"([^"]+)"/m.exec(cima)?.[1];
    }
    const impostazioni = JSON.parse(
      readFileSync(join(homedir(), ".claude", "settings.json"), "utf8"),
    );
    return typeof impostazioni.model === "string" ? impostazioni.model : undefined;
  } catch {
    return undefined;
  }
}
