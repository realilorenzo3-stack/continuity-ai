// Le prove che sostituiscono il lancio di Codex e Claude Code leggono comunque
// la versione delle loro CLI. Dove le CLI non sono installate (le prove su
// Ubuntu con GitHub Actions) ne prepara due finte; dove ci sono (il Mac di
// Lorenzo) non cambia nulla.
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickProvider, providerCandidates } from "../src/adapters/resolve.js";

// La stessa ricerca di Continuity (PATH, estensioni degli editor, cartelle
// note), senza la cartella dati: le prove ne usano una propria.
const installata = (nome: "codex" | "claude") => {
  try {
    pickProvider(nome, providerCandidates(nome, mkdtempSync(join(tmpdir(), "cli-cerca-"))));
    return true;
  } catch {
    return false;
  }
};

// Rispondono alla versione e al controllo del login (src/adapters/live.ts):
// «codex login status» e «claude auth status». Nient'altro.
const RISPOSTE = {
  codex: `[ "$1" = --version ] && echo "codex-cli 0.200.0" && exit 0
[ "$1 $2" = "login status" ] && echo "Logged in using ChatGPT" && exit 0`,
  claude: `[ "$1" = --version ] && echo "2.1.300 (Claude Code)" && exit 0
[ "$1 $2" = "auth status" ] && echo '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}' && exit 0`,
};
for (const nome of ["codex", "claude"] as const) {
  const variabile = `CONTINUITY_${nome.toUpperCase()}_BIN`;
  // CONTINUITY_PROVE_SENZA_CLI=1: come su Ubuntu, anche dove le CLI ci sono.
  if (process.env[variabile] || (!process.env.CONTINUITY_PROVE_SENZA_CLI && installata(nome))) continue;
  const cartella = mkdtempSync(join(tmpdir(), `cli-finta-${nome}-`));
  const file = join(cartella, nome);
  writeFileSync(file, `#!/bin/sh\n${RISPOSTE[nome]}\nexit 1\n`);
  chmodSync(file, 0o755);
  process.env[variabile] = file;
  // Le prove che vogliono la CLI vera lo sanno da qui.
  process.env.CONTINUITY_CLI_FINTE = [process.env.CONTINUITY_CLI_FINTE, nome].filter(Boolean).join(",");
}
