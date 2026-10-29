// Ciò che l'interfaccia chiede al servizio, senza schermo: le stesse chiamate
// e le stesse regole del terminale a righe (src/cli/session.ts), con testo
// semplice al posto dei colori ANSI, che OpenTUI mostrerebbe come caratteri.
import type { Evento } from "./conversazione.js";
import { lingua } from "./lingua.js";

const en = () => lingua() === "en";

export type Api = (percorso: string, corpo?: unknown) => Promise<any>;

// Il registro si legge a pagine di 500, fino in fondo.
export async function leggiEventi(api: Api, id: string, dopo: number) {
  const tutti: Evento[] = [];
  let seq = dopo;
  for (;;) {
    const { events = [] } = await api(`/runs/${id}/events?afterSeq=${seq}`);
    if (!events.length) break;
    tutti.push(...events);
    seq = events.reduce((m: number, e: Evento) => Math.max(m, e.seq), seq);
    if (events.length < 500) break;
  }
  return tutti;
}

// Che cosa è arrivato nella cartella, in una riga (come descriviConsegna).
export function testoConsegna(esito: any): string {
  const parti: string[] = [];
  const scritti = (esito.applicati ?? []).filter(
    (f: string) => !(esito.uniti ?? []).includes(f),
  );
  if (scritti.length)
    parti.push(
      scritti.length > 8
        ? `${scritti.length} file (${scritti.slice(0, 3).join(", ")}, …)`
        : scritti.join(", "),
    );
  if (esito.eliminati?.length)
    parti.push((en() ? "deleted: " : "eliminati: ") + esito.eliminati.join(", "));
  if (esito.uniti?.length)
    parti.push((en() ? "merged with your changes: " : "uniti alle tue modifiche: ") + esito.uniti.join(", "));
  const riga = parti.length
    ? en() ? `in your folder: ${parti.join(" · ")} · /undo to revert` : `nella tua cartella: ${parti.join(" · ")} · /annulla per tornare indietro`
    : (esito.messaggio ?? (en() ? "No changes to apply" : "Nessuna modifica da applicare"));
  return esito.saltati?.length
    ? `${riga} · ${en() ? "not delivered (symbolic links)" : "non consegnati (collegamenti simbolici)"}: ${esito.saltati.join(", ")}`
    : riga;
}

export type FileModificato = { nome: string; piu: number; meno: number };
export type Esito =
  | { tipo: "ok" | "avviso" | "info"; testo: string }
  // Il riepilogo di ciò che l'AI ha cambiato, prima della consegna.
  | { tipo: "modifiche"; testo: string; file: FileModificato[] };

// Dopo un turno concluso: i file vanno nella cartella della persona, senza
// domande (la rete di sicurezza è /annulla), e con la pubblicazione automatica
// attiva anche su GitHub. Da sola non decide mai su eliminazioni o segreti.
export async function dopoIlTurno(api: Api, id: string): Promise<Esito[]> {
  const fuori: Esito[] = [];
  const cambiati = await api(`/runs/${id}/changed?stat=1`).catch(() => ({}));
  const prodotti: string[] = cambiati.files ?? [];
  if (!prodotti.length) return fuori;
  fuori.push({
    tipo: "modifiche",
    testo: `${prodotti.length} file`,
    file: prodotti.map((nome) => ({
      nome,
      piu: cambiati.stat?.[nome]?.piu ?? 0,
      meno: cambiati.stat?.[nome]?.meno ?? 0,
    })),
  });
  let esito: any;
  try {
    esito = await api(`/runs/${id}/apply`, {});
  } catch (e) {
    fuori.push({
      tipo: "avviso",
       testo: en() ? `Could not write to your folder: ${messaggio(e)}. Files remain ready: ${prodotti.join(", ")}` : `Non ho potuto scrivere nella tua cartella: ${messaggio(e)}. I file restano pronti: ${prodotti.join(", ")}`,
    });
    return fuori;
  }
  fuori.push({
    tipo: esito.applicati?.length || esito.eliminati?.length ? "ok" : "info",
    testo: testoConsegna(esito),
  });
  if (!(esito.applicati?.length || esito.eliminati?.length)) return fuori;
  const github = await api(`/runs/${id}/github`).catch(() => ({}));
  if (github.automatica && github.destinazione)
    fuori.push(...(await pubblica(api, id, { automatica: true })));
  return fuori;
}

