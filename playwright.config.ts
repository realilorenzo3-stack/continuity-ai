import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4318",
    headless: true,
    viewport: { width: 1440, height: 1100 },
    launchOptions: process.env.RELAY_CHROME
      ? { executablePath: process.env.RELAY_CHROME }
      : {},
  },
  reporter: [["list"], ["json", { outputFile: "docs/evidence/browser.json" }]],
});
