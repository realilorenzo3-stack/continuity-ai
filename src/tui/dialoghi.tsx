// Adattato da opencode (https://github.com/anomalyco/opencode)
// Pacchetto: packages/tui  File: src/ui/dialog.tsx  Versione: 2.0.26
// Pacchetto: packages/tui  File: src/ui/dialog-select.tsx  Versione: 2.0.26
// Licenza originale: MIT, Copyright (c) 2025 opencode (testo completo in THIRD_PARTY_NOTICES.md)
// Modifiche: riscritto per Continuity (scelta con gruppi e ricerca, domanda nascosta, testo da scorrere, avvisi); riprese la cornice e le misure del pannello.
// I dialoghi della nuova interfaccia: una scelta da un elenco con ricerca (come
// i dialoghi a elenco di opencode, docs/rea/interfaccia.md §7), una domanda con
// risposta scritta, e la stessa domanda «nascosta» per le chiavi. Più gli
// avvisi brevi in alto a destra (§8).
import { createMemo, createSignal, For, Show } from "solid-js";
import { useKeyboard, usePaste, useTerminalDimensions } from "@opentui/solid";
import { RGBA } from "@opentui/core";
import { execFileSync } from "node:child_process";
import { tema } from "./tema.js";
import { BARRA } from "./elementi.js";
import { aCapo } from "./acapo.js";
import { lingua } from "./lingua.js";

import type { Voce } from "./tipi.js";
import { apriLink, appuntiLeggibili, leggiAppunti, tastoIncolla } from "../piattaforma.js";
export type { Voce };

// Il pannello dei dialoghi, come in opencode (docs/rea/confronto-interfaccia.md
// A3; opencode 2.0.26, MIT, packages/tui/src/ui/dialog.tsx e
// dialog-select.tsx): tutto lo schermo scurito dietro, il pannello a un
// quarto dell'altezza, largo al massimo 60 colonne, titolo ed «esc».
function Cornice(props: { titolo: string; children: any }) {
  const dim = useTerminalDimensions();
  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={dim().width}
      height={dim().height}
      zIndex={10}
      backgroundColor={SCURITO}
      alignItems="center"
      paddingTop={Math.floor(dim().height / 4)}
    >
      <box
        width={Math.min(60, dim().width - 2)}
        backgroundColor={tema.pannello}
        flexDirection="column"
        paddingTop={1}
        paddingBottom={1}
      >
        <box
          flexDirection="row"
          justifyContent="space-between"
          height={1}
          flexShrink={0}
          paddingLeft={4}
          paddingRight={4}
        >
          <text fg={tema.testo}>
            <b>{props.titolo}</b>
          </text>
          <text fg={tema.tenue}>esc</text>
        </box>
        <box height={1} flexShrink={0} />
        {props.children}
      </box>
    </box>
  );
}
const SCURITO = RGBA.fromInts(0, 0, 0, 150);

type Riga<T> = { titolo: string } | { voce: Voce<T>; posizione: number };

