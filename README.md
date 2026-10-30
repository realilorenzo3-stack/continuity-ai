# Continuity

> **Avviso importante**
> Continuity è un software indipendente e gratuito. **Non è affiliato, approvato né sponsorizzato** da OpenAI, Anthropic, Google, Groq, Mistral, NVIDIA, Cloudflare, Cohere o altri fornitori. I nomi Codex, ChatGPT, Claude, Claude Code, Gemini e gli altri sono marchi dei rispettivi titolari e sono usati solo per indicare i servizi con cui Continuity funziona.
>
> Continuity non include alcun accesso ai modelli. **Servono i tuoi account e le tue chiavi**: Codex e Claude Code li installi e li colleghi tu, con i loro programmi ufficiali; Continuity non vede né conserva le loro credenziali. Le chiavi API che inserisci restano nell'archivio protetto del tuo sistema (Portachiavi sul Mac).
>
> **Sei responsabile del rispetto dei termini di ogni fornitore.** Per esempio: alcuni piani gratuiti usano i tuoi dati per addestrare i modelli o li fanno leggere a persone; alcuni non sono ammessi per lavoro commerciale o in produzione (prove NVIDIA e Cohere); i piani Claude Free/Pro/Max per i residenti nel SEE sono per uso non commerciale. Non inviare dati personali, segreti o codice riservato a servizi che non lo permettono.
>
> Con il servizio «Claude Code · abbonamento», Continuity controlla che le tue impostazioni di Claude Code non lo mandino a una chiave a consumo o a un altro servizio, per evitarti addebiti inattesi: se vuoi usare una chiave API di Anthropic, scegli il servizio «Claude Code · chiave API Anthropic».
>
> Il codice generato dalle AI può contenere errori o riprodurre codice soggetto a licenze di terzi: controllalo prima di usarlo. Continuity lavora su una copia e ti chiede conferma prima di consegnare, ma fai sempre una copia di sicurezza.
>
> Continuity è fornito «così com'è», senza garanzie, nei limiti consentiti dalla legge. Per maggiorenni. Privacy: [PRIVACY.md](PRIVACY.md) · Sicurezza: [SECURITY.md](SECURITY.md) · Software di terzi: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

<details>
<summary><b>Important notice (English)</b></summary>

Continuity is independent, free software. It is **not affiliated with, endorsed or sponsored by** OpenAI, Anthropic, Google, Groq, Mistral, NVIDIA, Cloudflare, Cohere or any other provider. Codex, ChatGPT, Claude, Claude Code, Gemini and other names are trademarks of their owners, used only to identify the services Continuity works with.

Continuity does not include any model access. **You need your own accounts and keys**: you install and sign in to Codex and Claude Code yourself, using their official apps; Continuity never sees or stores their credentials. API keys you enter stay in your system's protected store (Keychain on a Mac).

**You are responsible for complying with each provider's terms.** For example, some free tiers use your data for training or human review; some do not allow commercial or production use (NVIDIA and Cohere trials); Claude Free/Pro/Max plans for EEA residents are for non-commercial use. Do not send personal data, secrets or confidential code to services that do not allow it.

With the "Claude Code · subscription" service, Continuity checks that your Claude Code settings do not route it to a pay-as-you-go key or another service, to avoid unexpected charges; to use an Anthropic API key, choose "Claude Code · Anthropic API key".

AI-generated code may be wrong or may reproduce third-party licensed code: review it before use. Continuity works on a copy and asks before delivering, but always keep a backup.

Continuity is provided "as is", without warranties, to the extent permitted by law. For adults (18+).
</details>

Continuity è uno strumento da terminale per lavorare con più AI sullo stesso progetto. Codex e Claude Code con i tuoi abbonamenti, i servizi gratuiti con le tue chiavi (Groq, Google AI Studio, NVIDIA, Mistral, Cloudflare, Cohere…) e un modello sul tuo computer con Ollama: tutte leggono, scrivono e modificano i file allo stesso modo. Quando un'AI esaurisce i crediti, il lavoro passa da solo alla successiva, che riprende con la stessa conversazione e gli stessi file, senza che tu rispieghi nulla.

