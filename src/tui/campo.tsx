// Adattato da opencode (https://github.com/anomalyco/opencode)
// Pacchetto: packages/tui  File: src/component/prompt/index.tsx  Versione: 2.0.26
// Licenza originale: MIT, Copyright (c) 2025 opencode (testo completo in THIRD_PARTY_NOTICES.md)
// Modifiche: riscritto per Continuity (allegati, piè con consumo e scorciatoie, testi e colori propri); ripresa la struttura del campo.
// Il campo di scrittura, come quello di opencode (docs/rea/interfaccia.md §3):
// un blocco su fondo rialzato con la barra «┃» del colore dell'AI, il testo,
// sotto la riga «AI · modello · accesso», chiuso in basso da «╹▀▀▀». Sotto
// ancora il piè: la cartella (o la rotella e «esc interrompe» mentre l'AI
// lavora) e a destra consumo e scorciatoie.
// Struttura ripresa da opencode 2.0.26 (MIT, © 2025 opencode),
// packages/tui/src/component/prompt/index.tsx; testi e colori di Continuity.
import { For, Show } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { BARRA, nomeAI } from "./elementi.js";
import { coloreAI, tema } from "./tema.js";
import { lingua } from "./lingua.js";

const VUOTO = { ...BARRA, vertical: "" };

export function Campo(props: {
  ai: string;
  modello?: string;
  accesso?: string;
  ragionamento?: string;
  focused: boolean;
  inTurno: boolean;
  segnaposto: string;
  rif: (r: any) => void;
  onInvia: () => void;
  onIncolla?: (evento: any) => void;
  onCambio?: () => void;
  // Gli allegati della sessione, sopra il testo; «×» li toglie, «+» ne
  // aggiunge dal Finder.
  allegati?: string[];
  onTogliAllegato?: (nome: string) => void;
  onPiu?: () => void;
  // Il destinatario del prossimo messaggio quando non è la sequenza
  // (l'AI ibrida a comando): si mostra nella riga sotto il campo.
  destinatario?: string;
}) {
  const dim = useTerminalDimensions();
  const stretto = () => dim().width < 44;
  // La barra resta del colore dell'AI anche mentre lavora, come in opencode.
  const colore = () => coloreAI(props.ai);
  return (
    <box width="100%" flexShrink={0}>
      <box
        width="100%"
        border={["left"]}
        borderColor={colore()}
        customBorderChars={{ ...BARRA, bottomLeft: "╹" }}
      >
        <box
          paddingLeft={stretto() ? 1 : 2}
          paddingRight={stretto() ? 1 : 2}
          paddingTop={1}
          backgroundColor={tema.rialzato}
          flexGrow={1}
          width="100%"
        >
          <Show when={props.allegati?.length}>
            <box flexDirection="row" flexWrap="wrap" gap={1} paddingBottom={1} flexShrink={0}>
              <For each={props.allegati}>
                {(nome) => (
                  <box
                    backgroundColor={tema.fondoMessaggio}
                    paddingLeft={1}
                    paddingRight={1}
                    onMouseUp={() => props.onTogliAllegato?.(nome)}
                  >
                    <text wrapMode="none">
                      <span style={{ fg: tema.accento }}>{"📎 "}</span>
                      <span style={{ fg: tema.testo }}>{nome}</span>
                      <span style={{ fg: tema.tenue }}>{"  ×"}</span>
                    </text>
                  </box>
                )}
              </For>
            </box>
          </Show>
          <textarea
            ref={props.rif}
            width="100%"
            minHeight={1}
            maxHeight={Math.max(6, Math.floor(dim().height / 3))}
            focused={props.focused}
            placeholder={props.segnaposto}
            placeholderColor={tema.tenue}
            textColor={tema.testo}
            focusedTextColor={tema.testo}
            focusedBackgroundColor="transparent"
            cursorColor={tema.testo}
            keyBindings={[
              { name: "return", action: "submit" },
              { name: "kpenter", action: "submit" },
              { name: "return", shift: true, action: "newline" },
              { name: "return", meta: true, action: "newline" },
              { name: "linefeed", action: "newline" },
            ]}
            onSubmit={props.onInvia}
            onPaste={props.onIncolla}
            onContentChange={() => props.onCambio?.()}
          />
          <box flexDirection="row" paddingTop={1} flexShrink={0} justifyContent="space-between">
            <text>
              <Show when={props.destinatario}>
                <span style={{ fg: tema.accento }}>{"→ " + props.destinatario + "   "}</span>
              </Show>
              <span style={{ fg: coloreAI(props.ai) }}>{nomeAI(props.ai) || "Continuity"}</span>
              <Show when={props.modello}>
                <span style={{ fg: tema.tenue }}>{" · "}</span>
                <span style={{ fg: tema.testo }}>{props.modello}</span>
              </Show>
              <Show when={props.accesso && dim().width >= 60}>
                <span style={{ fg: tema.tenue }}>{" " + props.accesso}</span>
              </Show>
              <Show when={props.ragionamento}>
                <span style={{ fg: tema.accento }}>{" · " + props.ragionamento}</span>
              </Show>
            </text>
            <Show when={props.onPiu}>
              <box onMouseUp={() => props.onPiu?.()} flexShrink={0}>
                <text>
                  <span style={{ fg: tema.accento }}>{"+ "}</span>
                  <span style={{ fg: tema.tenue }}>{lingua() === "en" ? "attach" : "allega"}</span>
                </text>
              </box>
            </Show>
          </box>
        </box>
      </box>
      <box
        height={1}
        border={["left"]}
        borderColor={colore()}
        customBorderChars={{ ...VUOTO, vertical: "╹" }}
      >
        <box
          height={1}
          border={["bottom"]}
          borderColor={tema.rialzato}
          customBorderChars={{ ...VUOTO, horizontal: "▀" }}
        />
      </box>
    </box>
  );
}

