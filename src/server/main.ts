import {
  assicuraOllama,
  binarioOllama,
  leggiIbrida,
  modelliSulDisco,
  salvaIbrida,
  statoOllama,
} from "../core/ibrida.js";
import { providerNoto } from "../core/provider.js";
import { spawnSync } from "node:child_process";
import { LIMITE_RICHIESTA } from "../core/limiti.js";
import { improntaApp } from "../core/build.js";
import { exportRun } from "../handoff/export.js";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
  rmSync,
  statSync,
  readFileSync,
} from "node:fs";
import { z } from "zod";
import { Store } from "../persistence/store.js";
import { Engine } from "../core/engine.js";
import { leggiFlussi, salvaFlussi } from "../core/flussi.js";
import {
  inspectProject,
  openProject,
  stessaCartella,
} from "../core/project.js";
import { cartellaDatiPredefinita } from "../piattaforma.js";
import { migraDati } from "../core/migrazioni.js";
const root = resolve(cartellaDatiPredefinita());
mkdirSync(root, { recursive: true, mode: 0o700 });
const lock = join(root, "server.lock");
// Un lock lasciato da un servizio morto (crash, SIGKILL, spegnimento) non deve
// impedire di ripartire: prima serviva rimuoverlo a mano (collaudo del 3
// ottobre, CT-001). Si toglie solo se il processo che l'ha scritto non esiste
// più o non è un servizio Continuity.
try {
  const testo = readFileSync(lock, "utf8");
  // Un lock vuoto o illeggibile è rimasto da un crash fra la creazione e la
  // scrittura: dopo qualche secondo non può più appartenere a un avvio in
  // corso. Prima lo si lascia, perché due servizi che partono insieme non si
  // tolgano a vicenda un lock appena creato.
  if (!testo.trim()) {
    if (Date.now() - statSync(lock).mtimeMs > 10_000)
      rmSync(lock, { force: true });
    throw Error("lock vuoto");
  }
  const vecchio = JSON.parse(testo);
  let vivo = false;
  if (Number.isSafeInteger(vecchio.pid) && vecchio.pid !== process.pid) {
    const ps = spawnSync("ps", ["-o", "command=", "-p", String(vecchio.pid)], {
      encoding: "utf8",
      timeout: 5000,
    });
    vivo = ps.error ? true : ps.stdout.includes("server/main.ts");
  }
  if (!vivo) rmSync(lock, { force: true });
} catch {}
try {
  const fd = openSync(lock, "wx", 0o600);
  writeFileSync(
    fd,
    JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
  );
  closeSync(fd);
} catch {
  console.error(
    "Continuity ha un lock esistente. Verificare il processo prima della rimozione manuale: " +
      lock,
  );
  process.exit(4);
}
// Il formato dei dati, prima di aprire il database: copia di sicurezza e
// conversioni dopo un aggiornamento (src/core/migrazioni.ts).
try {
  migraDati(root);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  try {
    unlinkSync(lock);
  } catch {}
  process.exit(5);
}
const store = new Store(root),
  engine = new Engine(store),
  app = Fastify({ logger: false, bodyLimit: 32768 });
const token = randomBytes(32).toString("hex"),
  bootstrap = randomBytes(32).toString("hex"),
  apiToken = randomBytes(32).toString("hex");
const tickets = new Set<string>([bootstrap]);
const port = Number(process.env.PORT ?? 4317),
  origin = `http://127.0.0.1:${port}`;
