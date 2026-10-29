// Un testo lungo diviso in righe larghe al massimo «larghezza», a parole.
export function aCapo(testo: string, larghezza: number): string[] {
  const fuori: string[] = [];
  for (const riga of testo.split("\n")) {
    if (!riga.trim()) {
      fuori.push("");
      continue;
    }
    let corrente = "";
    for (const parola of riga.split(/(\s+)/)) {
      if ((corrente + parola).length <= larghezza) corrente += parola;
      else {
        if (corrente.trim()) fuori.push(corrente.trimEnd());
        // Una parola più lunga della riga si spezza.
        let resto = parola.trimStart();
        while (resto.length > larghezza) {
          fuori.push(resto.slice(0, larghezza));
          resto = resto.slice(larghezza);
        }
        corrente = resto;
      }
    }
    if (corrente.trim()) fuori.push(corrente.trimEnd());
  }
  return fuori;
}
