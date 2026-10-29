# Conformità ai termini dei fornitori

Continuity avvia i CLI ufficiali dei fornitori di AI sul computer di chi lo usa.
Questo documento dichiara cosa fa e cosa non fa, con le clausole a cui si
riferisce. Non è una consulenza legale: è la descrizione verificabile del
comportamento del software, con i collegamenti alle fonti primarie consultate il
26 settembre 2026.

## Cosa Continuity non fa

- **Non tocca le credenziali.** Il login avviene nel CLI ufficiale del
  fornitore, attraverso il suo flusso. Continuity non legge, non copia, non
  conserva e non inoltra token OAuth, chiavi o sessioni.
- **Non modifica i binari dei fornitori.** Li avvia come pubblicati, senza
  patch, senza alterare identificativi, senza fingersi il client ufficiale.
- **Non intermedia l'uso per conto di altri.** Ogni persona usa il proprio
  abbonamento sul proprio computer. Non esiste una modalità ospitata, non ci
  sono account condivisi, non si rivende nulla: il software non viene venduto né dato in uso a terzi in questa fase.
- **Non aggira i limiti.** Quando un fornitore dichiara la quota esaurita,
  Continuity smette di chiamarlo. Non ritenta, non ruota account, non usa
  proxy. Passa a un fornitore diverso che la persona già paga, e questo non è
  elusione: è smettere di usare un servizio e usarne un altro.
- **Non aggiunge né autentica connettori.** I connettori (Gmail, Figma,
  Google Calendar…) si aggiungono e si autorizzano solo sulle piattaforme
  ufficiali: claude.ai o Claude Code per Claude, ChatGPT o Codex per Codex.
  Continuity legge l'elenco con i comandi pubblici dei CLI (`claude mcp list`,
  `codex mcp list` e la configurazione di Codex), lascia che ciascun CLI li
  carichi a modo suo e permette solo di spegnerli per una sessione. Non vede
  né conserva i loro token.
- **Non ridistribuisce i CLI.** Vanno installati dall'utente. In particolare
  Claude Code non è open source e non può essere incluso o ripacchettizzato.

## Antigravity di Google: non supportato, e perché

I termini di Google vietano espressamente, nominando strumenti terzi per
esempio, l'accesso ad Antigravity con software non loro, e l'FAQ ufficiale
indica la sospensione dell'account fra le conseguenze. Sono documentati casi
reali di sospensioni permanenti. Continuity quindi **rifiuta di selezionare
Antigravity** e lo dice apertamente. La strada che Google stessa indica è una
chiave API (Gemini API o Gemini Enterprise): se verrà sostenuta, sarà per
quella via, mai tramite il login di Antigravity.

## Adempimenti a carico di chi distribuisce

- Anthropic richiede che chi «esegue Claude Code nel proprio prodotto» accetti
  i Commercial Terms of Service, fermi restando i Consumer Terms per chi lo usa
  con il proprio abbonamento.
- I nomi dei fornitori si usano solo in testo semplice e in senso descrittivo
  («funziona con Claude Code e Codex»). Nessun logo, nessun marchio altrui nel
  nome del progetto, nel dominio o nell'interfaccia, nessuna affiliazione
  suggerita.

## Cosa può cambiare

I fornitori modificano queste regole senza preavviso, e Anthropic lo dichiara
espressamente. Nel 2026 ha annunciato e poi sospeso una revisione del modo in
cui l'uso programmatico attinge ai limiti dell'abbonamento. Chi usa Continuity
deve sapere che il proprio abbonamento resta soggetto ai termini del fornitore,
che i limiti annunciati presuppongono un «uso ordinario e individuale», e che la
responsabilità dell'uso resta di chi lo esercita.

## Fonti consultate il 26 settembre 2026

- Anthropic, Claude Code — Legal and compliance: <https://code.claude.com/docs/en/legal-and-compliance>
- Anthropic, Consumer Terms of Service: <https://www.anthropic.com/legal/consumer-terms>
- Anthropic, Usage Policy: <https://www.anthropic.com/legal/aup>
- OpenAI, Terms of Use: <https://openai.com/policies/row-terms-of-use/>
- OpenAI, Codex — modalità non interattiva: <https://learn.chatgpt.com/docs/non-interactive-mode>
- Google, Antigravity — termini aggiuntivi e FAQ: <https://antigravity.google/terms/> e <https://antigravity.google/docs/faq/>