app.addHook("onRequest", async (req, reply) => {
  if (req.headers.host !== `127.0.0.1:${port}`)
    return reply
      .code(403)
      .send({ code: "HOST_DENIED", message: "Host non autorizzato" });
  if (req.headers.origin && req.headers.origin !== origin)
    return reply
      .code(403)
      .send({ code: "ORIGIN_DENIED", message: "Origin non autorizzata" });
  // Si decide sulla rotta già risolta da Fastify, non sull'indirizzo grezzo:
  // «/%61pi/v1/runs» porta alla stessa rotta di «/api/v1/runs» e scavalcava
  // il controllo. Per prudenza vale anche il percorso decodificato.
  const rotta = req.routeOptions?.url ?? "";
  let percorso = req.url.split("?")[0];
  try {
    percorso = decodeURIComponent(percorso);
  } catch {}
  const libere = ["/api/v1/health", "/api/v1/session"];
  if (
    (rotta.startsWith("/api/") || percorso.toLowerCase().startsWith("/api/")) &&
    !(libere.includes(rotta) && libere.includes(percorso))
  ) {
    if (
      !req.headers.cookie
        ?.split("; ")
        .includes("continuity_session=" + token) &&
      req.headers.authorization !== "Bearer " + apiToken
    )
      return reply.code(401).send({
        code: "SESSION_REQUIRED",
        message: "Aprire Continuity tramite il link locale di avvio",
      });
    if (
      req.method !== "GET" &&
      req.headers["x-continuity-csrf"] !== "same-origin"
    )
      return reply.code(403).send({ code: "CSRF", message: "Protezione CSRF" });
  }
});
// «occupato» dice se un'AI sta lavorando o un turno si sta chiudendo: chi
// aggiorna Continuity deve saperlo, per non interrompere un lavoro in corso.
app.get("/api/v1/health", async () => ({
  status: "ok",
  occupato: engine.occupato(),
}));
app.post("/api/v1/session", async (req, reply) => {
  const b = z.object({ token: z.string() }).parse(req.body);
  if (!tickets.has(b.token))
    return reply
      .code(403)
      .send({ message: "Token bootstrap non valido o già usato" });
  tickets.delete(b.token);
  reply.header(
    "set-cookie",
    `continuity_session=${token}; HttpOnly; SameSite=Strict; Path=/`,
  );
  return { ok: true };
});
app.post("/api/v1/session/tickets", async (req, reply) => {
  if (req.headers.authorization !== "Bearer " + apiToken)
    return reply.code(403).send({ message: "Richiesto client locale" });
  if (tickets.size >= 10) tickets.delete(tickets.values().next().value!);
  const ticket = randomBytes(32).toString("hex");
  tickets.add(ticket);
  return { url: origin + "/#bootstrap=" + ticket };
});
app.get("/api/v1/runs", async () =>
  store.list(100).map((r) => engine.current(r.id)),
);
app.get("/api/v1/runs/:id", async (req: any, reply) => {
  const run = store.get(req.params.id) ? engine.current(req.params.id) : null;
  return run ?? reply.code(404).send({ message: "Run non trovata" });
});
// Ciò che l'AI sta scrivendo in questo momento, senza passare dal registro:
// è un'anteprima, non un fatto da conservare.
app.get("/api/v1/runs/:id/live", async (req: any, reply) => {
  if (!store.get(req.params.id))
    return reply.code(404).send({ message: "Run non trovata" });
  return {
    parziale: engine.parziali.get(req.params.id) ?? "",
    attivita: engine.attivita?.get(req.params.id) ?? "",
    // Da quanti secondi l'AI non dà segni di vita, e su che cosa era.
    fermoDa: engine.children.has(req.params.id) && engine.ultimoSegno.has(req.params.id)
      ? Math.round((Date.now() - engine.ultimoSegno.get(req.params.id)!) / 1000)
      : 0,
    ultimaAzione: engine.ultimaAzione.get(req.params.id) ?? "",
    // Un'azione fuori dal progetto in attesa della risposta della persona.
    permesso: engine.permessoInAttesa(req.params.id) ?? null,
  };
});
const streams = new Set<import("node:http").ServerResponse>();
app.get("/api/v1/runs/:id/events", async (req: any, reply) => {
  if (!store.get(req.params.id))
    return reply.code(404).send({ message: "Run non trovata" });
  let seq = Number(req.query.afterSeq ?? req.headers["last-event-id"] ?? 0);
  if (!Number.isSafeInteger(seq) || seq < 0)
    return reply.code(400).send({ message: "Cursor non valido" });
  if (req.headers.accept === "application/json")
    return { events: store.events(req.params.id, seq) };
  reply.hijack();
  streams.add(reply.raw);
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const send = () => {
    for (const e of store.events(req.params.id, seq)) {
      reply.raw.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
      seq = e.seq;
    }
    reply.raw.write(": heartbeat\n\n");
  };
  send();
  const timer = setInterval(send, 500);
  req.raw.on("close", () => {
    clearInterval(timer);
    streams.delete(reply.raw);
  });
});
let mutating = 0;
async function mutation(req: any, reply: any, fn: () => Promise<any>) {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key.length > 200)
    return reply.code(400).send({ message: "Idempotency-Key obbligatoria" });
  // Basta un'impronta per riconoscere una richiesta ripetuta: il corpo
  // intero (un prompt fino a 200.000 caratteri, con ciò che vi era incollato)
  // restava per sempre nel database, senza oscuramento.
  const body = createHash("sha256")
    .update(JSON.stringify({ url: req.url, body: req.body }))
    .digest("hex");
  const prior = store.db.prepare("SELECT * FROM requests WHERE key=?").get(key);
  if (prior) {
    if (prior.body !== body)
      return reply
        .code(409)
        .send({ message: "Chiave riutilizzata con richiesta diversa" });
    const saved = JSON.parse(String(prior.result));
    if (saved.pending)
      return reply.code(409).send({
        message:
          "Intent persistito in corso o interrotto: non viene rilanciato",
      });
    reply.code(saved.status);
    return saved.body;
  }
  if (mutating) return reply.code(409).send({ message: "Mutazione in corso" });
  mutating++;
  store.db
    .prepare("INSERT INTO requests VALUES(?,?,?)")
    .run(key, body, JSON.stringify({ pending: true }));
  try {
    const result = await fn();
    store.db
      .prepare("UPDATE requests SET result=? WHERE key=?")
      .run(JSON.stringify({ status: reply.statusCode, body: result }), key);
    return result;
  } catch (e: any) {
    const result = {
      code: "CONTINUITY_ERROR",
      message: e.message,
      retryable: false,
      evidenceIds: [],
    };
    store.db
      .prepare("UPDATE requests SET result=? WHERE key=?")
      .run(JSON.stringify({ status: 409, body: result }), key);
    return reply.code(409).send(result);
  } finally {
    mutating--;
  }
}
app.post("/api/v1/demo", async (req, reply) => {
  const body = z
    .object({
      goal: z.string().trim().min(3).max(2000),
      successor: z.enum(["gemini", "claude", "antigravity"]).default("claude"),
      project: z.string().min(1).max(4096).optional(),
      approvedCommands: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      mode: z.enum(["simulation", "live"]).default("simulation"),
    })
    .parse(req.body);
  return mutation(req, reply, async () => {
    let context;
    if (body.project) {
      const project = inspectProject(body.project);
      // The approval refers to the commands the caller was shown; if the file
      // changed in between, nothing runs.
      if (project.commandsDigest !== body.approvedCommands)
        throw Error(
          "I comandi di verifica non corrispondono a quelli approvati: rileggere continuity.json",
        );
      context = {
        root: project.root,
        head: project.head,
        branch: project.branch,
        verify: project.config.verify,
        commandsDigest: project.commandsDigest,
      };
    }
    // Live on a real project is authorised per invocation by the person typing
    // --live; the one-shot marker stays on the experimental fixture path.
    if (body.mode === "live" && !context)
      throw Error("Modalità live disponibile solo con --project");
    const run = await engine.create(
      body.goal,
      body.mode,
      body.successor,
      context,
    );
    reply.code(202);
    return run;
  });
});
// La sessione più recente di questa cartella, se è ancora riprendibile: chiudere
// il terminale non deve buttare via la conversazione.
app.get("/api/v1/sessions/last", async (req: any) => {
  const cartella = String(req.query.project ?? "");
  const ripresa = store
    .list()
    .filter(
      (r: any) =>
        r.session &&
        stessaCartella(r.project?.root, cartella) &&
        // Anche una sessione bloccata da un guasto è riprendibile: escluderla
        // lasciava la conversazione e il lavoro irraggiungibili.
        ["PAUSED", "READY", "BLOCKED"].includes(r.state) &&
        // Una sessione con la copia guasta (repository del progetto sparito)
        // non si riprende: se ne apre una nuova (26 ottobre).
        !engine.copiaInutilizzabile(r),
    )
    // Una sessione aperta per sbaglio e mai usata non deve seppellire una
    // conversazione vera: prima quelle con del lavoro dentro, poi la più recente.
    .sort((a: any, b: any) => {
      const lavoro = (r: any) => ((r.turnNumber ?? 0) > 0 ? 1 : 0);
      if (lavoro(a) !== lavoro(b)) return lavoro(b) - lavoro(a);
      return a.createdAt < b.createdAt ? 1 : -1;
    })[0];
  return ripresa
    ? {
        id: ripresa.id,
        turni: ripresa.turnNumber ?? 0,
        quando: ripresa.createdAt,
        agente: ripresa.agent,
        stato: ripresa.state,
        // Quali verifiche ha la sessione: il terminale le confronta con quelle
        // che la cartella dichiara adesso.
        verifiche: ripresa.project?.commandsDigest,
      }
    : { id: null };
});
app.post("/api/v1/sessions", async (req, reply) => {
  const body = z
    .object({
      goal: z.string().trim().min(3).max(2000),
      project: z.string().min(1).max(4096),
      approvedCommands: z.string().regex(/^[a-f0-9]{64}$/),
      providers: z
        .array(
          z
            .string()
            .refine(
              (p) => p === "antigravity" || Boolean(providerNoto(p)),
              "Provider non supportato",
            ),
        )
        .min(1)
        .max(20),
      mode: z.enum(["simulation", "live"]).default("live"),
    })
    .parse(req.body);
  return mutation(req, reply, async () => {
    const project = openProject(body.project);
    if (project.commandsDigest !== body.approvedCommands)
      throw Error(
        "I comandi di verifica non corrispondono a quelli approvati: rileggere continuity.json",
      );
    const run = await engine.create(
      body.goal,
      body.mode,
      (body.providers.find((p) => p !== "codex") ?? "claude") as any,
      {
        root: project.root,
        head: project.head,
        branch: project.branch,
        verify: project.config.verify,
        commandsDigest: project.commandsDigest,
        modificati: project.modificati,
        senzaGit: project.senzaGit,
      },
      { providers: body.providers },
    );
    reply.code(202);
    return run;
  });
});
// Alla ripresa il terminale propone le verifiche che la cartella dichiara ora.
// Il servizio le ricalcola da sé e le adotta solo se coincidono con quelle
// approvate: la stessa regola usata quando la sessione nasce.
app.post("/api/v1/runs/:id/verifiche", async (req: any, reply) => {
  const body = z
    .object({ approvedCommands: z.string().regex(/^[a-f0-9]{64}$/) })
    .parse(req.body);
  return mutation(req, reply, async () => {
    const r = engine.run(req.params.id);
    if (!r.project) throw Error("La run non lavora su un progetto");
    const project = openProject(r.project.root);
    if (project.commandsDigest !== body.approvedCommands)
      throw Error("I comandi di verifica non corrispondono a quelli approvati");
    return engine.aggiornaVerifiche(
      req.params.id,
      project.config.verify,
      project.commandsDigest,
    );
  });
});
// I connettori della sessione: letti dalle piattaforme ufficiali, accesi o
// spenti dalla persona. Continuity non ne aggiunge e non ne autentica.
app.get("/api/v1/runs/:id/connettori", async (req: any, reply) => {
  if (!store.get(req.params.id))
    return reply.code(404).send({ message: "Run non trovata" });
  const r = engine.run(req.params.id);
  const { elenco } = await engine.connettoriSessione(
    r,
    String(req.query.aggiorna ?? "") === "1",
  );
  return { elenco, spenti: r.connettoriSpenti ?? [] };
});
app.post("/api/v1/runs/:id/connettori", async (req: any, reply) => {
  const body = z
    .object({ spenti: z.array(z.string().max(300)).max(200) })
    .parse(req.body);
  return mutation(req, reply, async () =>
    engine.impostaConnettori(req.params.id, body.spenti),
  );
});
app.get("/api/v1/runs/:id/changed", async (req: any, reply) => {
  if (!store.get(req.params.id))
    return reply.code(404).send({ message: "Run non trovata" });
  const r = engine.run(req.params.id);
  return {
    files: engine.changedFiles(r),
    ...(String(req.query.stat ?? "") === "1"
      ? { stat: engine.statisticheModifiche(r) }
      : {}),
  };
});
// «forza» è sempre una scelta esplicita della persona: porta la versione
// dell'AI sopra una modifica sua, o annulla sopra un suo ritocco. Il suo lavoro
// resta comunque recuperabile.
const conForza = (body: unknown) =>
  z.object({ forza: z.boolean().optional() }).parse(body ?? {}).forza ?? false;
