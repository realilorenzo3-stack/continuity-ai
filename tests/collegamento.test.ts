// Scrivere a un'AI non collegata: un messaggio solo, con /collega, e il
// riquadro che propone di collegarla subito; /collega per gli abbonamenti apre
// il login ufficiale senza uscire da Continuity (richieste di Lorenzo del 30
// ottobre).
import { it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daCollegare, nonCollegato } from "../src/core/collegamento.js";
import { requisitiProvider } from "../src/adapters/live.js";
import { providerNoto } from "../src/core/provider.js";
import { portachiaviInMemoria } from "../src/core/portachiavi.js";
import { inspectProject } from "../src/core/project.js";
import { Store } from "../src/persistence/store.js";
import { Engine } from "../src/core/engine.js";
import { collegaAbbonamento, proponiCollegamento } from "../src/tui/comandi.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const temp = (n: string) => {
  const d = mkdtempSync(join(tmpdir(), n));
  dirs.push(d);
  return d;
};

it("il messaggio unico: chiave, login, programma mancante; e lo si riconosce", () => {
  expect(nonCollegato("groq").message).toBe("Groq non è collegato: collegalo con /collega groq");
  expect(nonCollegato("codex", "login").message).toBe("Codex non è collegato al tuo abbonamento: collegalo con /collega codex");
  expect(nonCollegato("claude", "installa").message).toBe("Claude Code non è installato su questo computer: /collega claude spiega come installarlo e collegarlo");
  expect(daCollegare(nonCollegato("nvidia").message)).toBe("nvidia");
  expect(daCollegare(nonCollegato("claude", "installa").message)).toBe("claude");
  expect(daCollegare("Groq: limite al minuto del piano gratuito")).toBeUndefined();
  expect(daCollegare("scrivi /collega groq quando vuoi")).toBeUndefined();
});

it("una chiave che manca: il controllo prima del turno dice /collega", () => {
  expect(() => requisitiProvider(providerNoto("groq")!, temp("coll-"), portachiaviInMemoria())).toThrow(
    "Groq non è collegato: collegalo con /collega groq",
  );
});

