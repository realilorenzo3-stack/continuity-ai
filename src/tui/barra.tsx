// La barra laterale, come in opencode (larga 42, a destra, visibile quando
// c'è spazio: docs/rea/interfaccia.md §5), con ciò che conta in Continuity:
// la sequenza delle AI con quota e credito, il consumo e il costo, le
// verifiche, la coda.
import { For, Show } from "solid-js";
import { versioneApp } from "../core/build.js";
import { providerNoto } from "../core/provider.js";
import { descriviOgniTurni } from "../core/revisore.js";
import { nomeAI } from "./elementi.js";
import { coloreAI, tema } from "./tema.js";
import { lingua, traduci } from "./lingua.js";

export const LARGHEZZA_BARRA = 42;

function Sezione(props: { titolo: string; children: any }) {
  return (
    <box flexDirection="column" marginTop={1} flexShrink={0}>
      <text fg={tema.testo}>
        <b>{props.titolo}</b>
      </text>
      {props.children}
    </box>
  );
}

export function Barra(props: {
  titolo: string;
  run: any;
  adesso: number;
  consumo: string;
  coda: number;
  ibrida?: { config: any; ollama: any };
}) {
  const en = () => lingua() === "en";
  const sequenza = () => (props.run.providers ?? []) as string[];
  // Con un modello scelto con /ai nessuna AI della sequenza è «attiva».
  const attiva = () => (props.run.risponde ? undefined : props.run.prossimo ?? props.run.agent);
  const stato = (p: string) => {
    const v = (props.run.esauriti ?? {})[p];
    if (v?.credito) return { testo: en() ? "out of credit" : "senza credito", colore: tema.errore };
    if (v?.riprendi && Date.parse(v.riprendi) > props.adesso)
      return {
        testo:
          (en() ? "returns at " : "torna alle ") +
          new Date(v.riprendi).toLocaleTimeString(en() ? "en-US" : "it-IT", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        colore: tema.avviso,
      };
    return { testo: p === attiva() ? (en() ? "active" : "attiva") : "", colore: tema.tenue };
  };
  const verifiche = () => (props.run.checks ?? []) as any[];
  const nomeFlusso = () => {
    const f = props.run.esecuzione?.flusso;
    const nome = f?.nome ?? props.run.flussoNome ?? props.run.flusso;
    const predefinito = f ? f.predefinito : ["diretto", "revisione", "completo"].includes(props.run.flusso);
    return predefinito ? (traduci(nome) ?? nome) : nome;
  };
  return (
    <box
      width={LARGHEZZA_BARRA}
      flexShrink={0}
      flexDirection="column"
      backgroundColor={tema.fondoMessaggio}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
    >
      <text fg={tema.testo} wrapMode="none" truncate>
        <b>{props.titolo}</b>
      </text>
      {/* Un modello scelto con /ai risponde al posto della sequenza (25 ottobre). */}
      <Show when={props.run.risponde}>
        {(r: any) => (
          <Sezione titolo={en() ? "Responds" : "Risponde"}>
            <text wrapMode="none" truncate>
              <span style={{ fg: coloreAI(r().provider) }}>{"● " + nomeAI(r().provider)}</span>
              <span style={{ fg: tema.tenue }}>{"  " + r().modello}</span>
            </text>
            <text fg={tema.tenue}>{en() ? "free · answers only" : "gratuito · risponde soltanto"}</text>
            <text fg={tema.tenue}>{en() ? "/ai to change" : "/ai per cambiare"}</text>
          </Sezione>
        )}
      </Show>
      <Sezione titolo={en() ? "AI sequence" : "Sequenza delle AI"}>
        <For each={sequenza()}>
          {(p, i) => (
            <text wrapMode="none" truncate>
              <span style={{ fg: p === attiva() ? coloreAI(p) : tema.tenue }}>
                {(p === attiva() ? "● " : `${i() + 1} `) + nomeAI(p)}
              </span>
              <span style={{ fg: stato(p).colore }}>
                {stato(p).testo ? "  " + stato(p).testo : ""}
              </span>
            </text>
          )}
        </For>
        <Show when={providerNoto(attiva() ?? "")?.accesso}>
          {(accesso) => (
            <text fg={tema.tenue}>
              {accesso() === "abbonamento"
                ? en() ? "with your subscription" : "con il tuo abbonamento"
                : accesso() === "chiave" && providerNoto(attiva() ?? "")?.gratis
                  ? en() ? "free plan, with your key" : "piano gratuito, con la tua chiave"
                  : accesso() === "chiave"
                  ? en() ? "API key, pay as you go" : "con chiave API, a consumo"
                  : en() ? "on your Mac, free" : "sul tuo Mac, gratuito"}
            </text>
          )}
        </Show>
        <text fg={tema.tenue}>{en() ? "/workflow to change it" : "/flusso per cambiarla"}</text>
      </Sezione>
      <Sezione titolo={en() ? "Usage" : "Consumo"}>
        <text fg={tema.tenue}>
          {props.consumo || (props.run.turnNumber ? (en() ? "no usage recorded" : "nessun consumo registrato") : (en() ? "no turns yet" : "nessun turno ancora"))}
        </text>
      </Sezione>
      <Show when={verifiche().length}>
        <Sezione titolo={en() ? "Checks" : "Verifiche"}>
          <For each={verifiche()}>
            {(k) => (
              <text fg={k.passed ? tema.bene : k.passed === false ? tema.errore : tema.tenue} wrapMode="none" truncate>
                {(k.passed ? "✓ " : k.passed === false ? "✗ " : "· ") + (k.label ?? k.id)}
              </text>
            )}
          </For>
        </Sezione>
      </Show>
      {/* Il flusso (Fase 3): quello attivo, e il passo in corso. */}
      <Show when={props.run.esecuzione || (props.run.flusso && props.run.flusso !== "diretto")}>
        <Sezione titolo={en() ? "Workflow" : "Flusso"}>
          <text fg={tema.testo} wrapMode="none" truncate>
            {"◆ " + nomeFlusso()}
          </text>
          <Show
            when={props.run.esecuzione}
            fallback={<text fg={tema.tenue}>{en() ? "/workflow to change it" : "/flusso per cambiarlo"}</text>}
          >
            <text fg={props.run.esecuzione?.attesa ? tema.avviso : tema.tenue} wrapMode="none" truncate>
              {(() => {
                const e = props.run.esecuzione;
                if (e.attesa === "piano") return en() ? "plan waiting: press enter" : "il piano aspetta: premi invio";
                const p = e.flusso.passi[e.passo];
                const ruolo = p && e.ruoli.find((x: any) => x.id === p.ruolo);
                 return en() ? `step ${Math.min(e.passo + 1, e.flusso.passi.length)} of ${e.flusso.passi.length}${ruolo ? " · " + (ruolo.predefinito ? (traduci(ruolo.nome) ?? ruolo.nome) : ruolo.nome) : ""}${e.giro ? ` · round ${e.giro}` : ""}` : `passo ${Math.min(e.passo + 1, e.flusso.passi.length)} di ${e.flusso.passi.length}${ruolo ? " · " + ruolo.nome : ""}${e.giro ? ` · giro ${e.giro}` : ""}`;
              })()}
            </text>
          </Show>
        </Sezione>
      </Show>
      {/* Il revisore (Fase 2): acceso, e quanti suggerimenti aspettano. */}
      <Show when={props.run.revisore?.attivo || (props.run.controlli ?? []).some((x: any) => x.attivo)}>
        <Sezione titolo={en() ? "Reviewer" : "Revisore"}>
          <text fg={tema.tenue} wrapMode="none" truncate>
            {props.run.revisore?.attivo
              ? `◇ ${props.run.revisore.provider ? nomeAI(props.run.revisore.provider) : en() ? "automatic" : "automatico"} · ${
                  descriviOgniTurni(props.run.revisore.ogniTurni ?? 1, en())
                }`
              : en() ? "◇ reviewer off" : "◇ revisore spento"}
          </text>
          <text fg={tema.tenue}>
            {(() => {
              const n = (props.run.suggerimenti ?? []).filter((x: any) => x.stato === "nuovo").length;
              return n ? (en() ? `${n} suggestion${n === 1 ? "" : "s"} for the next turn` : `${n} suggeriment${n === 1 ? "o" : "i"} per il prossimo turno`) : (en() ? "no suggestions waiting" : "nessun suggerimento in attesa");
            })()}
          </text>
          <Show when={(props.run.controlli ?? []).some((x: any) => x.attivo)}>
            <text fg={tema.tenue} wrapMode="none" truncate>
              {"+ " + (props.run.controlli ?? []).filter((x: any) => x.attivo).map((x: any) => x.nome).join(", ")}
            </text>
          </Show>
          <text fg={tema.tenue}>{en() ? "/reviewer to change it" : "/revisore per cambiarlo"}</text>
        </Sezione>
      </Show>
      <Show when={props.ibrida?.config.attiva}>
        <Sezione titolo={en() ? "Hybrid AI" : "AI ibrida"}>
          <text wrapMode="none" truncate>
            <span style={{ fg: coloreAI("qwen") }}>{"◆ " + props.ibrida!.config.modello}</span>
            <span style={{ fg: tema.tenue }}>{props.ibrida!.ollama.acceso ? (en() ? "  ready" : "  pronto") : (en() ? "  starts on first use" : "  si avvia al primo uso")}</span>
          </text>
          <text fg={tema.tenue} wrapMode="none" truncate>
            {[
              props.ibrida!.config.riserva ? (en() ? "backup" : "riserva") : "",
              props.ibrida!.config.aComando ? (en() ? "on demand" : "a comando") : "",
              `${props.ibrida!.config.compiti.filter((k: any) => k.attivo).length} ${en() ? "tasks" : "compiti"}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </text>
          <text fg={tema.tenue}>{en() ? "/hybrid to change it" : "/ibrida per cambiarla"}</text>
        </Sezione>
      </Show>
      <Show when={props.coda}>
        <Sezione titolo={en() ? "Queued" : "In coda"}>
          <text fg={tema.tenue}>{en() ? `${props.coda} messages start after this turn` : `${props.coda} messaggi partono a fine turno`}</text>
        </Sezione>
      </Show>
      <box flexGrow={1} />
      <text fg={tema.tenue} marginBottom={1}>
        <span style={{ fg: tema.accento }}>●</span> {`Continuity ${versioneApp()}`}
      </text>
    </box>
  );
}
