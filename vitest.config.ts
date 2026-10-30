import { defineConfig } from "vitest/config";
// @ts-expect-error modulo JavaScript senza tipi
import { compilaTui } from "./src/tui/compila.mjs";

export default defineConfig({
  plugins: [
    // I componenti dell'interfaccia (Solid per OpenTUI) si compilano come a
    // runtime (src/tui/hook.mjs), non con il JSX di React.
    {
      name: "continuity-tui",
      enforce: "pre",
      transform(codice: string, id: string) {
        if (/\/(src|tests)\/tui\/.*\.tsx$/.test(id))
          return { code: compilaTui(codice, id), map: null };
      },
    },
  ],
  test: {
    include: ["tests/**/*.test.ts", "tests/tui/**/*.test.tsx"],
    testTimeout: 15000,
    // L'AI ibrida resta fuori dai test: su un Mac con Ollama acceso il motore
    // lo userebbe davvero come riserva. I test dell'AI ibrida la accendono.
    // La lingua: l'inglese è quella di serie (28 ottobre), ma i test
    // controllano i testi italiani; i test dell'inglese la cambiano da sé.
    // Anche Ollama: lo spegnimento del motore lo interroga per liberare il
    // modello, e nei test non deve mai raggiungere quello vero della persona
    // (porta 9, sempre chiusa). I test di Ollama usano un server finto.
    env: { CONTINUITY_IBRIDA: "spenta", CONTINUITY_OLLAMA_URL: "http://127.0.0.1:9", CONTINUITY_LINGUA: process.env.CONTINUITY_LINGUA ?? "it", CONTINUITY_SENZA_CODEX: "1", CONTINUITY_SENZA_CLAUDE: "1" },
    fileParallelism: false,
    // CLI finte per la versione, solo dove Codex e Claude Code non ci sono.
    setupFiles: ["tests/cli-finte.ts"],
  },
});
