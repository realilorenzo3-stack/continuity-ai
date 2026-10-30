// Il programma dei permessi per Claude Code (decisione di Lorenzo del 23
// ottobre: «chiede ogni volta»). Claude Code lo chiama con
// --permission-prompt-tool prima di usare uno strumento che non è già
// consentito, cioè gli strumenti dei connettori. Gli strumenti che leggono
// soltanto passano subito; gli altri (pubblicare, cambiare, inviare,
// cancellare) li decide la persona nell'interfaccia di Continuity, e senza la
// sua risposta non parte nulla.
//
// Server MCP minimo su stdio (JSON-RPC, una riga per messaggio), senza
// dipendenze: lo avvia Claude Code, non il servizio.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";


// Il verbo con cui comincia il nome dello strumento dice se legge soltanto.
// Nel dubbio si chiede: uno strumento sconosciuto vale come «con effetti».
export const SOLO_LETTURA =
  /^(get|list|search|read|fetch|find|describe|inspect|show|view|count|check|whoami|status|lookup|retrieve|query_docs|analy[sz]e|compare|trace|observe|capture|recover|decompile|demangle|explain|summari[sz]e|web_fetch|resolve)(_|$)/i;

export function nomeBreve(strumento) {
  // mcp__claude_ai_Vercel__create_deployment → create_deployment
  return String(strumento).split("__").pop() ?? "";
}

// Un verbo che cambia qualcosa, ovunque nel nome, vince sul verbo iniziale:
// «get_or_create_record» chiede (collaudo del 25 ottobre).
export const CAMBIA =
  /(^|_)(create|update|delete|remove|write|send|set|put|post|patch|deploy|publish|upload|insert|drop|execute|exec|run|apply|merge|push|grant|revoke|invite|cancel|pause|restart|start|stop|rename|move|archive|transfer|buy|purchase|pay|approve|reject|assign|add|edit|modify|replace|reset|restore|rollback|promote|import|install|uninstall)(_|$)/i;

export function soloLettura(strumento) {
  const nome = nomeBreve(strumento);
  return String(strumento).startsWith("mcp__") && SOLO_LETTURA.test(nome) && !CAMBIA.test(nome);
}

async function chiedi(strumento, input) {
  // Letti a ogni domanda: il servizio può essere ripartito con un'altra porta.
  const servizio = JSON.parse(readFileSync(process.env.CONTINUITY_PERMESSI_SERVIZIO ?? "", "utf8"));
  const run = process.env.CONTINUITY_PERMESSI_RUN ?? "";
  const r = await fetch(`${servizio.origin}/api/v1/runs/${run}/permessi/chiedi`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${servizio.apiToken}`,
      "content-type": "application/json",
      "x-continuity-csrf": "same-origin",
    },
    body: JSON.stringify({ strumento, input }),
    // Il servizio nega da sé dopo 170 secondi, sotto i 3 minuti che Claude
    // Code concede a ogni strumento.
    signal: AbortSignal.timeout(178_000),
  });
  if (!r.ok) return { consenti: false, motivo: `Continuity non ha potuto chiedere il permesso (HTTP ${r.status})` };
  return r.json();
}

async function decidi(args) {
  const strumento = String(args?.tool_name ?? "");
  const input = args?.input ?? {};
  // Fuori dai connettori nulla passa da qui: ciò che non è già consentito
  // resta vietato, come prima di questo programma.
  // Senza la sandbox del sistema (Linux, 30 ottobre) anche i comandi e gli
  // altri strumenti di Claude si chiedono alla persona.
  if (!strumento.startsWith("mcp__") && process.env.CONTINUITY_PERMESSI_COMANDI !== "1")
    return { behavior: "deny", message: `${strumento} non è consentito nelle sessioni di Continuity` };
  if (soloLettura(strumento)) return { behavior: "allow", updatedInput: input };
  try {
    const esito = await chiedi(strumento, input);
    return esito.consenti
      ? { behavior: "allow", updatedInput: input }
      : {
          behavior: "deny",
          message:
            (esito.motivo || "La persona non ha dato il permesso.") +
            " Non riprovare per altre vie (né con comandi da terminale): spiega che cosa volevi fare e chiedi alla persona.",
        };
  } catch (e) {
    return {
      behavior: "deny",
      message: `Permesso non ottenuto (${e?.message ?? e}). Non riprovare per altre vie: spiega che cosa volevi fare e chiedi alla persona.`,
    };
  }
}

function rispondi(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const righe = createInterface({ input: process.stdin });
  righe.on("line", async (riga) => {
    let m;
    try {
      m = JSON.parse(riga);
    } catch {
      return;
    }
    if (m.id === undefined) return; // notifiche
    if (m.method === "initialize")
      return rispondi(m.id, {
        protocolVersion: m.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "continuity", version: "1.0.0" },
      });
    if (m.method === "tools/list")
      return rispondi(m.id, {
        tools: [
          {
            name: "permesso",
            description:
              "Uso interno di Continuity: decide i permessi degli strumenti. Non chiamarlo direttamente.",
            inputSchema: {
              type: "object",
              properties: {
                tool_name: { type: "string" },
                input: { type: "object" },
                tool_use_id: { type: "string" },
              },
              required: ["tool_name"],
            },
          },
        ],
      });
    if (m.method === "tools/call") {
      const esito = await decidi(m.params?.arguments ?? {});
      return rispondi(m.id, { content: [{ type: "text", text: JSON.stringify(esito) }] });
    }
    if (m.method === "ping") return rispondi(m.id, {});
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Metodo sconosciuto" } }) + "\n",
    );
  });
}

export { decidi };
