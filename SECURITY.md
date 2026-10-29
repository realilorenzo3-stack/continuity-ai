# Sicurezza di Continuity

## Come segnalare una vulnerabilità

Usa la segnalazione privata di GitHub: nel repository di Continuity, scheda **Security** → **Report a vulnerability**. Non aprire una issue pubblica e non pubblicare dettagli finché la correzione non è disponibile.

Indica, se puoi: la versione (in basso nella finestra di Continuity, per esempio `v2.0.0 · abc1234`), i passi per riprodurre il problema, che cosa succede e che cosa ti aspettavi.

## Che cosa succede dopo

- Rispondo entro 7 giorni per confermare di aver ricevuto la segnalazione.
- Se la vulnerabilità è confermata, la correggo il prima possibile e la descrivo nelle note della versione, citandoti se lo desideri.
- Una vulnerabilità sfruttata attivamente ha la precedenza su ogni altro lavoro.

## Versioni supportate

Solo l'ultima versione pubblicata. Aggiorna rieseguendo l'installer.

## Che cosa conta come vulnerabilità

Per esempio: Continuity che manda a un servizio esterno file che non dovrebbe (credenziali, file fuori dal progetto), che scrive fuori dalla copia di lavoro o nella tua cartella senza conferma, che espone il servizio locale ad altri computer, o che lascia un'AI usare strumenti con effetti esterni senza il tuo permesso.

I problemi dei programmi dei fornitori (Codex, Claude Code, Ollama) vanno segnalati a loro.
