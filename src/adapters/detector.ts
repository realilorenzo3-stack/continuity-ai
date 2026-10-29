export function classify(event: {
  type: string;
  source: string;
  code?: string;
  retrying?: boolean;
}) {
  if (event.type !== "error" || event.source !== "provider" || event.retrying)
    return null;
  const map: Record<string, string> = {
    quota_exhausted: "quota_exhausted",
    rate_limit: "rate_limited",
    unauthorized: "auth_required",
    permission_denied: "permission_required",
    network_error: "network_error",
    context_exhausted: "context_exhausted",
  };
  return map[event.code ?? ""] ?? "unknown";
}
// Legge lo stream riga per riga. Un errore di lettura e un errore di chi riceve
// sono cose diverse: prima finivano nello stesso catch, e un guasto nel gestore
// — anche nel ramo che riconosce la quota — diventava «JSON malformato» e
// spariva senza lasciare traccia.
const LIMITE_RIGA = 32 * 1024 * 1024;
export class JsonLines {
  buffer = "";
  // Una riga troppo lunga si salta fino al prossimo a capo: è contenuto (un
  // file letto, un output enorme), non un motivo per interrompere il turno.
  private salta = false;
  constructor(
    private receive: (value: unknown) => void,
    private guasto?: (errore: unknown, value: unknown) => void,
    private limite = LIMITE_RIGA,
  ) {}
  private consegna(value: unknown) {
    try {
      this.receive(value);
    } catch (e) {
      if (this.guasto) this.guasto(e, value);
      else throw e;
    }
  }
  push(chunk: string) {
    this.buffer += chunk;
    let n;
    while ((n = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, n);
      this.buffer = this.buffer.slice(n + 1);
      if (this.salta) {
        this.salta = false;
        continue;
      }
      if (!line.trim()) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        value = { type: "unknown", reason: "malformed JSON" };
      }
      this.consegna(value);
    }
    if (Buffer.byteLength(this.buffer) > this.limite) {
      this.buffer = "";
      this.salta = true;
      this.consegna({ type: "unknown", reason: "line too long" });
    }
  }
  end() {
    if (this.buffer.trim() && !this.salta)
      this.consegna({ type: "unknown", reason: "incomplete EOF" });
    this.buffer = "";
    this.salta = false;
  }
}
