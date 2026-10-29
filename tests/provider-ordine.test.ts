import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/core/engine.js";
import { nuovaSequenza, providerNoto } from "../src/core/provider.js";
import {
  controllaAbbonamentoClaude,
  credenzialeEstraneaClaude,
  impostazioniFuoriAbbonamento,
  liveCommand,
  normalizedLiveEvent,
} from "../src/adapters/live.js";
import { comandoSenzaBarra } from "../src/cli/session.js";

// Lorenzo, 14 ottobre 2026: conta poco l'ordine predefinito, conta che la
// persona lo cambi come vuole, in modo semplice.
it("/ordine con un nome lo mette in testa e lascia le altre dietro", () => {
  expect(nuovaSequenza(["codex", "claude"], "claude")).toEqual([
    "claude",
    "codex",
  ]);
  expect(nuovaSequenza(["claude", "codex"], "claude")).toEqual([
    "claude",
    "codex",
  ]);
});

it("/ordine accetta le posizioni dell'elenco, gli alias e più nomi", () => {
  expect(nuovaSequenza(["codex", "claude"], "2")).toEqual(["claude", "codex"]);
  expect(nuovaSequenza(["codex", "claude"], "2 1")).toEqual([
    "claude",
    "codex",
  ]);
  expect(nuovaSequenza(["claude", "codex"], "chatgpt")).toEqual([
    "codex",
    "claude",
  ]);
  expect(nuovaSequenza(["codex"], "claude → codex")).toEqual([
    "claude",
    "codex",
  ]);
  // Un'AI fuori sequenza si aggiunge in testa.
  expect(nuovaSequenza(["codex"], "claude")).toEqual(["claude", "codex"]);
});

it("/ordine solo … tiene esattamente quelle scritte", () => {
  expect(nuovaSequenza(["codex", "claude"], "solo claude")).toEqual([
    "claude",
  ]);
});

it("/ordine spiega gli errori invece di indovinare", () => {
  expect(() => nuovaSequenza(["codex", "claude"], "llama")).toThrow(
    /AI non supportata: llama/,
  );
  // Dal 28 ottobre anche un servizio gratuito lavora sui file (il ponte).
  expect(nuovaSequenza(["codex", "claude"], "gemini")).toEqual(["google", "codex", "claude"]);
  expect(() => nuovaSequenza(["codex", "claude"], "3")).toThrow(
    /Posizione 3 inesistente/,
  );
  expect(() => nuovaSequenza(["codex", "claude"], "claude claude")).toThrow(
    /ripetizioni/,
  );
  expect(() => nuovaSequenza(["codex"], "  ")).toThrow(/almeno un'AI/);
  expect(providerNoto("CLAUDE")?.id).toBe("claude");
});

it("il motore: un testo segue le regole brevi, un elenco resta la sequenza esatta", () => {
  const motore = Object.create(Engine.prototype) as any;
  const run: any = { id: "x", session: true, providers: ["codex", "claude"] };
  motore.run = () => run;
  motore.event = () => {};
  motore.impostaSequenza("x", "claude");
  expect(run.providers).toEqual(["claude", "codex"]);
  motore.impostaSequenza("x", ["codex"]);
  expect(run.providers).toEqual(["codex"]);
  expect(() => motore.impostaSequenza("x", "antigravity")).toThrow(
    /Antigravity non è disponibile/,
  );
});

it("«ordine claude» senza barra è un comando; una frase resta per l'AI", () => {
  expect(comandoSenzaBarra("ordine claude")).toBe("/ordine claude");
  expect(comandoSenzaBarra("ordine solo claude")).toBe("/ordine solo claude");
  expect(comandoSenzaBarra("ordine chatgpt, claude")).toBe(
    "/ordine chatgpt, claude",
  );
  expect(comandoSenzaBarra("ordine alfabetico dei file")).toBe(
    "ordine alfabetico dei file",
  );
});

// Una chiave API nell'ambiente vince sull'abbonamento: il turno si pagherebbe
// a consumo senza che la persona lo sappia (docs/rea/cli-chiavi-api.md).
it("Claude con una credenziale a consumo viene fermato all'avvio", () => {
  expect(credenzialeEstraneaClaude("none")).toBeUndefined();
  expect(credenzialeEstraneaClaude(undefined)).toBeUndefined();
  expect(credenzialeEstraneaClaude("ANTHROPIC_API_KEY")).toMatch(
    /ANTHROPIC_API_KEY/,
  );
  expect(credenzialeEstraneaClaude("/login managed key")).toMatch(/consumo/);
  const fermo = normalizedLiveEvent("claude", {
    type: "system",
    subtype: "init",
    apiKeySource: "ANTHROPIC_API_KEY",
  });
  expect(fermo.type).toBe("error");
  expect(fermo.fermare).toBe(true);
  expect(fermo.text).toMatch(/invece del tuo abbonamento/);
  const buono = normalizedLiveEvent("claude", {
    type: "system",
    subtype: "init",
    apiKeySource: "none",
    model: "claude-x",
  });
  expect(buono.type).toBe("reported");
  expect(buono.fermare).toBeUndefined();
});

it("impostazioni di Claude che portano fuori dall'abbonamento: si guardano i nomi", () => {
  expect(impostazioniFuoriAbbonamento({ env: { FOO: "1" } })).toEqual([]);
  expect(
    impostazioniFuoriAbbonamento({
      env: { ANTHROPIC_BASE_URL: "x", ANTHROPIC_AUTH_TOKEN: "y" },
      apiKeyHelper: "/bin/chiave",
    }),
  ).toEqual(["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "apiKeyHelper"]);
  const dir = mkdtempSync(join(tmpdir(), "continuity-impostazioni-"));
  const file = join(dir, "settings.json");
  writeFileSync(file, JSON.stringify({ env: { ANTHROPIC_API_KEY: "segreta" } }));
  expect(() => controllaAbbonamentoClaude(file)).toThrow(/ANTHROPIC_API_KEY/);
  // Il valore non compare mai nel messaggio.
  try {
    controllaAbbonamentoClaude(file);
  } catch (e) {
    expect(String(e)).not.toContain("segreta");
  }
  writeFileSync(file, JSON.stringify({ env: { DISABLE_TELEMETRY: "1" } }));
  expect(() => controllaAbbonamentoClaude(file)).not.toThrow();
  // Nessun file o un file illeggibile: niente da segnalare.
  expect(() => controllaAbbonamentoClaude(join(dir, "manca.json"))).not.toThrow();
});

it("Codex con l'abbonamento resta sempre sul provider di OpenAI", () => {
  for (const ambito of ["project", "fixture"] as const) {
    const { args } = liveCommand("codex", "/w", undefined, undefined, ambito);
    const i = args.indexOf('model_provider="openai"');
    expect(i).toBeGreaterThan(0);
    expect(args[i - 1]).toBe("-c");
  }
});
