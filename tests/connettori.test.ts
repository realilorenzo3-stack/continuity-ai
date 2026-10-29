import { it, expect } from "vitest";
import {
  dimenticaConnettori,
  scopriConnettori,
  type Connettore,
  leggiElencoClaude,
  leggiElencoCodex,
  prefissoClaude,
} from "../src/adapters/connettori.js";
import {
  liveCommand,
  normalizedLiveEvent,
  projectPrompt,
  usoConnettore,
} from "../src/adapters/live.js";

const ELENCO_CLAUDE = `Checking MCP server health…

claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✓ Connected
claude.ai Claude Docs: https://docs.example/mcp - ✓ Connected
claude.ai Canva: https://mcp.canva.com/mcp - ! Needs authentication
locale: node server.js - ✗ Failed to connect
`;

const CONFIG_CODEX = `model = "gpt-5"
[plugins."google-calendar@openai-curated"]
enabled = true

[plugins."spento@openai-curated"]
enabled = false

[mcp_servers.docs]
command = "docs-mcp"
`;

const SERVER_CODEX = JSON.stringify([
  { name: "docs", enabled: true },
  { name: "cua_repl", enabled: true },
  { name: "vecchio", enabled: false },
]);

it("legge i connettori di Claude con il loro stato", () => {
  const elenco = leggiElencoClaude(ELENCO_CLAUDE);
  expect(elenco.map((c) => [c.nome, c.stato])).toEqual([
    ["Gmail", "collegato"],
    ["Claude Docs", "collegato"],
    ["Canva", "da autorizzare"],
    ["locale", "non raggiungibile"],
  ]);
  expect(elenco[1].prefisso).toBe("mcp__claude_ai_Claude_Docs");
  expect(prefissoClaude("claude.ai Gmail")).toBe("mcp__claude_ai_Gmail");
});

it("legge i plugin attivi e i server di Codex definiti nella configurazione", () => {
  const elenco = leggiElencoCodex(CONFIG_CODEX, SERVER_CODEX);
  expect(elenco.map((c) => [c.id, c.disattiva])).toEqual([
    [
      "codex:plugin:google-calendar@openai-curated",
      ['plugins."google-calendar@openai-curated".enabled=false'],
    ],
    ["codex:mcp:docs", ["mcp_servers.docs.enabled=false"]],
  ]);
  expect(elenco[0].nome).toBe("google-calendar");
  // Un elenco illeggibile non fa fallire la scoperta.
  expect(leggiElencoCodex("", "non json")).toEqual([]);
});

it("con «plugin list» Codex mostra anche le app dell'account ChatGPT, come GitHub", () => {
  const plugin = JSON.stringify({
    installed: [
      {
        pluginId: "pdf@openai-primary-runtime",
        name: "pdf",
        installed: true,
        enabled: true,
        source: { source: "local" },
      },
      {
        pluginId: "github@openai-curated-remote",
        name: "github",
        marketplaceName: "openai-curated-remote",
        version: "0.1.12",
        installed: true,
        enabled: true,
        source: { source: "remote", id: "plugin_connector_x" },
      },
      {
        pluginId: "notion@openai-curated-remote",
        name: "notion",
        installed: true,
        enabled: false,
        source: { source: "remote" },
      },
    ],
  });
  const elenco = leggiElencoCodex(
    CONFIG_CODEX,
    SERVER_CODEX,
    plugin,
    (m, n, v) => {
      expect([m, n, v]).toEqual(["openai-curated-remote", "github", "0.1.12"]);
      return { nome: "GitHub", app: ["connector_7686"] };
    },
  );
  expect(elenco.map((c) => [c.nome, c.stato, c.disattiva])).toEqual([
    [
      "pdf",
      "disponibile",
      ['plugins."pdf@openai-primary-runtime".enabled=false'],
    ],
    ["GitHub", "collegato", ["apps.connector_7686.enabled=false"]],
    ["docs", "disponibile", ["mcp_servers.docs.enabled=false"]],
  ]);
  // Il plugin abilitato nella configurazione ma non installato non compare.
  expect(elenco.some((c) => c.nome === "google-calendar")).toBe(false);
});

it("sul progetto Claude carica i connettori, consente gli accesi e vieta gli spenti", () => {
  const claude = leggiElencoClaude(ELENCO_CLAUDE);
  const { args } = liveCommand(
    "claude",
    "/tmp/lavoro",
    undefined,
    undefined,
    "project",
    undefined,
    { attivi: [claude[0]], spenti: [claude[1]] },
  );
  const dopo = (opzione: string) => args[args.indexOf(opzione) + 1];
  // Le impostazioni del progetto e locali stanno nella copia, scrivibile
  // anche dall'altra AI: non si caricano.
  expect(dopo("--setting-sources")).toBe("user");
  expect(args).not.toContain("--strict-mcp-config");
  expect(dopo("--allowedTools").split(",")).toContain("mcp__claude_ai_Gmail");
  expect(dopo("--disallowedTools").split(",")).toContain(
    "mcp__claude_ai_Claude_Docs",
  );
  expect(dopo("--allowedTools")).not.toContain("Claude_Docs");
});

