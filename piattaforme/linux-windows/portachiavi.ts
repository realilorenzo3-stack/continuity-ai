// Linux e Windows con WSL: le chiavi in libsecret (Linux) o nell'archivio
// credenziali di Windows (WSL). Parte della distribuzione Linux/Windows
// (piattaforme/linux-windows/LEGGIMI.md).
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ricordaSegreto } from "../../src/persistence/redact.js";
import { servizioPortachiavi, type Portachiavi } from "../../src/core/archivio.js";

// ---- Linux e WSL ----

// Una chiave letta resta in memoria per poco: un altro processo di Continuity
// (il terminale e il servizio) può cambiarla, e lì non c'è un'impronta da
// leggere senza permesso come sul Mac. «esiste» si chiede spesso: anche quello.
const DURATA_MEMORIA = 30_000;

type Operazioni = {
  leggi(servizio: string, provider: string): { stato: number; uscita: string; errore: string };
  salva(servizio: string, provider: string, chiave: string): { stato: number; errore: string };
  togli(servizio: string, provider: string): boolean;
  // Il motivo, in parole semplici, quando l'archivio non risponde.
  nonDisponibile: string;
  // Un motivo più preciso, dal messaggio del programma, se lo si riconosce.
  spiega?: (errore: string) => string | undefined;
};

// Che cosa vuol dire l'errore di secret-tool, per chi usa Ubuntu.
export function spiegaPortachiaviLinux(errore: string): string | undefined {
  if (/ENOENT|not found|spawn secret-tool/i.test(errore))
    return "Manca secret-tool, il programma che parla con il portachiavi di Linux. Su Ubuntu e Debian: sudo apt install libsecret-tools gnome-keyring";
  if (/autolaunch D-Bus|DBUS_SESSION_BUS_ADDRESS|org\.freedesktop\.secrets|was not provided by any \.service|No such secret collection|Cannot create an item in a locked collection/i.test(errore))
    return "Il portachiavi di Linux non è attivo in questa sessione. Su Ubuntu con il desktop parte da solo all'accesso: se hai appena installato gnome-keyring, esci e rientra nel desktop (o riavvia), poi riprova. Da un terminale remoto (SSH) il portachiavi del desktop non c'è.";
  return undefined;
}

function portachiaviConOperazioni(cartellaDati: string, op: Operazioni): Portachiavi {
  const servizio = servizioPortachiavi(cartellaDati);
  const memoria = new Map<string, { quando: number; chiave: string | undefined }>();
  const leggi = (provider: string) => {
    const giaLetta = memoria.get(provider);
    if (giaLetta && Date.now() - giaLetta.quando < DURATA_MEMORIA) return giaLetta.chiave;
    const r = op.leggi(servizio, provider);
    // 0: trovata; 1 o 44: non c'è. Altro: l'archivio non risponde.
    if (r.stato !== 0 && r.stato !== 1 && r.stato !== 44)
      throw Error(op.spiega?.(r.errore) ?? `${op.nonDisponibile}${r.errore ? ` (${r.errore.trim().slice(0, 160)})` : ""}`);
    const chiave = r.stato === 0 ? r.uscita.replace(/\r?\n$/, "") || undefined : undefined;
    if (chiave) ricordaSegreto(chiave);
    memoria.set(provider, { quando: Date.now(), chiave });
    return chiave;
  };
  return {
    leggi,
    esiste(provider) {
      try {
        return leggi(provider) !== undefined;
      } catch {
        return false;
      }
    },
    salva(provider, chiave) {
      if (/[\r\n\0]/.test(chiave)) throw Error("Valore non valido");
      ricordaSegreto(chiave);
      op.togli(servizio, provider);
      const r = op.salva(servizio, provider, chiave);
      memoria.delete(provider);
      if (r.stato !== 0)
        throw Error(op.spiega?.(r.errore) ?? `${op.nonDisponibile}${r.errore ? ` (${r.errore.trim().slice(0, 160)})` : ""}`);
    },
    togli(provider) {
      memoria.delete(provider);
      return op.togli(servizio, provider);
    },
  };
}

// Linux: libsecret con il comando «secret-tool» (pacchetto libsecret-tools su
// Ubuntu e Debian). La chiave entra dallo standard input.
export function portachiaviLinux(cartellaDati: string, comando = "secret-tool"): Portachiavi {
  const esegui = (argomenti: string[], input?: string) =>
    spawnSync(comando, argomenti, { encoding: "utf8", input, timeout: 15_000 });
  return portachiaviConOperazioni(cartellaDati, {
    nonDisponibile:
      "Il portachiavi di Linux non risponde: serve libsecret con un portachiavi attivo (su Ubuntu e Debian: sudo apt install libsecret-tools gnome-keyring)",
    spiega: spiegaPortachiaviLinux,
    leggi(servizio, provider) {
      const r = esegui(["lookup", "service", servizio, "account", provider]);
      // secret-tool risponde 1 sia per «non c'è» sia per un errore: l'errore
      // ha un messaggio.
      const stato = r.error ? 127 : r.status === 1 && r.stderr.trim() ? 2 : (r.status ?? 2);
      return { stato, uscita: r.stdout ?? "", errore: String(r.stderr ?? r.error?.message ?? "") };
    },
    salva(servizio, provider, chiave) {
      const r = esegui(["store", `--label=${servizio} · ${provider}`, "service", servizio, "account", provider], chiave);
      return { stato: r.error ? 127 : (r.status ?? 2), errore: String(r.stderr ?? r.error?.message ?? "") };
    },
    togli(servizio, provider) {
      const prima = esegui(["lookup", "service", servizio, "account", provider]);
      esegui(["clear", "service", servizio, "account", provider]);
      return prima.status === 0 && Boolean(prima.stdout);
    },
  });
}

