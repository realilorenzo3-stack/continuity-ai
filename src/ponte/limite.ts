// Le richieste di Codex dentro il limite di un servizio gratuito (28 ottobre).
// Groq gratuito accetta 8.000 token al minuto per modello: la prima volta che
// lavora in una sessione lunga riceve tutta la conversazione, e ogni file
// letto si aggiunge alla richiesta dopo. Perché tutte le AI possano lavorare
// sui file, il ponte stringe la richiesta prima di mandarla.
//
// Due parti, trattate in modo diverso:
// - la testa: istruzioni, strumenti, contesto e messaggi fino alla richiesta
//   corrente di Continuity. È la stessa per tutte le richieste di un turno, e
//   si stringe solo guardando sé stessa: così resta identica da una richiesta
//   all'altra e Groq la tiene in cache («cached tokens do not count towards
//   your rate limits», console.groq.com/docs/prompt-caching);
// - il turno: ciò che l'AI ha fatto dopo (chiamate e risultati), stretto
//   per ultimo, tenendo gli ultimi passi.

// Una stima prudente: circa 3,2 caratteri per token nei testi misti di codice.
const token = (x: unknown) => Math.ceil(JSON.stringify(x ?? []).length / 3.2);
export function stimaToken(chat: any): number {
  return token(chat.messages) + token(chat.tools);
}

const NOTA = "[Continuity: tolta una parte più vecchia per stare nel limite del servizio gratuito]";

function accorcia(testo: string, massimo: number): string {
  if (testo.length <= massimo) return testo;
  const testa = Math.floor(massimo * 0.65);
  const coda = massimo - testa;
  return `${testo.slice(0, testa)}\n${NOTA}\n${testo.slice(-coda)}`;
}

// Le righe della conversazione nel messaggio di Continuity: «  [utente] …»,
// «  [AI codex] …», «  [Continuity] …».
const RIGA_STORIA = /^ {2}\[(utente|Continuity|AI[^\]]*)\] /;

function togliStoriaVecchia(testo: string): string | undefined {
  const righe = testo.split("\n");
  const indice = righe.findIndex((r) => RIGA_STORIA.test(r));
  if (indice < 0) return undefined;
  // Una voce va fino alla voce dopo (le risposte delle AI sono su più righe);
  // l'ultima fino alla richiesta corrente. Senza un confine chiaro, solo la riga.
  let fine = righe.findIndex((r, i) => i > indice && RIGA_STORIA.test(r));
  if (fine < 0) {
    const richiesta = righe.findIndex((r, i) => i > indice && /^Richiesta corrente:/.test(r));
    fine = richiesta > 0 ? (righe[richiesta - 1] === "" ? richiesta - 1 : richiesta) : indice + 1;
  }
  righe.splice(indice, fine - indice, ...(righe[indice - 1] === NOTA ? [] : [NOTA]));
  return righe.join("\n");
}

// Un'unità che si può togliere da sola: un messaggio dell'assistente con i
// risultati delle sue chiamate, oppure un messaggio solo.
function unita(messaggi: any[], da: number, fino: number): [number, number] | undefined {
  let i = da;
  while (i < fino && messaggi[i].content === NOTA) i++;
  if (i >= fino) return undefined;
  let fine = i + 1;
  if (messaggi[i].role === "assistant" && messaggi[i].tool_calls?.length)
    while (fine < messaggi.length && messaggi[fine].role === "tool") fine++;
  return fine <= fino ? [i, fine] : undefined;
}

const reale = (m: any) => m.role === "user" && m.content !== NOTA;

export type Stretta = { prima: number; dopo: number; entra: boolean };

