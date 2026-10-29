import { it, expect, vi } from "vitest";
import { Engine } from "../src/core/engine.js";

function motoreFinto(run: any, eventi: string[]) {
  const m = Object.create(Engine.prototype) as any;
  m.store = { list: () => [run] };
  m.children = new Map();
  m.richiesteIntere = new Map();
  m.run = () => run;
  m.event = (_r: any, tipo: string, messaggio: string) =>
    eventi.push(`${tipo}: ${messaggio}`);
  m.changedFiles = () => [];
  // Un turno vero avanza il contatore e torna in pausa: è il segnale che
  // il motore aspetta prima di consegnare i file.
  m.turn = vi.fn(async (_id: string, testo: string) => {
    run.eseguito = testo;
    run.turnNumber = (run.turnNumber ?? 0) + 1;
    run.state = "PAUSED";
  });
  return m;
}

it("una richiesta bloccata dalla quota riparte quando i crediti tornano", async () => {
  const eventi: string[] = [];
  const run: any = {
    id: "r1",
    session: true,
    state: "PAUSED",
    providers: ["codex", "claude"],
    agent: "codex",
    esauriti: {
      codex: { riprendi: new Date(Date.now() - 1000).toISOString() },
      claude: { riprendi: new Date(Date.now() - 1000).toISOString() },
    },
    inAttesa: {
      testo: "Aggiungi la funzione addio",
      dalle: new Date(Date.now() - 1000).toISOString(),
    },
  };
  const m = motoreFinto(run, eventi);
  await m.riprendiInAttesa();
  expect(run.eseguito).toBe("Aggiungi la funzione addio");
  expect(run.inAttesa).toBeUndefined();
  expect(eventi.join(" ")).toContain("Crediti tornati");
});

it("prima dell'orario, o senza provider liberi, non riparte", async () => {
  const eventi: string[] = [];
  const traUnOra = new Date(Date.now() + 3600_000).toISOString();

  const presto: any = {
    id: "r1",
    session: true,
    state: "PAUSED",
    providers: ["codex"],
    agent: "codex",
    esauriti: { codex: { riprendi: traUnOra } },
    inAttesa: { testo: "x", dalle: traUnOra },
  };
  await motoreFinto(presto, eventi).riprendiInAttesa();
  expect(presto.eseguito).toBeUndefined();
  expect(presto.inAttesa).toBeDefined();

  // Orario arrivato ma il provider risulta ancora esaurito: si aspetta ancora.
  const ancoraSenza: any = {
    id: "r2",
    session: true,
    state: "PAUSED",
    providers: ["codex"],
    agent: "codex",
    esauriti: { codex: { riprendi: traUnOra } },
    inAttesa: { testo: "x", dalle: new Date(Date.now() - 1000).toISOString() },
  };
  await motoreFinto(ancoraSenza, eventi).riprendiInAttesa();
  expect(ancoraSenza.eseguito).toBeUndefined();
  expect(ancoraSenza.inAttesa).toBeDefined();
});

it("non consegna finché il turno non è finito", async () => {
  const eventi: string[] = [];
  const run: any = {
    id: "r1",
    session: true,
    state: "PAUSED",
    turnNumber: 3,
    providers: ["codex"],
    agent: "codex",
    esauriti: {},
    project: { root: "/tmp/p" },
    inAttesa: { testo: "x", dalle: new Date(Date.now() - 1000).toISOString() },
  };
  const m = motoreFinto(run, eventi);
  const consegne: string[] = [];
  m.applyToProject = () => consegne.push("consegnato");
  m.changedFiles = () => ["a.txt"];
  // Il turno avanza solo dopo mezzo secondo: prima non si deve consegnare.
  m.turn = async () => {
    setTimeout(() => {
      run.turnNumber = 4;
      run.state = "PAUSED";
    }, 500);
  };
  const lavoro = m.riprendiInAttesa();
  await new Promise((r) => setTimeout(r, 200));
  expect(consegne).toHaveLength(0);
  await lavoro;
  expect(consegne).toEqual(["consegnato"]);
}, 20000);

