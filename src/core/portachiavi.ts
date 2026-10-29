// Le chiavi dei provider stanno nell'archivio protetto del sistema: il
// Portachiavi di macOS, il portachiavi di Linux (libsecret), l'archivio
// credenziali di Windows quando Continuity gira in WSL (decisione di Lorenzo
// del 29 ottobre). Mai nel progetto, mai nei file di Continuity, mai a schermo,
// mai date alle AI. opencode le tiene in chiaro in un database
// (docs/rea/provider.md): qui no.
//
// Il comando «security» riceve la chiave dallo standard input (modalità -i):
// sulla riga di comando sarebbe visibile a chiunque guardi i processi.
import { spawnSync } from "node:child_process";
import { ricordaSegreto } from "../persistence/redact.js";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { cartellaBaseDati, sistema, type Sistema } from "../piattaforma.js";

export type Portachiavi = {
  leggi(provider: string): string | undefined;
  // Se la chiave c'è, senza leggerla: per «collegato» e per la sequenza.
  esiste(provider: string): boolean;
  salva(provider: string, chiave: string): void;
  togli(provider: string): boolean;
};

// Un servizio per cartella dati: le prove con una cartella temporanea non
// toccano le chiavi della persona, e Continuity 1 e 2 restano separate.
// Il nome solo non basta: due cartelle «…/a/dati» e «…/b/dati» vedevano e
// cancellavano le stesse chiavi (settimo collaudo, CT-2.0-608). Le cartelle
// in «Application Support» (quelle normali, una per nome) tengono il nome di
// sempre, così le chiavi già salvate restano; ogni altra cartella aggiunge
// un'impronta del suo percorso vero: lo stesso posto raggiunto da un alias
// (/tmp e /private/tmp, un collegamento simbolico) ha lo stesso nome, anche
// quando la cartella non c'è più (ottavo collaudo). scripts/nome-chiavi.sh
// fa lo stesso calcolo per la disinstallazione, e un test li confronta.
export function percorsoVero(percorso: string) {
  let base = resolve(percorso);
  const resto: string[] = [];
  while (!existsSync(base) && dirname(base) !== base) {
    resto.unshift(basename(base));
    base = dirname(base);
  }
  try {
    base = realpathSync(base);
  } catch {}
  return join(base, ...resto);
}

export function servizioPortachiavi(cartellaDati: string, casa = homedir()) {
  const percorso = percorsoVero(cartellaDati);
  const nome = `Continuity · ${basename(percorso)}`;
  // La cartella normale dei dati dei programmi: «Application Support» sul
  // Mac, ~/.local/share su Linux e WSL.
  if (dirname(percorso) === percorsoVero(cartellaBaseDati(casa))) return nome;
  return `${nome} · ${createHash("sha256").update(percorso).digest("hex").slice(0, 8)}`;
}

