// La configurazione iniziale (piano di pubblicazione, punto 3): il controllo
// del sistema su Mac, Linux e WSL, e il percorso guidato con risposte finte.
import { it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { comeInstallare, controllaSistema, type Sonde } from "../src/core/requisiti.js";

const chiamati: string[] = [];
vi.mock("../src/tui/comandi.js", async (originale) => ({
  ...(await originale<any>()),
  eseguiComando: async (testo: string) => {
    chiamati.push(testo);
    return true;
  },
  ordine: async () => void chiamati.push("ordine"),
  pannelloRevisore: async () => void chiamati.push("revisore"),
}));
vi.mock("../src/piattaforma.js", async (originale) => ({
  ...(await originale<any>()),
  copiaNegliAppunti: () => true,
}));
const { configurazione, configurazioneFatta, proponiConfigurazione } = await import("../src/tui/configura.js");

const dirs: string[] = [];
afterEach(() => {
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
  chiamati.length = 0;
});

const sonde = (presenti: string[], extra: Partial<Sonde> = {}): Sonde => ({
  esiste: (c) => presenti.includes(c),
  portachiaviLinuxAttivo: () => true,
  apparmorBlocca: () => false,
  codexInstallato: () => true,
  ...extra,
});

it("il sistema sul Mac: Git e Portachiavi, niente sandbox da installare", () => {
  const r = controllaSistema("mac", sonde(["git", "security"]));
  expect(r.map((x) => [x.id, x.ok])).toEqual([["git", true], ["chiavi", true], ["codex", true]]);
  expect(controllaSistema("mac", sonde([])).find((x) => x.id === "git")?.rimedio).toBe("xcode-select --install");
});

it("il sistema su Linux: portachiavi, sandbox di Claude e il blocco di AppArmor (Ubuntu 24.04), con i comandi per sistemarli", () => {
  const nuova = controllaSistema("linux", sonde(["git"], { apparmorBlocca: () => true, codexInstallato: () => false }));
  expect(nuova.map((x) => [x.id, x.ok])).toEqual([["git", true], ["chiavi", false], ["codex", false], ["sandbox", false], ["apparmor", false]]);
  // Il programma Codex per i servizi gratuiti, con il suo installatore ufficiale.
  expect(nuova.find((x) => x.id === "codex")?.rimedio).toBe("curl -fsSL https://chatgpt.com/codex/install.sh | sh");
  expect(nuova.find((x) => x.id === "chiavi")?.rimedio).toBe("sudo apt install libsecret-tools gnome-keyring");
  expect(nuova.find((x) => x.id === "sandbox")?.rimedio).toBe("sudo apt install bubblewrap socat");
  // Il blocco di AppArmor: i comandi esatti, non un link.
  expect(nuova.find((x) => x.id === "apparmor")?.rimedio).toMatch(/^sudo tee \/etc\/apparmor\.d\/bwrap[\s\S]*profile bwrap \/usr\/bin\/bwrap flags=\(unconfined\)[\s\S]*sudo systemctl reload apparmor$/);
  // secret-tool c'è ma il portachiavi non risponde (server senza desktop).
  expect(controllaSistema("linux", sonde(["git", "secret-tool", "bwrap", "socat"], { portachiaviLinuxAttivo: () => false })).find((x) => x.id === "chiavi")?.ok).toBe(false);
  const pronta = controllaSistema("linux", sonde(["git", "secret-tool", "bwrap", "socat"]));
  expect(pronta.every((x) => x.ok)).toBe(true);
});

it("il sistema in WSL: le chiavi nell'archivio di Windows (powershell.exe), e la sandbox come su Linux", () => {
  const r = controllaSistema("wsl", sonde(["git", "powershell.exe", "bwrap", "socat"]));
  expect(r.map((x) => [x.id, x.ok, x.nome])).toEqual([
    ["git", true, "Git"],
    ["chiavi", true, "Archivio credenziali di Windows"],
    ["codex", true, "Programma Codex (per i servizi gratuiti)"],
    ["sandbox", true, "Sandbox per Claude Code"],
  ]);
});

it("Codex e Claude Code si installano con i loro installatori ufficiali", () => {
  expect(comeInstallare("codex", "linux")).toBe("curl -fsSL https://chatgpt.com/codex/install.sh | sh");
  expect(comeInstallare("claude", "mac")).toBe("curl -fsSL https://claude.ai/install.sh | bash");
  // Windows nativo: gli installatori per PowerShell.
  expect(comeInstallare("codex", "windows")).toBe("irm https://chatgpt.com/codex/install.ps1 | iex");
  expect(comeInstallare("claude", "windows")).toBe("irm https://claude.ai/install.ps1 | iex");
});

it("il sistema su Windows nativo: Git da winget, chiavi nell'archivio di Windows, nessuna sandbox da installare", () => {
  const r = controllaSistema("windows", sonde(["powershell.exe"]));
  expect(r.map((x) => [x.id, x.ok, x.nome])).toEqual([
    ["git", false, "Git"],
    ["chiavi", true, "Archivio credenziali di Windows"],
    ["codex", true, "Programma Codex (per i servizi gratuiti)"],
  ]);
  expect(r[0].rimedio).toBe("winget install Git.Git");
});

// Un Contesto finto: le scelte si danno in ordine, una per riquadro.
function contesto(risposte: (string | undefined)[]) {
  const cartellaDati = mkdtempSync(join(tmpdir(), "configura-"));
  dirs.push(cartellaDati);
  const riquadri: { titolo: string; voci: any[]; nota?: string }[] = [];
  const avvisi: string[] = [];
  const terminale: string[][] = [];
  const c: any = {
    cartellaDati,
    avvisa: (_t: string, testo: string) => avvisi.push(testo),
    scegli: async (titolo: string, voci: any[], opzioni?: any) => {
      riquadri.push({ titolo, voci, nota: opzioni?.nota });
      const r = risposte.shift();
      if (r === undefined) return undefined;
      const v = voci.find((x) => (typeof x.valore === "object" ? `${x.valore.cli ?? x.valore.id}` : x.valore) === r);
      if (!v) throw Error(`Nel riquadro «${titolo}» non c'è «${r}»: ${voci.map((x) => JSON.stringify(x.valore)).join(", ")}`);
      return v;
    },
    nelTerminale: async (comando: string, argomenti: string[]) => void terminale.push([comando, ...argomenti]),
  };
  return { c, cartellaDati, riquadri, avvisi, terminale };
}

const dipendenze = (connesso: boolean, ollama = false) => ({
  controllaSistema: () => controllaSistema("linux", sonde(["git", "secret-tool"])),
  providerStatus: (cli: string) =>
    cli === "codex"
      ? { connected: connesso, detail: connesso ? "0.200.0, abbonamento ChatGPT" : "0.200.0, nessun abbonamento ChatGPT attivo" }
      : { connected: false, detail: "CLI non installata o non nel PATH" },
  ollamaRaggiungibile: async () => ollama,
});

// Il percorso su Linux (sandbox da installare con apt): il sistema vero conta.
it.skipIf(process.platform === "win32")("il percorso completo: lingua, sistema, abbonamenti, gratuiti, Ollama, ordine, revisore; poi non si ripropone", async () => {
  const { c, cartellaDati, riquadri, avvisi } = contesto([
    "sandbox", // copia il comando
    "avanti", // sistema
    "avanti", // abbonamenti
    "collega", // un servizio gratuito
    "avanti", // basta così
    "avanti", // niente Ollama
  ]);
  await configurazione(c, dipendenze(true));
  expect(chiamati).toEqual(["/linguaggio", "/collega", "ordine", "revisore"]);
  expect(riquadri.map((r) => r.titolo)).toEqual([
    "Configurazione 2/7 · il tuo sistema",
    "Configurazione 2/7 · il tuo sistema",
    "Configurazione 3/7 · Codex e Claude Code",
    "Configurazione 4/7 · servizi gratuiti",
    "Configurazione 4/7 · servizi gratuiti",
    "Configurazione 5/7 · AI sul computer",
  ]);
  // Il comando per la sandbox, copiato e detto.
  expect(avvisi[0]).toBe("Copiato negli appunti: sudo apt install bubblewrap socat");
  // Claude non installato: il comando ufficiale; Codex collegato.
  const abbonamenti = riquadri[2].voci;
  expect(abbonamenti[0].nome).toBe("✓ Codex (ChatGPT)");
  expect(abbonamenti[1].descrizione).toContain("curl -fsSL https://claude.ai/install.sh | bash");
  // Il riepilogo: che cosa è pronto e che cosa manca.
  expect(avvisi.at(-1)).toMatch(/^Pronto: lingua, Codex \(ChatGPT\), servizi gratuiti · Da sistemare: Sandbox per Claude Code · Rifai la configurazione/);
  expect(configurazioneFatta(cartellaDati)).toBe(true);
  expect(JSON.parse(readFileSync(join(cartellaDati, "interfaccia.json"), "utf8")).configurazione.come).toBe("fatta");
});

it("Codex installato ma non collegato: prima un avviso, poi il suo login ufficiale nel terminale; «Non ora» non apre nulla", async () => {
  const { c, terminale, riquadri } = contesto(["avanti", "codex", "apri", "avanti", "avanti", "avanti"]);
  await configurazione(c, dipendenze(false));
  expect(terminale).toHaveLength(1);
  expect(terminale[0].slice(-1)).toEqual(["login"]);
  const avviso = riquadri.find((r) => r.titolo === "Collegare Codex (ChatGPT)?")!;
  expect(avviso.nota).toMatch(/^Continuity lascia il terminale al programma ufficiale di Codex \(ChatGPT\)/);

  const noOra = contesto(["avanti", "codex", "no", "avanti", "avanti", "avanti"]);
  await configurazione(noOra.c, dipendenze(false));
  expect(noOra.terminale).toHaveLength(0);
});

it("con Ollama acceso si apre /ibrida", async () => {
  const { c } = contesto(["avanti", "avanti", "avanti"]);
  await configurazione(c, dipendenze(true, true));
  expect(chiamati).toEqual(["/linguaggio", "/ibrida", "ordine", "revisore"]);
});

it("esc e «Esci dalla configurazione»: ci si ferma lì, e la configurazione non si ripropone da sola", async () => {
  const { c, cartellaDati } = contesto([undefined, "esci"]);
  await configurazione(c, dipendenze(true));
  expect(chiamati).toEqual(["/linguaggio"]);
  expect(configurazioneFatta(cartellaDati)).toBe(true);
});

it("alla prima apertura si propone: «Più tardi» la ripropone, «No, non chiedere più» no", async () => {
  const dopo = contesto(["dopo"]);
  await proponiConfigurazione(dopo.c);
  expect(configurazioneFatta(dopo.cartellaDati)).toBe(false);
  const mai = contesto(["mai"]);
  await proponiConfigurazione(mai.c);
  expect(configurazioneFatta(mai.cartellaDati)).toBe(true);
});
