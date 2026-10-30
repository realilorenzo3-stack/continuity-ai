// /flusso: ruoli e flussi (Fase 3, CONTINUITY_2.0.md §5.17). Scegliere il
// flusso attivo, crearne e modificarne (passi, chi li fa, giri di correzione),
// modificare i ruoli e crearne di nuovi; rispondere al piano e fermare il
// flusso in corso. Ogni scelta si salva subito, come in /ibrida.
import {
  descriviFlusso as descriviFlussoCore,
  FLUSSI_PREDEFINITI,
  GIRI_MASSIMI,
  idDaNome,
  nomeAI,
  problemaAI,
  RUOLI_PREDEFINITI,
  type ConfigFlussi,
  type Esito,
  type Flusso,
  type Passo,
  type Ruolo,
} from "../core/flussi.js";
import { providerNoto } from "../core/provider.js";
import { nomeCorto } from "../core/menzioni.js";
import { messaggio } from "./cliente.js";
import type { Contesto } from "./comandi.js";
import type { Voce } from "./tipi.js";
import { lingua, traduci } from "./lingua.js";

const nomeAIUI = (ai: string) => lingua() === "en" && ai === "sequenza" ? "AI sequence" : lingua() === "en" && ai === "gratuito" ? "a free provider" : nomeAI(ai);
const descriviFlusso = (f: Flusso, ruoli: Ruolo[]) => lingua() === "en"
  ? f.passi.map((p) => {
      const ruolo = ruoli.find((r) => r.id === p.ruolo);
      const nome = ruolo?.nome ?? p.ruolo;
      return `${ruolo?.predefinito ? traduci(nome) : nome} (${nomeAIUI(p.ai)})`;
    }).join(" → ")
  : descriviFlussoCore(f, ruoli);
const anteprimaIstruzioni = (testo: string, max: number) => (traduci(testo) ?? testo).slice(0, max);

const ESITI: { esito: Esito; nome: string }[] = [
  { esito: "suggerimenti", nome: "Problemi da correggere (rimanda il lavoro a chi scrive)" },
  { esito: "testo", nome: "Un testo che passa ai passi dopo" },
  { esito: "verdetto", nome: "Un verdetto: PRONTO o NON PRONTO" },
  { esito: "piano", nome: "Un piano che aspetta il tuo sì" },
];

// La risposta al piano: approvarlo, farlo cambiare, annullare il flusso.
// true se la persona ha risposto (il flusso riparte o si chiude).
export async function rispondiAlPiano(c: Contesto): Promise<boolean> {
  const e = c.run().esecuzione;
  if (e?.attesa !== "piano") return false;
  const v = await c.scegli<string>(
    // Titolo corto: il riquadro è largo 60 colonne, il nome del flusso va
    // nella nota.
    "Il piano da approvare",
    [
      { nome: "Approva e continua", valore: "approva" },
      // Da qui in poi i piani di questo flusso partono da soli (27 ottobre).
      { nome: "Approva sempre", valore: "sempre", tasto: "per questo flusso" },
      { nome: "Chiedi di cambiarlo…", valore: "modifica" },
      { nome: "Annulla il flusso", valore: "annulla" },
    ],
    {
      // Il piano intero dentro il riquadro, da scorrere: dietro, nella
      // conversazione, il riquadro lo coprirebbe (CT-2.0-302).
      testo: String(e.piano ?? ""),
      nota: `Flusso «${e.flusso.nome}». Esc lo lascia in attesa: invio lo riapre.`,
    },
  );
  if (!v) return false;
  let testo: string | undefined;
  if (v.valore === "modifica") {
    testo = (await c.chiedi("Che cosa cambiare nel piano", { testo: "Per esempio: «aggiungi anche i test per il carrello vuoto»" }))?.trim();
    if (!testo) return false;
  }
  try {
    await c.api(`/runs/${c.id}/flusso/piano`, { azione: v.valore, ...(testo ? { testo } : {}) });
    await c.aggiorna();
    return true;
  } catch (e) {
    c.avvisa("errore", messaggio(e), 8000);
    return false;
  }
}

