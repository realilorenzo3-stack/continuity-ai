import { it, expect } from "vitest";
import { rendiStorico } from "../src/cli/storico.js";

const ev = (
  seq: number,
  type: string,
  message: string,
  recordedAt?: string,
) => ({
  seq,
  type,
  recordedAt,
  payload: { message },
});
const pulito = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

it("ristampa la conversazione com'era: richiesta, lavoro, risposta, consegna", () => {
  const testo = pulito(
    rendiStorico([
      ev(1, "task.created", "interno"),
      ev(2, "user.request", "Crea il sito"),
      ev(3, "turn.started", "Turno 1 · agente codex", "2026-10-08T10:00:00Z"),
      ev(4, "attempt.started", "codex reale avviato"),
      ev(5, "agent.action", "esegue  python3 - <<'PY'\nprint(1)\nPY"),
      ev(6, "agent.action", "delega a un sotto-agente (design)"),
      ev(7, "agent.message", "Fatto.\nEcco il sito."),
      ev(8, "usage.reported", "100 token in ingresso · 20 in uscita"),
      ev(
        9,
        "turn.completed",
        "Turno 1 concluso da codex",
        "2026-10-08T10:01:30Z",
      ),
      ev(10, "work.applied", "File portati nella cartella: index.html"),
      ev(11, "snapshot.completed", "interno"),
    ]),
  );
  expect(testo).toContain("› Crea il sito");
  expect(testo).toContain("codex ha lavorato");
  expect(testo).toContain("· esegue  python3 - <<'PY' print(1) PY");
  expect(testo).toContain("⤷ delega a un sotto-agente (design)");
  expect(testo).toContain("  Fatto.\n  Ecco il sito.");
  expect(testo).toContain("Turno 1 concluso da codex · 1m30 · 100 in · 20 out");
  expect(testo).toContain("✓ File portati nella cartella: index.html");
  expect(testo).not.toContain("interno");
  // L'ordine è quello in cui è successo.
  expect(testo.indexOf("Crea il sito")).toBeLessThan(testo.indexOf("Fatto."));
});

it("per le sessioni di prima recupera le richieste dalla conversazione, per data", () => {
  const testo = pulito(
    rendiStorico(
      [
        ev(1, "turn.started", "Turno 1", "2026-10-06T10:00:05Z"),
        ev(2, "turn.completed", "Turno 1 concluso", "2026-10-06T10:01:00Z"),
        ev(3, "turn.started", "Turno 2", "2026-10-06T11:00:05Z"),
        ev(4, "turn.completed", "Turno 2 concluso", "2026-10-06T11:01:00Z"),
        ev(5, "turn.started", "Turno 3", "2026-10-06T12:00:05Z"),
      ],
      [
        { role: "utente", text: "prima richiesta", at: "2026-10-06T10:00:00Z" },
        { role: "ai", text: "risposta", at: "2026-10-06T10:00:50Z" },
        { role: "utente", text: "terza richiesta", at: "2026-10-06T12:00:00Z" },
      ],
    ),
  );
  expect(testo).toContain("› prima richiesta");
  expect(testo).toContain("› (richiesta non conservata)");
  expect(testo).toContain("› terza richiesta");
  expect(testo.indexOf("prima richiesta")).toBeLessThan(
    testo.indexOf("non conservata"),
  );
});

it("una richiesta lunghissima mostra l'inizio e quante righe aveva; una sessione nuova non ha storico", () => {
  const lunga = Array.from({ length: 300 }, (_, i) => `riga ${i + 1}`).join(
    "\n",
  );
  const testo = pulito(
    rendiStorico([
      ev(1, "user.request", lunga),
      ev(2, "turn.started", "Turno 1"),
    ]),
  );
  expect(testo).toContain("riga 12");
  expect(testo).not.toContain("riga 13\n");
  expect(testo).toContain("300 righe in tutto");
  expect(rendiStorico([ev(1, "session.ready", "pronta")])).toBe("");
});
