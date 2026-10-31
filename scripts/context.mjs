import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
  watch,
} from "node:fs";
import { resolve, join, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("..", import.meta.url))),
  statePath = join(root, ".context-state.json"),
  context = join(root, "docs", "CONTEXT.md");
const skip = new Set([
  "node_modules",
  ".git",
  "dist",
  "test-results",
  "playwright-report",
  ".context-state.json",
  "CONTEXT.md",
  ".DS_Store",
]);
function collect(dir, output = {}) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name),
      st = statSync(path);
    if (st.isDirectory()) collect(path, output);
    else if (st.isFile()) {
      // Sempre con «/», anche su Windows: lo stesso inventario su ogni computer.
      const rel = relative(root, path).split(sep).join("/");
      output[rel] = createHash("sha256")
        .update(readFileSync(path))
        .digest("hex");
    }
  }
  return output;
}
function update() {
  // Development-only inventory: an installed copy has no workspace to annotate.
  if (!existsSync(context)) return;
  const files = collect(root),
    old = existsSync(statePath)
      ? JSON.parse(readFileSync(statePath, "utf8"))
      : {};
  const changed = [
    ...new Set([...Object.keys(files), ...Object.keys(old)]),
  ].filter((p) => files[p] !== old[p]);
  if (!changed.length) return;
  const now = new Date().toISOString();
  writeFileSync(statePath, JSON.stringify(files, null, 2));
  const text = readFileSync(context, "utf8"),
    section = `<!-- inventory:start -->\n## Inventario automatico\nUltimo controllo con modifiche: ${now}. File monitorati: ${Object.keys(files).length}.\n\nUltimo gruppo di modifiche rilevato:\n${changed.map((p) => "- `" + p + "`" + (!files[p] ? " (rimosso)" : "")).join("\n")}\n\nQuesto inventario rileva cambiamenti ai file; il registro manuale sopra descrive motivazioni, verifiche e limiti.\n<!-- inventory:end -->`;
  writeFileSync(
    context,
    text.includes("<!-- inventory:start -->")
      ? text.replace(
          /<!-- inventory:start -->[\s\S]*?<!-- inventory:end -->/,
          section,
        )
      : text + "\n" + section + "\n",
  );
  console.log(`Contesto aggiornato: ${changed.length} file modificati.`);
}
update();
if (process.argv.includes("--watch")) {
  let timer;
  watch(root, { recursive: true }, (_event, name) => {
    if (!name || name.split("/").some((p) => skip.has(p))) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        update();
      } catch (e) {
        console.error(e.message);
      }
    }, 400);
  });
  console.log("Monitoraggio contesto attivo.");
}