// WSL: l'archivio credenziali di Windows (PasswordVault), attraverso
// PowerShell di Windows. Lo script va codificato (-EncodedCommand) perché il
// nome del servizio ha caratteri non ASCII; la chiave entra dallo standard
// input, mai nello script né sulla riga di comando.
const VAULT =
  "[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime];$v=New-Object Windows.Security.Credentials.PasswordVault;";
const stringaPS = (x: string) => "'" + x.replace(/'/g, "''") + "'";
export function scriptVault(azione: "leggi" | "salva" | "togli" | "togliTutte", servizio: string, provider = ""): string {
  const s = stringaPS(servizio);
  const a = stringaPS(provider);
  const corpo = {
    leggi: `try{$c=$v.Retrieve(${s},${a});$c.RetrievePassword();[Console]::Out.Write($c.Password)}catch{exit 44}`,
    salva: `$k=[Console]::In.ReadToEnd();try{$v.Remove($v.Retrieve(${s},${a}))}catch{};$v.Add((New-Object Windows.Security.Credentials.PasswordCredential(${s},${a},$k)))`,
    togli: `try{$v.Remove($v.Retrieve(${s},${a}))}catch{exit 44}`,
    togliTutte: `$n=0;try{foreach($c in $v.FindAllByResource(${s})){$v.Remove($c);$n++}}catch{};[Console]::Out.Write($n)`,
  }[azione];
  return VAULT + corpo;
}
export function codificaPowerShell(script: string) {
  return Buffer.from(script, "utf16le").toString("base64");
}
export function portachiaviWindows(
  cartellaDati: string,
  comando = "powershell.exe",
  // Windows nativo (piattaforme/windows/portachiavi.ts) dice il suo motivo.
  nonDisponibile = "L'archivio credenziali di Windows non risponde da WSL: controlla che powershell.exe si avvii da questo terminale",
): Portachiavi {
  const esegui = (script: string, input?: string) =>
    spawnSync(comando, ["-NoProfile", "-NonInteractive", "-EncodedCommand", codificaPowerShell(script)], {
      encoding: "utf8",
      windowsHide: true,
      input,
      timeout: 30_000,
    });
  return portachiaviConOperazioni(cartellaDati, {
    nonDisponibile,
    leggi(servizio, provider) {
      const r = esegui(scriptVault("leggi", servizio, provider));
      return { stato: r.error ? 127 : (r.status ?? 2), uscita: r.stdout ?? "", errore: String(r.stderr ?? r.error?.message ?? "") };
    },
    salva(servizio, provider, chiave) {
      const r = esegui(scriptVault("salva", servizio, provider), chiave);
      return { stato: r.error ? 127 : (r.status ?? 2), errore: String(r.stderr ?? r.error?.message ?? "") };
    },
    togli(servizio, provider) {
      return esegui(scriptVault("togli", servizio, provider)).status === 0;
    },
  });
}

// Il ripiego dove l'archivio del sistema non c'è o non risponde (decisione di
// Lorenzo del 30 ottobre): un file nella cartella dati, leggibile solo dal tuo
// utente (permessi 600), come fanno opencode, Codex e GitHub CLI. Lo si dice
// quando si collega una chiave.
export function portachiaviFile(cartellaDati: string): Portachiavi {
  const percorso = join(cartellaDati, "chiavi.json");
  const leggiTutte = (): Record<string, string> => {
    try {
      return JSON.parse(readFileSync(percorso, "utf8"));
    } catch {
      return {};
    }
  };
  const scrivi = (voci: Record<string, string>) => {
    mkdirSync(cartellaDati, { recursive: true, mode: 0o700 });
    writeFileSync(percorso, JSON.stringify(voci, null, 2) + "\n", { mode: 0o600 });
    // Un file creato prima con altri permessi torna a 600.
    chmodSync(percorso, 0o600);
  };
  return {
    leggi(provider) {
      const chiave = leggiTutte()[provider];
      if (chiave) ricordaSegreto(chiave);
      return chiave || undefined;
    },
    esiste: (provider) => Boolean(leggiTutte()[provider]),
    salva(provider, chiave) {
      if (/[\r\n\0]/.test(chiave)) throw Error("Valore non valido");
      ricordaSegreto(chiave);
      scrivi({ ...leggiTutte(), [provider]: chiave });
    },
    togli(provider) {
      const voci = leggiTutte();
      if (!(provider in voci)) return false;
      delete voci[provider];
      scrivi(voci);
      return true;
    },
  };
}

// L'archivio del sistema risponde? Linux: secret-tool c'è e il portachiavi è
// attivo (una ricerca che non trova nulla risponde 1 senza messaggi). WSL:
// powershell.exe si avvia.
export function archivioDisponibile(wsl: boolean, comando?: string): boolean {
  if (wsl) {
    const r = spawnSync(comando ?? "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], { timeout: 20_000 });
    return !r.error && r.status === 0;
  }
  const r = spawnSync(comando ?? "secret-tool", ["lookup", "service", "continuity-controllo", "account", "-"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  return !r.error && (r.status === 0 || (r.status === 1 && !String(r.stderr).trim()));
}
