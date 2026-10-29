import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/core/engine.js";
import { providerNoto } from "../src/core/provider.js";
import {
  ambienteProvider,
  argomentiProviderCodex,
  creditoEsaurito,
  liveCommand,
  normalizedLiveEvent,
  quotaExhausted,
  requisitiProvider,
} from "../src/adapters/live.js";
import { minore, provaCollegamento } from "../src/core/collega.js";
import { portachiaviInMemoria, tra } from "../src/core/portachiavi.js";
import {
  caricaCatalogo,
  costoStimato,
  gratuito,
  riduci,
} from "../src/core/modelsdev.js";
import { collegati, sequenzaPredefinita } from "../src/core/collegati.js";
import { collega, scollega, type Dialogo } from "../src/cli/collega.js";

const p = (id: string) => providerNoto(id)!;
const cartella = () => mkdtempSync(join(tmpdir(), "continuity-provider-"));

it("Codex va dove dice il provider scelto, mai dove dice la configurazione personale", () => {
  expect(argomentiProviderCodex(undefined)).toEqual([
    "-c",
    'model_provider="openai"',
  ]);
  expect(argomentiProviderCodex(p("codex"))).toEqual([
    "-c",
    'model_provider="openai"',
  ]);
  // I server locali con un provider proprio: attese lunghe, più tentativi.
  const locale = argomentiProviderCodex(p("ollama"));
  expect(locale).toContain('model_provider="continuity-locale"');
  expect(locale.join(" ")).toMatch(/base_url="http:\/\/127\.0\.0\.1:11434\/v1".*stream_idle_timeout_ms=900000/);
  const or = argomentiProviderCodex(p("openrouter"));
  expect(or).toContain('model_provider="continuity"');
  const definizione = or.find((a) => a.startsWith("model_providers."))!;
  expect(definizione).toContain('base_url="https://openrouter.ai/api/v1"');
  expect(definizione).toContain('env_key="OPENROUTER_API_KEY"');
  expect(definizione).toContain('wire_api="responses"');
  // Con una chiave i comandi dell'AI non la ereditano.
  expect(or).toContain("shell_environment_policy.ignore_default_excludes=false");
  expect(argomentiProviderCodex(p("openai"))).toContain(
    "shell_environment_policy.ignore_default_excludes=false",
  );
});

