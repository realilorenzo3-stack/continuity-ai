import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
const agentNames: Record<string, string> = {
  codex: "Codex",
  gemini: "Gemini CLI",
  antigravity: "Antigravity (Gemini)",
  claude: "Claude Code",
};
const labels: Record<string, string> = {
  READY: "Pronto",
  STARTING: "Avvio in corso",
  RUNNING: "Agente al lavoro",
  QUIESCING: "Arresto in corso",
  SNAPSHOTTING: "Salvataggio",
  VERIFYING: "Verifica in corso",
  HANDOFF_READY: "Handoff pronto",
  SUCCEEDED: "Obiettivo verificato",
  FAILED: "Verifica fallita",
  PAUSED: "In pausa — lavoro salvato",
  CANCELLED: "Annullato — lavoro conservato",
  BLOCKED: "Intervento necessario",
};
async function api(path: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch("/api/v1" + path, {
    signal,
    method: body ? "POST" : "GET",
    headers: body
      ? {
          "content-type": "application/json",
          "x-continuity-csrf": "same-origin",
          "idempotency-key": crypto.randomUUID(),
        }
      : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.message ?? "Errore di connessione");
  return data;
}
function App() {
  const [runs, setRuns] = useState<any[]>([]),
    [run, setRun] = useState<any>(null),
    [events, setEvents] = useState<any[]>([]),
    [error, setError] = useState(""),
    [goal, setGoal] = useState("Validare quantità e totale del carrello"),
    [successor, setSuccessor] = useState("claude"),
    [pending, setPending] = useState(false),
    [tab, setTab] = useState("timeline"),
    [filter, setFilter] = useState("all");
  async function refresh(id?: string) {
    const all = await api("/runs");
    setRuns(all);
    // Senza un id si resta sulla run selezionata: saltare alla prima della
    // lista cambiava run sotto gli occhi di chi la stava seguendo.
    setRun((corrente: any) => {
      const cercata = id ?? corrente?.id;
      return (
        all.find((r: any) => r.id === cercata) ?? corrente ?? all[0] ?? null
      );
    });
  }
  useEffect(() => {
    void (async () => {
      try {
        const params = new URLSearchParams(location.hash.slice(1));
        const token = params.get("bootstrap");
        if (token) {
          history.replaceState(null, "", location.pathname);
          await api("/session", { token });
        }
        await refresh();
      } catch (e: any) {
        setError(e.message);
      }
    })();
  }, []);
  useEffect(() => {
    if (!run) return;
    const seguita = run.id;
    // Le risposte che arrivano dopo un cambio di selezione appartengono alla
    // run precedente: applicarle riportava la dashboard indietro, con la run
    // nuova già avviata e i pulsanti spariti (collaudo del 3 ottobre, CT-010).
    let attiva = true;
    const annulla = new AbortController();
    setEvents([]);
    const es = new EventSource(`/api/v1/runs/${seguita}/events`);
    es.onmessage = (e) => {
      if (!attiva) return;
      const event = JSON.parse(e.data);
      setEvents((old) =>
        old.some((x) => x.seq === event.seq)
          ? old
          : [...old, event].slice(-500),
      );
      void api("/runs/" + seguita, undefined, annulla.signal)
        .then((updated) => {
          if (!attiva) return;
          setRun((corrente: any) =>
            corrente?.id === updated.id ? updated : corrente,
          );
          setRuns((old) =>
            old.map((item) => (item.id === updated.id ? updated : item)),
          );
        })
        .catch((e) => {
          if (attiva && e.name !== "AbortError") setError(e.message);
        });
    };
    es.onerror = () => {
      if (attiva)
        setError("Connessione interrotta: riconnessione automatica in corso");
    };
    es.onopen = () => {
      if (attiva) setError("");
    };
    return () => {
      attiva = false;
      annulla.abort();
      es.close();
    };
  }, [run?.id]);
  async function act(action: string) {
    setPending(true);
    setError("");
    try {
      setRun(
        await api(`/runs/${run.id}/actions`, {
          action,
          expectedVersion: run.version,
        }),
      );
    } catch (e: any) {
      setError(e.message);
      await refresh(run.id);
    } finally {
      setPending(false);
    }
  }
  async function start(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      const r = await api("/demo", { goal, successor });
      setRun(r);
      await refresh(r.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPending(false);
    }
  }
  const active =
      run && !["SUCCEEDED", "FAILED", "CANCELLED"].includes(run.state),
    passed = run?.checks?.filter((c: any) => c.status === "passed").length ?? 0;
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="/">
          ▰ <span>continuity</span>
          <small>LOCAL WORKSPACE</small>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <div className="nav-item selected">◈ &nbsp; Centro di controllo</div>
        <div className="nav-label history-label">ESECUZIONI RECENTI</div>
        {runs.map((r) => (
          <button
            className={"run-link " + (r.id === run?.id ? "current" : "")}
            key={r.id}
            onClick={() => setRun(r)}
          >
            <span
              className={"dot " + (r.state === "SUCCEEDED" ? "green" : "")}
            />
            <span>
              {r.goal}
              <small>
                {new Date(r.createdAt).toLocaleTimeString("it-IT")} ·{" "}
                {labels[r.state]}
              </small>
            </span>
          </button>
        ))}
        <div className="sidebar-foot">
          <span className="dot green" /> Motore locale
          <div>
            Un progetto. Un writer.
            <br />
            Stato conservato sul tuo Mac.
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div>
            Workspace <span>/</span> demo-cart
          </div>
          <span className="badge simulation">
            {run?.mode === "live"
              ? "◉ CLI REALI · INTERRUZIONE SIMULATA"
              : "◉ SIMULAZIONE"}
          </span>
        </header>
        <section className="heading">
          <div className="eyebrow">CONTINUITÀ, CON EVIDENZE</div>
          <h1>
            Il lavoro continua.
            <br />
            <span>Il contesto resta.</span>
          </h1>
          <p>
            Segui il passaggio tra agenti, dal primo file al risultato
            verificato.
          </p>
        </section>
        {error && (
          <div role="alert" className="alert">
            {error}
          </div>
        )}
        <section className="task-card">
          <div className="section-top">
            <span className="eyebrow">
              {run ? "ATTIVITÀ CORRENTE" : "LA TUA PRIMA ESECUZIONE"}
            </span>
            <span className="subtle">
              {run?.mode === "live"
                ? "Fixture fidata · accesso personale, nessuna API a consumo"
                : "Fixture fidata · nessun costo API"}
            </span>
          </div>
          {!active ? (
            <form onSubmit={start}>
              <label htmlFor="successor">Agente successore</label>
              <select
                id="successor"
                value={successor}
                onChange={(e) => setSuccessor(e.target.value)}
                disabled={pending}
              >
                <option value="gemini">Gemini CLI</option>
                <option value="antigravity">Antigravity (Gemini)</option>
                <option value="claude">Claude Code</option>
              </select>
              <label htmlFor="goal">Descrizione della demo carrello</label>
              <div className="task-input">
                <input
                  id="goal"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  required
                  minLength={3}
                  maxLength={2000}
                />
                <button className="primary" disabled={pending}>
                  Avvia demo <span>↗</span>
                </button>
              </div>
              <p className="fine">
                Codex e {agentNames[successor]} sono simulati. File, checkpoint
                e test vengono eseguiti realmente in locale.
              </p>
            </form>
          ) : (
            <>
              <h2>{run.goal}</h2>
              <div className="actions">
                {run.state === "RUNNING" && (
                  <>
                    <button
                      disabled={pending}
                      onClick={() => void act("pause")}
                    >
                      Ⅱ Pausa
                    </button>
                    {run.agent === "codex" && (
                      <button
                        className="primary"
                        disabled={pending}
                        onClick={() => void act("switch")}
                      >
                        Simula limite →
                      </button>
                    )}
                  </>
                )}
                {run.state === "BLOCKED" && (
                  <button disabled={pending} onClick={() => void act("pause")}>
                    Riconcilia e salva
                  </button>
                )}
                {run.state === "PAUSED" && (
                  <button disabled={pending} onClick={() => void act("resume")}>
                    Riprendi
                  </button>
                )}
                <button disabled={pending} onClick={() => void act("cancel")}>
                  Annulla
                </button>
              </div>
            </>
          )}
        </section>
        <div className="stats">
          <article>
            <span>STATO DELL'ESECUZIONE</span>
            <strong>{run ? labels[run.state] : "In attesa di un task"}</strong>
            <small>{run?.error ?? "Persistenza locale · SQLite"}</small>
          </article>
          <article>
            <span>AGENTE ATTIVO</span>
            <strong>
              {run ? agentNames[run.agent] : "—"}{" "}
              <em>{run?.mode === "live" ? "reale" : "simulato"}</em>
            </strong>
            <small>
              Switch {run?.switches ?? 0}/1 · successore:{" "}
              {agentNames[run?.successor ?? (run ? "claude" : successor)]} ·
              quota non disponibile
            </small>
          </article>
          <article>
            <span>CRITERI VERIFICATI</span>
            <strong>
              {passed}
              <span className="muted"> / 3</span>
            </strong>
            <small>
              {run?.checks.length
                ? "Verifiche eseguite da Continuity"
                : "In attesa della verifica indipendente"}
            </small>
          </article>
        </div>
        <div className="columns">
          <section className="panel">
            <div className="tabs">
              <button
                className={tab === "timeline" ? "active" : ""}
                onClick={() => setTab("timeline")}
              >
                Timeline
              </button>
              <button
                className={tab === "handoff" ? "active" : ""}
                onClick={() => setTab("handoff")}
              >
                Handoff
              </button>
              <button
                className={tab === "files" ? "active" : ""}
                onClick={() => setTab("files")}
              >
                File e ripristino
              </button>
            </div>
            {tab === "timeline" ? (
              <>
                <div className="timeline-head">
                  <span>Eventi osservati da Continuity</span>
                  <select
                    aria-label="Filtra eventi"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">Tutti gli eventi</option>
                    <option value="verification">Verifiche</option>
                    <option value="snapshot">Checkpoint</option>
                    <option value="agent">Agenti</option>
                  </select>
                </div>
                <div className="timeline" aria-live="polite">
                  {events
                    .filter((e) => filter === "all" || e.type.includes(filter))
                    .map((e) => (
                      <div className="event" key={e.seq}>
                        <time>
                          {new Date(e.recordedAt).toLocaleTimeString("it-IT")}
                        </time>
                        <span
                          className={
                            "event-mark " +
                            (e.type.includes("succeeded") ? "done" : "")
                          }
                        >
                          ◆
                        </span>
                        <div>
                          <span>{e.payload.message}</span>
                          <small>
                            {e.source} · {e.type} · #{e.seq}
                          </small>
                        </div>
                      </div>
                    ))}
                  {!events.length && (
                    <div className="empty">
                      <span>◎</span>
                      <h3>Ogni passaggio lascia una traccia.</h3>
                      <p>
                        Avvia la demo per vedere eventi, checkpoint e verifiche
                        in tempo reale.
                      </p>
                    </div>
                  )}
                </div>
              </>
            ) : tab === "handoff" ? (
              <div className="detail">
                {run?.handoff ? (
                  <>
                    <h3>Il passaggio di consegne è persistito.</h3>
                    <p>
                      Origine: dati osservati e test indipendenti. Le
                      dichiarazioni degli agenti non sono prove.
                    </p>
                    <pre>{JSON.stringify(run.handoff, null, 2)}</pre>
                  </>
                ) : (
                  <p>Il pacchetto RHP apparirà dopo «Simula limite».</p>
                )}
              </div>
            ) : (
              <div className="detail">
                <h3>Stato conservato</h3>
                <p>
                  File supportato nella demo: <code>cart.mjs</code>. Ogni
                  checkpoint include manifest, modi e contenuti SHA-256.
                </p>
                <p className="path">
                  {run?.work ?? "Worktree creato all’avvio"}
                </p>
                {run?.snapshots.map((s: any, i: number) => (
                  <div className="snapshot" key={i}>
                    ◈ Checkpoint {i + 1}
                    <code>{s.id.slice(0, 16)}</code>
                    <span>{s.files} file · integrità verificata</span>
                  </div>
                ))}
                {run && (
                  <button
                    disabled={pending}
                    onClick={() => void act("restore-copy")}
                  >
                    Crea copia di recupero
                  </button>
                )}
                {run?.restoredPath && (
                  <p className="path">Copia verificata: {run.restoredPath}</p>
                )}
              </div>
            )}
          </section>
          <section className="panel evidence">
            <div className="panel-title">
              Verifiche indipendenti <span>↗</span>
            </div>
            <p>
              Il successo è legato ai file verificati, non alle dichiarazioni
              dell’agente.
            </p>
            {["positive", "negative", "empty"].map((id, i) => {
              const c = run?.checks.find((x: any) => x.id === id);
              return (
                <div className="check" key={id}>
                  <span
                    className={
                      c
                        ? c.status === "passed"
                          ? "check-pass"
                          : "check-fail"
                        : "check-wait"
                    }
                  >
                    {c
                      ? c.status === "stale"
                        ? "○"
                        : c.status === "passed"
                          ? "✓"
                          : "!"
                      : "○"}
                  </span>
                  <div>
                    {
                      [
                        "Totale del carrello",
                        "Quantità non negative",
                        "Carrello vuoto",
                      ][i]
                    }
                    <small>
                      {c
                        ? c.status === "stale"
                          ? "Obsoleta · nuova verifica necessaria"
                          : c.status === "passed"
                            ? "Superato · osservato da Continuity"
                            : "Fallito · da correggere"
                        : "Non ancora verificato"}
                    </small>
                  </div>
                </div>
              );
            })}
            <div className="integrity">
              <span>◈ INTEGRITÀ CHECKPOINT</span>
              <strong>{run?.snapshotId ? "Verificata" : "In attesa"}</strong>
              <code>
                {run?.snapshotId?.slice(0, 20) ??
                  "Nessuno snapshot disponibile"}
              </code>
            </div>
            {run && (
              <a className="export" href={`/api/v1/runs/${run.id}/export`}>
                ↓ Esporta evidenze
              </a>
            )}
            <p className="fine">
              {run?.mode === "live"
                ? "Codice della fixture inviato a OpenAI e Anthropic tramite CLI. Interruzione controllata: non dimostra il rilevamento di quota autentica."
                : "Modalità locale. Nessun dato inviato ai provider. Integrazione live non validata."}
            </p>
          </section>
        </div>
        <footer>
          CONTINUITY · PROTOTIPO V0{" "}
          <span>
            Policy {run?.policy?.id ?? "demo-local-v1"} · effetti esterni
            vietati
          </span>
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