export function Scelta<T>(props: {
  titolo: string;
  voci: Voce<T>[];
  onScegli: (v: Voce<T>) => void;
  onChiudi: () => void;
  // Con la ricerca si scrive per filtrare; le frecce scelgono comunque.
  ricerca?: boolean;
  nota?: string;
  // Un testo lungo da leggere prima di scegliere (il piano di un flusso):
  // intero, a capo, e si scorre con pagina su e giù (collaudo del 26
  // ottobre, CT-2.0-302: tagliato a 2500 caratteri e non scorribile).
  testo?: string;
}) {
  const dim = useTerminalDimensions();
  const [filtro, setFiltro] = createSignal("");
  const [indice, setIndice] = createSignal(0);
  const [primaRiga, setPrimaRiga] = createSignal(0);
  const righeTesto = createMemo(() => (props.testo ? aCapo(props.testo, Math.min(60, dim().width - 2) - 8) : []));
  const altezzaTesto = () =>
    Math.max(3, dim().height - Math.floor(dim().height / 4) - Math.min(props.voci.length, 6) - 9);
  const scorriTesto = (quanto: number) =>
    setPrimaRiga((r) => Math.max(0, Math.min(r + quanto, righeTesto().length - altezzaTesto())));
  const filtrate = createMemo(() => {
    const f = filtro().trim().toLowerCase();
    return f
      ? props.voci.filter((v) =>
          [v.nome, v.descrizione ?? "", v.tasto ?? ""].join(" ").toLowerCase().includes(f),
        )
      : props.voci;
  });
  // Le righe a schermo: i titoli dei gruppi (solo senza filtro) e le voci.
  const righeTutte = createMemo<Riga<T>[]>(() => {
    const fuori: Riga<T>[] = [];
    let gruppo: string | undefined;
    filtrate().forEach((v, posizione) => {
      if (!filtro().trim() && v.gruppo && v.gruppo !== gruppo) {
        if (fuori.length) fuori.push({ titolo: "" });
        fuori.push({ titolo: v.gruppo });
      }
      gruppo = v.gruppo;
      fuori.push({ voce: v, posizione });
    });
    return fuori;
  });
  // La regola di opencode: metà schermo meno le righe del pannello, così a
  // 80×24 il dialogo non copre campo e piè (verifica REA, A3).
  const altezza = () =>
    Math.max(3, Math.min(righeTutte().length || 1, Math.floor(dim().height / 2) - 6));
  const rigaScelta = () =>
    righeTutte().findIndex((r) => "voce" in r && r.posizione === indice());
  const inizio = () =>
    Math.min(
      Math.max(0, rigaScelta() - altezza() + 1),
      Math.max(0, righeTutte().length - altezza()),
    );
  const scegli = () => {
    const v = filtrate()[Math.min(indice(), filtrate().length - 1)];
    if (v) props.onScegli(v);
  };
  useKeyboard((t) => {
    if (t.name === "escape") return props.onChiudi();
    const n = filtrate().length;
    if (!n) return;
    if (t.name === "up" || (t.ctrl && t.name === "p")) setIndice((i) => (i - 1 + n) % n);
    else if (t.name === "down" || (t.ctrl && t.name === "n")) setIndice((i) => (i + 1) % n);
    else if (props.testo && t.name === "pageup") scorriTesto(-altezzaTesto());
    else if (props.testo && t.name === "pagedown") scorriTesto(altezzaTesto());
    else if (t.name === "pageup") setIndice((i) => Math.max(0, i - altezza()));
    else if (t.name === "pagedown") setIndice((i) => Math.min(n - 1, i + altezza()));
    else if (t.name === "return" && !props.ricerca) scegli();
  });
  return (
    <Cornice titolo={props.titolo}>
      <Show when={props.testo}>
        <box flexDirection="column" paddingLeft={4} paddingRight={4} flexShrink={0}>
          <For each={righeTesto().slice(primaRiga(), primaRiga() + altezzaTesto())}>
            {(r) => <text fg={tema.testo} wrapMode="none">{r || " "}</text>}
          </For>
          <Show when={righeTesto().length > altezzaTesto()}>
            <text fg={tema.tenue}>
              {lingua() === "en"
                ? `lines ${primaRiga() + 1}–${Math.min(primaRiga() + altezzaTesto(), righeTesto().length)} of ${righeTesto().length} · page up/down to scroll`
                : `righe ${primaRiga() + 1}–${Math.min(primaRiga() + altezzaTesto(), righeTesto().length)} di ${righeTesto().length} · pagina su/giù per scorrere`}
            </text>
          </Show>
        </box>
        <box height={1} flexShrink={0} />
      </Show>
      <Show when={props.ricerca}>
        <box height={2} flexShrink={0} paddingLeft={4} paddingRight={4}>
          <input
            focused
            placeholder={lingua() === "en" ? "Search" : "Cerca"}
            backgroundColor={tema.pannello}
            focusedBackgroundColor={tema.pannello}
            textColor={tema.testo}
            placeholderColor={tema.tenue}
            onInput={(v: string) => {
              setFiltro(v);
              setIndice(0);
            }}
            onSubmit={scegli}
          />
        </box>
      </Show>
      <Show
        when={filtrate().length}
        fallback={
          <box paddingLeft={4}>
            <text fg={tema.tenue}>{lingua() === "en" ? "No results" : "Nessuna voce"}</text>
          </box>
        }
      >
        <box flexDirection="column" height={altezza()} flexShrink={0}>
          <For each={righeTutte().slice(inizio(), inizio() + altezza())}>
            {(r) =>
              "voce" in r ? (
                <box
                  flexDirection="row"
                  justifyContent="space-between"
                  gap={2}
                  height={1}
                  marginLeft={1}
                  marginRight={1}
                  paddingLeft={3}
                  paddingRight={3}
                  backgroundColor={r.posizione === indice() ? tema.scelta : tema.pannello}
                >
                  <text
                    fg={r.posizione === indice() ? tema.testoSuScelta : tema.testo}
                    wrapMode="none"
                    truncate
                    flexShrink={1}
                  >
                    {r.posizione === indice() ? (
                      <b>{(r.voce.attuale ? "● " : "") + r.voce.nome}</b>
                    ) : (
                      (r.voce.attuale ? "● " : "") + r.voce.nome
                    )}
                  </text>
                  <Show when={r.voce.tasto}>
                    <text
                      fg={r.posizione === indice() ? tema.testoSuScelta : tema.tenue}
                      flexShrink={0}
                    >
                      {r.voce.tasto}
                    </text>
                  </Show>
                </box>
              ) : (
                <box height={1} paddingLeft={4}>
                  <text fg={tema.accento}>
                    <b>{r.titolo}</b>
                  </text>
                </box>
              )
            }
          </For>
        </box>
      </Show>
      <Show when={props.nota}>
        <box paddingLeft={4} paddingRight={4} marginTop={1}>
          <text fg={tema.tenue}>{props.nota}</text>
        </box>
      </Show>
    </Cornice>
  );
}