app.post("/api/v1/runs/:id/undo", async (req: any, reply) =>
  mutation(req, reply, async () =>
    engine.annullaUltimo(req.params.id, { forza: conForza(req.body) }),
  ),
);
app.post("/api/v1/runs/:id/apply", async (req: any, reply) =>
  mutation(req, reply, async () =>
    engine.applyToProject(req.params.id, { forza: conForza(req.body) }),
  ),
);
app.post("/api/v1/runs/:id/close", async (req: any, reply) =>
  mutation(req, reply, async () =>
    engine.closeSession(req.params.id, { forza: conForza(req.body) }),
  ),
);
app.post("/api/v1/runs/:id/model", async (req: any, reply) => {
  const body = z
    .object({
      provider: z.string(),
      model: z.string().max(80),
      forzato: z.boolean().optional(),
    })
    .parse(req.body);
  return mutation(req, reply, async () =>
    engine.impostaModello(
      req.params.id,
      body.provider,
      body.model,
      body.forzato ?? false,
    ),
  );
});
// Il revisore (Fase 2): impostazioni e suggerimenti da scartare o rimettere.
app.post("/api/v1/runs/:id/revisore", async (req: any, reply) => {
  const body = z
    .object({
      attivo: z.boolean().optional(),
      provider: z.string().max(40).nullable().optional(),
      modello: z.string().max(200).nullable().optional(),
      ogniTurni: z.number().int().min(1).max(10).optional(),
      istruzioni: z.string().trim().min(1).max(4000).optional(),
      consensi: z.array(z.string().max(40)).max(20).optional(),
      corregge: z.boolean().optional(),
      // Un controllo sempre attivo diverso dal revisore (Fase 3, passo 4).
      controllo: z.string().max(40).optional(),
      togli: z.boolean().optional(),
    })
    .parse(req.body ?? {});
  const { controllo, ...altro } = body;
  const modifiche: any = { ...altro };
  if (body.provider === null) modifiche.provider = undefined;
  if (body.modello === null) modifiche.modello = undefined;
  return mutation(req, reply, async () => engine.impostaRevisore(req.params.id, modifiche, controllo ?? "revisore"));
});
app.post("/api/v1/runs/:id/controlli", async (req: any, reply) => {
  const body = z.object({ nome: z.string().trim().min(1).max(40), istruzioni: z.string().trim().min(1).max(4000) }).parse(req.body);
  return mutation(req, reply, async () => engine.aggiungiControllo(req.params.id, body.nome, body.istruzioni));
});
// Ruoli e flussi (Fase 3): valgono per tutti i progetti; il flusso attivo è
// della sessione.
app.get("/api/v1/flussi", async () => leggiFlussi(root));
app.post("/api/v1/flussi", async (req: any, reply) => {
  const ruolo = z.object({
    id: z.string().min(2).max(32),
    nome: z.string().trim().min(1).max(40),
    tipo: z.enum(["legge", "scrive"]),
    esito: z.enum(["piano", "suggerimenti", "verdetto", "lavoro", "testo"]),
    istruzioni: z.string().trim().min(1).max(4000),
    predefinito: z.boolean().optional(),
  });
  const passo = z.object({ ruolo: z.string().max(32), ai: z.string().max(40), modello: z.string().max(200).optional() });
  const flusso = z.object({
    id: z.string().min(2).max(32),
    nome: z.string().trim().min(1).max(40),
    descrizione: z.string().max(300).optional(),
    passi: z.array(passo).min(1).max(12),
    giri: z.number().int().min(0).max(5),
    approvaPiano: z.boolean().optional(),
    predefinito: z.boolean().optional(),
  });
  const body = z
    .object({ ruoli: z.array(ruolo).max(50), flussi: z.array(flusso).max(50), confermaIncarichi: z.boolean().optional() })
    .parse(req.body);
  return mutation(req, reply, async () => {
    salvaFlussi(root, body);
    return leggiFlussi(root);
  });
});
app.post("/api/v1/runs/:id/flusso", async (req: any, reply) => {
  const body = z.object({ flusso: z.string().min(1).max(32) }).parse(req.body);
  return mutation(req, reply, async () => engine.impostaFlusso(req.params.id, body.flusso));
});
app.post("/api/v1/runs/:id/flusso/piano", async (req: any, reply) => {
  const body = z
    .object({ azione: z.enum(["approva", "sempre", "modifica", "annulla"]), testo: z.string().max(20000).optional() })
    .parse(req.body);
  return mutation(req, reply, async () => engine.rispondiPiano(req.params.id, body.azione, body.testo));
});
app.post("/api/v1/runs/:id/flusso/ferma", async (req: any, reply) =>
  mutation(req, reply, async () => engine.fermaFlusso(req.params.id)),
);
app.post("/api/v1/runs/:id/suggerimenti/:sid", async (req: any, reply) => {
  const body = z.object({ scartato: z.boolean() }).parse(req.body);
  return mutation(req, reply, async () => engine.segnaSuggerimento(req.params.id, req.params.sid, body.scartato));
});
// Chi risponde (/ai, 25 ottobre): un modello che risponde soltanto resta
// scelto finché la persona non torna alle AI della sequenza (provider null).
app.post("/api/v1/runs/:id/risponde", async (req: any, reply) => {
  const body = z
    .object({ provider: z.string().max(40).nullable(), modello: z.string().max(200).optional() })
    .parse(req.body);
  // Non sotto il blocco delle mutazioni: la prova dei modelli può durare
  // decine di secondi, e intanto tutto il resto restava fermo («Mutazione in
  // corso», 25 ottobre).
  try {
    return await engine.impostaRisponde(req.params.id, body.provider, body.modello);
  } catch (e: any) {
    return reply.code(400).send({ message: e?.message ?? String(e) });
  }
});
app.post("/api/v1/runs/:id/diretto", { bodyLimit: 1024 * 1024 }, async (req: any, reply) => {
  const body = z.object({ testo: z.string().trim().min(1).max(LIMITE_RICHIESTA) }).parse(req.body);
  return mutation(req, reply, async () => engine.chiediDiretto(req.params.id, body.testo));
});
// I permessi per le azioni fuori dal progetto (23 ottobre). «chiedi» la usa
// il programma dei permessi di Claude e aspetta la risposta della persona;
// le altre due le usa l'interfaccia.
app.post("/api/v1/runs/:id/permessi/chiedi", async (req: any, reply) => {
  if (!store.get(req.params.id))
    return reply.code(404).send({ message: "Run non trovata" });
  const body = z
    .object({ strumento: z.string().min(1).max(300), input: z.unknown().optional() })
    .parse(req.body);
  const consenti = await engine.chiediPermesso(req.params.id, body.strumento, body.input);
  return { consenti, motivo: consenti ? "" : "La persona non ha dato il permesso." };
});
app.post("/api/v1/runs/:id/permessi/:pid", async (req: any, reply) => {
  const body = z.object({ consenti: z.boolean() }).parse(req.body);
  return mutation(req, reply, async () =>
    engine.decidiPermesso(req.params.id, req.params.pid, body.consenti),
  );
});
app.post("/api/v1/runs/:id/permessi-turno", async (req: any, reply) => {
  const body = z.object({ consenti: z.boolean() }).parse(req.body);
  return mutation(req, reply, async () =>
    engine.consentiProssimoTurno(req.params.id, body.consenti),
  );
});
// I modelli gratuiti (Fase 1 del 21 ottobre): servizi, modelli letti dal
// servizio, e una domanda di prova senza progetti né sessioni.
app.get("/api/v1/gratuiti", async () => engine.serviziGratuiti());
app.get("/api/v1/gratuiti/:id/modelli", async (req: any, reply) => {
  try {
    return await engine.modelliGratuitiDi(
      req.params.id,
      String(req.query?.aggiorna ?? "") === "1",
    );
  } catch (e: any) {
    return reply.code(400).send({ message: e?.message ?? String(e) });
  }
});
app.post("/api/v1/gratuiti/:id/prova", async (req: any, reply) => {
  const body = z
    .object({
      modello: z.string().trim().min(1).max(200),
      domanda: z.string().trim().min(1).max(4000),
    })
    .parse(req.body);
  try {
    return await engine.provaGratuito(req.params.id, body.modello, body.domanda);
  } catch (e: any) {
    return reply.code(400).send({ message: e?.message ?? String(e) });
  }
});
app.get("/api/v1/modelli", async () => {
  // I modelli dei provider a chiave vengono dal catalogo: lo si attende.
  await engine.assicuraCatalogo();
  return engine.modelliDisponibili();
});
app.post("/api/v1/runs/:id/pubblica", async (req: any, reply) => {
  const body = z
    .object({
      destinazione: z.string().max(400).optional(),
      conferma: z
        .string()
        .regex(/^[0-9a-f]{16}$/)
        .optional(),
      forza: z.boolean().optional(),
    })
    .parse(req.body ?? {});
  return mutation(req, reply, async () =>
    body.conferma
      ? engine.pubblica(req.params.id, body.conferma, body.forza ?? false)
      : engine.anteprimaPubblicazione(req.params.id, body.destinazione),
  );
});
app.get("/api/v1/runs/:id/github", async (req: any, reply) => {
  if (!store.get(req.params.id))
    return reply.code(404).send({ message: "Run non trovata" });
  return engine.impostazioneGithub(req.params.id);
});
app.post("/api/v1/runs/:id/github", async (req: any, reply) => {
  const body = z.object({ automatica: z.boolean() }).parse(req.body);
  return mutation(req, reply, async () =>
    engine.impostaPubblicazioneAutomatica(req.params.id, body.automatica),
  );
});
// Dopo «/collega»: un provider rimasto senza credito torna disponibile.
app.post("/api/v1/providers/:id/collegato", async (req: any, reply) => {
  const provider = providerNoto(String(req.params.id ?? ""));
  if (!provider) throw Error("Provider sconosciuto");
  return mutation(req, reply, async () => {
    engine.sbloccaCredito(provider.id);
    return { ok: true };
  });
});
app.post("/api/v1/runs/:id/ragionamento", async (req: any, reply) => {
  const body = z
    .object({
      provider: z.string().min(1).max(40),
      livello: z.enum(["basso", "medio", "alto", "massimo"]),
    })
    .parse(req.body);
  return mutation(req, reply, async () =>
    engine.impostaRagionamento(req.params.id, body.provider, body.livello),
  );
});
// L'AI ibrida: configurazione (ruoli, modello, compiti) e stato di Ollama.
// Con l'AI ibrida spenta Ollama non si interroga (CT-2.0-004); il pannello
// lo chiede esplicitamente con ?verifica=1.
app.get("/api/v1/ibrida", async (req: any) => {
  const config = leggiIbrida(root);
  const verifica = String(req.query?.verifica ?? "") === "1";
  const stato =
    config.attiva || verifica ? await statoOllama() : { acceso: false, modelli: [] as string[] };
  return {
    config,
    ollama: verifica
      ? {
          ...stato,
          installato: Boolean(binarioOllama()),
          modelli: stato.acceso ? stato.modelli : modelliSulDisco(),
        }
      : stato,
  };
});
// Toglie il modello locale dalla memoria quando la persona passa a un'altra AI.
app.post("/api/v1/ibrida/libera", async () => ({ liberato: await engine.liberaModelloLocale() }));
// Avvia Ollama dal pannello /ibrida, senza aspettare il primo compito.
app.post("/api/v1/ibrida/avvia", async () => {
  if (!binarioOllama()) return { acceso: false, installato: false };
  return { acceso: await assicuraOllama(), installato: true };
});
app.post("/api/v1/ibrida", async (req: any, reply) => {
  const compito = z.object({
    id: z.string().min(1).max(60),
    nome: z.string().min(1).max(80),
    parola: z.string().min(3).max(25),
    istruzioni: z.string().min(1).max(4000),
    attivo: z.boolean(),
    predefinito: z.boolean().optional(),
  });
  const body = z
    .object({
      attiva: z.boolean(),
      modello: z.string().min(1).max(120),
      riserva: z.boolean(),
      aComando: z.boolean(),
      compiti: z.array(compito).max(50),
    })
    .parse(req.body);
  return mutation(req, reply, async () => {
    salvaIbrida(root, body);
    return leggiIbrida(root);
  });
});
app.post("/api/v1/runs/:id/locale/stop", async (req: any, reply) =>
  mutation(req, reply, async () => ({
    fermato: engine.fermaCompitoLocale(req.params.id),
  })),
);
// Come /turn: un compito può ricevere un incolla lungo (CT-2.0-005).
app.post("/api/v1/runs/:id/locale", { bodyLimit: 1024 * 1024 }, async (req: any, reply) => {
  const body = z
    .object({
      testo: z.string().trim().max(LIMITE_RICHIESTA),
      compito: z.string().max(60).optional(),
    })
    .parse(req.body);
  return mutation(req, reply, async () =>
    engine.avviaCompitoLocale(req.params.id, body.testo, body.compito),
  );
});
app.post("/api/v1/runs/:id/attachments/remove", async (req: any, reply) => {
  const body = z.object({ nome: z.string().min(1).max(300) }).parse(req.body);
  return mutation(req, reply, async () =>
    engine.togliAllegato(req.params.id, body.nome),
  );
});
app.post("/api/v1/runs/:id/attachments", async (req: any, reply) => {
  const body = z.object({ path: z.string().min(1).max(4096) }).parse(req.body);
  return mutation(req, reply, async () =>
    engine.allega(req.params.id, body.path),
  );
});
app.post("/api/v1/runs/:id/providers", async (req: any, reply) => {
  const body = z
    .object({
      providers: z.array(z.string()).min(1).max(20).optional(),
      richiesta: z.string().trim().min(1).max(500).optional(),
    })
    .refine((b) => b.providers || b.richiesta, "Serve una sequenza")
    .parse(req.body);
  return mutation(req, reply, async () =>
    engine.impostaSequenza(req.params.id, body.richiesta ?? body.providers!),
  );
});
// Una richiesta può essere una specifica di decine di pagine. Il limite
// generale del servizio è di 32 KB: su questa rotta un prompt reale di circa
// 40.000 caratteri veniva rifiutato («Request body is too large») e al suo
// posto partiva solo l'ultima riga. Qui il limite segue quello del testo:
// 200.000 caratteri, fino a 4 byte l'uno in UTF-8, più l'involucro JSON.
app.post(
  "/api/v1/runs/:id/turn",
  { bodyLimit: 1024 * 1024 },
  async (req: any, reply) => {
    const body = z
      .object({
        text: z.string().trim().min(1).max(LIMITE_RICHIESTA),
        // Un provider scelto per questo turno (l'AI ibrida «sui file»).
        provider: z.string().max(40).optional(),
        // Chi fa cosa, come confermato dalla persona (le AI chiamate con @).
        incarichi: z
          .array(
            z.object({
              ai: z.string().min(1).max(40),
              compito: z.string().trim().min(1).max(4000),
              tipo: z.enum(["scrive", "legge"]),
              quando: z.enum(["ogni", "fine"]).optional(),
            }),
          )
          .max(8)
          .optional(),
      })
      .parse(req.body);
    return mutation(req, reply, async () =>
      engine.turn(req.params.id, body.text, { provider: body.provider, incarichi: body.incarichi }),
    );
  },
);
app.post("/api/v1/live-smoke", async (req, reply) => {
  const body = z
    .object({
      successor: z.enum(["gemini", "claude", "antigravity"]).default("claude"),
    })
    .parse(req.body ?? {});
  const authorization =
    body.successor === "antigravity"
      ? "antigravity-fixture-20260922"
      : body.successor === "gemini"
        ? "google-fixture"
        : "subscriptions-fixture";
  if (process.env.CONTINUITY_LIVE_AUTHORIZED_ONCE !== authorization)
    return reply.code(403).send({
      message: "Prova live non abilitata per il successore selezionato",
    });
  return mutation(req, reply, async () => {
    // Each authorization the user grants gets its own marker: past ones stay
    // consumed, so a new trial never reuses a spent permission.
    const grant = process.env.CONTINUITY_LIVE_AUTHORIZATION_ID ?? "";
    if (grant && !/^[a-z0-9-]{1,32}$/.test(grant))
      throw Error("Identificatore di autorizzazione live non valido");
    const receipt =
      (body.successor === "antigravity"
        ? "live-authorization-antigravity-20260922"
        : "live-authorization") +
      (grant ? "-" + grant : "") +
      "-consumed";
    if (store.db.prepare("SELECT key FROM requests WHERE key=?").get(receipt))
      throw Error("Autorizzazione per una sola prova già consumata");
    const { requireSubscriptions } = await import("../adapters/live.js");
    requireSubscriptions(body.successor, root);
    store.db
      .prepare("INSERT INTO requests VALUES(?,?,?)")
      .run(receipt, "{}", "{}");
    const run = await engine.create(
      "Validare quantità e totale del carrello",
      "live",
      body.successor,
    );
    reply.code(202);
    return run;
  });
});
app.post("/api/v1/runs/:id/actions", async (req: any, reply) => {
  const body = z
    .object({
      action: z.enum(["pause", "cancel", "resume", "switch", "restore-copy"]),
      expectedVersion: z.number().int(),
    })
    .parse(req.body);
  return mutation(req, reply, async () => {
    if (engine.run(req.params.id).version !== body.expectedVersion) {
      reply.code(409);
      return { message: "Stato aggiornato: riprovare" };
    }
    return engine.action(req.params.id, body.action);
  });
});
app.get("/api/v1/runs/:id/export", async (req: any, reply) => {
  const r = engine.run(req.params.id);
  reply.header(
    "content-disposition",
    `attachment; filename="continuity-${r.id}.json"`,
  );
  return exportRun(store, r.id);
});
app.setErrorHandler((e: any, _req, reply) =>
  reply.code(e instanceof z.ZodError ? 400 : 409).send({
    code: "CONTINUITY_ERROR",
    message: e.message,
    retryable: false,
    evidenceIds: [],
  }),
);
const dist = resolve("dist");
if (existsSync(dist)) await app.register(fastifyStatic, { root: dist });
else
  app.get("/", async (_req, reply) =>
    reply
      .type("text/plain")
      .send("Eseguire pnpm build prima di avviare Continuity."),
  );