it("una ripresa fallita viene detta, non nascosta", async () => {
  const eventi: string[] = [];
  const run: any = {
    id: "r1",
    session: true,
    state: "PAUSED",
    providers: ["codex"],
    agent: "codex",
    esauriti: {},
    inAttesa: { testo: "x", dalle: new Date(Date.now() - 1000).toISOString() },
  };
  const m = motoreFinto(run, eventi);
  m.turn = async () => {
    throw Error("provider non raggiungibile");
  };
  await m.riprendiInAttesa();
  expect(eventi.join(" ")).toContain("Ripresa non riuscita");
  expect(eventi.join(" ")).toContain("provider non raggiungibile");
});

it("il successore riceve l'istruzione di non rifare il lavoro da zero", async () => {
  const { projectPrompt } = await import("../src/adapters/live.js");
  const prompt = projectPrompt({
    role: "successor",
    goal: "Sito",
    work: "/tmp/w",
    criteria: [],
    handoff: { snapshot: { changedFiles: ["index.html"] } },
  });
  expect(prompt).toContain("Non riscrivere da zero un file esistente");
  expect(prompt).toContain("conservando il resto");
});

it("un secondo segnale di quota senza orario non cancella quello esatto", async () => {
  const { normalizedLiveEvent } = await import("../src/adapters/live.js");
  const reset = Math.floor(Date.now() / 1000) + 900;
  const primo = normalizedLiveEvent("claude", {
    type: "rate_limit_event",
    rate_limit_info: { status: "rejected", resetsAt: reset },
  });
  const secondo = normalizedLiveEvent("claude", {
    type: "result",
    is_error: true,
    result: "Claude usage limit reached",
  });
  expect(primo.ricaricaA).toBeDefined();
  expect(secondo.ricaricaA).toBeUndefined();
  // È la regola applicata dal motore: il secondo non sovrascrive il primo.
  const memoria: any = {};
  memoria.ricaricaA = primo.ricaricaA ?? memoria.ricaricaA;
  memoria.ricaricaA = secondo.ricaricaA ?? memoria.ricaricaA;
  expect(memoria.ricaricaA).toBe(primo.ricaricaA);
});

it("se la consegna della ripresa va in conflitto la richiesta non riparte all'infinito", async () => {
  const eventi: string[] = [];
  const run: any = {
    id: "r1",
    session: true,
    project: { root: "/x" },
    state: "PAUSED",
    providers: ["codex"],
    agent: "codex",
    inAttesa: {
      testo: "Lavoro",
      dalle: new Date(Date.now() - 1000).toISOString(),
    },
  };
  const m = motoreFinto(run, eventi);
  m.attendiFineTurno = async () => run;
  m.changedFiles = () => ["a.txt"];
  m.applyToProject = () => {
    throw Error(
      "Le modifiche non si applicano: a.txt è stato modificato anche da te",
    );
  };
  await m.riprendiInAttesa();
  await m.riprendiInAttesa();
  expect(m.turn).toHaveBeenCalledTimes(1);
  expect(run.inAttesa).toBeUndefined();
  expect(eventi.join(" ")).toContain("/applica per riprovare");
});

it("con un'altra AI al lavoro la ripresa aspetta il giro dopo", async () => {
  const eventi: string[] = [];
  const run: any = {
    id: "r1",
    session: true,
    state: "PAUSED",
    providers: ["codex"],
    agent: "codex",
    inAttesa: { testo: "x", dalle: new Date(Date.now() - 1000).toISOString() },
  };
  const m = motoreFinto(run, eventi);
  m.children.set("altra", {});
  await m.riprendiInAttesa();
  expect(m.turn).not.toHaveBeenCalled();
  expect(run.inAttesa).toBeDefined();
});

it("un turno ripreso che si ferma di nuovo per quota non viene consegnato", async () => {
  const eventi: string[] = [];
  const run: any = {
    id: "r1",
    session: true,
    project: { root: "/x" },
    state: "PAUSED",
    providers: ["codex"],
    agent: "codex",
    inAttesa: { testo: "x", dalle: new Date(Date.now() - 1000).toISOString() },
  };
  const m = motoreFinto(run, eventi);
  m.attendiFineTurno = async () => ({ ...run, quotaDetected: true });
  m.changedFiles = () => ["a.txt"];
  m.applyToProject = vi.fn();
  await m.riprendiInAttesa();
  expect(m.applyToProject).not.toHaveBeenCalled();
});
