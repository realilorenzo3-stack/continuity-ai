// Avvia la nuova interfaccia e la chiude riportando il terminale com'era.
// Restituisce quando la persona esce: la sessione resta, come con /esci.
import { render } from "@opentui/solid";
import { createCliRenderer } from "@opentui/core";
import { App, type Opzioni } from "./app.js";

export async function avviaTui(opzioni: Opzioni): Promise<void> {
  // Continuity non mostra immagini: senza la domanda sulla grafica kitty, il
  // Terminale di macOS (che non la capisce) non la lascia a schermo come
  // testo all'avvio («…Gi=31337,s=1,v=1,a=q,t=d,f=24;AAAA», prova di Lorenzo
  // del 14 ottobre). La legge la parte nativa di OpenTUI.
  process.env.OPENTUI_GRAPHICS ??= "false";
  // OpenTUI chiede al terminale cosa sa fare (XTGETTCAP, sei DECRQM, OSC 66)
  // prima di passare allo schermo alternativo. Il Terminale di macOS non le
  // capisce e le stampa: «+q4d73pppppp» restava nella finestra dopo l'uscita
  // (prova di Lorenzo del 19 ottobre). Passando prima allo schermo
  // alternativo, quei resti finiscono lì e spariscono all'uscita, quando
  // OpenTUI torna allo schermo normale.
  if (process.stdout.isTTY) process.stdout.write("\x1b[?1049h\x1b[H");
  let esci!: () => void;
  const fine = new Promise<void>((ok) => (esci = ok));
  const renderer = await createCliRenderer({
    // ctrl+c lo gestisce Continuity: svuota il campo, due volte interrompe
    // il turno o esce. Uscire alla prima pressione farebbe perdere il filo.
    exitOnCtrlC: false,
    // Il mouse serve al «+» per allegare e alla «×» degli allegati.
    useMouse: true,
    targetFps: 30,
    onDestroy: () => esci(),
  });
  await render(
    () => <App {...opzioni} onEsci={() => renderer.destroy()} />,
    renderer,
  );
  await fine;
  process.stdout.write(
    "A dopo. Riaprendo Continuity in questa cartella riprendo da qui.\n",
  );
}