export async function pannelloFlusso(c: Contesto, argomento: string) {
  // «/flusso revisione»: attivo subito (con il nome interno).
  if (argomento.trim()) return usaFlusso(c, argomento.trim().toLowerCase().replace(/:$/, ""));
  for (;;) {
    await c.aggiorna();
    const run = c.run();
    let config: ConfigFlussi;
    try {
      config = await c.api("/flussi");
    } catch (e) {
      return c.avvisa("errore", messaggio(e), 8000);
    }
    const attivo = run.flusso ?? "diretto";
    const e = run.esecuzione;
    const v = await c.scegli<string>(
      "Come lavorano le AI",
      [
        ...(e?.attesa === "piano"
          ? [{ nome: "⚠ Il piano aspetta la tua risposta", valore: "piano", gruppo: "In corso", tasto: "rispondi" }]
          : []),
        ...(e
          ? [
              {
                nome: `Ferma «${e.flusso.nome}»`,
                descrizione: `passo ${Math.min(e.passo + 1, e.flusso.passi.length)} di ${e.flusso.passi.length}`,
                valore: "ferma",
                gruppo: "In corso",
                tasto: "ferma",
              },
            ]
          : []),
        ...config.flussi.map((f) => ({
          nome: f.nome,
          descrizione: f.descrizione ? (f.predefinito ? traduci(f.descrizione) : f.descrizione) : descriviFlusso(f, config.ruoli),
          valore: "usa:" + f.id,
          gruppo: "Scegli come lavorano · invio",
          tasto: f.id === attivo ? "● in uso" : "",
          attuale: f.id === attivo,
        })),
        // Chi lavora quando finiscono i crediti (era /ordine) e chi controlla
        // sempre, in parallelo (il revisore e gli altri controlli).
        {
          nome: "Sequenza: " + ((run.providers ?? []) as string[]).map((x) => providerNoto(x)?.nome.split(" · ")[0] ?? x).join(" → "),
          valore: "sequenza",
          gruppo: "Chi lavora e chi controlla",
          tasto: "chi continua",
        },
        {
          nome:
            "Sempre attivi: " +
            ([
              ...(run.revisore?.attivo ? ["Revisore"] : []),
              ...((run.controlli ?? []) as any[]).filter((x) => x.attivo).map((x) => x.nome),
            ].join(", ") || "nessuno acceso"),
          valore: "sempre",
          gruppo: "Chi lavora e chi controlla",
          tasto: "in parallelo",
        },
        // Le AI chiamate con @ nel messaggio: riepilogo da confermare o no.
        {
          nome: `AI chiamate con @: ${config.confermaIncarichi === false ? "partono subito" : "chiedo conferma"}`,
          valore: "conferma",
          gruppo: "Chi lavora e chi controlla",
          tasto: config.confermaIncarichi === false ? "chiedi conferma" : "parti subito",
        },
        { nome: "+ Crea un flusso…", valore: "nuovo", gruppo: "Modifica" },
        { nome: "Modifica un flusso…", valore: "modifica", gruppo: "Modifica" },
        { nome: "Ruoli…", valore: "ruoli", gruppo: "Modifica", tasto: `${config.ruoli.length} ruoli` },
      ],
      {
        // Che cosa fa ciascuno, in parole: i nomi da soli non bastavano.
        nota:
          config.flussi.map((f) => `• ${f.predefinito ? traduci(f.nome) : f.nome}: ${f.descrizione ? (f.predefinito ? traduci(f.descrizione) : f.descrizione) : descriviFlusso(f, config.ruoli)}`).join("\n") +
          (lingua() === "en" ? "\n\nThe selected workflow applies to every message until you change it." : "\n\nQuello in uso vale per ogni messaggio, finché non lo cambi."),
      },
    );
    if (!v) return;
    try {
      if (v.valore === "piano") {
        if (await rispondiAlPiano(c)) return;
      } else if (v.valore === "ferma") {
        await c.api(`/runs/${c.id}/flusso/ferma`, {});
        c.avvisa("ok", "Flusso fermato: il lavoro fatto resta nella copia", 5000);
        return;
      } else if (v.valore.startsWith("usa:")) {
        await usaFlusso(c, v.valore.slice(4));
        return;
      } else if (v.valore === "nuovo") {
        const id = await nuovoFlusso(c, config);
        if (id) await modificaFlusso(c, id);
      } else if (v.valore === "modifica") {
        const f = await c.scegli<string>(
          "Quale flusso",
          config.flussi.map((x) => ({ nome: x.nome, descrizione: descriviFlusso(x, config.ruoli), valore: x.id })),
        );
        if (f) await modificaFlusso(c, f.valore);
      } else if (v.valore === "ruoli") await pannelloRuoli(c);
      else if (v.valore === "conferma") {
        await salva(c, { ...config, confermaIncarichi: config.confermaIncarichi === false });
      } else if (v.valore === "sequenza") {
        const { ordine } = await import("./comandi.js");
        await ordine(c, "");
      } else if (v.valore === "sempre") {
        const { pannelloRevisore } = await import("./comandi.js");
        await pannelloRevisore(c);
      }
    } catch (err) {
      c.avvisa("errore", messaggio(err), 8000);
    }
  }
}

