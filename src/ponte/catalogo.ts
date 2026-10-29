// Il catalogo dei modelli che Codex legge per i servizi del ponte
// (`model_catalog_json`). Senza, Codex non dà `apply_patch` e manda istruzioni
// lunghe (circa 12.000 token: troppo per Groq gratuito, 8.000 al minuto). La
// voce si ricava da quella di un modello di Codex (`codex debug models`, la
// forma cambia con le versioni) con istruzioni brevi, `apply_patch`, niente
// ricerca web né immagini. docs/ponte/RICERCA_FASE4.md, «Codex».
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderNoto } from "../core/provider.js";

export const ISTRUZIONI_PONTE =
  "You are a coding agent working in the user's project folder through Continuity. " +
  "Use exec_command to inspect files and run commands, and apply_patch to create or edit files. " +
  "Work step by step, keep tool calls small, verify your changes (run the tests when there are any), " +
  "and finish with a short summary of what you changed. Reply in the user's language.";

// Il modello di riferimento dal catalogo della versione di Codex installata,
// salvato in `cartellaDati/ponte/base-<versione>.json`.
export function voceDiBase(binario: string, versione: string, cartellaDati: string): any {
  const cartella = join(cartellaDati, "ponte");
  const file = join(cartella, `base-v2-${versione.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  mkdirSync(cartella, { recursive: true, mode: 0o700 });
  // Una CODEX_HOME vuota: niente login né configurazione della persona.
  const casa = join(cartella, "codex-vuota");
  mkdirSync(casa, { recursive: true, mode: 0o700 });
  const uscita = execFileSync(binario, ["debug", "models"], {
    encoding: "utf8",
    timeout: 30_000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, CODEX_HOME: casa },
  });
  const modelli: any[] = JSON.parse(uscita).models ?? [];
  // Un modello «classico»: senza la modalità solo-codice e la revisione
  // automatica dei modelli più nuovi di OpenAI, che con il ponte fanno
  // annullare le modifiche («aborted», prova del 28 ottobre con gpt-6-astra).
  const classico = (m: any) =>
    m.apply_patch_tool_type === "freeform" && m.shell_type && !m.tool_mode && !m.use_responses_lite && !m.node_repl_auto_review_required;
  const base = modelli.find((m) => m.slug === "gpt-5.5" && classico(m)) ?? modelli.find(classico) ?? modelli[0];
  if (!base) throw Error("Codex non ha restituito il catalogo dei modelli");
  writeFileSync(file, JSON.stringify(base), { mode: 0o600 });
  return base;
}

// Il catalogo per un modello del ponte, scritto nella CODEX_HOME del servizio.
export function scriviCatalogo(base: any, casa: string, p: ProviderNoto, modello: string): string {
  // Chi ha un limite stretto al minuto (Groq gratuito) lavora con un contesto
  // corto: Codex riassume prima di superarlo.
  const contesto = p.massimoToken ? 16_000 : 64_000;
  const voce = {
    ...base,
    slug: modello,
    display_name: `${p.nome.split(" · ")[0].replace(/\s*\(.*\)\s*$/, "")} · ${modello}`,
    description: "Modello gratuito attraverso il ponte di Continuity",
    base_instructions: ISTRUZIONI_PONTE,
    model_messages: null,
    upgrade: null,
    availability_nux: null,
    include_skills_usage_instructions: false,
    include_plugin_usage_instructions: false,
    include_apps_usage_instructions: false,
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: "freeform",
    supports_search_tool: false,
    input_modalities: ["text"],
    supports_image_detail_original: false,
    context_window: contesto,
    max_context_window: contesto,
    default_reasoning_summary: "none",
    additional_speed_tiers: [],
    service_tiers: [],
    experimental_supported_tools: [],
    // Spente comunque: valgono solo per i modelli di OpenAI.
    tool_mode: null,
    use_responses_lite: false,
    node_repl_auto_review_required: false,
    multi_agent_version: null,
    multi_agent_reasoning_effort: null,
    supports_reasoning_effort_updates: false,
  };
  mkdirSync(casa, { recursive: true, mode: 0o700 });
  const file = join(casa, "catalogo-ponte.json");
  writeFileSync(file, JSON.stringify({ models: [voce] }), { mode: 0o600 });
  return file;
}
