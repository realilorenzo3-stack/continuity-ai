// La rotella del piè, come quella di opencode (8 caselle con una scia che
// sfuma, aggiornata spesso: packages/tui/src/ui/spinner.ts, MIT), rifatta con
// i colori di Continuity: la testa nel colore dell'AI, la scia verso il fondo.
export const CASELLE = 8;

function mescola(a: string, b: string, t: number) {
  const n = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [n(a), n(b)];
  return (
    "#" +
    x
      .map((v, i) => Math.round(v * t + y[i] * (1 - t)).toString(16).padStart(2, "0"))
      .join("")
  );
}

// Un fotogramma: per ogni casella il carattere e il colore. La testa va
// avanti e indietro; dietro di lei tre caselle che sfumano.
export function fotogramma(passo: number, colore: string, fondo: string) {
  const giro = (CASELLE - 1) * 2;
  const p = passo % giro;
  const testa = p < CASELLE ? p : giro - p;
  const verso = p < CASELLE ? -1 : 1;
  return Array.from({ length: CASELLE }, (_, i) => {
    const distanza = (i - testa) * verso;
    if (distanza === 0) return { c: "■", fg: colore };
    if (distanza > 0 && distanza <= 3)
      return { c: "■", fg: mescola(colore, fondo, 1 - distanza * 0.25) };
    return { c: "⬝", fg: mescola(colore, fondo, 0.35) };
  });
}