it("le prove dimostrative restano isolate dai connettori", () => {
  const claude = liveCommand("claude", "/tmp/lavoro").args;
  expect(claude).toContain("--strict-mcp-config");
  expect(claude.some((a) => a.includes("mcp__"))).toBe(false);
  expect(liveCommand("codex", "/tmp/lavoro").args).toContain(
    "--ignore-user-config",
  );
});

it("sul progetto Codex carica la configurazione e spegne solo i connettori spenti", () => {
  const [calendario, docs] = leggiElencoCodex(CONFIG_CODEX, SERVER_CODEX);
  const github = {
    id: "codex:plugin:github@openai-curated-remote",
    ai: "codex" as const,
    nome: "GitHub",
    stato: "collegato" as const,
    disattiva: ["apps.connector_7686.enabled=false"],
  };
  const { args } = liveCommand(
    "codex",
    "/tmp/lavoro",
    undefined,
    undefined,
    "project",
    undefined,
    { attivi: [calendario], spenti: [docs, github] },
  );
  expect(args).not.toContain("--ignore-user-config");
  const impostazioni = args.filter((a, i) => args[i - 1] === "-c");
  expect(impostazioni).toContain("mcp_servers.docs.enabled=false");
  expect(impostazioni).toContain("apps.connector_7686.enabled=false");
  expect(impostazioni.some((c) => c.includes("google-calendar"))).toBe(false);
});

it("il prompt elenca i connettori e chiede di non simulare quelli che mancano", () => {
  const base = {
    role: "writer" as const,
    goal: "Leggi l'ultima mail",
    work: "/tmp/lavoro",
    criteria: [],
  };
  const con = projectPrompt({ ...base, connettori: ["Gmail", "Figma"] });
  expect(con).toContain("Gmail, Figma");
  expect(con).toMatch(/invece di simulare/);
  expect(projectPrompt(base)).not.toContain("Connettori disponibili");
});

it("a schermo l'uso di un connettore dice quale servizio e quale strumento", () => {
  expect(
    usoConnettore("mcp__claude_ai_Gmail__search_threads", { query: "fattura" }),
  ).toBe("usa Gmail: search_threads «fattura»");
  expect(usoConnettore("Read")).toBeUndefined();
});

it("la ricerca fra i connettori dice che cosa cerca", () => {
  const evento = normalizedLiveEvent("claude", {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          name: "ToolSearch",
          input: { query: "select:mcp__claude_ai_Gmail__search_threads" },
        },
      ],
    },
  });
  expect(evento).toMatchObject({
    type: "azione",
    text: "cerca fra i connettori «Gmail__search_threads»",
  });
});

const voce = (ai: string, nome: string): Connettore => ({
  id: `${ai}:${nome}`,
  ai,
  nome,
  stato: "collegato",
});

it("a ogni rilettura entra da solo quello che c'è adesso, per qualsiasi AI", async () => {
  dimenticaConnettori();
  let claude = [voce("claude", "Gmail")];
  const futura = [voce("futura", "Drive")];
  const lettori = {
    claude: async () => claude,
    futura: async () => futura,
  };
  const binari = { claude: "/bin/claude", futura: "/bin/futura" };
  expect(
    (await scopriConnettori(binari, true, lettori)).map((c) => c.id),
  ).toEqual(["claude:Gmail", "futura:Drive"]);
  // Aggiunto sulla piattaforma ufficiale dopo: alla lettura dell'avvio c'è.
  claude = [voce("claude", "Gmail"), voce("claude", "GitHub")];
  expect(
    (await scopriConnettori(binari, true, lettori)).map((c) => c.id),
  ).toEqual(["claude:Gmail", "claude:GitHub", "futura:Drive"]);
  // Un'AI senza CLI installato non contribuisce.
  expect(
    (await scopriConnettori({ claude: "/bin/claude" }, true, lettori)).map(
      (c) => c.ai,
    ),
  ).toEqual(["claude", "claude"]);
});

it("una lettura in corso è condivisa e un'AI che non risponde tiene l'ultimo elenco", async () => {
  dimenticaConnettori();
  let chiamate = 0;
  let risponde = true;
  const lettori = {
    claude: async () => {
      chiamate++;
      await new Promise((r) => setTimeout(r, 20));
      return risponde ? [voce("claude", "Gmail")] : undefined;
    },
    codex: async () => [voce("codex", "GitHub")],
  };
  const binari = { claude: "/bin/claude", codex: "/bin/codex" };
  // Il terminale avvia la lettura, il primo turno la aspetta: una sola.
  const [avvio, turno] = await Promise.all([
    scopriConnettori(binari, true, lettori),
    scopriConnettori(binari, false, lettori),
  ]);
  expect(chiamate).toBe(1);
  expect(turno).toEqual(avvio);
  // Entro dieci minuti un turno non rilegge.
  await scopriConnettori(binari, false, lettori);
  expect(chiamate).toBe(1);
  // Claude non risponde: il suo elenco resta l'ultimo letto.
  risponde = false;
  expect(
    (await scopriConnettori(binari, true, lettori)).map((c) => c.id),
  ).toEqual(["claude:Gmail", "codex:GitHub"]);
  dimenticaConnettori();
});
