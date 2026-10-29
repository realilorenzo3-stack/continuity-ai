import {
  test,
  expect,
  request,
  type APIRequestContext,
} from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
let server: ChildProcess,
  root: string,
  client: APIRequestContext,
  cookies: any[] = [];
const base = "http://127.0.0.1:4318";
test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "continuity-browser-"));
  server = spawn(process.execPath, ["--import", "tsx", "src/server/main.ts"], {
    env: { ...process.env, CONTINUITY_DATA_DIR: root, PORT: "4318" },
    stdio: "pipe",
  });
  server.stderr?.on("data", () => {});
  for (let i = 0; i < 100 && !existsSync(join(root, "service.json")); i++)
    await new Promise((r) => setTimeout(r, 50));
  const service = JSON.parse(readFileSync(join(root, "service.json"), "utf8"));
  const token = new URLSearchParams(new URL(service.url).hash.slice(1)).get(
    "bootstrap",
  );
  client = await request.newContext({ baseURL: base });
  expect(
    (await client.post("/api/v1/session", { data: { token } })).ok(),
  ).toBeTruthy();
  cookies = (await client.storageState()).cookies;
});
test.beforeEach(async ({ context }) => {
  await context.addCookies(cookies);
});
test.afterAll(async () => {
  server.kill("SIGTERM");
  await new Promise<void>((r) => {
    if (server.exitCode !== null) r();
    else server.once("exit", () => r());
  });
  await client.dispose();
  rmSync(root, { recursive: true, force: true });
});
test("flusso visibile, refresh, RHP, tre criteri e ripristino", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("◉ SIMULAZIONE")).toBeVisible();
  await expect(page.getByLabel("Agente successore")).toHaveValue("claude");
  await page.getByRole("button", { name: "Avvia demo" }).click();
  await expect(
    page.getByText("Calcolo del totale implementato.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Calcolo del totale implementato.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Simula limite" }).click();
  await expect(
    page.getByText("Obiettivo verificato", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Superato · osservato da Continuity")).toHaveCount(3);
  await page.getByRole("button", { name: "Handoff", exact: true }).click();
  await expect(page.locator("pre")).toContainText('"status": "failed"');
  await expect(page.locator("pre")).toContainText('"toAgent": "claude"');
  await page.getByRole("button", { name: "File e ripristino" }).click();
  await page.getByRole("button", { name: "Crea copia di recupero" }).click();
  await expect(
    page.getByText("Copia verificata:", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await page.screenshot({
    path: "docs/evidence/dashboard-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("pausa, ripresa, annulla, vista mobile", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Avvia demo" }).click();
  await expect(
    page.getByText("Calcolo del totale implementato.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pausa", exact: false }).click();
  await expect(page.getByRole("button", { name: "Riprendi" })).toBeVisible();
  await page.getByRole("button", { name: "Riprendi" }).click();
  await expect(
    page.getByRole("button", { name: "Simula limite" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Annulla", exact: true }).click();
  await expect(
    page.getByText("Annullato — lavoro conservato", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "docs/evidence/dashboard-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});
test("API: sessione, origin, CSRF, input, idempotenza e versioni obsolete", async () => {
  const guest = await request.newContext({ baseURL: base });
  expect((await guest.get("/api/v1/runs")).status()).toBe(401);
  expect(
    (
      await guest.get("/api/v1/health", {
        headers: { origin: "https://evil.example" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (await client.post("/api/v1/demo", { data: { goal: "Test" } })).status(),
  ).toBe(403);
  const headers = {
    "x-continuity-csrf": "same-origin",
    "idempotency-key": "e2e-idempotent",
  };
  const first = await client.post("/api/v1/demo", {
    headers,
    data: { goal: "Fixture carrello API" },
  });
  expect(first.status()).toBe(202);
  const r = await first.json();
  const repeated = await client.post("/api/v1/demo", {
    headers,
    data: { goal: "Fixture carrello API" },
  });
  expect((await repeated.json()).id).toBe(r.id);
  expect(
    (
      await client.post("/api/v1/demo", {
        headers,
        data: { goal: "Corpo diverso" },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await client.post(`/api/v1/runs/${r.id}/actions`, {
        headers: { ...headers, "idempotency-key": "stale" },
        data: { action: "cancel", expectedVersion: -1 },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await client.post("/api/v1/demo", {
        headers: { ...headers, "idempotency-key": "bad" },
        data: { goal: "" },
      })
    ).status(),
  ).toBe(400);
  const current = await (await client.get("/api/v1/runs/" + r.id)).json();
  expect(
    (
      await client.post(`/api/v1/runs/${r.id}/actions`, {
        headers: { ...headers, "idempotency-key": "cancel" },
        data: { action: "cancel", expectedVersion: current.version },
      })
    ).ok(),
  ).toBeTruthy();
  await guest.dispose();
});

test("Claude resta selezionabile e completa la demo", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Agente successore").selectOption("claude");
  await page.getByRole("button", { name: "Avvia demo" }).click();
  await expect(
    page.getByText("Calcolo del totale implementato.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Simula limite" }).click();
  await expect(
    page.getByText("Obiettivo verificato", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Handoff", exact: true }).click();
  await expect(page.locator("pre")).toContainText('"toAgent": "claude"');
});

test("Antigravity completa il passaggio e riceve RHP", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Agente successore").selectOption("antigravity");
  await page.getByRole("button", { name: "Avvia demo" }).click();
  await expect(
    page.getByText("Calcolo del totale implementato.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Simula limite" }).click();
  await expect(
    page.getByText("Obiettivo verificato", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Handoff", exact: true }).click();
  await expect(page.locator("pre")).toContainText('"toAgent": "antigravity"');
});
