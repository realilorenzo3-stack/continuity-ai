import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
  symlinkSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  snapshot,
  restore,
  hash,
  inventory,
  safe,
  verify,
} from "../src/git/snapshot.js";
import { classify, JsonLines } from "../src/adapters/detector.js";
import { Store } from "../src/persistence/store.js";
import { Engine } from "../src/core/engine.js";
const dirs: string[] = [];
const temp = () => {
  const p = mkdtempSync(join(tmpdir(), "continuity-test-"));
  dirs.push(p);
  return p;
};
afterEach(() => {
  for (const p of dirs.splice(0)) rmSync(p, { recursive: true, force: true });
});
for (let repeat = 1; repeat <= 5; repeat++)
  describe("Corpus deterministico · ripetizione " + repeat, () => {
    it.each(["message", "tool_output", "grep", "test", "unknown"])(
      "non classifica quota nel testo %s",
      (type) =>
        expect(
          classify({ type, source: "provider", code: "quota_exhausted" }),
        ).toBeNull(),
    );
    it.each([
      "quota_exhausted",
      "rate_limit",
      "unauthorized",
      "permission_denied",
      "network_error",
      "context_exhausted",
    ])("classifica solo errore provider strutturato %s", (code) =>
      expect(
        classify({ type: "error", source: "provider", code }),
      ).not.toBeNull(),
    );
    it("non sovrappone retry nativo", () =>
      expect(
        classify({
          type: "error",
          source: "provider",
          code: "rate_limit",
          retrying: true,
        }),
      ).toBeNull());
    it("errore sconosciuto resta unknown", () =>
      expect(
        classify({ type: "error", source: "provider", code: "invented" }),
      ).toBe("unknown"));
    it("fonte non provider non causa switch", () =>
      expect(
        classify({ type: "error", source: "tool", code: "quota_exhausted" }),
      ).toBeNull());
    it("parsa chunk spezzati", () => {
      const out: any[] = [];
      const p = new JsonLines((x) => out.push(x));
      p.push('{"type":');
      p.push('"ok"}\n');
      expect(out).toEqual([{ type: "ok" }]);
    });
    it("JSON malformato non diventa successo", () => {
      const out: any[] = [];
      const p = new JsonLines((x) => out.push(x));
      p.push("bad\n");
      expect(out[0].type).toBe("unknown");
    });
    it("EOF incompleto resta unknown", () => {
      const out: any[] = [];
      const p = new JsonLines((x) => out.push(x));
      p.push("{");
      p.end();
      expect(out[0].type).toBe("unknown");
    });
    // Una riga enorme (un file letto, un output gigante) non deve più
    // interrompere il turno: si salta, si segnala, e la lettura prosegue.
    it("limita lo stream senza interrompere la lettura", () => {
      const visti: any[] = [];
      const lettore = new JsonLines((v) => visti.push(v), undefined, 1000);
      expect(() => lettore.push("x".repeat(1500))).not.toThrow();
      expect(lettore.buffer.length).toBe(0);
      lettore.push('ancora coda della riga lunga\n{"type":"dopo"}\n');
      expect(visti).toEqual([
        { type: "unknown", reason: "line too long" },
        { type: "dopo" },
      ]);
    });
    // Un guasto in chi riceve non deve diventare «JSON malformato» e sparire.
    it("non nasconde gli errori di chi riceve", () => {
      const guasti: string[] = [];
      const lettore = new JsonLines(
        () => {
          throw Error("guasto nel gestore");
        },
        (e) => guasti.push((e as Error).message),
      );
      lettore.push('{"type":"result"}\n');
      expect(guasti).toEqual(["guasto nel gestore"]);
      // Senza chi raccoglie i guasti, l'errore risale invece di sparire.
      expect(() =>
        new JsonLines(() => {
          throw Error("x");
        }).push("{}\n"),
      ).toThrow("x");
    });
    it.each(["../secret", "/etc/passwd", "a/../../b", "a\\b"])(
      "rifiuta traversal %s",
      (path) => expect(() => safe(temp(), path)).toThrow(),
    );
    it("ripristina binary, modi e file nuovi", () => {
      const root = temp(),
        data = temp(),
        target = join(temp(), "copy");
      writeFileSync(join(root, "new.bin"), Buffer.from([0, 1, 255, 0]));
      chmodSync(join(root, "new.bin"), 0o755);
      const s = snapshot(root, data);
      restore(data, s.id, target);
      expect(inventory(target)).toEqual(inventory(root));
    });
    it("rifiuta symlink", () => {
      const root = temp();
      symlinkSync("/etc/passwd", join(root, "link"));
      expect(() => snapshot(root, temp())).toThrow("Symlink");
    });
    it("esclude credenziali per percorso", () => {
      const root = temp();
      writeFileSync(join(root, ".env"), "SECRET");
      writeFileSync(join(root, "ok"), "hello");
      const s = snapshot(root, temp());
      expect(s.manifest.files.map((f) => f.path)).toEqual(["ok"]);
      expect(s.manifest.excludedPaths).toEqual([".env"]);
    });
    it("hash invalido blocca consumo", () => {
      const root = temp(),
        data = temp();
      writeFileSync(join(root, "a"), "A");
      const s = snapshot(root, data);
      writeFileSync(join(data, "blobs", hash("A")), "B");
      expect(() => verify(data, s.id)).toThrow("corrotto");
    });
    it("restore non sovrascrive", () => {
      const root = temp(),
        data = temp();
      writeFileSync(join(root, "a"), "A");
      const s = snapshot(root, data);
      expect(() => restore(data, s.id, root)).toThrow("esiste");
    });
    it("manifest cancellazioni rappresenta lo stato corrente", () => {
      const root = temp(),
        data = temp();
      writeFileSync(join(root, "a"), "A");
      snapshot(root, data);
      rmSync(join(root, "a"));
      const s = snapshot(root, data);
      expect(s.manifest.files).toEqual([]);
    });
    it("rifiuta file oltre limite", () => {
      const root = temp();
      writeFileSync(join(root, "large"), Buffer.alloc(10 * 1024 * 1024 + 1));
      expect(() => snapshot(root, temp())).toThrow("Limite");
    });
    it("evento e stato persistono insieme", () => {
      const root = temp(),
        db = new Store(root);
      const r = { id: "r", version: 0, state: "RUNNING" };
      db.save(r, "started", "Start");
      db.close();
      const db2 = new Store(root);
      expect(db2.get("r").version).toBe(1);
      expect(db2.events("r")[0].seq).toBe(1);
      db2.close();
    });
  });
