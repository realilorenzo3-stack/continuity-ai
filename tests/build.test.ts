import { it, expect } from "vitest";
import { dicitura, impronta, ultimaModifica } from "../src/core/build.js";
import { schermataIniziale } from "../src/cli/benvenuto.js";

it("dice giorno e ora dell'ultima modifica registrata", () => {
  const b = {
    commit: "2f4ce19",
    dataCommit: "2026-09-30T10:00:00+02:00",
    nonRegistrate: false,
    installataIl: "2026-09-30T09:30:00Z",
  };
  const d = new Date("2026-09-30T10:00:00+02:00");
  const attesa =
    "ultima modifica " +
    d.toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }) +
    " ore " +
    d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) +
    " · 2f4ce19";
  expect(dicitura(b)).toBe(attesa);
});

// Installando modifiche non ancora registrate, la data dell'ultimo commit
// sarebbe più vecchia di ciò che gira davvero: vale l'ora dell'installazione.
it("con modifiche non registrate vale l'ora dell'installazione, e lo dice", () => {
  const b = {
    commit: "2f4ce19",
    dataCommit: "2026-09-29T10:00:00Z",
    nonRegistrate: true,
    installataIl: "2026-09-30T12:15:00Z",
  };
  expect(ultimaModifica(b)?.toISOString()).toBe("2026-09-30T12:15:00.000Z");
  expect(dicitura(b)).toContain("non ancora registrate");
});

it("senza informazioni non inventa una data", () => {
  expect(dicitura(undefined)).toBeUndefined();
  expect(dicitura({ dataCommit: "non è una data" })).toBeUndefined();
});

it("due installazioni diverse hanno impronte diverse", () => {
  expect(impronta({ commit: "a", installataIl: "1" })).not.toBe(
    impronta({ commit: "a", installataIl: "2" }),
  );
});

it("la schermata iniziale mostra la scritta sotto il riquadro", () => {
  const righe = schermataIniziale({
    versione: "0.1.0",
    aggiornamento: "ultima modifica 30/09/2026 ore 10:00 · 2f4ce19",
    cartella: "/tmp/progetto",
    senzaGit: true,
    verifiche: [],
    origineVerifiche: "",
    modificati: 0,
    rotazione: ["codex", "claude"],
  }).map((r) => r.replace(/\u001b\[[0-9;]*m/g, ""));
  const i = righe.findIndex((r) =>
    r.includes("ultima modifica 30/09/2026 ore 10:00"),
  );
  expect(i).toBeGreaterThan(righe.findIndex((r) => r.startsWith("╰")));
});

import { vaSostituito } from "../src/core/build.js";
import { spawn } from "node:child_process";
import { fermo, viviNelGruppo } from "../src/supervisor/process.js";

// Un terminale aperto prima di un aggiornamento abbatteva il servizio a ogni
// installazione, anche in pieno turno: è successo due volte in un collaudo reale.
it("il terminale sostituisce il servizio solo se è più vecchio e fermo", () => {
  const vecchio = "abc@2026-09-30T08:00:00Z";
  const nuovo = "def@2026-09-30T09:00:00Z";
  expect(vaSostituito(vecchio, nuovo, false)).toBe(true);
  // Mai durante un turno.
  expect(vaSostituito(vecchio, nuovo, true)).toBe(false);
  // Un terminale più vecchio non abbatte il servizio nuovo.
  expect(vaSostituito(nuovo, vecchio, false)).toBe(false);
  expect(vaSostituito(nuovo, nuovo, false)).toBe(false);
  expect(vaSostituito(undefined, nuovo, false)).toBe(false);
});

it("un gruppo di processi terminato risulta fermo, uno vivo no", async () => {
  const figlio = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 100));
  expect(fermo(figlio.pid!)).toBe(false);
  expect(viviNelGruppo(figlio.pid!)).toBeGreaterThan(0);
  process.kill(-figlio.pid!, "SIGKILL");
  await new Promise((r) => figlio.once("exit", r));
  await new Promise((r) => setTimeout(r, 100));
  expect(fermo(figlio.pid!)).toBe(true);
});

it("dalla sorgente: l'impronta cambia con il codice, e un servizio senza impronta si sostituisce", async () => {
  const { improntaSorgente } = await import("../src/core/build.js");
  const { mkdtempSync, mkdirSync, writeFileSync, utimesSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const app = mkdtempSync(join(tmpdir(), "continuity-sorgente-"));
  mkdirSync(join(app, "src", "core"), { recursive: true });
  writeFileSync(join(app, "src", "core", "a.ts"), "export {}\n");
  const prima = improntaSorgente(app)!;
  expect(prima).toMatch(/^sorgente-[0-9a-f]{12}@\d{4}-/);
  const dopo = new Date(Date.now() + 60_000);
  writeFileSync(join(app, "src", "core", "b.ts"), "export {}\n");
  utimesSync(join(app, "src", "core", "b.ts"), dopo, dopo);
  const nuova = improntaSorgente(app)!;
  expect(nuova).not.toBe(prima);
  // Il servizio partito prima della modifica è più vecchio: si sostituisce.
  expect(vaSostituito(prima, nuova, false)).toBe(true);
  // Un servizio di prima delle impronte (il caso del 25 ottobre).
  expect(vaSostituito(undefined, nuova, false)).toBe(true);
  // Mai mentre lavora.
  expect(vaSostituito(undefined, nuova, true)).toBe(false);
  // Un'installazione vera senza impronta del servizio resta com'era.
  expect(vaSostituito(undefined, "abc@2026-10-25T10:00:00.000Z", false)).toBe(false);
  expect(improntaSorgente(join(app, "manca"))).toBeUndefined();
});
