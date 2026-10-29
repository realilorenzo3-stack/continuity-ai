import { it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FigliCodex } from "../src/adapters/codex-figli.js";
import { normalizedLiveEvent } from "../src/adapters/live.js";
import { comandoSenzaBarra } from "../src/cli/session.js";

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);

const meta = (source: unknown) =>
  JSON.stringify({ type: "session_meta", payload: { source } }) + "\n";
const chiamata = (name: string, input: string) =>
  JSON.stringify({
    type: "response_item",
    payload: { type: "custom_tool_call", name, input },
  }) + "\n";

// Codex non mostra i suoi sotto-agenti nello stream: si vedono solo nei loro
// file di sessione. Il test riproduce la forma reale di quei file.
it("segue i sotto-agenti di Codex dai loro file, e solo quelli del turno", () => {
  const radice = mkdtempSync(join(tmpdir(), "continuity-sessioni-"));
  dirs.push(radice);
  const d = new Date();
  const giorno = join(
    radice,
    String(d.getFullYear()),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  );
  mkdirSync(giorno, { recursive: true });
  writeFileSync(join(giorno, "padre.jsonl"), meta("exec"));
  writeFileSync(
    join(giorno, "estraneo.jsonl"),
    meta({
      subagent: {
        thread_spawn: { parent_thread_id: "altro", agent_path: "/root/x" },
      },
    }),
  );
  const figlio = join(giorno, "figlio.jsonl");
  writeFileSync(
    figlio,
    meta({
      subagent: {
        thread_spawn: { parent_thread_id: "T1", agent_path: "/root/revisore" },
      },
    }) +
      chiamata(
        "exec",
        'text(await tools.exec_command({cmd:"cat src/app.js"}));',
      ),
  );
  const visti: string[] = [];
  const f = new FigliCodex(
    Date.now() - 1000,
    (t) => visti.push(t.trim()),
    radice,
  );
  f.scansiona();
  // Senza sapere chi è il padre non si attribuisce nulla.
  expect(visti).toEqual([]);
  f.padre = "T1";
  f.scansiona();
  expect(visti).toEqual([
    "delega a un sotto-agente generico · compito revisore",
    "↳ esegue  cat src/app.js",
  ]);
  // Ciò che il figlio fa dopo arriva al giro successivo, senza ripetere il resto.
  appendFileSync(
    figlio,
    chiamata(
      "apply_patch",
      "*** Begin Patch\n*** Update File: src/styles.css\n@@\n",
    ),
  );
  f.scansiona();
  expect(visti.slice(2)).toEqual(["↳ modifica  styles.css"]);
  f.scansiona();
  expect(visti).toHaveLength(3);
});

it("riconosce l'identità della sessione principale di Codex", () => {
  expect(
    normalizedLiveEvent("codex", { type: "thread.started", thread_id: "T9" }),
  ).toMatchObject({
    type: "thread",
    text: "T9",
  });
});

// «ordine claude, codex» senza barra arrivava all'AI come richiesta, e l'AI
// cercava nel sito dove cambiare «l'ordine». Ma una richiesta vera che comincia
// con la stessa parola deve restare una richiesta.
it("una parola del riquadro con un argomento inequivocabile è un comando", () => {
  expect(comandoSenzaBarra("ordine claude, codex")).toBe(
    "/ordine claude, codex",
  );
  expect(comandoSenzaBarra("Ordine codex claude")).toBe("/ordine codex claude");
  expect(comandoSenzaBarra("modello gpt-6-astra")).toBe("/modello gpt-6-astra");
  const file = join(
    mkdtempSync(join(tmpdir(), "continuity-allega-")),
    "nota.txt",
  );
  dirs.push(join(file, ".."));
  writeFileSync(file, "x");
  expect(comandoSenzaBarra("allega " + file)).toBe("/allega " + file);
});

it("una richiesta che comincia con la stessa parola resta una richiesta", () => {
  for (const t of [
    "ordine alfabetico dei file nella pagina",
    "modello dati per il carrello",
    "allega un modulo di contatto alla pagina",
    "allega ~/non-esiste-davvero.txt",
  ])
    expect(comandoSenzaBarra(t), t).toBe(t);
});

// Collaudo del 3 ottobre, CT-012: i token dei sotto-agenti non erano contati.
it("conta i token dei sotto-agenti, una volta sola per figlio", () => {
  const radice = mkdtempSync(join(tmpdir(), "continuity-consumi-"));
  dirs.push(radice);
  const d = new Date();
  const giorno = join(
    radice,
    String(d.getFullYear()),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  );
  mkdirSync(giorno, { recursive: true });
  const consumo = (input: number, cached: number, output: number) =>
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: input,
            cached_input_tokens: cached,
            output_tokens: output,
            reasoning_output_tokens: 0,
          },
        },
      },
    }) + "\n";
  for (const [nome, righe] of [
    ["a.jsonl", [consumo(1000, 400, 10), consumo(3000, 1000, 30)]],
    ["b.jsonl", [consumo(500, 0, 5)]],
  ] as const)
    writeFileSync(
      join(giorno, nome),
      meta({
        subagent: {
          thread_spawn: { parent_thread_id: "P", agent_path: "/root/" + nome },
        },
      }) + righe.join(""),
    );
  const f = new FigliCodex(Date.now() - 1000, () => {}, radice);
  f.padre = "P";
  f.scansiona();
  f.scansiona();
  // Il totale cumulativo di ciascun figlio, non la somma dei parziali.
  // Con la cache, che prima mancava (collaudo del 25 ottobre, CT-2.0-003).
  expect(f.consumoFigli()).toEqual({
    entrata: 2000 + 500,
    uscita: 30 + 5,
    cache: 1000 + 0,
    figli: 2,
  });
});

it("un sotto-agente con un ruolo vero si mostra con il nome dell'agente", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { FigliCodex } = await import("../src/adapters/codex-figli.js");
  const casa = mkdtempSync(join(tmpdir(), "codexhome-"));
  const prima = process.env.CODEX_HOME;
  process.env.CODEX_HOME = casa;
  try {
    const oggi = new Date();
    const giorno = join(
      casa,
      "sessions",
      String(oggi.getFullYear()),
      String(oggi.getMonth() + 1).padStart(2, "0"),
      String(oggi.getDate()).padStart(2, "0"),
    );
    mkdirSync(giorno, { recursive: true });
    const righe: string[] = [];
    const f = new FigliCodex(Date.now() - 1000, (t) => righe.push(t));
    f.padre = "P1";
    writeFileSync(
      join(giorno, "rollout-figlio.jsonl"),
      JSON.stringify({
        type: "session_meta",
        payload: {
          source: {
            subagent: {
              thread_spawn: {
                parent_thread_id: "P1",
                agent_path: "/root/git_review",
                agent_role: "git-workflow-manager",
              },
            },
          },
        },
      }) + "\n",
    );
    f.scansiona();
    expect(righe[0]).toBe(
      "delega all'agente git-workflow-manager · compito git_review",
    );
  } finally {
    if (prima === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prima;
  }
});
