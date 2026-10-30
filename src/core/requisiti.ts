// Che cosa serve a Continuity su questo computer, per la configurazione
// iniziale (piano di pubblicazione, punto 3): che cosa c'è, che cosa manca e
// il comando esatto per sistemarlo, per Mac, Linux e Windows con WSL.
import { spawnSync } from "node:child_process";
import { cartellaDatiPredefinita, esiste, sistema, type Sistema } from "../piattaforma.js";
import { resolveProvider } from "../adapters/resolve.js";

export type Requisito = {
  id: "git" | "chiavi" | "sandbox" | "apparmor" | "codex";
  nome: string;
  ok: boolean;
  // Che cosa vuol dire, in una riga.
  nota: string;
  // Come sistemarlo: un comando da copiare o un'indicazione.
  rimedio?: string;
};

export type Sonde = {
  esiste: (comando: string) => boolean;
  // Il portachiavi di Linux risponde? (secret-tool c'è ma il servizio no.)
  portachiaviLinuxAttivo: () => boolean;
  // kernel.apparmor_restrict_unprivileged_userns (Ubuntu 24.04 e successivi).
  apparmorBlocca: () => boolean;
  // Il programma Codex c'è? (la stessa ricerca di Continuity)
  codexInstallato: () => boolean;
};

const sondeVere: Sonde = {
  esiste,
  portachiaviLinuxAttivo() {
    // Una ricerca di una voce che non c'è: «1» senza messaggio vuol dire che
    // il portachiavi risponde; un messaggio vuol dire che non c'è.
    const r = spawnSync("secret-tool", ["lookup", "service", "continuity-controllo", "account", "-"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    return !r.error && (r.status === 0 || (r.status === 1 && !String(r.stderr).trim()));
  },
  apparmorBlocca() {
    const r = spawnSync("sysctl", ["-n", "kernel.apparmor_restrict_unprivileged_userns"], { encoding: "utf8" });
    return r.status === 0 && r.stdout.trim() === "1";
  },
  codexInstallato() {
    try {
      resolveProvider("codex", cartellaDatiPredefinita());
      return true;
    } catch {
      return false;
    }
  },
};

export const PROFILO_APPARMOR = `sudo tee /etc/apparmor.d/bwrap > /dev/null <<'EOF'
abi <abi/4.0>,
include <tunables/global>

profile bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,
  include if exists <local/bwrap>
}
EOF
sudo systemctl reload apparmor`;

export function controllaSistema(s: Sistema = sistema(), sonde: Sonde = sondeVere): Requisito[] {
  const apt = (pacchetti: string) => `sudo apt install ${pacchetti}`;
  const elenco: Requisito[] = [];

  elenco.push({
    id: "git",
    nome: "Git",
    ok: sonde.esiste("git"),
    nota: "serve per la copia di lavoro e per riportare il lavoro nella tua cartella",
    rimedio: s === "mac" ? "xcode-select --install" : apt("git"),
  });

  if (s === "mac")
    elenco.push({
      id: "chiavi",
      nome: "Portachiavi del Mac",
      ok: sonde.esiste("security"),
      nota: "qui vanno le chiavi dei servizi gratuiti",
    });
  else if (s === "wsl")
    elenco.push({
      id: "chiavi",
      nome: "Archivio credenziali di Windows",
      ok: sonde.esiste("powershell.exe"),
      nota: "qui vanno le chiavi dei servizi gratuiti, protette dal tuo login di Windows",
      rimedio: "WSL deve poter avviare i programmi di Windows (interoperabilità attiva, come di serie)",
    });
  else {
    const c = sonde.esiste("secret-tool");
    elenco.push({
      id: "chiavi",
      nome: "Portachiavi di Linux",
      ok: c && sonde.portachiaviLinuxAttivo(),
      nota: c
        ? "qui vanno le chiavi dei servizi gratuiti; serve un portachiavi attivo (di solito quello del desktop)"
        : "qui vanno le chiavi dei servizi gratuiti",
      rimedio: apt("libsecret-tools gnome-keyring"),
    });
  }

  // I servizi gratuiti lavorano sui file attraverso il programma Codex: serve
  // il programma, non l'abbonamento (prova di Lorenzo su Ubuntu, 30 ottobre).
  elenco.push({
    id: "codex",
    nome: "Programma Codex (per i servizi gratuiti)",
    ok: sonde.codexInstallato(),
    nota: "Groq, NVIDIA, Google e gli altri gratuiti lavorano sui file attraverso Codex; non serve l'abbonamento ChatGPT",
    rimedio: comeInstallare("codex"),
  });

  // La sandbox di Claude Code su Linux e WSL 2 (code.claude.com/docs/en/sandboxing).
  // Senza, Continuity non fa partire Claude: niente lavoro fuori dalla copia.
  if (s !== "mac") {
    elenco.push({
      id: "sandbox",
      nome: "Sandbox per Claude Code",
      ok: sonde.esiste("bwrap") && sonde.esiste("socat"),
      nota: "senza, Claude Code non può lavorare (Continuity non lo fa lavorare fuori dalla copia)",
      rimedio: apt("bubblewrap socat"),
    });
    if (sonde.apparmorBlocca())
      elenco.push({
        id: "apparmor",
        nome: "Ubuntu lascia lavorare la sandbox",
        ok: false,
        nota: "Ubuntu (AppArmor) blocca bubblewrap: Claude Code non può partire",
        // Il profilo che lascia lavorare solo bwrap (code.claude.com/docs/en/sandboxing).
        rimedio: PROFILO_APPARMOR,
      });
  }
  return elenco;
}

// Come installare le CLI in abbonamento, dai siti ufficiali. Continuity non
// le installa e non ne tocca il login (termini dei fornitori).
// Fonti: README di openai/codex e code.claude.com/docs/en/setup (29/10/2026).
// Su Mac, Linux e WSL i loro installatori ufficiali da terminale.
export function comeInstallare(cli: "codex" | "claude"): string {
  return cli === "claude"
    ? "curl -fsSL https://claude.ai/install.sh | bash"
    : "curl -fsSL https://chatgpt.com/codex/install.sh | sh";
}

// Ollama per l'AI sul computer: dove si trova, e come installarlo se manca.
export function comeInstallareOllama(s: Sistema = sistema()): string {
  if (s === "mac") return "https://ollama.com/download";
  // In WSL l'Ollama di Windows di solito non si raggiunge da Linux: si
  // installa dentro Ubuntu.
  return "curl -fsSL https://ollama.com/install.sh | sh";
}
