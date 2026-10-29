import { it, expect } from "vitest";
import { redact } from "../src/persistence/redact.js";

it("oscura i formati di segreto più comuni", () => {
  const casi = [
    '{"password": "Sup3rSegreta"}',
    '{"api_key":"abcdef123456"}',
    "github_pat_11ABCDEFG0123456789_abcdefghijklmnop",
    "sk_live_51HabcdefGHIJKLmnop",
    "AKIAABCDEFGHIJKLMNOP",
    "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG",
    "xoxb-1234567890-abcdefghij",
    "client_secret=abcdef123456",
    "token: abcdef123456",
    "postgres://utente:segretissima@db.example.com/app",
    "SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.abcdefgh1234",
    "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAB3NzaC1yc2E\n-----END OPENSSH PRIVATE KEY-----",
  ];
  for (const caso of casi) {
    const fuori = redact(caso);
    expect(fuori, caso).toContain("[REDACTED]");
    for (const pezzo of [
      "Sup3rSegreta",
      "abcdef123456",
      "segretissima",
      "wJalrXUtnFEMI",
      "AAAAB3NzaC1yc2E",
    ])
      expect(fuori, caso).not.toContain(pezzo);
  }
});

it("lascia stare il testo normale e il codice", () => {
  for (const testo of [
    "la password deve avere almeno 12 caratteri",
    "password = leggiPassword()",
    "const key = 'nome'",
    "Ho aggiornato il token di stile del pulsante",
    "https://github.com/realilorenzo3-stack/Continuity",
  ])
    expect(redact(testo), testo).toBe(testo);
});