describe("Pipeline con processi OS e Git", () => {
  it.each(["gemini", "claude"] as const)(
    "Codex → snapshot fallito → %s → 3 criteri, ripristino e originale intatto",
    async (successor) => {
      const db = new Store(temp()),
        engine = new Engine(db);
      try {
        const r = await engine.create(
          "Validare carrello",
          "simulation",
          successor,
        );
        await new Promise((r) => setTimeout(r, 750));
        const switched = await engine.action(r.id, "switch");
        expect(
          switched.handoff.acceptance.find((x: any) => x.id === "negative")
            .status,
        ).toBe("failed");
        const until = Date.now() + 8000;
        while (Date.now() < until && engine.run(r.id).state !== "SUCCEEDED")
          await new Promise((r) => setTimeout(r, 100));
        const done = engine.run(r.id);
        expect(done.state).toBe("SUCCEEDED");
        expect(done.switches).toBe(1);
        expect(done.agent).toBe(successor);
        expect(done.handoff.toAgent).toBe(successor);
        expect(done.checks.every((c: any) => c.passed)).toBe(true);
        expect(readFileSync(join(r.repo, "cart.mjs"), "utf8")).toContain(
          "return 0",
        );
        const copy = await engine.action(r.id, "restore-copy");
        expect(inventory(copy.restoredPath)).toEqual(inventory(r.work));
      } finally {
        await engine.shutdown();
        db.close();
      }
    },
  );
  it("pausa, ripresa, annullamento conservano lavoro senza fallback", async () => {
    const db = new Store(temp()),
      engine = new Engine(db);
    try {
      const r = await engine.create("Test pausa");
      await new Promise((r) => setTimeout(r, 700));
      expect((await engine.action(r.id, "pause")).state).toBe("PAUSED");
      expect((await engine.action(r.id, "resume")).state).toBe("RUNNING");
      expect((await engine.action(r.id, "cancel")).state).toBe("CANCELLED");
      expect(engine.run(r.id).switches).toBe(0);
      expect(engine.children.size).toBe(0);
    } finally {
      await engine.shutdown();
      db.close();
    }
  });
  it("riavvio conservativo non rilancia writer ambiguo", () => {
    const db = new Store(temp());
    db.save({ id: "r", version: 0, state: "STARTING" }, "intent", "start");
    new Engine(db);
    expect(db.get("r").state).toBe("BLOCKED");
    db.close();
  });
});

