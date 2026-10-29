// Tipi condivisi fra la logica (comandi.ts) e i dialoghi, in un file senza
// JSX: così i test della logica non trascinano i componenti.
export type Voce<T = string> = {
  nome: string;
  descrizione?: string;
  valore: T;
  // Il valore in uso (il modello attuale, l'AI in testa): segnato con «●».
  attuale?: boolean;
  // Le voci con lo stesso gruppo stanno sotto il suo titolo.
  gruppo?: string;
  // A destra, attenuato: il comando o la scorciatoia.
  tasto?: string;
};
