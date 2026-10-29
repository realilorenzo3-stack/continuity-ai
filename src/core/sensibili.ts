import { realpathSync } from "node:fs";
import { basename, sep } from "node:path";

// File che contengono credenziali o chiavi: allegati, finirebbero nella copia
// di lavoro e quindi a disposizione del provider. Il contratto lo prometteva
// da tempo, ma /allega non lo applicava (collaudo del 3 ottobre, CT-008).
const NOMI = [
  /^\.env(\..+)?$/i,
  /^\.envrc$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore|ppk|asc|gpg)$/i,
  /^(auth|credentials?|secrets?|token|service[-_]account.*)\.(json|ya?ml|toml|txt)$/i,
  // Anche in italiano e come parte del nome: «config/segreti.json»,
  // «chiavi-prod.yaml», «app.secrets.json» (collaudo del 26 ottobre,
  // CT-2.0-201). Solo file di dati: «token.ts» o «tokenizer.json» restano.
  /(^|[._-])(secrets?|segret[oi]|credentials?|credenziali|passwords?|passwd|chiav[ei]|api[-_]?keys?|tokens?)(?=[._-]|$).*\.(json|ya?ml|toml|txt|ini|conf|cfg|properties|xml|csv)$/i,
  /^\.(npmrc|pypirc|netrc|git-credentials|pgpass|dockercfg)$/i,
  /^known_hosts$/i,
];
// Cartelle che contengono solo materiale di autenticazione.
const CARTELLE = [
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  ".kube",
  ".docker",
  ".codex",
  ".claude",
  ".gemini",
  ".config/gh",
  ".config/gcloud",
];

export function percorsoSensibile(percorso: string): string | undefined {
  // Il percorso vero, non quello scritto: un collegamento con un nome innocuo
  // può puntare a una chiave.
  let vero = percorso;
  try {
    vero = realpathSync(percorso);
  } catch {}
  for (const p of new Set([percorso, vero])) {
    const nome = basename(p);
    if (NOMI.some((r) => r.test(nome))) return nome;
    const parti = p.split(sep).join("/");
    const cartella = CARTELLE.find((c) => parti.includes(`/${c}/`));
    if (cartella) return cartella;
  }
  return undefined;
}