async function usaFlusso(c: Contesto, id: string) {
  try {
    await c.api(`/runs/${c.id}/flusso`, { flusso: id });
    await c.aggiorna();
    const config: ConfigFlussi = await c.api("/flussi");
    const f = config.flussi.find((x) => x.id === id);
    c.avvisa("ok", `Flusso attivo: ${f?.nome ?? id}${f ? ` · ${descriviFlusso(f, config.ruoli)}` : ""}`, 6000);
  } catch (e) {
    c.avvisa("errore", messaggio(e), 8000);
  }
}

// Salva tutto: il servizio controlla e spiega che cosa non va.
async function salva(c: Contesto, config: ConfigFlussi): Promise<boolean> {
  try {
    await c.api("/flussi", config);
    return true;
  } catch (e) {
    c.avvisa("errore", messaggio(e), 8000);
    return false;
  }
}

async function nuovoFlusso(c: Contesto, config: ConfigFlussi): Promise<string | undefined> {
  const nome = (await c.chiedi("Nuovo flusso", { testo: "Come si chiama? Per esempio «Sicuro»" }))?.trim();
  if (!nome) return;
  const id = idDaNome(nome, config.flussi.map((f) => f.id));
  const flusso: Flusso = { id, nome: nome.slice(0, 40), giri: 2, passi: [{ ruolo: "scrive", ai: "sequenza" }] };
  if (!(await salva(c, { ...config, flussi: [...config.flussi, flusso] }))) return;
  c.avvisa("ok", `Flusso «${flusso.nome}» creato: aggiungi i passi`, 5000);
  return id;
}

