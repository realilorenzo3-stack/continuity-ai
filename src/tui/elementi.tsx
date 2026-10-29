// Adattato da opencode (https://github.com/anomalyco/opencode)
// Pacchetto: packages/tui  File: src/routes/session/index.tsx  Versione: 2.0.26
// Pacchetto: packages/tui  File: src/routes/session/message-parts.tsx  Versione: 2.0.26
// Licenza originale: MIT, Copyright (c) 2025 opencode (testo completo in THIRD_PARTY_NOTICES.md)
// Modifiche: riscritto per Continuity (elementi della conversazione, testi e colori propri); riprese struttura e misure di UserMessage, AssistantFooter, TextPart e InlineToolRow.
// Come si disegna ogni elemento della conversazione (conversazione.ts), con la
// stessa grammatica di opencode (docs/rea/interfaccia.md §4): la richiesta
// della persona in un blocco rialzato con la barra «┃», il testo dell'AI
// rientrato di 3 colonne, una riga per strumento con la sua icona, il
// ragionamento compresso, la riga di fine turno con chi ha lavorato.
// Struttura e misure riprese da opencode 2.0.26 (MIT, © 2025 opencode),
// packages/tui/src/routes/session/index.tsx (UserMessage, AssistantFooter) e
// message-parts.tsx (TextPart, InlineToolRow); colori e testi di Continuity.
import { For, Match, Show, Switch } from "solid-js";
import { useRenderer } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import type { Elemento } from "./conversazione.js";
import { coloreAI, stileMarkdown, tema } from "./tema.js";
import { lingua, traduci } from "./lingua.js";

// La barra verticale dei blocchi, come lo «SplitBorder» di opencode.
export const BARRA = {
  topLeft: "",
  bottomLeft: "",
  vertical: "┃",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
};

// Le risposte delle AI in Markdown: titoli, grassetto, codice, tabelle a
// griglia. Se lo stile non si può creare, il testo così com'è.
export function Testo(props: { testo: string; inArrivo?: boolean }) {
  let stile: ReturnType<typeof stileMarkdown> | undefined;
  try {
    stile = stileMarkdown(useRenderer());
  } catch {
    stile = undefined;
  }
  if (!stile) return <text fg={tema.testo}>{props.testo}</text>;
  return (
    <markdown
      content={props.testo.trim()}
      syntaxStyle={stile}
      conceal
      streaming={props.inArrivo}
      fg={tema.testo}
      tableOptions={{ style: "grid", cellPaddingX: 1 } as any}
    />
  );
}

export function nomeAI(ai?: string) {
  if (!ai) return "";
  return ai.charAt(0).toUpperCase() + ai.slice(1);
}

// L'icona di una riga di strumento, dal verbo con cui la descrive il motore.
export function iconaAzione(testo: string): { icona: string; resto: string } {
  const t = testo.trim();
  const verbo = /^(\S+)\s+(.*)$/.exec(t);
  const [prima, resto] = verbo ? [verbo[1], verbo[2].trim()] : [t, ""];
  switch (prima) {
    case "esegue":
      return { icona: "$", resto };
    case "modifica":
    case "scrive":
      return { icona: "←", resto: `${lingua() === "en" ? (prima === "modifica" ? "edits" : "writes") : prima} ${resto}` };
    case "legge":
      return { icona: "→", resto: `${lingua() === "en" ? "reads" : "legge"} ${resto}` };
    case "cerca":
      return { icona: "✱", resto: `${lingua() === "en" ? "searches" : "cerca"} ${resto}` };
    case "usa":
      return { icona: "⚙", resto: `${lingua() === "en" ? "uses" : "usa"} ${resto}` };
    case "delega":
      return { icona: "⤷", resto: lingua() === "en" ? `delegates ${resto}` : t };
    default:
      return { icona: "·", resto: t };
  }
}

