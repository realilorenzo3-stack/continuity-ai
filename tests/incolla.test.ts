import { it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { runSession, riassunto } from "../src/cli/session.js";

function lettore() {
  const rl: any = new EventEmitter();
  rl.setPrompt = () => {};
  rl.prompt = () => {};
  rl.close = () => rl.emit("close");
  return rl;
}
const scritto: string[] = [];
const originale = process.stdout.write.bind(process.stdout);
const zitto = () => {
  process.stdout.write = ((t: string) => {
    scritto.push(String(t));
    return true;
  }) as any;
};
afterEach(() => {
  process.stdout.write = originale;
  scritto.length = 0;
});
const attendi = (ms: number) => new Promise((r) => setTimeout(r, ms));

it("un testo incollato diventa un turno solo, non uno per riga", async () => {
  zitto();
  const turni: string[] = [];
  const api = vi.fn(async (path: string, body?: any) => {
    if (path.includes("/turn")) {
      turni.push(body.text);
      return {};
    }
    if (path.includes("/events"))
      return {
        events: [
          { seq: 1, type: "turn.completed", payload: { message: "ok" } },
        ],
      };
    if (path.includes("/changed")) return { files: [] };
    return {
      agent: "codex",
      providers: ["codex"],
      createdAt: new Date().toISOString(),
    };
  });
  const rl = lettore();
  const sessione = runSession(api as any, "r1", [], rl);
  await attendi(50);
  for (const riga of ["Fai una cosa:", "- primo punto", "- secondo punto", ""])
    rl.emit("line", riga);
  await attendi(400);
  rl.emit("line", "/esci");
  await attendi(300);
  rl.close();
  await sessione;

  expect(turni).toHaveLength(1);
  expect(turni[0]).toContain("Fai una cosa:");
  expect(turni[0]).toContain("- secondo punto");
}, 20000);

it("senza crediti i messaggi in coda vengono messi da parte, non spesi uno a uno", async () => {
  zitto();
  const turni: string[] = [];
  const api = vi.fn(async (path: string, body?: any) => {
    if (path.includes("/turn")) {
      turni.push(body.text);
      return {};
    }
    if (path.includes("/events")) {
      // Il turno dura: è mentre l'AI lavora che si continua a scrivere.
      await attendi(600);
      return {
        events: [
          {
            seq: 1,
            type: "turn.blocked",
            payload: { message: "Tutti i provider sono senza crediti" },
          },
        ],
      };
    }
    if (path.includes("/changed")) return { files: [] };
    return {
      agent: "codex",
      providers: ["codex"],
      createdAt: new Date().toISOString(),
    };
  });
  const rl = lettore();
  const sessione = runSession(api as any, "r1", [], rl);
  await attendi(50);
  rl.emit("line", "prima richiesta");
  await attendi(200);
  for (const testo of ["seconda", "terza", "quarta"]) {
    rl.emit("line", testo);
    await attendi(120);
  }
  await attendi(700);
  rl.close();
  await sessione;

  expect(turni).toEqual(["prima richiesta"]);
  expect(scritto.join("")).toContain("messi da parte");
}, 20000);

it("di un blocco lungo si mostra la prima riga e quante sono", () => {
  expect(riassunto("una riga sola")).toBe("una riga sola");
  const lungo = riassunto(["titolo", "", "- a", "- b"].join("\n"));
  expect(lungo).toContain("titolo");
  expect(lungo).toContain("(3 righe)");
});

it("un documento incollato a raffiche resta un messaggio solo", async () => {
  zitto();
  const turni: string[] = [];
  const api = vi.fn(async (path: string, body?: any) => {
    if (path.includes("/turn")) {
      turni.push(body.text);
      return {};
    }
    if (path.includes("/events"))
      return {
        events: [
          { seq: 1, type: "turn.completed", payload: { message: "ok" } },
        ],
      };
    if (path.includes("/live")) return { parziale: "" };
    if (path.includes("/changed")) return { files: [] };
    return {
      agent: "codex",
      providers: ["codex"],
      createdAt: new Date().toISOString(),
    };
  });
  const rl = lettore();
  const sessione = runSession(api as any, "r1", [], rl);
  await attendi(50);
  // Un incolla vero arriva a blocchi: molte righe insieme, poi una pausa
  // mentre il terminale consegna il pezzo successivo.
  for (const blocco of [
    ["# Specifica", "", "## Obiettivo", "Costruire il sito"],
    ["", "## Sezioni", "- intestazione", "- contatti"],
    ["", "Fine del documento"],
  ]) {
    for (const riga of blocco) rl.emit("line", riga);
    await attendi(300);
  }
  await attendi(900);
  rl.emit("line", "/esci");
  await attendi(300);
  rl.close();
  await sessione;

  expect(turni).toHaveLength(1);
  expect(turni[0]).toContain("# Specifica");
  expect(turni[0]).toContain("Fine del documento");
  expect(turni[0].split("\n")).toHaveLength(10);
}, 20000);

it("righe scritte a mano restano messaggi distinti", async () => {
  zitto();
  const turni: string[] = [];
  const api = vi.fn(async (path: string, body?: any) => {
    if (path.includes("/turn")) {
      turni.push(body.text);
      return {};
    }
    if (path.includes("/events"))
      return {
        events: [
          { seq: 1, type: "turn.completed", payload: { message: "ok" } },
        ],
      };
    if (path.includes("/live")) return { parziale: "" };
    if (path.includes("/changed")) return { files: [] };
    return {
      agent: "codex",
      providers: ["codex"],
      createdAt: new Date().toISOString(),
    };
  });
  const rl = lettore();
  const sessione = runSession(api as any, "r1", [], rl);
  await attendi(50);
  // Chi digita manda una riga alla volta: non vanno fuse fra loro.
  rl.emit("line", "prima richiesta");
  await attendi(400);
  rl.emit("line", "seconda richiesta");
  await attendi(400);
  rl.emit("line", "/esci");
  await attendi(300);
  rl.close();
  await sessione;

  expect(turni).toEqual(["prima richiesta", "seconda richiesta"]);
}, 20000);

it("ciò che si scrive durante l'avvio non va perso", async () => {
  zitto();
  const turni: string[] = [];
  const api = vi.fn(async (path: string, body?: any) => {
    if (path.includes("/turn")) {
      turni.push(body.text);
      return {};
    }
    if (path.includes("/events"))
      return {
        events: [
          { seq: 1, type: "turn.completed", payload: { message: "ok" } },
        ],
      };
    if (path.includes("/live")) return { parziale: "" };
    if (path.includes("/changed")) return { files: [] };
    return {
      agent: "codex",
      providers: ["codex"],
      createdAt: new Date().toISOString(),
    };
  });
  const rl = lettore();
  // Righe scritte mentre il servizio si avviava: la sessione le riceve già in coda.
  const anticipate = ["prima di tutto sistema il carrello"];
  const sessione = runSession(api as any, "r1", [], rl, anticipate);
  await attendi(400);
  rl.emit("line", "/esci");
  await attendi(300);
  rl.close();
  await sessione;

  expect(turni).toEqual(["prima di tutto sistema il carrello"]);
}, 20000);

it("un menu non consuma la richiesta che aspetta in coda", async () => {
  zitto();
  const turni: string[] = [];
  const api = vi.fn(async (path: string, body?: any) => {
    if (path.includes("/turn")) {
      turni.push(body.text);
      return {};
    }
    if (path.includes("/events")) {
      await attendi(500);
      return {
        events: [
          { seq: 1, type: "turn.completed", payload: { message: "ok" } },
        ],
      };
    }
    if (path.includes("/live")) return { parziale: "" };
    if (path.includes("/changed")) return { files: [] };
    return {
      agent: "codex",
      providers: ["codex", "claude"],
      modelli: {},
      createdAt: new Date().toISOString(),
    };
  });
  const rl = lettore();
  const sessione = runSession(api as any, "r1", [], rl);
  await attendi(50);
  rl.emit("line", "/modello");
  await attendi(200);
  // Mentre il menu è aperto arriva una richiesta vera: è per l'AI, non è una
  // risposta al menu, e non deve essere consumata come tale.
  rl.emit("line", "aggiungi i test al carrello");
  await attendi(200);
  rl.emit("line", "2");
  await attendi(200);
  rl.emit("line", "1");
  await attendi(900);
  rl.emit("line", "/esci");
  await attendi(300);
  rl.close();
  await sessione;

  expect(turni).toContain("aggiungi i test al carrello");
}, 25000);

// Il 29 settembre e il 1° ottobre una specifica incollata è partita da sola a
// metà: l'ultima riga è rimasta nella casella per tutto il turno, occupandola,
// e la persona non trovava più dove scrivere. Con i marcatori del terminale
// ciò che si incolla aspetta l'invio, qualunque pausa ci sia in mezzo.
it("un testo incollato aspetta l'invio, anche se arriva a pezzi", async () => {
  zitto();
  const turni: string[] = [];
  const api = vi.fn(async (path: string, body?: any) => {
    if (path.includes("/turn")) {
      turni.push(body.text);
      return {};
    }
    if (path.includes("/events"))
      return {
        events: [
          { seq: 1, type: "turn.completed", payload: { message: "ok" } },
        ],
      };
    if (path.includes("/changed")) return { files: [] };
    return {
      agent: "codex",
      providers: ["codex"],
      createdAt: new Date().toISOString(),
    };
  });
  const rl = lettore();
  const sessione = runSession(api as any, "r1", [], rl);
  await attendi(50);
  process.stdin.emit("keypress", "", { name: "paste-start" });
  rl.emit("line", "Sezione 1 della specifica");
  await attendi(2500); // una pausa a metà incollaggio, più lunga di ogni finestra
  rl.emit("line", "Sezione 2 della specifica");
  process.stdin.emit("keypress", "", { name: "paste-end" });
  await attendi(2500);
  // Nessun invio: non deve essere partito niente.
  expect(turni).toHaveLength(0);
  // L'invio spedisce tutto, con l'ultima riga rimasta nella casella.
  rl.emit("line", "ULTIMA RIGA");
  await attendi(400);
  expect(turni).toHaveLength(1);
  expect(turni[0]).toContain("Sezione 1 della specifica");
  expect(turni[0]).toContain("ULTIMA RIGA");
  // E dopo il turno si può scrivere ancora.
  rl.emit("line", "secondo prompt");
  await attendi(400);
  expect(turni).toEqual([expect.any(String), "secondo prompt"]);
  rl.emit("line", "/esci");
  await attendi(300);
  rl.close();
  await sessione;
}, 30000);

// Collaudo del 3 ottobre, CT-002: un turno fallito veniva consegnato come
// fosse concluso. Il terminale non deve portare nella cartella un lavoro a metà.
it("dopo un turno fallito non consegna nulla nella cartella", async () => {
  zitto();
  const chiamate: string[] = [];
  const api = vi.fn(async (path: string) => {
    chiamate.push(path);
    if (path.includes("/turn")) return {};
    if (path.includes("/events"))
      return {
        events: [
          {
            seq: 1,
            type: "turn.failed",
            payload: { message: "Turno interrotto: uscita 7" },
          },
        ],
      };
    if (path.includes("/changed")) return { files: ["failed-output.txt"] };
    return {
      agent: "codex",
      providers: ["codex"],
      createdAt: new Date().toISOString(),
    };
  });
  const rl = lettore();
  const sessione = runSession(api as any, "r1", [], rl);
  await attendi(50);
  rl.emit("line", "fai qualcosa");
  await attendi(600);
  rl.emit("line", "/esci");
  await attendi(300);
  rl.close();
  await sessione;
  expect(chiamate.some((c) => c.includes("/apply"))).toBe(false);
  expect(scritto.join("")).toContain("Turno interrotto");
}, 20000);

// Collaudo del 3 ottobre, CT-011: Ctrl+C non interrompeva il turno. Ora lo
// interrompe alla seconda pressione entro 3 secondi, e non consegna nulla.
it("Ctrl+C due volte interrompe il turno, una volta sola no", async () => {
  zitto();
  const azioni: any[] = [];
  let fermato = false;
  const api = vi.fn(async (path: string, body?: any) => {
    if (path.includes("/actions")) {
      azioni.push(body);
      fermato = true;
      return {};
    }
    if (path.includes("/turn")) return {};
    if (path.includes("/events"))
      return {
        events: fermato
          ? [{ seq: 1, type: "run.paused", payload: { message: "In pausa" } }]
          : [],
      };
    if (path.includes("/changed")) return { files: ["mezzo.txt"] };
    return {
      agent: "codex",
      providers: ["codex"],
      version: 7,
      turnNumber: 1,
      state: fermato ? "PAUSED" : "RUNNING",
      createdAt: new Date().toISOString(),
    };
  });
  const rl = lettore();
  const sessione = runSession(api as any, "r1", [], rl);
  await attendi(50);
  rl.emit("line", "lavoro lungo");
  await attendi(400);
  rl.emit("SIGINT");
  await attendi(400);
  expect(azioni).toHaveLength(0);
  expect(scritto.join("")).toContain("Premi di nuovo Ctrl+C");
  rl.emit("SIGINT");
  await attendi(800);
  expect(azioni).toEqual([{ action: "pause", expectedVersion: 7 }]);
  expect(scritto.join("")).toContain("Turno interrotto da te");
  // Non consegna il lavoro a metà, e la sessione resta utilizzabile.
  expect(api.mock.calls.some(([p]) => String(p).includes("/apply"))).toBe(
    false,
  );
  rl.emit("SIGINT"); // fuori da un turno: esce
  await sessione;
}, 20000);