// I passi di un flusso: ruolo e chi lo fa, in ordine.
async function modificaFlusso(c: Contesto, id: string) {
  for (;;) {
    const config: ConfigFlussi = await c.api("/flussi");
    const f = config.flussi.find((x) => x.id === id);
    if (!f) return;
    const ruolo = (p: Passo) => config.ruoli.find((r) => r.id === p.ruolo);
    const v = await c.scegli<string>(
      `Flusso «${f.nome}»`,
      [
        ...f.passi.map((p, i) => ({
          nome: `${i + 1}. ${ruolo(p)?.nome ?? p.ruolo}`,
          valore: "passo:" + i,
          gruppo: "Passi, in ordine",
           tasto: nomeAIUI(p.ai),
        })),
        { nome: "+ Aggiungi un passo", valore: "aggiungi", gruppo: "Passi, in ordine" },
        {
          nome: `Giri di correzione: ${f.giri}`,
          descrizione: "quante volte chi rivede può rimandare il lavoro a chi scrive",
          valore: "giri",
          gruppo: "Impostazioni",
        },
        { nome: `Nome: ${f.nome}`, valore: "nome", gruppo: "Impostazioni" },
        // Solo se il flusso ha un piano: chiedere ogni volta o farlo partire.
        ...(f.passi.some((p) => ruolo(p)?.esito === "piano")
          ? [
              {
                nome: `Il piano: ${f.approvaPiano ? "parte da solo" : "chiede il tuo sì"}`,
                valore: "approva",
                gruppo: "Impostazioni",
                tasto: f.approvaPiano ? "chiedi di nuovo" : "approva sempre",
              },
            ]
          : []),
        ...(f.predefinito
          ? [{ nome: "Rimetti com'era di serie", valore: "serie", gruppo: "Impostazioni" }]
          : [{ nome: "Elimina il flusso", valore: "elimina", gruppo: "Impostazioni" }]),
      ],
       { nota: `${f.descrizione ? (f.predefinito ? traduci(f.descrizione) : f.descrizione) + "\n\n" : ""}${lingua() === "en" ? "Steps" : "Passi"}: ${descriviFlusso(f, config.ruoli)}` },
    );
    if (!v) return;
    const cambia = (nuovo: Flusso | undefined) =>
      salva(c, { ...config, flussi: nuovo ? config.flussi.map((x) => (x.id === id ? nuovo : x)) : config.flussi.filter((x) => x.id !== id) });
    if (v.valore === "aggiungi") {
      const r = await sceltaRuolo(c, config.ruoli);
      if (!r) continue;
      const ai = await sceltaAI(c, r, r.tipo === "legge" ? "gratuito" : "sequenza");
      if (!ai) continue;
      await cambia({ ...f, passi: [...f.passi, { ruolo: r.id, ai }] });
    } else if (v.valore.startsWith("passo:")) {
      await modificaPasso(c, config, f, Number(v.valore.slice(6)), cambia);
    } else if (v.valore === "giri") {
      const g = await c.scegli<number>(
        "Giri di correzione",
        Array.from({ length: GIRI_MASSIMI + 1 }, (_, n) => ({
          nome: n === 0 ? "Nessuno: chi rivede segnala soltanto" : `${n} ${n === 1 ? "giro" : "giri"}`,
          valore: n,
          attuale: n === f.giri,
        })),
        { nota: "Finiti i giri, i problemi rimasti te li dico e vanno all'AI con il prossimo messaggio." },
      );
      if (g) await cambia({ ...f, giri: g.valore });
    } else if (v.valore === "nome") {
      const nome = (await c.chiedi("Nome del flusso", { testo: `Ora è «${f.nome}»` }))?.trim();
      if (nome) await cambia({ ...f, nome: nome.slice(0, 40) });
    } else if (v.valore === "approva") {
      await cambia({ ...f, approvaPiano: !f.approvaPiano });
    } else if (v.valore === "serie") {
      const serie = FLUSSI_PREDEFINITI.find((x) => x.id === id);
      if (serie) await cambia(JSON.parse(JSON.stringify(serie)));
    } else if (v.valore === "elimina") {
      const sicuro = await c.scegli(`Eliminare «${f.nome}»?`, [
        { nome: "Sì, elimina", valore: true },
        { nome: "No", valore: false },
      ]);
      if (sicuro?.valore && (await cambia(undefined))) {
        if ((c.run().flusso ?? "diretto") === id) await c.api(`/runs/${c.id}/flusso`, { flusso: "diretto" }).catch(() => {});
        return;
      }
    }
  }
}

async function modificaPasso(
  c: Contesto,
  config: ConfigFlussi,
  f: Flusso,
  i: number,
  cambia: (f: Flusso) => Promise<boolean>,
) {
  const p = f.passi[i];
  const ruolo = config.ruoli.find((r) => r.id === p.ruolo);
  const v = await c.scegli<string>(
    `Passo ${i + 1}: ${ruolo?.nome ?? p.ruolo}`,
    [
       { nome: "Chi lo fa", valore: "ai", tasto: nomeAIUI(p.ai) },
      { nome: "Cambia il ruolo", valore: "ruolo", tasto: ruolo?.nome ?? p.ruolo },
      ...(i > 0 ? [{ nome: "Sposta su", valore: "su" }] : []),
      ...(i < f.passi.length - 1 ? [{ nome: "Sposta giù", valore: "giu" }] : []),
      ...(f.passi.length > 1 ? [{ nome: "Togli il passo", valore: "togli" }] : []),
    ],
     { nota: ruolo ? anteprimaIstruzioni(ruolo.istruzioni, 200) : undefined },
  );
  if (!v) return;
  const passi = [...f.passi];
  if (v.valore === "ai" && ruolo) {
    const ai = await sceltaAI(c, ruolo, p.ai);
    if (ai) passi[i] = { ruolo: p.ruolo, ai };
  } else if (v.valore === "ruolo") {
    const r = await sceltaRuolo(c, config.ruoli);
    if (!r) return;
    // Chi lo fa resta, se può fare il ruolo nuovo; altrimenti la sequenza.
    passi[i] = { ruolo: r.id, ai: problemaAI(r, p.ai) ? "sequenza" : p.ai };
  } else if (v.valore === "su" || v.valore === "giu") {
    const j = v.valore === "su" ? i - 1 : i + 1;
    [passi[i], passi[j]] = [passi[j], passi[i]];
  } else if (v.valore === "togli") passi.splice(i, 1);
  else return;
  await cambia({ ...f, passi });
}

