// Le chiavi che questo processo ha letto dal Portachiavi: si tolgono da ogni
// testo che passa da qui (eventi, registro, memoria, export), in qualsiasi
// forma arrivino, anche senza un prefisso riconoscibile. È la rete sotto i
// controlli dei singoli percorsi (ottavo collaudo, CT-2.0-602).
const SEGRETI = new Set<string>();
export function ricordaSegreto(valore: string | undefined) {
  if (!valore) return;
  for (const parte of [valore, ...valore.split(":")]) if (parte.length >= 8) SEGRETI.add(parte);
}
function senzaSegretiNoti(value: string) {
  let pulito = value;
  for (const s of SEGRETI) if (pulito.includes(s)) pulito = pulito.split(s).join("[REDACTED]");
  return pulito;
}

export function redact(value: string) {
  return (
    senzaSegretiNoti(value)
      .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, "")
      // Blocchi di chiave privata, interi.
      .replace(
        /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
        "[REDACTED]",
      )
      // Token con un prefisso riconoscibile: OpenAI/Anthropic, GitHub, Stripe,
      // AWS, Slack, Google, i JWT (per esempio le chiavi service-role) e i
      // servizi gratuiti (Groq, NVIDIA, xAI, Hugging Face, Cerebras: 29 ottobre).
      .replace(
        /\b(?:gsk_[A-Za-z0-9]{12,}|nvapi-[A-Za-z0-9_-]{12,}|xai-[A-Za-z0-9]{12,}|hf_[A-Za-z0-9]{12,}|csk-[A-Za-z0-9]{12,}|sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{20,}|(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{12,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g,
        "[REDACTED]",
      )
      // Password dentro un indirizzo: postgres://utente:segreto@host
      .replace(/(\/\/[^:/\s@]+:)[^@\s/]{3,}(@)/g, "$1[REDACTED]$2")
      // Lo schema di autenticazione resta, il token no: prima veniva oscurata
      // la parola «Bearer» e il token restava in chiaro.
      .replace(
        /\b((?:authorization|proxy-authorization)\s*[:=]\s*(?:bearer|basic|token)\s+)[^\s,;"']+/gi,
        "$1[REDACTED]",
      )
      .replace(/\b(bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, "$1[REDACTED]")
      // Un valore assegnato a un campo segreto: almeno 6 caratteri, senza spazi,
      // e non una chiamata di funzione. Così «password: deve avere 12
      // caratteri» e «password = leggi()» restano come la persona li ha scritti.
      // Anche come chiave JSON fra virgolette («"password": "…"») e come
      // variabile d'ambiente con suffisso _KEY, _TOKEN, _SECRET, _PASSWORD.
      .replace(
        /\b((?:[A-Za-z0-9]+_)*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret|client[_-]?secret|secret[_-]?key|private[_-]?key|password|passwd|key)["']?\s*[:=]\s*["']?)(?![A-Za-z_$][\w$.]*\s*\()(?!\[REDACTED\])([^\s,;"']{6,})/gi,
        (intero, campo: string, valore: string) =>
          // «key» da sola è troppo comune: vale solo come suffisso (FOO_KEY).
          /^key["']?\s*[:=]/i.test(campo) ? intero : campo + "[REDACTED]",
      )
  );
}

// Un testo che viene da un servizio (un errore) può ripetere la chiave con cui
// lo si è chiamato, in qualsiasi forma: si toglie il valore esatto, poi tutto
// ciò che redact() riconosce (settimo collaudo, CT-2.0-602).
export function senzaChiavi(testo: string, chiavi: (string | undefined)[]) {
  let pulito = testo;
  for (const c of chiavi)
    if (c && c.length >= 8) pulito = pulito.split(c).join("[REDACTED]");
  return redact(pulito);
}

// Redazione e conservazione sono due cose diverse: prima redact() tagliava
// anche a 8.000 caratteri, e una risposta lunga dell'AI arrivava mozzata nel
// registro (collaudo del 3 ottobre, CT-007). Il taglio, quando serve, è
// dichiarato nel testo.
export const LIMITE_MESSAGGIO = 200_000;
export function conserva(value: string, limite = LIMITE_MESSAGGIO) {
  const pulito = redact(value);
  return pulito.length <= limite
    ? pulito
    : pulito.slice(0, limite) +
        `\n[… troncato: ${(pulito.length - limite).toLocaleString("it-IT")} caratteri non conservati]`;
}

// Oscura ogni testo dentro una struttura qualsiasi: serve a ciò che esce dalla
// macchina (l'export), che non deve ripubblicare ciò che il registro oscura.
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map(redactDeep) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactDeep(v)]),
    ) as T;
  return value;
}
