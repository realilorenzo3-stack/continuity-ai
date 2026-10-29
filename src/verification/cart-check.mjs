import { pathToFileURL } from "node:url";
import { join } from "node:path";
const { total } = await import(pathToFileURL(join(process.cwd(), "cart.mjs")));
let negative = false;
try {
  total([{ price: 10, quantity: -1 }]);
} catch {
  negative = true;
}
const results = [
  {
    id: "positive",
    label: "Totale di quantità positive",
    passed:
      total([
        { price: 10, quantity: 2 },
        { price: 5, quantity: 1 },
      ]) === 25,
  },
  { id: "negative", label: "Rifiuto di quantità negative", passed: negative },
  {
    id: "empty",
    label: "Carrello vuoto uguale a zero",
    passed: total([]) === 0,
  },
];
console.log(JSON.stringify(results));
process.exit(results.every((r) => r.passed) ? 0 : 1);