describe("Guardie e sicurezza aggiuntive", () => {
  it("rifiuta successo senza ciclo di verifica", async () => {
    const { assertTransition } = await import("../src/core/state.js");
    expect(() => assertTransition("RUNNING", "SUCCEEDED")).toThrow("illegale");
  });
  it("ricava seq dal database anche per oggetto in memoria superato", () => {
    const db = new Store(temp());
    const r = { id: "r", version: 0, state: "RUNNING" };
    db.save(r, "started", "start");
    const older = { ...r };
    db.save(r, "message", "one");
    db.save(older, "message", "two");
    expect(db.events("r").map((e) => e.seq)).toEqual([1, 2, 3]);
    db.close();
  });
  it("ambiente live non eredita chiavi o endpoint di fatturazione API", async () => {
    const { subscriptionEnvironment } = await import("../src/adapters/live.js");
    const env = subscriptionEnvironment();
    expect(Object.keys(env)).not.toContain("ANTHROPIC_API_KEY");
    expect(Object.keys(env)).not.toContain("OPENAI_API_KEY");
    expect(Object.keys(env)).not.toContain("ANTHROPIC_BASE_URL");
  });
  it("comandi live non bypassano permessi e Claude non ha Bash", async () => {
    const { liveCommand } = await import("../src/adapters/live.js");
    for (const agent of ["codex", "claude"] as const) {
      expect(liveCommand(agent, "/fixture").args.join(" ")).not.toMatch(
        /bypass|danger-full-access|acceptEdits/,
      );
    }
    expect(liveCommand("claude", "/fixture").args).toContain("dontAsk");
    expect(liveCommand("claude", "/fixture").args).toContain("Read,Edit,Write");
  });
  it("claim CLI non diventa successo osservato", async () => {
    const { normalizedLiveEvent } = await import("../src/adapters/live.js");
    expect(normalizedLiveEvent("codex", { type: "turn.completed" }).type).toBe(
      "reported",
    );
    expect(
      normalizedLiveEvent("claude", { type: "result", is_error: false }).type,
    ).toBe("reported");
    // Un comando eseguito è un passaggio da mostrare, mai un esito: il suo
    // output non diventa quota né successo, e non viene nemmeno stampato.
    const passaggio = normalizedLiveEvent("codex", {
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "cat note.txt",
        aggregated_output: "quota_exhausted",
      },
    });
    expect(passaggio.type).toBe("azione");
    expect(passaggio.text).toContain("cat note.txt");
    expect(passaggio.text).not.toContain("quota_exhausted");
  });
  it("arresta un figlio che continua a scrivere dopo uscita del padre", async () => {
    const { launch, stop } = await import("../src/supervisor/process.js");
    const dir = temp(),
      script = join(dir, "parent.mjs"),
      file = join(dir, "written");
    writeFileSync(
      script,
      `import {spawn} from 'node:child_process';const child=spawn(process.execPath,['-e',${JSON.stringify("const fs=require('fs');setInterval(()=>fs.appendFileSync(" + JSON.stringify(file) + ",'x'),30)")}],{stdio:'ignore'});setTimeout(()=>process.exit(0),100);`,
    );
    const child = launch(process.execPath, [script], dir, join(dir, "receipt"));
    await new Promise((r) => setTimeout(r, 250));
    await stop(child);
    const before = readFileSync(file, "utf8");
    await new Promise((r) => setTimeout(r, 100));
    expect(readFileSync(file, "utf8")).toBe(before);
  });
  it("esportazione include blob verificati e tutti gli eventi", async () => {
    const { exportRun } = await import("../src/handoff/export.js");
    const root = temp(),
      work = temp();
    writeFileSync(join(work, "cart.mjs"), "hello");
    const s = snapshot(work, root);
    const db = new Store(root),
      run = {
        id: "r",
        version: 0,
        state: "READY",
        dir: root,
        snapshots: [{ id: s.id }],
      };
    db.save(run, "created", "x");
    for (let i = 0; i < 501; i++) db.save(run, "event", "x");
    const bundle = exportRun(db, "r");
    expect(bundle.events).toHaveLength(502);
    expect(Buffer.from(bundle.blobs[hash("hello")], "base64").toString()).toBe(
      "hello",
    );
    db.close();
  });
});