async function sceltaRuolo(c: Contesto, ruoli: Ruolo[]): Promise<Ruolo | undefined> {
  const v = await c.scegli<string>(
    "Quale ruolo",
    ruoli.map((r) => ({
      nome: r.nome,
       descrizione: anteprimaIstruzioni(r.istruzioni, 90),
      valore: r.id,
      gruppo: "Ruoli",
    })),
  );
  return v ? ruoli.find((r) => r.id === v.valore) : undefined;
}

// Chi fa un ruolo: la sequenza, un gratuito, un'AI precisa. Tutte le AI
// sullo stesso piano (28 ottobre); si dice solo chi consuma l'abbonamento.
async function sceltaAI(c: Contesto, _ruolo: Ruolo, attuale: string): Promise<string | undefined> {
  const sequenza: string[] = c.run().providers ?? ["codex", "claude"];
  const servizi: any[] = await c.api("/gratuiti").catch(() => []);
  const gratuiti = servizi.filter((x) => x.collegato).map((x) => String(x.id));
  const crediti = (id: string) => {
    const p = providerNoto(id);
    return p?.accesso === "abbonamento" ? "consuma il tuo abbonamento" : p?.motore === "diretto" ? "gratis" : id === "ollama" ? "sul tuo computer, gratis" : "";
  };
  const voci: Voce<string>[] = [
    {
      nome: "La sequenza",
      descrizione: "la prima AI con crediti, e cambia da sola quando finiscono",
      valore: "sequenza",
      gruppo: "Automatico",
      attuale: attuale === "sequenza",
    },
    {
      nome: "Gratuito automatico",
      descrizione: "il primo servizio gratuito collegato (Groq, Cloudflare, Google…)",
      valore: "gratuito",
      gruppo: "Automatico",
      tasto: "gratis",
      attuale: attuale === "gratuito",
    },
    ...[...new Set([...sequenza, ...gratuiti, "ollama"])]
      .filter((id) => providerNoto(id))
      .map((id) => ({
        nome: nomeCorto(id),
        valore: id,
        gruppo: "Le tue AI",
        tasto: crediti(id),
        attuale: attuale === id,
      })),
  ];
  const v = await c.scegli<string>(`Chi fa «${_ruolo.nome}»`, voci);
  return v?.valore;
}

