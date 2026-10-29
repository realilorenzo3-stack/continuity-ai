import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

// Lo stream di `codex exec --json` non mostra la nascita né il lavoro dei
// sotto-agenti: solo, a volte, le attese del coordinatore. Codex però scrive la
// sessione di ogni figlio su disco, e la prima riga dichiara il padre. Seguire
// quei file è l'unico modo di far vedere alla persona che la delega avviene e
// cosa fa ciascun figlio, come già succede con Claude.
export class FigliCodex {
  padre?: string;
  private figli = new Map<string, { letti: number; resto: string }>();
  private estranei = new Set<string>();
  private radice: string;
  constructor(
    private inizio: number,
    private emetti: (testo: string) => void,
    radice?: string,
  ) {
    this.radice =
      radice ??
      join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions");
  }
  private cartelle() {
    const giorni = new Set<string>();
    for (const t of [this.inizio, Date.now()]) {
      const d = new Date(t);
      giorni.add(
        join(
          this.radice,
          String(d.getFullYear()),
          String(d.getMonth() + 1).padStart(2, "0"),
          String(d.getDate()).padStart(2, "0"),
        ),
      );
    }
    return [...giorni].filter((c) => existsSync(c));
  }
  private leggiDa(file: string, da: number) {
    const fd = openSync(file, "r");
    try {
      const dim = statSync(file).size;
      if (dim <= da) return { testo: "", fine: da };
      const quanti = Math.min(dim - da, 4 * 1024 * 1024);
      const buf = Buffer.alloc(quanti);
      readSync(fd, buf, 0, quanti, da);
      return { testo: buf.toString("utf8"), fine: da + quanti };
    } finally {
      closeSync(fd);
    }
  }
  // Vero se un figlio ha scritto qualcosa di nuovo: è un segno di vita del
  // turno anche quando il coordinatore tace.
  scansiona(): boolean {
    let nuovo = false;
    if (!this.padre) return false;
    for (const cartella of this.cartelle()) {
      let voci: string[] = [];
      try {
        voci = readdirSync(cartella).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const voce of voci) {
        const file = join(cartella, voce);
        if (this.estranei.has(file)) continue;
        try {
          if (!this.figli.has(file)) {
            // Un file nato prima di questo turno non può essere un suo figlio.
            if (statSync(file).mtimeMs < this.inizio - 5000) {
              this.estranei.add(file);
              continue;
            }
            const { testo } = this.leggiDa(file, 0);
            const prima = testo.split("\n")[0];
            if (!prima) continue;
            const meta =
              JSON.parse(prima)?.payload?.source?.subagent?.thread_spawn;
            if (!meta || meta.parent_thread_id !== this.padre) {
              this.estranei.add(file);
              continue;
            }
            // Il nome del compito lo sceglie Codex; il ruolo, se c'è, è un
            // agente vero (del progetto o di Codex). Mostrare il compito come
            // se fosse un agente faceva credere a un agente inventato.
            const compito = basename(String(meta.agent_path ?? "sotto-agente"));
            this.emetti(
              meta.agent_role
                ? `delega all'agente ${meta.agent_role} · compito ${compito}`
                : `delega a un sotto-agente generico · compito ${compito}`,
            );
            this.figli.set(file, { letti: 0, resto: "" });
          }
          const stato = this.figli.get(file)!;
          const { testo, fine } = this.leggiDa(file, stato.letti);
          if (fine > stato.letti) nuovo = true;
          stato.letti = fine;
          const righe = (stato.resto + testo).split("\n");
          stato.resto = righe.pop() ?? "";
          for (const riga of righe) this.riga(riga, file);
        } catch {
          // Un file a metà scrittura si rilegge al giro dopo.
        }
      }
    }
    return nuovo;
  }

  // Il consumo di ciascun figlio, l'ultimo totale che ha dichiarato.
  private consumi = new Map<string, { entrata: number; uscita: number; cache: number }>();
  // Quanto hanno consumato i sotto-agenti, con la stessa convenzione usata
  // per il coordinatore: input non preso dalla cache, output (che comprende
  // già il ragionamento) e cache a parte.
  // Prima non era contato, e il totale del turno mostrava solo il
  // coordinatore (collaudo del 3 ottobre, CT-012).
  consumoFigli() {
    let entrata = 0;
    let uscita = 0;
    let cache = 0;
    for (const c of this.consumi.values()) {
      entrata += c.entrata;
      uscita += c.uscita;
      cache += c.cache;
    }
    return { entrata, uscita, cache, figli: this.consumi.size };
  }
  // L'ultimo totale di ciascun figlio (il totale è cumulativo sulla sua
  // sessione): il motore ne somma solo la differenza dal turno prima.
  consumoPerFiglio() {
    return new Map(this.consumi);
  }
  private riga(riga: string, sessione = "") {
    let e: any;
    try {
      e = JSON.parse(riga);
    } catch {
      return;
    }
    const p = e?.payload ?? {};
    if (p.type === "token_count" && p.info?.total_token_usage) {
      const t = p.info.total_token_usage;
      this.consumi.set(sessione, {
        entrata:
          Number(t.input_tokens ?? 0) - Number(t.cached_input_tokens ?? 0),
        // output_tokens comprende già il ragionamento (come per il
        // coordinatore, CT-2.0-002); la cache si conta a parte (CT-2.0-003).
        uscita: Number(t.output_tokens ?? 0),
        cache: Number(t.cached_input_tokens ?? 0),
      });
      return;
    }
    if (p.type !== "custom_tool_call" && p.type !== "function_call") return;
    const corpo = String(p.input ?? p.arguments ?? "");
    if (p.name === "send_message") {
      this.emetti("  ↳ riferisce al coordinatore");
      return;
    }
    const file = [
      ...corpo.matchAll(/\*\*\* (?:Update|Add|Delete) File: ([^\n\\]+)/g),
    ];
    if (file.length) {
      for (const f of file)
        this.emetti(`  ↳ modifica  ${basename(f[1].trim())}`);
      return;
    }
    const comandi = [
      ...corpo.matchAll(/cmd\\?"?\s*:\s*\\?"((?:[^"\\]|\\.)*)\\?"/g),
    ];
    for (const c of comandi.slice(0, 3))
      this.emetti(
        `  ↳ esegue  ${c[1].replace(/\\"/g, '"').replace(/\\n/g, " ").slice(0, 90)}`,
      );
  }
}
