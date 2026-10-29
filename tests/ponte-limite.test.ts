// Il ponte stringe le richieste per i servizi con un limite piccolo (Groq
// gratuito, 28 ottobre): la prova di Lorenzo falliva con «request too large»
// alla prima volta di Groq in una sessione di 17 turni.
import { it, expect } from "vitest";
import { stimaToken, stringiPerIlLimite } from "../src/ponte/limite.js";

function richiestaLunga(): any {
  const storia = Array.from({ length: 60 }, (_, i) => `  [${i % 2 ? "AI nvidia" : "utente"}] messaggio vecchio numero ${i} ` + "parole ".repeat(60));
  const messaggi: any[] = [
    { role: "system", content: "Istruzioni di Codex. " + "regola ".repeat(300) },
    { role: "user", content: ["Obiettivo della sessione: prova", "", "Conversazione finora:", ...storia, "", "Richiesta corrente: crea ricetta.txt", "", "Regole comuni di Continuity."].join("\n") },
  ];
  for (let i = 0; i < 6; i++) {
    messaggi.push({ role: "assistant", content: null, tool_calls: [{ id: `c${i}`, type: "function", function: { name: "exec_command", arguments: `{"cmd":"cat file${i}"}` } }] });
    messaggi.push({ role: "tool", tool_call_id: `c${i}`, content: `uscita ${i} ` + "riga di file\n".repeat(900) });
  }
  return { model: "openai/gpt-oss-120b", messages: messaggi, tools: [{ type: "function", function: { name: "apply_patch", parameters: {} } }] };
}

it("una richiesta troppo grande per Groq entra nel limite, e restano istruzioni, richiesta corrente e ultimi passi", () => {
  const chat = richiestaLunga();
  const { prima, dopo } = stringiPerIlLimite(chat, 7000);
  expect(prima).toBeGreaterThan(20_000);
  expect(chat.max_tokens).toBe(2450);
  expect(dopo).toBeLessThanOrEqual(7000 - 2450);
  expect(stimaToken(chat)).toBe(dopo);
  const m: any[] = chat.messages;
  expect(m[0].content).toMatch(/^Istruzioni di Codex/);
  expect(m[1].content).toMatch(/Richiesta corrente: crea ricetta\.txt/);
  expect(m[1].content).toMatch(/Regole comuni di Continuity/);
  // Le righe più recenti della conversazione restano, le più vecchie no.
  expect(m[1].content).toMatch(/messaggio vecchio numero 59/);
  expect(m[1].content).not.toMatch(/messaggio vecchio numero 0 /);
  // L'ultimo passo resta, e ogni risultato segue la sua chiamata.
  expect(m.at(-1)).toMatchObject({ role: "tool", tool_call_id: "c5" });
  m.forEach((x, i) => {
    if (x.role === "tool") expect(m.slice(0, i).some((y) => y.tool_calls?.some((c: any) => c.id === x.tool_call_id))).toBe(true);
  });
  expect(JSON.stringify(m)).toMatch(/tolta una parte più vecchia/);
});

it("una richiesta che sta nel limite non si tocca, salvo la lunghezza della risposta", () => {
  const chat: any = { messages: [{ role: "system", content: "breve" }, { role: "user", content: "ciao" }], max_tokens: 9000 };
  const copia = JSON.stringify(chat.messages);
  const { prima, dopo } = stringiPerIlLimite(chat, 7000);
  expect(dopo).toBe(prima);
  expect(JSON.stringify(chat.messages)).toBe(copia);
  expect(chat.max_tokens).toBe(2450);
});

it("la sessione ripresa di Groq (prova di Lorenzo): i messaggi dei tentativi falliti e le risposte su più righe si tolgono", () => {
  const prompt = (n: number) =>
    [
      `Obiettivo: Sessione di lavoro (tentativo ${n})`,
      "Conversazione finora:",
      ...Array.from({ length: 30 }, (_, i) => `  [AI qwen] risposta ${n}.${i}\n` + "una riga della risposta su più righe\n".repeat(25)),
      "",
      `Richiesta corrente: scrivi la ricetta (tentativo ${n})`,
      "",
      "Regole comuni.",
    ].join("\n");
  const chat: any = {
    messages: [
      { role: "system", content: "Istruzioni di Codex." },
      { role: "user", content: "<environment_context>…</environment_context>" },
      { role: "user", content: prompt(1) },
      { role: "user", content: prompt(2) },
      { role: "user", content: prompt(3) },
    ],
  };
  const { prima, dopo } = stringiPerIlLimite(chat, 7000);
  expect(prima).toBeGreaterThan(20_000);
  expect(dopo + chat.max_tokens).toBeLessThanOrEqual(7000);
  const m = chat.messages;
  expect(m[1].content).toMatch(/environment_context/);
  expect(m[2].content).toMatch(/tolta una parte più vecchia/);
  expect(m[4].content).toMatch(/Richiesta corrente: scrivi la ricetta \(tentativo 3\)/);
  expect(m[4].content).toMatch(/Regole comuni/);
  // Nessun pezzo di risposta orfano: le voci tolte spariscono intere.
  const restano = (m[4].content.match(/risposta 3\.\d+/g) ?? []).length;
  expect((m[4].content.match(/una riga della risposta/g) ?? []).length).toBe(restano * 25);
});

it("la testa resta identica fra le richieste di un turno, così Groq la tiene in cache e non la conta nel limite", () => {
  const prompt = ["Obiettivo: prova", "Conversazione finora:", ...Array.from({ length: 40 }, (_, i) => `  [utente] voce ${i} ` + "parole ".repeat(80)), "", "Richiesta corrente: scrivi la ricetta", "", "Regole."].join("\n");
  const inizio = () => [
    { role: "system", content: "Istruzioni di Codex. " + "regola ".repeat(200) },
    { role: "user", content: "<environment_context>…</environment_context>" },
    { role: "user", content: prompt },
  ];
  const passo = (i: number) => [
    { role: "assistant", content: null, tool_calls: [{ id: `c${i}`, type: "function", function: { name: "exec_command", arguments: "{}" } }] },
    { role: "tool", tool_call_id: `c${i}`, content: `uscita ${i} ` + "riga\n".repeat(1500) },
  ];
  const strumenti = [{ type: "function", function: { name: "apply_patch", parameters: {} } }];
  const prima: any = { messages: [...inizio(), ...passo(0)], tools: strumenti };
  const dopo: any = { messages: [...inizio(), ...passo(0), ...passo(1), ...passo(2), ...passo(3)], tools: strumenti };
  stringiPerIlLimite(prima, 7000);
  stringiPerIlLimite(dopo, 7000);
  expect(stimaToken(dopo) + dopo.max_tokens).toBeLessThanOrEqual(7000);
  expect(JSON.stringify(dopo.messages.slice(0, 3))).toBe(JSON.stringify(prima.messages.slice(0, 3)));
  expect(dopo.messages[2].content).toMatch(/Richiesta corrente: scrivi la ricetta/);
});
