# Privacy di Continuity

Continuity funziona sul tuo computer. **Lorenzo Reali**, l'autore, non riceve il tuo codice, i tuoi messaggi, le tue chiavi né dati d'uso: non c'è telemetria e non ci sono server di Continuity.

## Che cosa esce dal computer, e solo per tua scelta

- I testi e i file che invii alle AI che hai collegato (Codex, Claude Code, Groq, Google AI Studio, Mistral, NVIDIA, Cloudflare, Cohere…), verso quei fornitori, che li trattano secondo le loro informative. Quando un servizio usa i dati per addestrare i modelli, li fa leggere a persone o è solo di prova, Continuity te lo dice con le parole dei suoi termini quando lo colleghi (`/collega`). Da quel momento, se lo scegli per lavorare, per controllare o come revisore, riceve i messaggi e i file del progetto che servono al suo lavoro, senza una nuova domanda ogni volta. Se non vuoi mandargli il codice, non collegarlo o scollegalo.
- La verifica delle chiavi, verso il fornitore della chiave.
- Il catalogo dei modelli scaricato da models.dev, che vede il tuo indirizzo IP.
- Il controllo delle versioni nuove: a ogni apertura Continuity chiede a GitHub qual è l'ultima versione pubblicata; GitHub vede il tuo indirizzo IP. Si spegne con `CONTINUITY_AGGIORNAMENTI=spenti` o con `"aggiornamenti": false` nel file `interfaccia.json` della cartella dati.
- L'installazione e `continuity update`, che scaricano Continuity da GitHub, Node da nodejs.org e le dipendenze dal registro npm.
- Le pubblicazioni su GitHub, fatte con il tuo `gh`.

Qwen e gli altri modelli che giri con Ollama restano sul computer.

## Il ponte locale

I servizi gratuiti lavorano sui file attraverso Codex. Continuity avvia sul computer un piccolo ponte, raggiungibile solo dal computer stesso (127.0.0.1) e solo con un gettone che cambia a ogni avvio. Il ponte riceve le richieste di Codex, le manda al servizio che hai scelto con la tua chiave e restituisce le risposte. Non manda nulla altrove.

Il ponte tiene un registro locale, `ponte/registro.log` nella cartella dati, leggibile solo dal tuo utente: oltre 1 MB ricomincia, tenendo solo la copia precedente. Per ogni richiesta registra:
- servizio, modello, esito e una stima dei token;
- i limiti che il servizio dichiara;
- per gli errori, il codice e i numeri del limite.

Non registra i testi delle richieste, le risposte né le chiavi. Se un servizio ripete la chiave in un messaggio di errore, la chiave viene tolta prima di mostrarlo o registrarlo. Lo stesso vale per tutto ciò che Continuity conserva (sessioni, eventi, memoria): le chiavi lette dal Portachiavi ne vengono tolte, in qualsiasi forma compaiano. Nella stessa cartella, `ponte/modelli.json` ricorda quali modelli gratuiti hanno risposto e quali no.

Al revisore e agli altri controlli Continuity non manda i file di credenziali (`.env`, chiavi, file di segreti), i collegamenti simbolici né la cartella `allegati/`.

## Che cosa resta sul computer

- Le chiavi API, nell'archivio protetto del sistema: Portachiavi sul Mac, portachiavi di Linux (libsecret), archivio credenziali di Windows con WSL. Dove l'archivio non c'è o non risponde (per esempio Linux senza desktop), in un file `chiavi.json` nella cartella dati, leggibile solo dal tuo utente: Continuity lo dice prima di salvare la chiave.
- Sessioni, memoria e impostazioni, nella cartella dati di Continuity (`~/Library/Application Support/Continuity…` sul Mac, `~/.local/share/Continuity…` su Linux e WSL). `sh scripts/uninstall.sh --all` le cancella, dopo conferma, insieme alle chiavi di quella cartella nel Portachiavi.

Continuity non legge le credenziali di Codex e Claude Code: usa i loro programmi ufficiali, collegati da te.

## Download

GitHub e il registro npm trattano i dati tecnici dei download come titolari autonomi.

## Se scrivi all'autore

Se apri una issue sul repository GitHub di Continuity, il tuo nome utente e il messaggio servono solo a risponderti. Hai i diritti degli articoli 15–22 del GDPR e puoi presentare reclamo al Garante per la protezione dei dati personali.