// Le virgolette di «security -i» seguono le regole della shell: dentro le
// doppie virgolette contano solo \ e ". Una chiave con a capo non è una chiave.
export function tra(valore: string) {
  if (/[\r\n\0]/.test(valore)) throw Error("Valore non valido");
  return '"' + valore.replace(/(["\\])/g, "\\$1") + '"';
}

// La conferma del Mac (decisione di Lorenzo, 17 ottobre 2026): la voce si
// salva con l'elenco delle app fidate vuoto («-T ""»), così macOS chiede il
// permesso a ogni lettura del segreto, anche a «security» stesso. Per non
// chiederlo a ogni turno, il servizio legge una volta e tiene la chiave in
// memoria finché la voce non cambia: gli attributi (date comprese) si leggono
// senza permesso e fanno da impronta. Senza «-w» il Mac non chiede nulla.
export const NOTA_CONFERMA =
  "La chiave va nel Portachiavi del Mac: al primo uso dopo ogni avvio il Mac chiede il permesso, scegli «Consenti» (non «Consenti sempre»).";
const ricordate = new Map<string, { impronta: string; chiave: string }>();

export function portachiaviMac(
  cartellaDati: string,
  comando = "/usr/bin/security",
): Portachiavi {
  const servizio = servizioPortachiavi(cartellaDati);
  const attributi = (provider: string) => {
    const r = spawnSync(
      comando,
      ["find-generic-password", "-s", servizio, "-a", provider],
      { encoding: "utf8", timeout: 10000 },
    );
    return r.status === 0 ? r.stdout : undefined;
  };
  const voce = (provider: string) => `${servizio}\0${provider}`;
  return {
    esiste: (provider) => attributi(provider) !== undefined,
    leggi(provider) {
      const impronta = attributi(provider);
      if (impronta === undefined) {
        ricordate.delete(voce(provider));
        return undefined;
      }
      const giaLetta = ricordate.get(voce(provider));
      if (giaLetta?.impronta === impronta) return giaLetta.chiave;
      // Qui il Mac mostra il riquadro: si lascia il tempo di rispondere.
      const r = spawnSync(
        comando,
        ["find-generic-password", "-s", servizio, "-a", provider, "-w"],
        { encoding: "utf8", timeout: 120000 },
      );
      const chiave = r.status === 0 ? r.stdout.replace(/\n$/, "") : "";
      if (!chiave)
        throw Error(
          `Il Mac non ha dato il permesso di leggere la chiave di ${provider}: riprova e scegli «Consenti» (non «Consenti sempre»)`,
        );
      ricordate.set(voce(provider), { impronta, chiave });
      ricordaSegreto(chiave);
      return chiave;
    },
    salva(provider, chiave) {
      ricordaSegreto(chiave);
      // Si toglie la voce vecchia: «-U» non cambierebbe chi può leggerla, e
      // una chiave salvata prima del 17 ottobre resterebbe senza conferma.
      spawnSync(comando, ["delete-generic-password", "-s", servizio, "-a", provider], {
        encoding: "utf8",
        timeout: 10000,
      });
      ricordate.delete(voce(provider));
      const r = spawnSync(comando, ["-i"], {
        input: `add-generic-password -s ${tra(servizio)} -a ${tra(provider)} -l ${tra(`${servizio} · ${provider}`)} -T "" -w ${tra(chiave)}\n`,
        encoding: "utf8",
        timeout: 10000,
      });
      if (r.status !== 0 || /error|errore/i.test(r.stderr))
        throw Error(
          "Il Portachiavi non ha accettato la chiave" +
            (r.stderr ? `: ${r.stderr.trim().slice(0, 200)}` : ""),
        );
    },
    togli(provider) {
      ricordate.delete(voce(provider));
      const r = spawnSync(
        comando,
        ["delete-generic-password", "-s", servizio, "-a", provider],
        { encoding: "utf8", timeout: 10000 },
      );
      return r.status === 0;
    },
  };
}

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
};

function portachiaviConOperazioni(cartellaDati: string, op: Operazioni): Portachiavi {
  const servizio = servizioPortachiavi(cartellaDati);
  const memoria = new Map<string, { quando: number; chiave: string | undefined }>();
  const leggi = (provider: string) => {
    const giaLetta = memoria.get(provider);
    if (giaLetta && Date.now() - giaLetta.quando < DURATA_MEMORIA) return giaLetta.chiave;
    const r = op.leggi(servizio, provider);
    // 0: trovata; 1 o 44: non c'è. Altro: l'archivio non risponde.
    if (r.stato !== 0 && r.stato !== 1 && r.stato !== 44)
      throw Error(`${op.nonDisponibile}${r.errore ? ` (${r.errore.trim().slice(0, 160)})` : ""}`);
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
        throw Error(`${op.nonDisponibile}${r.errore ? ` (${r.errore.trim().slice(0, 160)})` : ""}`);
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
export function portachiaviWindows(cartellaDati: string, comando = "powershell.exe"): Portachiavi {
  const esegui = (script: string, input?: string) =>
    spawnSync(comando, ["-NoProfile", "-NonInteractive", "-EncodedCommand", codificaPowerShell(script)], {
      encoding: "utf8",
      input,
      timeout: 30_000,
    });
  return portachiaviConOperazioni(cartellaDati, {
    nonDisponibile: "L'archivio credenziali di Windows non risponde da WSL: controlla che powershell.exe si avvii da questo terminale",
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

// Durante le prove automatiche l'archivio vero del sistema non si usa mai: una
// prova che si dimentica di sostituirlo scriverebbe chiavi finte nel
// Portachiavi della persona (29 ottobre: successo con due prove della TUI,
// voci tolte). Le prove dell'archivio vero chiamano portachiaviMac,
// portachiaviLinux e portachiaviWindows con un comando finto.
const archiviDiProva = new Map<string, Map<string, string>>();

// L'archivio giusto per il sistema su cui gira Continuity.
export function portachiaviDiSistema(cartellaDati: string, s: Sistema = sistema()): Portachiavi {
  if (process.env.VITEST) {
    const voci = archiviDiProva.get(cartellaDati) ?? new Map<string, string>();
    archiviDiProva.set(cartellaDati, voci);
    return {
      leggi: (p) => voci.get(p),
      esiste: (p) => voci.has(p),
      salva: (p, c) => void voci.set(p, c),
      togli: (p) => voci.delete(p),
    };
  }
  if (s === "mac") return portachiaviMac(cartellaDati);
  if (s === "wsl") return portachiaviWindows(cartellaDati);
  return portachiaviLinux(cartellaDati);
}

// Che cosa dire alla persona quando collega una chiave.
export function notaArchivio(s: Sistema = sistema()): string {
  if (s === "mac") return NOTA_CONFERMA;
  if (s === "wsl") return "La chiave va nell'archivio credenziali di Windows, protetto dal tuo login di Windows.";
  return "La chiave va nel portachiavi di Linux (libsecret), protetto dal tuo login.";
}

// Per i test: le stesse regole, in memoria.
export function portachiaviInMemoria(
  iniziali: Record<string, string> = {},
): Portachiavi {
  const voci = new Map(Object.entries(iniziali));
  for (const c of voci.values()) ricordaSegreto(c);
  return {
    leggi: (p) => voci.get(p),
    esiste: (p) => voci.has(p),
    salva: (p, c) => {
      ricordaSegreto(c);
      voci.set(p, c);
    },
    togli: (p) => voci.delete(p),
  };
}