export type Anteprima = {
  destinazione: string;
  aggiunti: string[];
  modificati: string[];
  eliminati: string[];
  sospetti: string[];
  esclusi: string[];
  piano: string;
};

// La pubblicazione in due tempi: anteprima, poi conferma. «chiedi» serve solo
// quando c'è da decidere (eliminazioni, possibili segreti, repository): la
// pubblicazione automatica non chiede mai, si ferma.
export async function pubblica(
  api: Api,
  id: string,
  opzioni: {
    automatica?: boolean;
    destinazione?: string;
    chiedi?: (domanda: string) => Promise<string | undefined>;
  } = {},
): Promise<Esito[]> {
  let anteprima: Anteprima | undefined;
  let destinazione = opzioni.destinazione;
  const fuori: Esito[] = [];
  // Prima il lavoro rimasto nella copia va nella cartella: si pubblica la
  // cartella della persona, e senza questo mancherebbe (come in session.ts).
  if (!opzioni.automatica) {
    const inSospeso: string[] = await api(`/runs/${id}/changed`).then(
      (x: any) => x.files ?? [],
      () => [],
    );
    if (inSospeso.length)
      try {
        const esito = await api(`/runs/${id}/apply`, {});
        fuori.push({ tipo: "ok", testo: testoConsegna(esito) });
      } catch (e) {
        return [
          {
            tipo: "avviso",
             testo: en() ? `Could not deliver remaining work before publishing: ${messaggio(e)}` : `Prima di pubblicare non ho potuto consegnare il lavoro rimasto: ${messaggio(e)}`,
          },
        ];
      }
  }
  for (let tentativo = 0; tentativo < 2 && !anteprima; tentativo++) {
    try {
      anteprima = await api(`/runs/${id}/pubblica`, {
        ...(destinazione ? { destinazione } : {}),
      });
    } catch (e) {
      const testo = messaggio(e);
      if (
        /Dimmi dove pubblicare/.test(testo) &&
        tentativo === 0 &&
        !opzioni.automatica &&
        opzioni.chiedi
      ) {
        destinazione = (
           await opzioni.chiedi(en() ? "Which GitHub repository? (owner/name)" : "Su quale repository GitHub? (utente/nome)")
        )?.trim();
        if (destinazione) continue;
         return [{ tipo: "info", testo: en() ? "Nothing published." : "Niente pubblicato." }];
      }
      return [{ tipo: "avviso", testo }];
    }
  }
  if (!anteprima) return [];
  const cambi =
    anteprima.aggiunti.length +
    anteprima.modificati.length +
    anteprima.eliminati.length;
  if (!cambi)
    return [
      {
        tipo: "ok",
         testo: en() ? `${anteprima.destinazione} is already up to date.` : `Su ${anteprima.destinazione} è già tutto aggiornato.`,
      },
    ];
  const delicati = [
    anteprima.eliminati.length
       ? en() ? `${anteprima.eliminati.length} files would be deleted from GitHub` : `su GitHub verrebbero eliminati ${anteprima.eliminati.length} file`
      : "",
    anteprima.sospetti.length
       ? en() ? `possible passwords or tokens in ${anteprima.sospetti.join(", ")}` : `possibili password o token in ${anteprima.sospetti.join(", ")}`
      : "",
  ].filter(Boolean);
  if (delicati.length) {
    if (opzioni.automatica || !opzioni.chiedi)
      return [
        {
          tipo: "avviso",
           testo: en() ? `Automatic publishing paused: ${delicati.join(" and ")}. Decide with /publish.` : `Pubblicazione automatica sospesa: ${delicati.join(" e ")}. Decidi tu con /pubblica.`,
        },
      ];
    const risposta = await opzioni.chiedi(
       en() ? `${delicati.join(" and ")}. Publish anyway? (y/n)` : `${delicati.join(" e ")}. Pubblico lo stesso? (s/n)`,
    );
    if (!/^(s|si|sì|y|yes)$/i.test(risposta?.trim() ?? ""))
       return [{ tipo: "info", testo: en() ? "Nothing published." : "Niente pubblicato." }];
  }
  try {
    const esito = await api(`/runs/${id}/pubblica`, {
      conferma: anteprima.piano,
      forza: anteprima.sospetti.length > 0,
    });
    const conta = (k: number, uno: string, tanti: string) =>
      k ? `${k} ${k === 1 ? uno : tanti}` : "";
    const parti = [
       conta(anteprima.aggiunti.length, en() ? "new file" : "file nuovo", en() ? "new files" : "file nuovi"),
       conta(anteprima.modificati.length, en() ? "modified file" : "modificato", en() ? "modified files" : "modificati"),
       conta(anteprima.eliminati.length, en() ? "deleted file" : "eliminato", en() ? "deleted files" : "eliminati"),
    ].filter(Boolean);
    fuori.push(
      {
        tipo: "ok",
        testo:
           `${en() ? "Published to" : "Pubblicato su"} ${anteprima.destinazione} (${esito.ramo}): ${parti.join(", ")}` +
          (esito.url ? ` · ${esito.url}` : ""),
      },
    );
    if (anteprima.esclusi.length)
      fuori.push({
        tipo: "info",
         testo: en() ? `Not published because they look like credentials: ${anteprima.esclusi.join(", ")}` : `Non pubblicati perché sembrano credenziali: ${anteprima.esclusi.join(", ")}`,
      });
    // Dopo la prima pubblicazione fatta a mano, una domanda sola: la
    // risposta resta per il progetto (come in session.ts).
    if (!opzioni.automatica && esito.automatica === undefined && opzioni.chiedi) {
      const r = await opzioni.chiedi(
         en() ? "Publish to GitHub automatically after every delivery? (y/n) Change this with /publish automatic" : "Pubblico da solo su GitHub dopo ogni consegna? (s/n) Si cambia con /pubblica automatica",
      );
      if (r !== undefined) {
        const attiva = /^(s|si|sì|y|yes)$/i.test(r.trim());
        await api(`/runs/${id}/github`, { automatica: attiva }).catch(() => {});
        fuori.push({
          tipo: "info",
           testo: en() ? `Automatic publishing ${attiva ? "on" : "off"}` : `Pubblicazione automatica ${attiva ? "attiva" : "non attiva"}`,
        });
      }
    }
    return fuori;
  } catch (e) {
    return [...fuori, { tipo: "avviso", testo: messaggio(e) }];
  }
}

// Interrompere il turno in corso: una pausa, solo se è ancora quel turno.
export async function interrompi(api: Api, id: string): Promise<boolean> {
  let turno: number | undefined;
  for (let i = 0; i < 20; i++) {
    try {
      const r = await api(`/runs/${id}`);
      turno ??= r.turnNumber;
      // Un turno che sta ancora partendo si aspetta: interromperlo «a vuoto»
      // lo lasciava andare avanti (punto 16).
      if (r.state === "STARTING") {
        await new Promise((ok) => setTimeout(ok, 300));
        continue;
      }
      if (r.turnNumber !== turno || r.state !== "RUNNING") return true;
      await api(`/runs/${id}/actions`, {
        action: "pause",
        expectedVersion: r.version,
      });
      return true;
    } catch {
      await new Promise((ok) => setTimeout(ok, 300));
    }
  }
  return false;
}

export function messaggio(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
