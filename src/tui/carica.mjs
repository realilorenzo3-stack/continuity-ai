// I file .tsx dell'interfaccia passano da Babel prima di tsx (che conosce solo
// il JSX di React). Hook sincroni (module.registerHooks, Node 26): registrati
// per ultimi, rispondono per primi. module.register è deprecato su Node 26.
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compilaTuiConCache } from "./compila.mjs";

registerHooks({
  load(url, contesto, prossimo) {
    if (url.startsWith("file:") && /\/src\/tui\/.*\.tsx$/.test(url)) {
      const file = fileURLToPath(url);
      return {
        format: "module",
        source: compilaTuiConCache(readFileSync(file, "utf8"), file),
        shortCircuit: true,
      };
    }
    return prossimo(url, contesto);
  },
});