export function stringiPerIlLimite(chat: any, massimoToken: number): Stretta {
  const prima = stimaToken(chat);
  // La risposta conta nel limite: abbastanza per scrivere un file.
  const risposta = Math.min(3000, Math.floor(massimoToken * 0.35));
  chat.max_tokens = Math.min(chat.max_tokens ?? risposta, risposta);
  const budget = massimoToken - risposta;
  if (prima <= budget) return { prima, dopo: prima, entra: true };
  const messaggi: any[] = chat.messages;

  // La testa: fino all'ultimo messaggio vero della persona (la richiesta
  // corrente di Continuity). Il suo spazio: due terzi del totale.
  const ultimoUtente = messaggi.reduce((u, m, i) => (reale(m) ? i : u), -1);
  const testa = () => token(messaggi.slice(0, ultimoUtente + 1)) + token(chat.tools);
  const spazioTesta = Math.floor(budget * 0.67);
  if (ultimoUtente >= 0) {
    const utenti = messaggi.map((m, i) => (i <= ultimoUtente && reale(m) ? i : -1)).filter((i) => i >= 0);
    // 1. I messaggi di Continuity dei turni prima (Codex riprende la sua
    // sessione: restano in testa) diventano una nota; il primo è il contesto
    // dell'ambiente di Codex, l'ultimo è la richiesta di adesso.
    for (const i of utenti.slice(1, -1)) {
      if (testa() <= spazioTesta) break;
      messaggi[i].content = NOTA;
    }
    // 2. Ciò che le AI hanno fatto nei turni prima.
    for (;;) {
      if (testa() <= spazioTesta) break;
      const primoUtile = utenti.length > 1 ? utenti[1] : utenti[0];
      const u = unita(messaggi, primoUtile + 1, ultimoUtente);
      if (!u) break;
      messaggi.splice(u[0], u[1] - u[0]);
      const tolti = u[1] - u[0];
      for (let k = 0; k < utenti.length; k++) if (utenti[k] >= u[1]) utenti[k] -= tolti;
      return stringiDiNuovo(chat, massimoToken, prima);
    }
    // 3. La conversazione tenuta da Continuity, dalle voci più vecchie.
    for (const i of utenti) {
      while (testa() > spazioTesta && typeof messaggi[i].content === "string") {
        const nuovo = togliStoriaVecchia(messaggi[i].content);
        if (nuovo === undefined) break;
        messaggi[i].content = nuovo;
      }
    }
  }
  return stringiTurno(chat, massimoToken, budget, ultimoUtente, prima);
}

// Dopo aver tolto un pezzo della testa gli indici cambiano: si ricomincia.
function stringiDiNuovo(chat: any, massimoToken: number, prima: number): Stretta {
  return { ...stringiPerIlLimite(chat, massimoToken), prima };
}

function stringiTurno(chat: any, massimoToken: number, budget: number, ultimoUtente: number, prima: number): Stretta {
  const messaggi: any[] = chat.messages;
  const ultimo = messaggi.length - 1;
  // 4. Le uscite dei comandi di questo turno: l'ultima più lunga, le altre
  // brevi. Le stesse a ogni richiesta, quindi anche queste restano in cache.
  messaggi.forEach((m, i) => {
    if (i > ultimoUtente && m.role === "tool" && typeof m.content === "string")
      m.content = accorcia(m.content, i === ultimo ? 3000 : 1200);
  });
  // 5. I passi più vecchi di questo turno, tenendo gli ultimi 3 messaggi.
  while (stimaToken(chat) > budget) {
    const u = unita(messaggi, ultimoUtente + 1, messaggi.length - 3);
    if (!u) break;
    const giaNota = messaggi[ultimoUtente + 1]?.content === NOTA;
    messaggi.splice(u[0], u[1] - u[0], ...(giaNota ? [] : [{ role: "user", content: NOTA }]));
  }
  // 6. Le uscite rimaste, ancora più corte.
  if (stimaToken(chat) > budget)
    messaggi.forEach((m, i) => {
      if (i > ultimoUtente && m.role === "tool" && typeof m.content === "string") m.content = accorcia(m.content, 600);
    });
  // 7. Se resta poco sopra, la risposta si accorcia (non sotto 1.200 token).
  const dopo = stimaToken(chat);
  if (dopo > budget) chat.max_tokens = Math.max(1200, Math.min(chat.max_tokens, massimoToken - dopo));
  // 8. Se non entra ancora, è la richiesta della persona (o un suo allegato) a
  // essere troppo lunga: non si taglia di nascosto, si dice prima di mandarla
  // (settimo collaudo, CT-2.0-603).
  return { prima, dopo, entra: dopo + chat.max_tokens <= massimoToken };
}