it("l'ambiente del turno: la chiave solo nel processo, Codex in una cartella propria", () => {
  const dati = cartella();
  expect(ambienteProvider(p("codex"), undefined, dati)).toEqual({});
  expect(ambienteProvider(p("claude"), undefined, dati)).toEqual({});
  const openai = ambienteProvider(p("openai"), "sk-finta", dati);
  expect(openai.CODEX_API_KEY).toBe("sk-finta");
  expect(openai.CODEX_HOME).toBe(join(dati, "codex", "openai"));
  const anthropic = ambienteProvider(p("anthropic"), "sk-ant-finta", dati);
  expect(anthropic.ANTHROPIC_API_KEY).toBe("sk-ant-finta");
  expect(anthropic.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBe("1");
  expect(anthropic.ANTHROPIC_BASE_URL).toBeUndefined();
  const kimi = ambienteProvider(p("kimi"), "finta", dati);
  expect(kimi.ANTHROPIC_AUTH_TOKEN).toBe("finta");
  expect(kimi.ANTHROPIC_BASE_URL).toBe("https://api.moonshot.ai/anthropic");
  expect(ambienteProvider(p("ollama"), undefined, dati).CODEX_HOME).toBe(
    join(dati, "codex", "ollama"),
  );
});

it("i requisiti si controllano solo per il provider che lavora", () => {
  const chiavi = portachiaviInMemoria({ openai: "sk-finta" });
  expect(requisitiProvider(p("openai"), "/x", chiavi)).toBe("sk-finta");
  expect(() => requisitiProvider(p("anthropic"), "/x", chiavi)).toThrow(
    /continuity collega anthropic/,
  );
  expect(requisitiProvider(p("ollama"), "/x", chiavi)).toBeUndefined();
});

it("Claude con la chiave collegata: fermato se usa l'abbonamento o un'altra fonte", () => {
  const fonti = p("anthropic").fontiClaude;
  const conAbbonamento = normalizedLiveEvent(
    "claude",
    { type: "system", subtype: "init", apiKeySource: "none" },
    fonti,
  );
  expect(conAbbonamento.fermare).toBe(true);
  expect(conAbbonamento.text).toMatch(/il login del tuo abbonamento Claude/);
  expect(conAbbonamento.text).toMatch(/invece della chiave collegata/);
  const giusta = normalizedLiveEvent(
    "claude",
    { type: "system", subtype: "init", apiKeySource: "ANTHROPIC_API_KEY" },
    fonti,
  );
  expect(giusta.type).toBe("reported");
});

it("Codex con un provider a scelta del modello: il modello passa con -m", () => {
  const { args } = liveCommand(
    "codex",
    "/w",
    undefined,
    undefined,
    "project",
    "openai/gpt-oss-120b:free",
    undefined,
    { profilo: p("openrouter") },
  );
  expect(args[args.indexOf("-m") + 1]).toBe("openai/gpt-oss-120b:free");
  expect(args).toContain('model_provider="continuity"');
  expect(args).not.toContain('model_provider="openai"');
});

const risposta = (status: number, corpo: unknown = {}) =>
  (async () =>
    new Response(JSON.stringify(corpo), { status })) as unknown as typeof fetch;

it("la prova del collegamento distingue chiave rifiutata, credito finito e servizio muto", async () => {
  expect((await provaCollegamento(p("openai"), "k", risposta(200))).ok).toBe(true);
  const rifiutata = await provaCollegamento(p("openai"), "k", risposta(401));
  expect(rifiutata).toMatchObject({ ok: false, chiaveRifiutata: true });
  const credito = await provaCollegamento(p("anthropic"), "k", risposta(402));
  expect(credito.dettaglio).toMatch(/credito esaurito/);
  const strana = await provaCollegamento(p("zai"), "k", risposta(404));
  expect(strana.chiaveRifiutata).toBeUndefined();
  expect(strana.dettaglio).toMatch(/non è stata verificata/);
  const giu = (async () => {
    throw Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
  expect((await provaCollegamento(p("ollama"), undefined, giu)).dettaglio).toMatch(
    /è avviato\?/,
  );
  const vecchio = await provaCollegamento(
    p("ollama"),
    undefined,
    risposta(200, { version: "0.12.9" }),
  );
  expect(vecchio).toMatchObject({ ok: false });
  expect(vecchio.dettaglio).toMatch(/0\.13\.3/);
  const openrouter = await provaCollegamento(
    p("openrouter"),
    "k",
    risposta(200, { data: { is_free_tier: true, limit_remaining: 0 } }),
  );
  expect(openrouter.dettaglio).toMatch(/solo modelli gratuiti/);
  expect(minore("0.13.10", "0.13.3")).toBe(false);
  expect(minore("0.9.0", "0.13.3")).toBe(true);
});

function dialogo(risposte: string[], scritto: string[] = []): Dialogo {
  return {
    chiedi: async () => risposte.shift() ?? null,
    chiediNascosto: async () => risposte.shift() ?? null,
    scrivi: (t) => void scritto.push(t),
  };
}

it("collega: si sceglie dall'elenco, la chiave provata va nel Portachiavi", async () => {
  const dati = cartella();
  const chiavi = portachiaviInMemoria();
  const scritto: string[] = [];
  // Il numero 12 è anthropic: abbonamenti (1-2), gratuiti (3-10), poi le
  // chiavi a consumo in ordine (gruppi del 21 ottobre; Zen gratuito e GitHub
  // Models tolti il 28 ottobre).
  const esito = await collega(
    dati,
    chiavi,
    dialogo(["12", "sk-ant-finta"], scritto),
    undefined,
    async () => ({ ok: true, dettaglio: "collegamento riuscito" }),
  );
  expect(esito.stato).toBe("collegato");
  expect(chiavi.leggi("anthropic")).toBe("sk-ant-finta");
  expect(collegati(dati)).toEqual(["anthropic"]);
  // La chiave non compare mai in ciò che si scrive a schermo.
  expect(scritto.join("")).not.toContain("sk-ant-finta");
  expect(sequenzaPredefinita(dati)).toEqual(["codex", "claude", "anthropic"]);
});

it("collega: una chiave rifiutata non si salva; un servizio muto lo decide la persona", async () => {
  const dati = cartella();
  const chiavi = portachiaviInMemoria();
  const rifiutata = await collega(
    dati,
    chiavi,
    dialogo(["sk-sbagliata"]),
    "openai",
    async () => ({ ok: false, chiaveRifiutata: true, dettaglio: "rifiutata" }),
  );
  expect(rifiutata.stato).toBe("fallito");
  expect(chiavi.leggi("openai")).toBeUndefined();
  const muto = async () => ({ ok: false, dettaglio: "HTTP 404" });
  expect(
    (await collega(dati, chiavi, dialogo(["k1", "n"]), "zai", muto)).stato,
  ).toBe("annullato");
  expect(chiavi.leggi("zai")).toBeUndefined();
  expect(
    (await collega(dati, chiavi, dialogo(["k1", "s"]), "zai", muto)).stato,
  ).toBe("collegato");
  expect(chiavi.leggi("zai")).toBe("k1");
  expect(
    (await collega(dati, chiavi, dialogo(["chiave con spazi"]), "kimi")).stato,
  ).toBe("fallito");
});

it("collega: abbonamenti al login ufficiale, server locali provati e ricordati", async () => {
  const dati = cartella();
  const chiavi = portachiaviInMemoria();
  expect((await collega(dati, chiavi, dialogo([]), "claude")).stato).toBe(
    "abbonamento",
  );
  const giu = await collega(dati, chiavi, dialogo([]), "ollama", async () => ({
    ok: false,
    dettaglio: "non risponde",
  }));
  expect(giu.stato).toBe("fallito");
  expect(collegati(dati)).toEqual([]);
  await collega(dati, chiavi, dialogo([]), "lmstudio", async () => ({
    ok: true,
    dettaglio: "ok",
  }));
  expect(collegati(dati)).toEqual(["lmstudio"]);
  expect(scollega(dati, chiavi, "lmstudio").provider.id).toBe("lmstudio");
  expect(collegati(dati)).toEqual([]);
  expect(() => scollega(dati, chiavi, "codex")).toThrow(/login del programma/);
});

function motoreFinto(chiavi = portachiaviInMemoria()) {
  const motore = Object.create(Engine.prototype) as any;
  motore.chiavi = chiavi;
  const run: any = {
    id: "x",
    session: true,
    providers: ["anthropic", "codex"],
    agent: "anthropic",
  };
  motore.run = () => run;
  motore.event = () => {};
  return { motore, run };
}

it("un provider a chiave senza chiave non si prova: si passa al successivo", () => {
  const { motore, run } = motoreFinto();
  expect(motore.disponibile(run, "anthropic")).toBe(false);
  expect(motore.disponibile(run, "codex")).toBe(true);
  motore.chiavi = portachiaviInMemoria({ anthropic: "k" });
  expect(motore.disponibile(run, "anthropic")).toBe(true);
});

it("credito finito: fuori finché la persona non lo rimette in sequenza, senza ripresa automatica", () => {
  const { motore, run } = motoreFinto(portachiaviInMemoria({ anthropic: "k" }));
  motore.segnaEsaurito(run, "anthropic", undefined, true);
  expect(motore.disponibile(run, "anthropic")).toBe(false);
  expect(motore.prossimaRicarica(run)).toBeUndefined();
  motore.impostaSequenza("x", "anthropic");
  expect(motore.disponibile(run, "anthropic")).toBe(true);
  expect(creditoEsaurito("Credit balance is too low to access the API")).toBe(
    true,
  );
  expect(quotaExhausted("402 Insufficient credits")).toBe(true);
  expect(creditoEsaurito("You've hit your usage limit")).toBe(false);
});

it("il consumo si conta per provider; il costo solo per chi si paga a consumo", () => {
  const { motore, run } = motoreFinto();
  motore.catalogoModelli = {
    anthropic: {
      "claude-x": {
        id: "claude-x",
        nome: "X",
        gratuito: false,
        prezzi: { input: 3, output: 15, cache_read: 0.3 },
      },
    },
  };
  const costo = motore.registraConsumo(run, "anthropic", "claude-x", {
    entrata: 1_000_000,
    uscita: 100_000,
    cache: 1_000_000,
  });
  // 3 + 1,5 + 0,3 dollari.
  expect(costo).toBeCloseTo(4.8);
  expect(run.consumi.anthropic.costo).toBeCloseTo(4.8);
  expect(
    motore.registraConsumo(run, "codex", undefined, { entrata: 10, uscita: 1 }),
  ).toBeUndefined();
  expect(run.consumi.codex).toMatchObject({ entrata: 10, uscita: 1 });
  motore.registraConsumo(run, "anthropic", "sconosciuto", {
    entrata: 1,
    uscita: 1,
  });
  expect(run.consumi.anthropic.costoIgnoto).toBe(true);
});

it("il catalogo: gratuito solo con un prezzo zero dichiarato, mai per assenza di prezzo", () => {
  const ridotto = riduci({
    openrouter: {
      models: {
        "a/b:free": { name: "B free", cost: { input: 0, output: 0 } },
        "a/c": { name: "C", cost: { input: 0, output: 0 } },
        "a/d": { name: "D senza prezzo" },
      },
    },
    estraneo: { models: { z: { cost: { input: 0, output: 0 } } } },
  });
  expect(Object.keys(ridotto)).toEqual(["openrouter"]);
  expect(ridotto.openrouter["a/b:free"].gratuito).toBe(true);
  expect(ridotto.openrouter["a/c"].gratuito).toBe(false);
  expect(ridotto.openrouter["a/d"].gratuito).toBe(false);
  expect(gratuito("deepseek", "x", { input: 0, output: 0 })).toBe(true);
  expect(costoStimato({ entrata: 2e6, uscita: 0 }, { input: 1, output: 2 })).toBe(2);
});

it("il catalogo si scarica una volta al giorno e senza rete vale la copia precedente", async () => {
  const dati = cartella();
  let chiamate = 0;
  const scarica = (async () => {
    chiamate++;
    return new Response(
      JSON.stringify({
        anthropic: { models: { m: { name: "M", cost: { input: 1, output: 2 } } } },
      }),
    );
  }) as unknown as typeof fetch;
  const primo = await caricaCatalogo(dati, scarica);
  expect(primo?.anthropic.m.prezzi).toEqual({ input: 1, output: 2 });
  await caricaCatalogo(dati, scarica);
  expect(chiamate).toBe(1);
  // Un giorno dopo, senza rete: resta la copia.
  const ieri = new Date(Date.now() - 25 * 3600 * 1000);
  utimesSync(join(dati, "catalogo-modelli.json"), ieri, ieri);
  const senzaRete = (async () => {
    throw Error("offline");
  }) as unknown as typeof fetch;
  expect((await caricaCatalogo(dati, senzaRete))?.anthropic.m.nome).toBe("M");
  writeFileSync(join(dati, "x"), "");
});

it("le virgolette per il Portachiavi non lasciano uscire la chiave dal suo campo", () => {
  expect(tra('a"b\\c')).toBe('"a\\"b\\\\c"');
  expect(() => tra("a\nb")).toThrow();
});

it("un modello sconosciuto: il messaggio non elenca centinaia di nomi", () => {
  const { motore, run } = motoreFinto();
  const modelli = Object.fromEntries(
    Array.from({ length: 300 }, (_, i) => [
      `m${i}`,
      { id: `m${i}`, nome: `M${i}`, gratuito: false },
    ]),
  );
  motore.catalogoModelli = { openrouter: modelli };
  motore.catalogo = { quando: Date.now(), codex: [] };
  run.modelli = {};
  let messaggio = "";
  try {
    motore.impostaModello("x", "openrouter", "inesistente");
  } catch (e) {
    messaggio = String(e);
  }
  expect(messaggio).toMatch(/e altri 288/);
  expect(messaggio.length).toBeLessThan(400);
  motore.impostaModello("x", "openrouter", "m5");
  expect(run.modelli.openrouter).toBe("m5");
  // I nomi con la barra di OpenRouter passano.
  motore.impostaModello("x", "openrouter", "a/b:free", true);
  expect(run.modelli.openrouter).toBe("a/b:free");
});
