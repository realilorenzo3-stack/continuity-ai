import { redactDeep } from "../persistence/redact.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verify, hash } from "../git/snapshot.js";
import type { Store } from "../persistence/store.js";
export function exportRun(store: Store, id: string) {
  const run = store.get(id);
  if (!run) throw Error("Run non trovata");
  const snapshots = run.snapshots.map((s: any) => ({
    id: s.id,
    manifest: verify(run.dir, s.id),
  }));
  const blobs: Record<string, string> = {};
  for (const s of snapshots)
    for (const f of s.manifest.files) {
      const b = readFileSync(join(run.dir, "blobs", f.sha256));
      if (hash(b) !== f.sha256) throw Error("Artefatto corrotto");
      blobs[f.sha256] = b.toString("base64");
    }
  let events: any[] = [];
  let cursor = 0;
  for (;;) {
    const next = store.events(id, cursor);
    if (!next.length) break;
    events.push(...next);
    cursor = next[next.length - 1].seq;
  }
  // Ciò che il registro oscura non deve ricomparire nell'export: la run
  // contiene memoria, richieste ed errori del provider (collaudo, CT-009).
  return {
    schemaVersion: "0.1.0",
    run: redactDeep(run),
    events: redactDeep(events),
    snapshots,
    blobs,
    encoding: "base64",
    scope: "fixture-carrello",
    secretScan:
      "Percorsi esclusi e contenuto fixture noto; nessuna garanzia universale per repository arbitrari",
  };
}