async function pannelloRuoli(c: Contesto) {
  for (;;) {
    const config: ConfigFlussi = await c.api("/flussi");
    const v = await c.scegli<string>(
      "Ruoli",
      [
        ...config.ruoli.map((r) => ({
          nome: r.nome,
           descrizione: anteprimaIstruzioni(r.istruzioni, 90),
          valore: r.id,
          gruppo: r.predefinito ? "Di Continuity" : "Tuoi",
          tasto: "",
        })),
        { nome: "+ Nuovo ruolo…", valore: "+", gruppo: "Tuoi" },
      ],
      { nota: "Invio modifica un ruolo. Un ruolo nuovo si usa aggiungendolo come passo di un flusso." },
    );
    if (!v) return;
    if (v.valore === "+") {
      await nuovoRuolo(c, config);
      continue;
    }
    const r = config.ruoli.find((x) => x.id === v.valore);
    if (!r) continue;
    const usato = config.flussi.filter((f) => f.passi.some((p) => p.ruolo === r.id)).map((f) => f.nome);
    const serie = RUOLI_PREDEFINITI.find((x) => x.id === r.id);
    const a = await c.scegli<string>(
      r.nome,
      [
        { nome: "Modifica le istruzioni", valore: "istruzioni" },
        ...(serie && serie.istruzioni !== r.istruzioni ? [{ nome: "Torna alle istruzioni di serie", valore: "serie" }] : []),
        ...(r.predefinito ? [] : [{ nome: "Rinomina", valore: "nome" }]),
        ...(!r.predefinito && r.tipo === "legge" ? [{ nome: "Che cosa produce", valore: "esito", tasto: ESITI.find((x) => x.esito === r.esito)?.nome.split(" (")[0] }] : []),
        ...(r.predefinito ? [] : [{ nome: "Elimina", valore: "elimina", tasto: usato.length ? `usato in ${usato.join(", ")}` : "" }]),
      ],
       { nota: anteprimaIstruzioni(r.istruzioni, 300) },
    );
    if (!a) continue;
    let nuovo: Ruolo | undefined = { ...r };
    if (a.valore === "istruzioni") {
     const t = (await c.chiedi(`Istruzioni di «${r.nome}»`, { testo: r.istruzioni.slice(0, 300) }))?.trim();
      if (!t) continue;
      nuovo.istruzioni = t;
    } else if (a.valore === "serie" && serie) nuovo.istruzioni = serie.istruzioni;
    else if (a.valore === "nome") {
      const t = (await c.chiedi("Nuovo nome", { testo: `Ora è «${r.nome}»` }))?.trim();
      if (!t) continue;
      nuovo.nome = t.slice(0, 40);
    } else if (a.valore === "esito") {
      const e = await sceltaEsito(c, r.esito);
      if (!e) continue;
      nuovo.esito = e;
    } else if (a.valore === "elimina") {
      if (usato.length) {
        c.avvisa("avviso", `«${r.nome}» è usato in ${usato.join(", ")}: toglilo prima da quei flussi`, 8000);
        continue;
      }
      nuovo = undefined;
    }
    await salva(c, {
      ...config,
      ruoli: nuovo ? config.ruoli.map((x) => (x.id === r.id ? nuovo! : x)) : config.ruoli.filter((x) => x.id !== r.id),
    });
  }
}

async function sceltaEsito(c: Contesto, attuale?: Esito): Promise<Esito | undefined> {
  const v = await c.scegli<Esito>(
    "Che cosa produce",
    ESITI.map((x) => ({ nome: x.nome, valore: x.esito, attuale: x.esito === attuale })),
    { nota: "Così Continuity sa che cosa fare dopo questo passo." },
  );
  return v?.valore;
}

async function nuovoRuolo(c: Contesto, config: ConfigFlussi) {
  const nome = (await c.chiedi("Nuovo ruolo", { testo: "Come si chiama? Per esempio «Sicurezza» o «Testi in italiano»" }))?.trim();
  if (!nome) return;
  const tipo = await c.scegli<"legge" | "scrive">("Che cosa fa", [
    { nome: "Ricontrolla, consiglia o pianifica", descrizione: "dice che cosa fare; il lavoro lo fa chi scrive", valore: "legge" },
    { nome: "Fa il lavoro", descrizione: "modifica il progetto", valore: "scrive" },
  ]);
  if (!tipo) return;
  const esito: Esito | undefined = tipo.valore === "scrive" ? "lavoro" : await sceltaEsito(c, "suggerimenti");
  if (!esito) return;
  const istruzioni = (
    await c.chiedi("Istruzioni", { testo: "Che cosa deve fare? Scrivilo come lo diresti a una persona." })
  )?.trim();
  if (!istruzioni) return;
  const ruolo: Ruolo = {
    id: idDaNome(nome, config.ruoli.map((r) => r.id)),
    nome: nome.slice(0, 40),
    tipo: tipo.valore,
    esito,
    istruzioni,
  };
  if (await salva(c, { ...config, ruoli: [...config.ruoli, ruolo] }))
    c.avvisa("ok", `Ruolo «${ruolo.nome}» creato: aggiungilo come passo di un flusso (/flusso → Modifica un flusso)`, 7000);
}
