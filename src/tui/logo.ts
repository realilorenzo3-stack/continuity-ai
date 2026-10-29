// Il logo di Continuity in caratteri a blocchi: tre righe, disegnato apposta
// (mai il logo di opencode). Sotto i 44 colonne si usa la versione corta.
const LETTERE: Record<string, [string, string, string]> = {
  c: ["█▀▀", "█  ", "▀▀▀"],
  o: ["█▀█", "█ █", "▀▀▀"],
  n: ["█▀▄", "█ █", "▀ ▀"],
  t: ["▀█▀", " █ ", " ▀ "],
  i: ["█", "█", "▀"],
  u: ["█ █", "█ █", "▀▀▀"],
  y: ["█ █", "▀█▀", " ▀ "],
};

export function logo(parola = "continuity"): string[] {
  const righe = ["", "", ""];
  for (const [i, lettera] of [...parola].entries()) {
    const forma = LETTERE[lettera];
    if (!forma) continue;
    for (let r = 0; r < 3; r++) righe[r] += (i ? " " : "") + forma[r];
  }
  return righe;
}