// Il testo incollato: OpenTUI lo dà in «bytes» (PasteEvent), non in «text».
// Leggere «text» lasciava vuota ogni chiave incollata, e il collegamento non
// andava mai avanti (prova di Lorenzo del 25 ottobre).
export function testoIncollato(e: any): string {
  const grezzo =
    e?.bytes instanceof Uint8Array
      ? new TextDecoder().decode(e.bytes)
      : String(e?.text ?? e?.content ?? "");
  // Via i marcatori del bracketed paste, se arrivano, e gli a capo.
  return grezzo.replace(/\x1b\[20[01]~/g, "").replace(/[\r\n]+/g, "");
}

// Gli appunti del sistema, letti solo quando la persona preme tab: la riserva
// se il terminale non manda l'incolla all'interfaccia.
function appunti(): string {
  return leggiAppunti().replace(/[\r\n]+/g, "").trim();
}

export function Domanda(props: {
  titolo: string;
  testo?: string;
  // Per le chiavi: a schermo solo pallini, mai i caratteri.
  nascosta?: boolean;
  // La pagina che ctrl+o apre nel browser (dove si crea la chiave).
  link?: string;
  // Il tentativo precedente non è andato: si dice qui, nello stesso riquadro.
  errore?: string;
  onRisposta: (risposta: string | undefined) => void;
}) {
  const [segreto, setSegreto] = createSignal("");
  const [stato, setStato] = createSignal("");
  const incolla = (testo: string, da: string) => {
    const pulito = testo.trim();
    if (!pulito) {
        setStato(da === "appunti" ? (lingua() === "en" ? "Clipboard is empty: copy the key from the website" : "Negli appunti non c'è testo: copia la chiave dal sito") : "");
      return;
    }
    setSegreto(pulito);
    setStato(lingua() === "en" ? `✓ key pasted (${pulito.length} characters) · enter to connect` : `✓ chiave incollata (${pulito.length} caratteri) · invio per collegare`);
  };
  useKeyboard((t) => {
    if (t.name === "escape") return props.onRisposta(undefined);
    if (t.ctrl && t.name === "o" && props.link) {
      if (apriLink(props.link)) {
        setStato(lingua() === "en" ? "Page opened in browser: create the key, copy it, then return here" : "Pagina aperta nel browser: crea la chiave, copiala e torna qui");
      } else {
        setStato(lingua() === "en" ? `Open manually: ${props.link}` : `Apri a mano: ${props.link}`);
      }
      return;
    }
    if (!props.nascosta) return;
    if (t.name === "return") return props.onRisposta(segreto());
    if (t.name === "tab") {
      // Su Linux senza wl-clipboard né xclip gli appunti non si leggono: lo
      // si dice, invece di «negli appunti non c'è testo».
      if (!appuntiLeggibili())
        return setStato(
          lingua() === "en"
            ? `Can't read the clipboard here: paste with ${tastoIncolla()} (or install wl-clipboard or xclip)`
            : `Qui non riesco a leggere gli appunti: incolla con ${tastoIncolla()} (oppure installa wl-clipboard o xclip)`,
        );
      return incolla(appunti(), "appunti");
    }
    if (t.name === "backspace") {
      setStato("");
      return setSegreto((x) => x.slice(0, -1));
    }
    if (t.ctrl && t.name === "u") {
      setStato("");
      return setSegreto("");
    }
    // Qualunque carattere stampabile, anche arrivato a blocchi o con il
    // protocollo tastiera kitty (revisione del 14 ottobre, punto 19).
    const testo = t.sequence ?? "";
    if (testo && !t.ctrl && !t.meta && !/[\x00-\x1f\x7f]/.test(testo)) {
      setSegreto((x) => x + testo);
      setStato("");
    }
  });
  usePaste((e: any) => {
    if (!props.nascosta) return;
    incolla(segreto() + testoIncollato(e), "incolla");
    e?.preventDefault?.();
  });
  return (
    <Cornice titolo={props.titolo}>
      <box paddingLeft={4} paddingRight={4} flexDirection="column">
      <Show when={props.errore}>
        <text fg={tema.errore} marginBottom={1}>{`✗ ${props.errore}`}</text>
      </Show>
      <Show when={props.testo}>
        <text fg={tema.tenue}>{props.testo}</text>
      </Show>
      <Show
        when={props.nascosta}
        fallback={
          <input
            focused
            placeholder={lingua() === "en" ? "type and press enter" : "scrivi e premi invio"}
            onSubmit={(v: any) =>
              props.onRisposta(typeof v === "string" ? v : v?.value)
            }
          />
        }
      >
        <box marginTop={1} backgroundColor={tema.rialzato} paddingLeft={1}>
          <text fg={segreto() ? tema.testo : tema.tenue}>
            {segreto()
              ? "•".repeat(Math.min(segreto().length, 40)) + `  (${segreto().length} caratteri)`
              : lingua() === "en" ? `paste the key here (${tastoIncolla()})` : `incolla qui la chiave (${tastoIncolla()})`}
          </text>
        </box>
      </Show>
      <Show when={stato()}>
        <text fg={stato().startsWith("✓") ? tema.bene : tema.avviso}>{stato()}</text>
      </Show>
      <text fg={tema.tenue} marginTop={1}>
        {props.nascosta
          ? (lingua() === "en" ? [`${tastoIncolla()} paste`, "tab uses clipboard", ...(props.link ? ["ctrl+o opens the key page"] : []), "enter connects"] : [`${tastoIncolla()} incolla`, "tab usa gli appunti", ...(props.link ? ["ctrl+o apre la pagina della chiave"] : []), "invio collega"]).join(" · ")
          : lingua() === "en" ? "enter confirms" : "invio conferma"}
      </text>
      </box>
    </Cornice>
  );
}

export type Avviso = {
  id: number;
  tipo: "info" | "ok" | "avviso" | "errore";
  testo: string;
};

// L'avviso in alto a destra, come i toast di opencode (packages/tui/src/ui/
// toast.tsx): uno alla volta, «+N» se ce ne sono altri, largo quanto il testo
// fino a 60 colonne, barre ai due lati nel colore del tipo.
export function Avvisi(props: { elenco: Avviso[] }) {
  const dim = useTerminalDimensions();
  const ultimo = () => props.elenco[props.elenco.length - 1];
  const colore = (a: Avviso) =>
    a.tipo === "ok"
      ? tema.bene
      : a.tipo === "avviso"
        ? tema.avviso
        : a.tipo === "errore"
          ? tema.errore
          : tema.accento;
  return (
    <Show when={ultimo()}>
      {(a) => (
        <box
          position="absolute"
          top={1}
          right={2}
          maxWidth={Math.min(60, dim().width - 4)}
          zIndex={20}
          border={["left", "right"]}
          customBorderChars={BARRA}
          borderColor={colore(a())}
          backgroundColor={tema.pannello}
        >
          <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="column">
            {/* A capo a parole: un avviso lungo prima si tagliava (prove di
                Lorenzo su Ubuntu, 30 ottobre). Larghezza: il riquadro meno
                bordi e margini. */}
            <For each={aCapo(a().testo, Math.min(60, dim().width - 4) - 6)}>{(riga) => <text fg={tema.testo}>{riga}</text>}</For>
            <Show when={props.elenco.length > 1}>
              <text fg={tema.tenue}>{`+${props.elenco.length - 1} altri`}</text>
            </Show>
          </box>
        </box>
      )}
    </Show>
  );
}