**Stato:** versione 2.0, anteprima pubblica. Novità di ogni versione: [CHANGELOG.md](CHANGELOG.md). L'interfaccia è in inglese, oppure in italiano con `/linguaggio`.

## Le AI e come lavorano insieme

- `/collega` aggiunge un'AI: un abbonamento (Codex, Claude Code, con il loro login ufficiale), una chiave gratuita o a consumo. La chiave si prova subito e resta nell'archivio protetto del sistema. Prima di collegare un servizio gratuito, Continuity ti dice con le parole dei suoi termini che cosa fa dei dati (addestramento, lettura da parte di persone, solo prova).
- `/ai` sceglie chi risponde, oppure la **sequenza**: l'ordine in cui le AI si danno il cambio quando i crediti finiscono.
- I servizi gratuiti lavorano sui file attraverso Codex, con un **ponte locale** che traduce le richieste nel formato del servizio. Con i piani piccoli (Groq: circa 8.000 token al minuto) il ponte accorcia la storia vecchia della conversazione, mai la tua richiesta. Se è la richiesta stessa a non entrare, te lo dice prima di mandarla.
- `/flusso` stabilisce come lavorano: un'AI da sola, una che scrive e un'altra che controlla, oppure con un piano da approvare. Ogni pezzo di lavoro ha i suoi giri di correzione. Con la `@` assegni i compiti nel messaggio: «@nvidia scrivi il file, @groq controllalo».
- `/revisore` attiva un'AI che rivede il lavoro a ogni turno, oppure ogni 2, 3… fino a 10 turni, e suggerisce correzioni. I suggerimenti vanno all'AI che lavora solo se non li scarti.
- `/ibrida` usa un modello sul tuo computer (Qwen con Ollama) per i compiti che sceglie tu (`#compito` all'inizio del messaggio) o come riserva.

## La sessione

- Si apre con `continuity` in qualsiasi cartella, con o senza Git. Sotto il riquadro iniziale compare la data dell'ultima modifica al software installato.
- Con Codex e Claude Code, Continuity usa la versione più recente di ciascun CLI fra quelle installate (anche quella dentro l'estensione di VS Code). `/modello` propone i modelli attuali di ogni AI: per Codex dal suo catalogo ufficiale, per i servizi gratuiti quelli gratuiti per il tuo account.
- Le AI lavorano su una copia della cartella. A fine turno Continuity esegue i test del progetto, se ci sono, e porta il risultato nella tua cartella: file nuovi, modificati, eliminati e rinominati. Se nel frattempo hai cambiato lo stesso file, le modifiche in punti diversi si uniscono; se sono nello stesso punto la consegna si ferma e niente viene scritto. `/annulla` torna indietro di una consegna, senza cancellare ciò che hai ritoccato dopo.
- Un turno fallito non viene consegnato. Un turno lungo non viene mai interrotto per tempo; se l'AI resta muta per 20 minuti te lo dice. **Ctrl+C due volte** interrompe il turno conservando il lavoro fatto.
- Ogni AI lavora con tutte le sue funzioni, come nel suo terminale: esegue comandi e test, installa dipendenze, usa la rete per pacchetti e documentazione, la ricerca web, le skill, i sotto-agenti e i connettori. Lo fa nella sandbox del proprio CLI, che le permette di scrivere solo nella copia di lavoro. Finché lavora la stessa AI, Continuity riprende la sua sessione vera, che ricorda tutto quello che ha letto ed eseguito; all'altra AI passa la conversazione e lo stato dei file.
- Claude carica solo le tue impostazioni personali, non quelle del progetto: la copia di lavoro è scrivibile anche dall'altra AI. Le istruzioni di `CLAUDE.md`/`AGENTS.md` e gli agenti in `.claude/agents` arrivano lo stesso; le skill del progetto (`.claude/skills`) no.
- Ragionamento **alto** per Codex e Claude, se non lo cambi con `/modello` (basso, medio, alto, massimo).
- **Connettori**: quelli che hai aggiunto su claude.ai o Claude Code (Gmail, Figma, Supabase…) e su ChatGPT o Codex (app come GitHub e Gmail, plugin e server MCP) entrano da soli anche in Continuity, ciascuno per la sua AI: a ogni avvio Continuity rilegge dalle piattaforme ufficiali quelli presenti in quel momento, e quelli nuovi arrivano già accesi. `/connettori` li elenca con lo stato e permette di spegnerli o riaccenderli per la sessione; quelli da autorizzare vanno collegati sulla piattaforma ufficiale. Continuity non li aggiunge e non ne tocca le credenziali.
- Prompt fino a 200.000 caratteri; un testo incollato aspetta il tuo invio. Allegati con `/allega` (i file di credenziali vengono rifiutati).

**Agenti del progetto, uguali per tutte le AI.** Alla prima sessione Continuity crea nel progetto la cartella `continuity/agenti/` (con un README che spiega il formato) e ci copia gli agenti che il progetto aveva già per Codex (`agents/`, `.codex/agents/`) o per Claude (`.claude/agents/`). Ogni file è un agente: nome, descrizione, permessi (lettura o scrittura), ragionamento, modello per Claude e per Codex, istruzioni. Continuity lo traduce nel formato nativo di ciascuna AI: per Claude un agente di `--agents`, per Codex un ruolo vero (con modello, ragionamento e sola lettura applicati). Basta chiedere «fai controllare all'agente revisore…». A schermo si distingue «delega all'agente revisore» da «delega a un sotto-agente generico».

Per pubblicare su GitHub basta scrivere «pubblica su git» (o «fai il push», «carica su GitHub»; anche `/pubblica`): Continuity consegna prima il lavoro rimasto nella copia, poi fa commit e push della tua cartella con il login GitHub del tuo Mac, senza mai forzare. Il repository si indica la prima volta (`utente/nome`) e viene ricordato. Si ferma a chiedere solo se su GitHub verrebbero eliminati file o se trova possibili password o token. Credenziali e dipendenze non vengono pubblicate; le AI non fanno commit né push. Dopo la prima pubblicazione Continuity chiede se attivare la pubblicazione automatica dopo ogni modifica; la scelta resta per il progetto e si cambia con `/pubblica automatica` (o «attiva/disattiva la pubblicazione automatica»).

Riaprendo Continuity in una cartella, la conversazione precedente ricompare dall'inizio, come in Claude Code e Codex: richieste, lavoro delle AI, risposte e consegne. Le richieste lunghissime mostrano le prime righe.

Comandi in sessione: `/aiuto`.

## Installazione

Su **macOS** e **Linux** (e dentro WSL), nel terminale:

```sh
curl -fsSL https://raw.githubusercontent.com/realilorenzo3-stack/continuity-ai/main/scripts/install.sh | sh
```

Su **Windows**, in PowerShell (Continuity gira in WSL 2, che il comando aiuta ad attivare se manca):

```powershell
irm https://raw.githubusercontent.com/realilorenzo3-stack/continuity-ai/main/scripts/install.ps1 | iex
```

Serve git. L'installatore scarica l'ultima versione pubblicata e ne controlla l'impronta (SHA-256), scarica Node da nodejs.org (controllato anche lui; il Node del sistema non viene toccato) e crea il comando `continuity`. Non chiede sudo né permessi di amministratore. Su Windows crea anche il comando `continuity` per PowerShell, che apre Continuity in WSL nella cartella in cui ti trovi.

Poi, una volta:

```sh
continuity setup            # configurazione iniziale (in italiano: continuity configura)
```

E ogni giorno, nella cartella di un progetto:

```sh
continuity                  # apre o riprende la sessione
```

**Aggiornare:** `continuity update`. Continuity avvisa da solo, all'apertura, quando c'è una versione nuova. Il tuo lavoro e le impostazioni restano; un turno in corso non viene interrotto. Se qualcosa non va, `continuity update --indietro` rimette la versione di prima.

**Disinstallare:** `continuity uninstall` toglie il programma; `continuity uninstall --all` anche dati, impostazioni e chiavi salvate, dopo conferma.

Continuity non legge né copia le credenziali di Codex e Claude Code: il login avviene nel loro programma ufficiale. Le chiavi dei servizi gratuiti si collegano con `/collega` (o durante la configurazione) e restano nell'archivio protetto del sistema: Portachiavi sul Mac, portachiavi di Linux, archivio credenziali di Windows.

Dai sorgenti: `sh scripts/install.sh` nella cartella del programma.

## Sviluppo

```sh
. ./scripts/toolchain.sh
pnpm install --frozen-lockfile
pnpm build && pnpm test && pnpm test:e2e
```

Node 26.4 o più recente (toolchain della 2.0: Node 26.10.0), pnpm 10.17.1. Per i test browser, una volta: `pnpm exec playwright install chromium`.

- `src/core`: motore delle sessioni, consegna (`consegna.ts`), flussi, revisore, limiti e catalogo dei provider.
- `src/ponte`: il ponte locale fra Codex e i servizi gratuiti. `src/tui`: l'interfaccia nel terminale.
- `src/adapters`: lancio e lettura dei CLI dei provider. `src/supervisor`: processi.
- `src/persistence`: SQLite e redazione. `src/git`: fotografie e ripristino. `src/handoff`: pacchetto di passaggio (RHP).
- `src/cli`: terminale. `src/server`: servizio locale. `src/ui`: pannello web.
- `piattaforme/macos` e `piattaforme/linux-windows`: ciò che cambia fra i sistemi (chiavi, cartelle, appunti, browser, processi, WSL). Tutto il resto è comune: una modifica vale per Mac, Linux e Windows. Regole in [piattaforme/LEGGIMI.md](piattaforme/LEGGIMI.md).

## Limiti noti

- Linux e Windows (WSL 2) sono in anteprima: lavori aperti in [piattaforme/linux-windows/CONTESTO_LAVORI.md](piattaforme/linux-windows/CONTESTO_LAVORI.md).
- Non provato: esaurimento dentro un sotto-agente, pilot statistico, macchina vergine, progetti molto grandi, dipendenze su un disco diverso (senza clonazione APFS), interruzione a metà dell'apertura di una sessione.
- Dentro la sandbox le AI non possono avviare un browser (Chromium e WebKit si chiudono): le verifiche nel browser le esegue Continuity, che passa all'AI le ultime righe degli esiti falliti.
- Le skill del progetto (`.claude/skills`) non vengono caricate per Claude, per sicurezza; agenti e istruzioni del progetto sì.
- Il confine è la sandbox di ciascun CLI (Codex `workspace-write` con rete; Claude con la sua sandbox del terminale, la cache dei pacchetti e la rete aperta dalla versione 2.1.186 di Claude Code, un elenco di siti di sviluppo prima). I comandi Git che cambiano la storia sono vietati e, se avvengono, Continuity riporta la copia al punto di partenza del turno.
- Antigravity e Gemini con account personale non sono supportati nelle sessioni (vedi [CONFORMITA](docs/CONFORMITA.md)).

## Marchi e affiliazione

Continuity è un progetto indipendente, **non affiliato** ad Anthropic, OpenAI o Google, e non è approvato né sponsorizzato da loro. I nomi dei loro prodotti compaiono solo per descrivere con quali strumenti Continuity funziona. Ogni persona usa il proprio abbonamento: vedi [docs/CONFORMITA.md](docs/CONFORMITA.md).

## Licenza

Continuity è software libero, distribuito con la licenza [Apache 2.0](LICENSE): puoi usarlo, modificarlo e ridistribuirlo, anche per lavoro, allegando [LICENSE](LICENSE) e [NOTICE](NOTICE). Il nome «Continuity» non è compreso nella licenza. Il software di terzi e le sue licenze sono in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Dettagli in italiano: [docs/COPYRIGHT.md](docs/COPYRIGHT.md).

© 2026 Lorenzo Reali.
