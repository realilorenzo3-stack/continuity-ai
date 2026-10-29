// La configurazione iniziale (piano di pubblicazione, punto 3; sequenza
// approvata da Lorenzo il 29 ottobre 2026). Si apre con «continuity setup» o
// «continuity configura», con /configura o /setup, e la propone Continuity
// alla prima apertura. Ogni passo si salta con esc; quelli che esistono già
// (lingua, /collega, /ibrida, sequenza, revisore) si aprono così come sono.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileInterfaccia } from "../core/lingua.js";
import { comeInstallare, comeInstallareOllama, controllaSistema, type Requisito } from "../core/requisiti.js";
import { indirizzoOllama } from "../core/ibrida.js";
import { providerLogin, providerStatus } from "../cli/providers.js";
import { copiaNegliAppunti, sistema } from "../piattaforma.js";
import { eseguiComando, ordine, pannelloRevisore, type Contesto } from "./comandi.js";
import { lingua } from "./lingua.js";
import type { Voce } from "./tipi.js";

const en = () => lingua() === "en";
const t = (it: string, eng: string) => (en() ? eng : it);

// Fatta (o rifiutata con «non chiedere più»): non la si propone più.
export function configurazioneFatta(cartellaDati: string): boolean {
  try {
    return Boolean(JSON.parse(readFileSync(fileInterfaccia(cartellaDati), "utf8"))?.configurazione);
  } catch {
    return false;
  }
}
export function segnaConfigurazione(cartellaDati: string, come: "fatta" | "saltata") {
  const file = fileInterfaccia(cartellaDati);
  let attuale: Record<string, unknown> = {};
  try {
    attuale = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify({ ...attuale, configurazione: { come, quando: new Date().toISOString() } }, null, 2) + "\n", { mode: 0o600 });
}

// Alla prima apertura: la si propone, una volta.
export async function proponiConfigurazione(c: Contesto) {
  const v = await c.scegli<"si" | "dopo" | "mai">(t("Prima configurazione", "First-time setup"), [
    { nome: t("Configura adesso (consigliato)", "Set up now (recommended)"), descrizione: t("pochi minuti: lingua, controllo del sistema, le tue AI", "a few minutes: language, system check, your AIs"), valore: "si" },
    { nome: t("Più tardi", "Later"), descrizione: t("la riproporrò alla prossima apertura", "I'll ask again next time"), valore: "dopo" },
    { nome: t("No, non chiedere più", "No, don't ask again"), descrizione: t("si apre quando vuoi con /configura", "open it any time with /setup"), valore: "mai" },
  ]);
  if (v?.valore === "si") return configurazione(c);
  if (v?.valore === "mai") segnaConfigurazione(c.cartellaDati, "saltata");
}

// Un comando da copiare: lo si mette negli appunti e lo si dice.
function offri(c: Contesto, comando: string) {
  const copiato = copiaNegliAppunti(comando);
  c.avvisa("info", copiato ? t(`Copiato negli appunti: ${comando}`, `Copied to clipboard: ${comando}`) : comando, 12000);
}

type Passo = "lingua" | "sistema" | "abbonamenti" | "gratuiti" | "ollama" | "ordine" | "revisore";
export const PASSI: Passo[] = ["lingua", "sistema", "abbonamenti", "gratuiti", "ollama", "ordine", "revisore"];