await app.listen({ host: "127.0.0.1", port });
const url = origin + "/#bootstrap=" + bootstrap;
writeFileSync(
  join(root, "service.json"),
  JSON.stringify({
    pid: process.pid,
    origin,
    url,
    apiToken,
    dataDir: root,
    // Quale installazione sta servendo: il terminale la confronta con la sua.
    build: improntaApp(resolve(".")),
  }),
  { mode: 0o600 },
);
console.log(
  // La modalità (reale o simulata) è di ogni sessione, non del servizio:
  // «SIMULAZIONE» qui diceva il falso anche con le sessioni reali.
  `Continuity · servizio ${improntaApp(resolve(".")) ?? ""}\n` +
    origin +
    "\nAprire con pnpm continuity ui.\nDati: " +
    root,
);
// Il controllo vive nel servizio, non nella sessione: così il lavoro riprende
// anche se il terminale è stato chiuso.
const orologio = setInterval(
  () => void engine.riprendiInAttesa().catch(() => {}),
  60_000,
);
orologio.unref();
// Prima della ripresa: i flussi rimasti a metà da un servizio spento si
// chiudono, così la sessione accetta di nuovo i messaggi (CT-2.0-303).
try {
  engine.riconciliaFlussi();
} catch {}
void engine.riprendiInAttesa().catch(() => {});
// Le sessioni chiuse da tempo lasciano copie di lavoro che nessuno riaprirà.
try {
  const liberate = engine.pulisci();
  if (liberate) console.log(`Pulizia: ${liberate} sessioni vecchie rimosse`);
} catch {}

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(orologio);
  await engine.shutdown();
  for (const stream of streams) stream.end();
  await app.close();
  store.close();
  unlinkSync(lock);
  // service.json con il pid di un servizio spento: dopo un riavvio quel numero
  // può toccare a un altro programma, che qualcuno potrebbe fermare. Si toglie
  // solo se è ancora il nostro (un servizio nuovo può averlo già riscritto).
  try {
    const servizio = join(root, "service.json");
    if (JSON.parse(readFileSync(servizio, "utf8")).pid === process.pid)
      unlinkSync(servizio);
  } catch {}
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