it("nel motore: scrivere a Groq senza chiave ferma il turno con il messaggio che dice /collega groq", async () => {
  const root = temp("coll-progetto-");
  writeFileSync(join(root, "a.txt"), "x\n");
  writeFileSync(join(root, "continuity.json"), JSON.stringify({ verify: [] }));
  const g = (a: string[]) =>
    execFileSync("git", a, { cwd: root, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
  g(["init", "-q"]);
  g(["add", "-A"]);
  g(["-c", "user.name=T", "-c", "user.email=t@l", "commit", "-qm", "b"]);
  const db = new Store(temp("coll-dati-"));
  const engine = new Engine(db);
  engine.chiavi = portachiaviInMemoria();
  const i = inspectProject(root);
  const run = await engine.create("x", "live", "claude", { root: i.root, head: i.head, branch: i.branch, verify: [], commandsDigest: i.commandsDigest }, { providers: ["groq"] });
  try {
    await engine.turn(run.id, "ciao").catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    const fine = db.eventiRecenti(run.id, 20).filter((e: any) => e.type === "run.blocked").at(-1);
    expect(daCollegare(String(fine?.payload?.message))).toBe("groq");
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

function contesto(risposte: (boolean | undefined)[]) {
  const riquadri: { titolo: string; nota?: string }[] = [];
  const domande: string[] = [];
  const avvisi: string[] = [];
  const terminale: string[][] = [];
  const c: any = {
    cartellaDati: temp("coll-cd-"),
    run: () => ({ providers: [] }),
    api: async () => [],
    aggiorna: async () => {},
    avvisa: (_t: string, testo: string) => avvisi.push(testo),
    scegli: async (titolo: string, voci: any[], opzioni?: any) => {
      riquadri.push({ titolo, nota: opzioni?.nota });
      const r = risposte.shift();
      return r === undefined ? undefined : voci.find((v) => v.valore === r);
    },
    chiedi: async (titolo: string) => {
      domande.push(titolo);
      return undefined;
    },
    nelTerminale: async (comando: string, argomenti: string[]) => void terminale.push([comando, ...argomenti]),
  };
  return { c, riquadri, domande, avvisi, terminale };
}

it("scrivendo a un'AI non collegata, Continuity propone /collega: «Collegalo adesso» apre il collegamento di quel servizio", async () => {
  const { c, riquadri, domande } = contesto([true]);
  expect(await proponiCollegamento(c, "Groq non è collegato: collegalo con /collega groq")).toBe(true);
  expect(riquadri[0].titolo).toBe("Groq non è collegato");
  // Si apre il riquadro della chiave di Groq.
  expect(domande[0]).toBe("Collega Groq (gratuito)");
  // «Più tardi»: niente collegamento; un errore qualsiasi non apre nulla.
  const dopo = contesto([false]);
  await proponiCollegamento(dopo.c, nonCollegato("nvidia").message);
  expect(dopo.domande).toEqual([]);
  expect(await proponiCollegamento(contesto([]).c, "Groq: limite al minuto")).toBe(false);
});

it("/collega per un abbonamento: avviso, login ufficiale nel terminale (che apre il browser), controllo al ritorno", async () => {
  let collegato = false;
  const dipendenze = {
    providerStatus: () => (collegato ? { connected: true, detail: "0.200.0, abbonamento ChatGPT" } : { connected: false, detail: "0.200.0, nessun abbonamento ChatGPT attivo" }),
    providerLogin: () => ({ binary: "/bin/codex", args: ["login"], env: {}, cwd: "/", note: "" }),
  };
  const s = contesto([true]);
  s.c.nelTerminale = async (comando: string, argomenti: string[]) => {
    s.terminale.push([comando, ...argomenti]);
    collegato = true;
  };
  expect(await collegaAbbonamento(s.c, providerNoto("codex")!, dipendenze as any)).toBe(true);
  expect(s.riquadri[0].titolo).toBe("Collegare Codex?");
  expect(s.riquadri[0].nota).toMatch(/si apre in questo terminale e poi nel browser\. Finito, torni qui, in questa sessione/);
  expect(s.terminale).toEqual([["/bin/codex", "login"]]);
  expect(s.avvisi.at(-1)).toBe("✓ Codex collegato · 0.200.0, abbonamento ChatGPT");

  // «Non ora»: il login non parte.
  collegato = false;
  const no = contesto([false]);
  expect(await collegaAbbonamento(no.c, providerNoto("codex")!, dipendenze as any)).toBe(false);
  expect(no.terminale).toEqual([]);

  // Programma non installato: «Installalo adesso» esegue l'installatore
  // ufficiale nel terminale, poi si passa al login.
  let installato = false;
  let collegatoDopo = false;
  const assente = contesto([true, true]);
  assente.c.nelTerminale = async (comando: string, argomenti: string[]) => {
    assente.terminale.push([comando, ...argomenti]);
    if (!installato) installato = true;
    else collegatoDopo = true;
  };
  const esito = await collegaAbbonamento(assente.c, providerNoto("claude")!, {
    providerStatus: () =>
      !installato
        ? { connected: false, detail: "CLI non installata o non nel PATH" }
        : collegatoDopo
          ? { connected: true, detail: "2.1.300, abbonamento claude.ai" }
          : { connected: false, detail: "2.1.300, serve un abbonamento claude.ai" },
    providerLogin: () => ({ binary: "/bin/claude", args: ["auth", "login", "--claudeai"], env: {}, cwd: "/", note: "" }),
  } as any);
  expect(assente.riquadri[0].titolo).toBe("Claude Code non è installato");
  expect(assente.terminale[0]).toEqual(["sh", "-c", "curl -fsSL https://claude.ai/install.sh | bash"]);
  expect(assente.riquadri[1].titolo).toBe("Collegare Claude Code?");
  expect(assente.terminale[1]).toEqual(["/bin/claude", "auth", "login", "--claudeai"]);
  expect(esito).toBe(true);
  // «Non ora»: niente installazione.
  const noInstalla = contesto([false]);
  noInstalla.c.nelTerminale = async (comando: string) => void noInstalla.terminale.push([comando]);
  await collegaAbbonamento(noInstalla.c, providerNoto("codex")!, {
    providerStatus: () => ({ connected: false, detail: "CLI non installata o non nel PATH" }),
    providerLogin: () => {
      throw Error("non deve partire");
    },
  } as any);
  expect(noInstalla.terminale).toEqual([]);
});

it("in inglese i tre messaggi si traducono", async () => {
  const { impostaLingua, traduci } = await import("../src/tui/lingua.js");
  const dati = temp("coll-lingua-");
  impostaLingua(dati, "en");
  try {
    expect(traduci(nonCollegato("groq").message)).toBe("Groq is not connected: connect it with /connect groq");
    expect(traduci(nonCollegato("codex", "login").message)).toBe("Codex is not connected to your subscription: connect it with /connect codex");
    expect(traduci(nonCollegato("claude", "installa").message)).toBe("Claude Code is not installed on this computer: /connect claude explains how to install and connect it");
  } finally {
    impostaLingua(dati, "it");
  }
});

it("un servizio gratuito senza il programma Codex: messaggio chiaro e il comando per installarlo, senza abbonamento", async () => {
  const { serveCodex, chiedeCodex } = await import("../src/core/collegamento.js");
  const testo = serveCodex("groq").message;
  expect(testo).toBe("Groq lavora sui file attraverso il programma Codex, che su questo computer non è installato. Non serve l'abbonamento ChatGPT: basta installarlo.");
  expect(chiedeCodex(testo)).toBe(true);
  const { c, riquadri, avvisi } = contesto([true]);
  expect(await proponiCollegamento(c, testo)).toBe(true);
  expect(riquadri[0].titolo).toBe("Serve il programma Codex");
  expect(riquadri[0].nota).toMatch(/Non serve l'abbonamento ChatGPT/);
  expect(avvisi.at(-1)).toMatch(/curl -fsSL https:\/\/chatgpt\.com\/codex\/install\.sh \| sh$/);
});

