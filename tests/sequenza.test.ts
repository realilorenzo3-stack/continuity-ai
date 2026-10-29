// La sequenza di lavoro delle AI si sceglie a mano, un'AI alla volta
// (decisione di Lorenzo del 29 ottobre): la prima, la seconda, poi «Conferma».
import { it, expect } from "vitest";
import { ordine } from "../src/tui/comandi.js";

function contesto(risposte: (string | undefined)[], providers = ["codex", "claude"]) {
  const riquadri: { titolo: string; voci: any[]; nota?: string }[] = [];
  const chiamate: any[] = [];
  const c: any = {
    id: "r1",
    run: () => ({ providers }),
    avvisa: () => {},
    aggiorna: async () => {},
    api: async (percorso: string, corpo: any) => {
      chiamate.push([percorso, corpo]);
      return { providers: corpo.richiesta.replace(/^solo /, "").split(" ") };
    },
    scegli: async (titolo: string, voci: any[], opzioni?: any) => {
      riquadri.push({ titolo, voci, nota: opzioni?.nota });
      const r = risposte.shift();
      return r === undefined ? undefined : voci.find((v) => v.valore === r);
    },
  };
  return { c, riquadri, chiamate };
}

it("si sceglie la prima AI, poi la seconda, poi si conferma: la sequenza è esattamente quella", async () => {
  const { c, riquadri, chiamate } = contesto(["claude", "groq", "\u0000fine"]);
  await ordine(c, "");
  expect(chiamate).toEqual([["/runs/r1/providers", { richiesta: "solo claude groq" }]]);
  expect(riquadri[0].titolo).toBe("Scegli la sequenza di lavoro delle AI");
  expect(riquadri[0].nota).toMatch(/^Scegli quale AI lavora per prima: quando finisce i crediti, il lavoro passa alla seconda, e così via\. Ora: Codex → Claude Code\.$/);
  // Si vede dov'è oggi ciascuna, e la scelta fatta non si ripropone.
  expect(riquadri[0].voci.find((v) => v.valore === "codex").tasto).toBe("ora 1ª");
  expect(riquadri[1].voci.some((v) => v.valore === "claude")).toBe(false);
  expect(riquadri[1].nota).toBe("Finora: Claude Code. Scegli la 2ª AI, oppure conferma.");
  expect(riquadri[1].voci.map((v) => v.gruppo)).toContain("2ª AI");
  // Nella prima scelta non c'è ancora nulla da confermare.
  expect(riquadri[0].voci.some((v) => v.valore === "\u0000fine")).toBe(false);
});

it("«Ricomincia» riparte da capo; esc lascia la sequenza com'era", async () => {
  const ricomincia = contesto(["claude", "\u0000capo", "codex", "\u0000fine"]);
  await ordine(ricomincia.c, "");
  expect(ricomincia.chiamate[0][1]).toEqual({ richiesta: "solo codex" });

  const esc = contesto(["claude", undefined]);
  await ordine(esc.c, "");
  expect(esc.chiamate).toEqual([]);
});