// Il piè sotto il campo. A sinistra la cartella, oppure mentre l'AI lavora
// la rotella a scia, «esc interrompe» (al primo esc «esc di nuovo per
// interrompere», in giallo, come opencode) e cosa sta facendo. A destra
// consumo e scorciatoie con il tasto in chiaro e la parola attenuata.
export function Piede(props: {
  sinistra: string;
  inTurno: boolean;
  armato: boolean;
  // Dopo il secondo esc, finché il turno non si ferma davvero.
  interrompendo?: boolean;
  rotella: { c: string; fg: string }[];
  destra: string;
  scorciatoie: [string, string][];
  // La versione, in fondo a destra quando la barra laterale non c'è.
  versione?: string;
}) {
  const dim = useTerminalDimensions();
  return (
    <box flexDirection="row" justifyContent="space-between" height={1} flexShrink={0} gap={2}>
      <Show
        when={props.inTurno}
        fallback={
          <text fg={tema.tenue} wrapMode="none" flexShrink={1}>
            {props.sinistra}
          </text>
        }
      >
        <text wrapMode="none" flexShrink={1}>
          <span>{" "}</span>
          <For each={props.rotella}>{(x) => <span style={{ fg: x.fg }}>{x.c}</span>}</For>
          <Show
            when={!props.interrompendo}
            fallback={<span style={{ fg: tema.avviso }}>{lingua() === "en" ? "  stopping turn…" : "  interrompo il turno…"}</span>}
          >
          <Show
            when={props.armato}
            fallback={
              <>
                <span style={{ fg: tema.testo }}>{"  esc "}</span>
                <span style={{ fg: tema.tenue }}>{(lingua() === "en" ? "stops  " : "interrompe  ") + props.sinistra}</span>
              </>
            }
          >
            <span style={{ fg: tema.avviso }}>{lingua() === "en" ? "  esc again to stop" : "  esc di nuovo per interrompere"}</span>
          </Show>
          </Show>
        </text>
      </Show>
      <Show when={dim().width >= 44}>
        <text wrapMode="none" flexShrink={0}>
          <span style={{ fg: tema.tenue }}>{props.destra ? props.destra + "   " : ""}</span>
          <For each={props.scorciatoie}>
            {([tasto, parola], i) => (
              <>
                <span style={{ fg: tema.testo }}>{(i() ? "   " : "") + tasto}</span>
                <span style={{ fg: tema.tenue }}>{" " + parola}</span>
              </>
            )}
          </For>
          <Show when={props.versione}>
            <span style={{ fg: tema.tenue }}>{"   " + props.versione}</span>
          </Show>
        </text>
      </Show>
    </box>
  );
}
