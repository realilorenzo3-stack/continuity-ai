# Le distribuzioni di Continuity

Continuity è **un programma solo**, con tre distribuzioni (decisione di Lorenzo del 30 ottobre 2026; Windows nativo dal 31 ottobre):

| Cartella | Sistemi | Stato | Dove si sviluppa |
|---|---|---|---|
| [`macos/`](macos/LEGGIMI.md) | macOS | completa e funzionante | sul Mac |
| [`linux-windows/`](linux-windows/LEGGIMI.md) | Linux, Windows con WSL 2 | in sviluppo ([prossimi lavori](linux-windows/CONTESTO_LAVORI.md)) | su Linux, o sul PC Windows dentro WSL |
| [`windows/`](windows/LEGGIMI.md) | Windows 10 e 11, senza WSL | completa, in collaudo | sul PC Windows, in PowerShell |

## Come restano allineate

- **Il codice comune sta in `src/`**: motore, interfaccia, ponte, flussi, revisore, lingua. Una modifica lì vale subito per tutti i sistemi.
- **In ogni distribuzione c'è solo ciò che cambia fra i sistemi:** archivio delle chiavi, cartelle dei dati, browser, appunti, copia delle dipendenze, processi, scelta dei file, Git sul disco di Windows, comando per PowerShell.
- **Il codice comune usa le distribuzioni solo attraverso tre file:**
  - `src/piattaforma.ts`;
  - `src/core/portachiavi.ts`;
  - `src/git/ambiente.ts`.

  Ciascuno sceglie la distribuzione giusta per il sistema in uso.
- **Le distribuzioni hanno le stesse funzioni** (`sistema.ts`, `portachiavi.ts`, `allegati.ts`), con gli stessi nomi. Se ne aggiungi una a una distribuzione, aggiungila anche alle altre.
- **Una versione sola per tutti:** `pnpm rilascio <versione>` pubblica Mac, Linux e Windows insieme.

## Le regole

1. **Un comportamento comune va in `src/`**, mai copiato in una distribuzione. Un comando di un sistema solo (`pbcopy`, `security`, `secret-tool`, `powershell.exe`, `process.platform`…) va nella sua distribuzione. `tests/struttura.test.ts` fallisce se uno di questi comandi finisce nel codice comune.
2. **Una modifica a una distribuzione si fa anche nelle altre**, adattata al loro sistema, se vale per tutti. Esempio: un nuovo modo di aprire i link vuol dire `comandoApriLink` in tutte.
3. **Prima di salvare, le prove:**
   - `pnpm test` sul computer su cui lavori;
   - a ogni `git push`, GitHub esegue le prove su Ubuntu e su Windows (con l'installazione vera del pacchetto per Windows);
   - a ogni versione (`pnpm rilascio`), su Ubuntu e su macOS.

   Una modifica fatta dal PC Windows che rompe il Mac ferma la versione prima che esca, e viceversa.
4. **Il registro del lavoro è uno solo:** `docs/CONTEXT.md`, aggiornato a ogni modifica da qualunque computer. `linux-windows/CONTESTO_LAVORI.md` è la lista dei lavori aperti di quella distribuzione: si toglie una voce quando è fatta e verificata.
5. **Dal Mac e dal PC si lavora sulla stessa repository e sullo stesso ramo `main`:** prima di cominciare `git pull`, alla fine `git push`.
