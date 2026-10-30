// macOS: le chiavi nel Portachiavi, con il comando «security». La chiave
// entra dallo standard input (modalità -i): sulla riga di comando sarebbe
// visibile a chiunque guardi i processi. Parte della distribuzione macOS
// (piattaforme/macos/LEGGIMI.md).
import { spawnSync } from "node:child_process";
import { ricordaSegreto } from "../../src/persistence/redact.js";
import { servizioPortachiavi, tra, type Portachiavi } from "../../src/core/archivio.js";

// La conferma del Mac (decisione di Lorenzo, 17 ottobre 2026): la voce si
// salva con l'elenco delle app fidate vuoto («-T ""»), così macOS chiede il
// permesso a ogni lettura del segreto, anche a «security» stesso. Per non
// chiederlo a ogni turno, il servizio legge una volta e tiene la chiave in
// memoria finché la voce non cambia: gli attributi (date comprese) si leggono
// senza permesso e fanno da impronta. Senza «-w» il Mac non chiede nulla.
export const NOTA_CONFERMA =
  "La chiave va nel Portachiavi del Mac: al primo uso dopo ogni avvio il Mac chiede il permesso, scegli «Consenti» (non «Consenti sempre»).";
const ricordate = new Map<string, { impronta: string; chiave: string }>();

export function portachiaviMac(
  cartellaDati: string,
  comando = "/usr/bin/security",
): Portachiavi {
  const servizio = servizioPortachiavi(cartellaDati);
  const attributi = (provider: string) => {
    const r = spawnSync(
      comando,
      ["find-generic-password", "-s", servizio, "-a", provider],
      { encoding: "utf8", timeout: 10000 },
    );
    return r.status === 0 ? r.stdout : undefined;
  };
  const voce = (provider: string) => `${servizio}\0${provider}`;
  return {
    esiste: (provider) => attributi(provider) !== undefined,
    leggi(provider) {
      const impronta = attributi(provider);
      if (impronta === undefined) {
        ricordate.delete(voce(provider));
        return undefined;
      }
      const giaLetta = ricordate.get(voce(provider));
      if (giaLetta?.impronta === impronta) return giaLetta.chiave;
      // Qui il Mac mostra il riquadro: si lascia il tempo di rispondere.
      const r = spawnSync(
        comando,
        ["find-generic-password", "-s", servizio, "-a", provider, "-w"],
        { encoding: "utf8", timeout: 120000 },
      );
      const chiave = r.status === 0 ? r.stdout.replace(/\n$/, "") : "";
      if (!chiave)
        throw Error(
          `Il Mac non ha dato il permesso di leggere la chiave di ${provider}: riprova e scegli «Consenti» (non «Consenti sempre»)`,
        );
      ricordate.set(voce(provider), { impronta, chiave });
      ricordaSegreto(chiave);
      return chiave;
    },
    salva(provider, chiave) {
      ricordaSegreto(chiave);
      // Si toglie la voce vecchia: «-U» non cambierebbe chi può leggerla, e
      // una chiave salvata prima del 17 ottobre resterebbe senza conferma.
      spawnSync(comando, ["delete-generic-password", "-s", servizio, "-a", provider], {
        encoding: "utf8",
        timeout: 10000,
      });
      ricordate.delete(voce(provider));
      const r = spawnSync(comando, ["-i"], {
        input: `add-generic-password -s ${tra(servizio)} -a ${tra(provider)} -l ${tra(`${servizio} · ${provider}`)} -T "" -w ${tra(chiave)}\n`,
        encoding: "utf8",
        timeout: 10000,
      });
      if (r.status !== 0 || /error|errore/i.test(r.stderr))
        throw Error(
          "Il Portachiavi non ha accettato la chiave" +
            (r.stderr ? `: ${r.stderr.trim().slice(0, 200)}` : ""),
        );
    },
    togli(provider) {
      ricordate.delete(voce(provider));
      const r = spawnSync(
        comando,
        ["delete-generic-password", "-s", servizio, "-a", provider],
        { encoding: "utf8", timeout: 10000 },
      );
      return r.status === 0;
    },
  };
}