export async function configurazione(c: Contesto, dipendenze = { controllaSistema, providerStatus, ollamaRaggiungibile }) {
  const fatti: string[] = [];
  const mancano: string[] = [];
  const titolo = (n: number, nome: string) => `${t("Configurazione", "Setup")} ${n}/${PASSI.length} · ${nome}`;
  // esc in un passo: si chiede se continuare con il passo dopo o uscire.
  const dopoEsc = async () =>
    (await c.scegli<"avanti" | "esci">(t("Configurazione", "Setup"), [
      { nome: t("Continua con il passo dopo", "Continue to the next step"), valore: "avanti" },
      { nome: t("Esci dalla configurazione", "Leave setup"), descrizione: t("si riprende con /configura", "resume with /setup"), valore: "esci" },
    ]))?.valore !== "esci";

  // 1. Lingua.
  await eseguiComando("/linguaggio", c);
  fatti.push(t("lingua", "language"));

  // 2. Il sistema: che cosa c'è e che cosa manca, con il comando per sistemarlo.
  for (;;) {
    const requisiti = dipendenze.controllaSistema();
    const voci: Voce<Requisito | "ricontrolla" | "avanti">[] = [
      ...requisiti.map((r) => ({
        nome: `${r.ok ? "✓" : "✗"} ${t(r.nome, nomeInglese(r))}`,
        descrizione: r.ok ? t(r.nota, notaInglese(r)) : `${t(r.nota, notaInglese(r))}${r.rimedio ? ` · ${t("invio copia", "enter copies")}: ${r.rimedio}` : ""}`,
        valore: r,
        gruppo: t("Il tuo sistema", "Your system"),
      })),
      { nome: t("Ricontrolla", "Check again"), valore: "ricontrolla", gruppo: t("Azioni", "Actions") },
      { nome: t("Avanti", "Next"), valore: "avanti", gruppo: t("Azioni", "Actions") },
    ];
    const v = await c.scegli(titolo(2, t("il tuo sistema", "your system")), voci, {
      nota: requisiti.every((r) => r.ok)
        ? t("Tutto a posto.", "All good.")
        : t("Ciò che manca si sistema con un comando: sceglilo per copiarlo, eseguilo in un altro terminale, poi «Ricontrolla».", "Anything missing is fixed with one command: choose it to copy it, run it in another terminal, then «Check again»."),
    });
    if (!v) {
      if (!(await dopoEsc())) return chiudi(c, fatti, mancano, false);
      break;
    }
    if (v.valore === "ricontrolla") continue;
    if (v.valore === "avanti") {
      for (const r of requisiti) if (!r.ok) mancano.push(t(r.nome, nomeInglese(r)));
      if (requisiti.every((r) => r.ok)) fatti.push(t("sistema controllato", "system checked"));
      break;
    }
    if (typeof v.valore === "object" && v.valore.rimedio) offri(c, v.valore.rimedio);
  }

  // 3. Codex e Claude Code: installati? collegati? Il login si fa nel loro
  // programma ufficiale, che si apre qui e poi si torna.
  for (;;) {
    const stato = (["codex", "claude"] as const).map((cli) => ({ cli, ...dipendenze.providerStatus(cli, c.cartellaDati) }));
    const nomi = { codex: "Codex (ChatGPT)", claude: "Claude Code (Claude)" };
    const voci: Voce<{ cli: "codex" | "claude"; azione: "installa" | "collega" } | "avanti">[] = [
      ...stato.map(({ cli, connected, detail }) => {
        const assente = /non installata|not found/i.test(detail);
        return {
          nome: `${connected ? "✓" : "✗"} ${nomi[cli]}`,
          descrizione: connected
            ? detail
            : assente
              ? `${t("non installato · invio copia il comando ufficiale", "not installed · enter copies the official command")}: ${comeInstallare(cli)}`
              : `${detail} · ${t("invio apre il login ufficiale", "enter opens the official sign-in")}`,
          valore: { cli, azione: (assente ? "installa" : "collega") as "installa" | "collega" },
          gruppo: t("Abbonamenti (facoltativi)", "Subscriptions (optional)"),
        };
      }),
      { nome: t("Avanti", "Next"), valore: "avanti", gruppo: t("Azioni", "Actions") },
    ];
    const v = await c.scegli(titolo(3, t("Codex e Claude Code", "Codex and Claude Code")), voci, {
      nota: t(
        "Se hai un abbonamento ChatGPT o Claude, Continuity usa i loro programmi ufficiali: li installi e li colleghi tu, Continuity non vede le tue credenziali. Senza abbonamento puoi usare i servizi gratuiti (passo dopo).",
        "If you have a ChatGPT or Claude subscription, Continuity uses their official apps: you install and sign in to them yourself, Continuity never sees your credentials. Without a subscription you can use free services (next step).",
      ),
    });
    if (!v) {
      if (!(await dopoEsc())) return chiudi(c, fatti, mancano, false);
      break;
    }
    if (v.valore === "avanti") {
      for (const s of stato) if (s.connected) fatti.push(nomi[s.cli]);
      break;
    }
    if (typeof v.valore === "object") {
      if (v.valore.azione === "installa") offri(c, comeInstallare(v.valore.cli));
      else if (c.nelTerminale) {
        // Prima si avvisa: il login ufficiale prende tutto il terminale
        // (richiesta di Lorenzo del 29 ottobre).
        const nome = nomi[v.valore.cli];
        const ok = await c.scegli<"apri" | "no">(t(`Collegare ${nome}?`, `Connect ${nome}?`), [
          { nome: t("Apri il login ufficiale", "Open the official sign-in"), valore: "apri" },
          { nome: t("Non ora", "Not now"), valore: "no" },
        ], {
          nota: t(
            `Continuity lascia il terminale al programma ufficiale di ${nome}: segui le sue istruzioni (di solito si apre il browser). Alla fine torni qui, alla configurazione.`,
            `Continuity hands the terminal over to the official ${nome} app: follow its instructions (usually your browser opens). When it's done you come back here, to setup.`,
          ),
        });
        if (ok?.valore === "apri") {
          const login = providerLogin(v.valore.cli, c.cartellaDati);
          await c.nelTerminale(login.binary, login.args, login.env, login.cwd);
        }
      } else offri(c, `continuity connect ${v.valore.cli}`);
    }
  }

  // 4. I servizi gratuiti, con la riga sui dati di ciascuno (/collega).
  for (;;) {
    const v = await c.scegli<"collega" | "avanti">(titolo(4, t("servizi gratuiti", "free services")), [
      { nome: t("Collega un servizio gratuito…", "Connect a free service…"), descrizione: t("Groq, Google, NVIDIA, Mistral… con la tua chiave", "Groq, Google, NVIDIA, Mistral… with your own key"), valore: "collega" },
      { nome: t("Avanti", "Next"), valore: "avanti" },
    ], { nota: t("Facoltativo. Per ogni servizio Continuity ti dice che cosa fa dei tuoi dati prima di collegarlo.", "Optional. For each service Continuity tells you what it does with your data before you connect it.") });
    if (!v) {
      if (!(await dopoEsc())) return chiudi(c, fatti, mancano, false);
      break;
    }
    if (v.valore === "avanti") break;
    await eseguiComando("/collega", c);
    fatti.push(t("servizi gratuiti", "free services"));
  }

  // 5. L'AI sul computer (Ollama), se c'è.
  if (await dipendenze.ollamaRaggiungibile()) {
    await eseguiComando("/ibrida", c);
  } else {
    const v = await c.scegli<"copia" | "avanti">(titolo(5, t("AI sul computer", "AI on your computer")), [
      { nome: t("Copia il comando per installare Ollama", "Copy the command to install Ollama"), descrizione: comeInstallareOllama(), valore: "copia" },
      { nome: t("Avanti", "Next"), valore: "avanti" },
    ], {
      nota: sistema() === "wsl"
        ? t("Ollama non risponde in WSL. Quello installato su Windows di solito non si raggiunge da Linux: installalo dentro Ubuntu. Facoltativo.", "Ollama is not responding in WSL. One installed on Windows usually can't be reached from Linux: install it inside Ubuntu. Optional.")
        : t("Ollama non risponde: senza, l'AI sul computer non è disponibile. Facoltativo.", "Ollama is not responding: without it, the AI on your computer is not available. Optional."),
    });
    if (v?.valore === "copia") offri(c, comeInstallareOllama());
  }

  // 6. L'ordine delle AI e il revisore.
  await ordine(c, "");
  await pannelloRevisore(c);

  return chiudi(c, fatti, mancano, true);
}

