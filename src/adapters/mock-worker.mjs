import { writeFileSync, readFileSync } from "node:fs";
const stage = process.argv[2];
// On a real project the mock has nothing meaningful to edit: it reports and exits,
// so the pipeline is exercised while the verification runs against untouched files.
const noEdit = process.argv.includes("--no-fixture-edit");
if (stage !== "codex") {
  const handoff = JSON.parse(readFileSync(process.argv[3], "utf8"));
  if (
    handoff.schemaVersion !== "0.1.0" ||
    !handoff.goal ||
    handoff.toAgent !== stage ||
    handoff.policy.externalEffects !== "deny"
  )
    process.exit(2);
  console.log(
    JSON.stringify({ type: "message", text: "RHP letto: " + handoff.goal }),
  );
}
console.log(JSON.stringify({ type: "started", stage }));
setTimeout(() => {
  if (!noEdit)
    writeFileSync(
      "cart.mjs",
      stage === "codex"
        ? "export function total(items) { return items.reduce((s,i)=>s+i.price*i.quantity,0); }\n"
        : 'export function total(items) { if(items.some(i=>!Number.isFinite(i.price)||i.price<0||!Number.isInteger(i.quantity)||i.quantity<0)) throw new Error("Invalid item"); return items.reduce((s,i)=>s+i.price*i.quantity,0); }\n',
    );
  console.log(
    JSON.stringify({
      type: "message",
      text: noEdit
        ? "Simulazione: nessuna modifica ai file del progetto."
        : stage === "codex"
          ? "Calcolo del totale implementato."
          : "Validazione delle quantità completata.",
    }),
  );
}, 500);
// Sulla prova dimostrativa codex resta al lavoro finché non lo ferma la quota
// simulata. In una sessione simulata su un progetto il turno deve finire,
// per qualunque AI: prima il turno di codex non finiva mai e il processo
// restava acceso anche dopo lo spegnimento del servizio.
if (stage !== "codex" || noEdit) setTimeout(() => process.exit(0), 1500);
else setInterval(() => {}, 1000);