export function VoceConversazione(props: {
  e: Elemento;
  // Il modello di un'AI, per la riga di fine turno.
  modelloDi?: (ai?: string) => string | undefined;
  // Se una fonte è il modello locale dell'AI ibrida.
  locale?: (ai?: string) => boolean;
  // Per una verifica fallita: le ultime righe dell'uscita dei test.
  dettagli?: string[];
}) {
  const e = () => props.e as any;
  return (
    <Switch>
      <Match when={e().tipo === "richiesta"}>
        <box
          border={["left"]}
          customBorderChars={BARRA}
          borderColor={tema.persona}
          backgroundColor={tema.fondoMessaggio}
          marginTop={1}
          flexShrink={0}
        >
          <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexDirection="column">
            <text fg={tema.testo}>{e().testo}</text>
            <Show when={e().verso}>
              <text fg={tema.accento}>{"→ " + e().verso}</text>
            </Show>
          </box>
        </box>
      </Match>
      <Match when={e().tipo === "messaggio"}>
        <box paddingLeft={3} marginTop={1} flexShrink={0} flexDirection="column">
          <Testo testo={e().testo} />
          {/* Chi risponde soltanto (Groq, Gemini…): il nome sotto la risposta. */}
          <Show when={e().ai && String(e().ai).includes(" · ")}>
            <text fg={tema.tenue} marginTop={1}>{e().ai + (lingua() === "en" ? " · answers only" : " · risponde soltanto")}</text>
          </Show>
          <Show when={e().ai && !["codex", "claude"].includes(e().ai) && props.locale?.(e().ai)}>
            <text fg={coloreAI(e().ai)} marginTop={1}>
              {nomeAI(e().ai) + (lingua() === "en" ? " · on your Mac · Hybrid AI" : " · sul tuo Mac · AI ibrida")}
            </text>
          </Show>
        </box>
      </Match>
      <Match when={e().tipo === "pensiero"}>
        <box paddingLeft={3} marginTop={1} flexShrink={0}>
          <text fg={tema.accento} attributes={TextAttributes.DIM}>
            {(lingua() === "en" ? "+ Reasoning: " : "+ Ragionamento: ") + e().testo}
          </text>
        </box>
      </Match>
      <Match when={e().tipo === "azione"}>
        {(() => {
          const { icona, resto } = iconaAzione(e().testo);
          // Un comando è un blocco, come in opencode (Shell): «$ comando» su
          // fondo pannello. Letture e ricerche restano righe semplici.
          if (icona === "$")
            return (
              <box
                border={["left"]}
                customBorderChars={BARRA}
                borderColor={tema.fondo}
                backgroundColor={tema.fondoMessaggio}
                marginTop={1}
                flexShrink={0}
              >
                <box paddingLeft={2} paddingTop={1} paddingBottom={1}>
                  <text fg={tema.testo}>{"$ " + resto}</text>
                </box>
              </box>
            );
          return (
            <box paddingLeft={3} flexDirection="row" flexShrink={0}>
              <text width={2} fg={e().delega ? tema.accento : tema.tenue}>
                {icona}
              </text>
              <text fg={e().delega ? tema.accento : tema.tenue}>{resto}</text>
            </box>
          );
        })()}
      </Match>
      <Match when={e().tipo === "passaggio" || e().tipo === "ripresa"}>
        <box
          border={["left"]}
          customBorderChars={BARRA}
          borderColor={tema.avviso}
          backgroundColor={tema.fondoMessaggio}
          marginTop={1}
          flexShrink={0}
        >
          <box paddingLeft={2} paddingTop={1} paddingBottom={1}>
            <text fg={tema.avviso}>
              {(e().tipo === "passaggio" ? "⟳ " : "↩ ") + (traduci(e().testo) ?? e().testo)}
            </text>
          </box>
        </box>
      </Match>
      <Match when={e().tipo === "verifica"}>
        <box paddingLeft={3} marginTop={1} flexShrink={0}>
          <text
            fg={
              e().esito === "ok"
                ? tema.bene
                : e().esito === "ko"
                  ? tema.errore
                  : tema.avviso
            }
          >
            {(e().esito === "ok" ? "✓ " : e().esito === "ko" ? "✗ " : "⚠ ") +
              (traduci(e().testo) ?? e().testo)}
          </text>
        </box>
        <Show when={props.dettagli?.length}>
          <box
            border={["left"]}
            customBorderChars={BARRA}
            borderColor={tema.errore}
            backgroundColor={tema.rialzato}
            marginTop={1}
            marginLeft={3}
            flexShrink={0}
          >
            <box paddingLeft={2} paddingTop={1} paddingBottom={1} flexDirection="column">
              <For each={props.dettagli!.slice(-10)}>
                {(riga) => (
                  <text fg={tema.tenue} wrapMode="none" truncate>
                    {riga}
                  </text>
                )}
              </For>
            </box>
          </box>
        </Show>
      </Match>
      <Match when={e().tipo === "fineTurno"}>
        <box paddingLeft={3} marginTop={1} flexShrink={0}>
          {/* «Codex · gpt-6 · 30s», come la riga di fine turno di opencode:
              il nome nel colore dell'AI, il resto attenuato; i token stanno
              nel piè e nella barra (confronto REA, M5). */}
          <text>
            <span style={{ fg: e().esito === "ok" ? coloreAI(e().ai) : tema.avviso }}>
              {nomeAI(e().ai) || (lingua() === "en" ? "Turn" : "Turno")}
            </span>
            <span style={{ fg: tema.tenue }}>
              {[props.modelloDi?.(e().ai), e().durata, e().esito === "ok" ? "" : (traduci(e().testo) ?? e().testo)]
                .filter(Boolean)
                .map((x: string) => " · " + x)
                .join("")}
            </span>
          </text>
        </box>
      </Match>
      <Match when={e().tipo === "consegna"}>
        <box paddingLeft={3} marginTop={1} flexShrink={0}>
          <text
            fg={
              e().esito === "ok"
                ? tema.bene
                : e().esito === "avviso"
                  ? tema.avviso
                  : tema.tenue
            }
          >
            {(e().esito === "ok" ? "✓ " : e().esito === "avviso" ? "⚠ " : "↶ ") +
              (traduci(e().testo) ?? e().testo)}
          </text>
        </box>
      </Match>
      <Match when={e().tipo === "modifiche"}>
        <box
          border={["left"]}
          customBorderChars={BARRA}
          borderColor={tema.bene}
          backgroundColor={tema.rialzato}
          marginTop={1}
          flexShrink={0}
        >
          <box paddingLeft={2} paddingTop={1} paddingBottom={1} flexDirection="column">
            <text fg={tema.testo}>
              <b>{(lingua() === "en" ? "Changes · " : "Modifiche · ") + e().testo}</b>
            </text>
            <For each={(e().file as any[]).slice(0, 20)}>
              {(f) => (
                <text wrapMode="none" truncate>
                  <span style={{ fg: tema.tenue }}>{"  " + f.nome + "  "}</span>
                  <span style={{ fg: tema.bene }}>{"+" + f.piu}</span>
                  <span style={{ fg: tema.errore }}>{" −" + f.meno}</span>
                </text>
              )}
            </For>
            <Show when={(e().file as any[]).length > 20}>
              <text fg={tema.tenue}>{lingua() === "en" ? `  … and ${(e().file as any[]).length - 20} more` : `  … e altri ${(e().file as any[]).length - 20}`}</text>
            </Show>
          </box>
        </box>
      </Match>
      <Match when={e().tipo === "pubblicazione"}>
        <box paddingLeft={3} flexShrink={0}>
          <text fg={tema.bene}>{"⇪ " + (traduci(e().testo) ?? e().testo)}</text>
        </box>
      </Match>
      <Match when={e().tipo === "avviso"}>
        <box paddingLeft={3} marginTop={1} flexShrink={0}>
          <text fg={tema.avviso}>{"⚠ " + (traduci(e().testo) ?? e().testo)}</text>
        </box>
      </Match>
      <Match when={e().tipo === "errore"}>
        <box paddingLeft={3} marginTop={1} flexShrink={0}>
          <text fg={tema.errore}>{(lingua() === "en" ? "Error: " : "Errore: ") + (traduci(e().testo) ?? e().testo)}</text>
        </box>
      </Match>
      <Match when={e().tipo === "revisione" && (e() as any)}>
        {(r: any) => (
          <box paddingLeft={3} marginTop={1} flexShrink={0} flexDirection="column">
            <text fg={tema.accento}>{(lingua() === "en" ? "◇ Reviewer · " : "◇ Revisore · ") + r().da}</text>
            <Show
              when={r().suggerimenti.length}
              fallback={<text fg={tema.bene}>{lingua() === "en" ? "  No suggestions: the changes look good" : "  Nessun suggerimento: le modifiche sembrano a posto"}</text>}
            >
              <For each={r().suggerimenti}>
                {(x: string, i) => <text fg={tema.testo}>{`  ${i() + 1}. ${x}`}</text>}
              </For>
              <text fg={tema.tenue}>{lingua() === "en" ? "  Sent to the AI next turn · /reviewer to discard" : "  Vanno all'AI al prossimo turno · /revisore per scartarli"}</text>
            </Show>
          </box>
        )}
      </Match>
      <Match when={e().tipo === "flusso" && (e() as any)}>
        {(f: any) => (
          <box paddingLeft={3} marginTop={1} flexShrink={0} flexDirection="column">
            <text fg={f().esito === false ? tema.errore : f().esito === true ? tema.bene : tema.accento}>
              {`◆ ${traduci(f().titolo) ?? f().titolo}${f().da && f().da !== "continuity" ? " · " + f().da : ""}`}
            </text>
            <For each={f().righe}>{(x: string) => <text fg={tema.testo}>{"  " + x}</text>}</For>
            <Show when={f().nota}>
              <text fg={tema.tenue}>{"  " + (traduci(f().nota) ?? f().nota)}</text>
            </Show>
          </box>
        )}
      </Match>
      <Match when={e().tipo === "info"}>
        <box paddingLeft={3} flexShrink={0}>
          <text fg={tema.tenue}>{traduci(e().testo) ?? e().testo}</text>
        </box>
      </Match>
    </Switch>
  );
}