function chiudi(c: Contesto, fatti: string[], mancano: string[], completa: boolean) {
  segnaConfigurazione(c.cartellaDati, completa ? "fatta" : "saltata");
  const righe = [
    fatti.length ? `${t("Pronto", "Ready")}: ${[...new Set(fatti)].join(", ")}` : "",
    mancano.length ? `${t("Da sistemare", "Still to fix")}: ${[...new Set(mancano)].join(", ")}` : "",
    t("Rifai la configurazione quando vuoi con /configura (o continuity configura).", "Run setup again any time with /setup (or continuity setup)."),
  ].filter(Boolean);
  c.avvisa(mancano.length ? "avviso" : "ok", righe.join(" · "), 15000);
}

// Raggiungibile, senza fare domande al modello.
export async function ollamaRaggiungibile(): Promise<boolean> {
  try {
    return (await fetch(`${indirizzoOllama()}/api/version`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

function nomeInglese(r: Requisito) {
  return { git: "Git", chiavi: r.nome.includes("Windows") ? "Windows Credential Manager" : r.nome.includes("Mac") ? "Mac Keychain" : "Linux keyring", sandbox: "Sandbox for Claude Code", apparmor: "Ubuntu allows the sandbox" }[r.id];
}
function notaInglese(r: Requisito) {
  return {
    git: "needed for the working copy and to bring work back to your folder",
    chiavi: "keys for free services are stored here",
    sandbox: "without it Claude Code can't work (Continuity never lets it work outside the copy)",
    apparmor: "Ubuntu (AppArmor) blocks bubblewrap: Claude Code can't start",
  }[r.id];
}