describe("Evidenze non attendibili e durabilità", () => {
  it("redige segreti e controlli terminale prima della persistenza", async () => {
    const db = new Store(temp());
    db.save(
      { id: "r", version: 0, state: "READY" },
      "message",
      "api_key=private-value \u001b[31mhello sk-abcdefghijklmnop",
    );
    const message = db.events("r")[0].payload.message;
    expect(message).not.toContain("private-value");
    expect(message).not.toContain("sk-abcdefghijklmnop");
    expect(message).not.toContain("\u001b");
    db.close();
  });
  it("RHP estraneo o con hash cambiato viene rifiutato", async () => {
    const { validateHandoff } = await import("../src/handoff/schema.js");
    expect(() =>
      validateHandoff({ schemaVersion: "0.1.0" }, "r", "x"),
    ).toThrow();
  });
  it("su errore SQLite non dichiara evento completato", () => {
    const db = new Store(temp());
    db.save({ id: "r", version: 0, state: "READY" }, "created", "ok");
    db.db.exec("PRAGMA query_only=ON");
    expect(() =>
      db.save(
        { id: "r", version: 1, state: "STARTING" },
        "launch",
        "not persisted",
      ),
    ).toThrow();
    expect(db.get("r").state).toBe("READY");
    expect(db.events("r")).toHaveLength(1);
    db.close();
  });
});

describe("Priorità del controllo umano", () => {
  it("annulla durante quiesce impedisce il lancio del successore", async () => {
    const db = new Store(temp()),
      engine = new Engine(db);
    try {
      const r = await engine.create("Fixture annullamento");
      await new Promise((r) => setTimeout(r, 650));
      const switching = engine.action(r.id, "switch");
      const cancelling = engine.action(r.id, "cancel");
      await Promise.all([switching, cancelling]);
      const result = engine.run(r.id);
      expect(result.state).toBe("CANCELLED");
      expect(result.switches).toBe(0);
      expect(
        db.events(r.id).filter((e) => e.type === "switch.started"),
      ).toHaveLength(0);
      expect(engine.children.size).toBe(0);
    } finally {
      await engine.shutdown();
      db.close();
    }
  });
});

describe("Freshness dei file", () => {
  it.each(
    [
      [],
      [{ id: "positive", label: "Parziale", passed: true }],
      ["positive", "negative", "empty"].map((id) => ({
        id,
        label: id,
        passed: "false",
      })),
      ["positive", "positive", "empty"].map((id) => ({
        id,
        label: id,
        passed: true,
      })),
      ["positive", "negative", "unknown"].map((id) => ({
        id,
        label: id,
        passed: true,
      })),
    ].map((report) => ({ report })),
  )(
    "rifiuta report incompleto o malformato %# anche con exit zero",
    async ({ report }) => {
      const root = temp(),
        work = temp(),
        db = new Store(root);
      const engine = new Engine(db);
      // The imported module can exit before the trusted checker has run.
      writeFileSync(
        join(work, "cart.mjs"),
        `console.log(${JSON.stringify(JSON.stringify(report))}); process.exit(0);`,
      );
      db.save(
        {
          id: "r",
          state: "RUNNING",
          dir: root,
          work,
          snapshots: [],
          checks: [],
        },
        "created",
        "fixture",
      );
      try {
        await expect(engine.complete("r")).rejects.toThrow(
          "Verificatore senza risultato valido",
        );
        expect(db.get("r").state).toBe("BLOCKED");
        expect(
          db.events("r").some((event) => event.type === "run.succeeded"),
        ).toBe(false);
        expect(db.get("r").evidence).toBeUndefined();
      } finally {
        db.close();
      }
    },
  );
  it("una modifica successiva rende obsolete le prove e revoca il verde", async () => {
    const root = temp(),
      work = temp(),
      db = new Store(root);
    writeFileSync(join(work, "cart.mjs"), "old");
    const s = snapshot(work, root);
    const r = {
      id: "r",
      version: 0,
      state: "SUCCEEDED",
      work,
      snapshotId: s.id,
      checks: [{ id: "positive", status: "passed" }],
    };
    db.save(r, "run.succeeded", "historical");
    const engine = new Engine(db);
    writeFileSync(join(work, "cart.mjs"), "new");
    const observed = engine.current("r");
    expect(observed.state).toBe("BLOCKED");
    expect(observed.checks[0].status).toBe("stale");
    db.close();
  });
  it("test che modifica il sorgente non produce successo", async () => {
    const db = new Store(temp()),
      engine = new Engine(db);
    try {
      const r = await engine.create("Fixture immutabilità");
      await new Promise((r) => setTimeout(r, 650));
      writeFileSync(
        join(r.work, "cart.mjs"),
        `import fs from 'node:fs';fs.appendFileSync('cart.mjs','\\n// mutation');export function total(items){if(items.some(i=>i.quantity<0))throw Error('negative');return items.reduce((s,i)=>s+i.price*i.quantity,0);}`,
      );
      await expect(engine.complete(r.id)).rejects.toThrow(/obsolet/);
      expect(engine.run(r.id).state).not.toBe("SUCCEEDED");
    } finally {
      await engine.shutdown();
      db.close();
    }
  });
});
