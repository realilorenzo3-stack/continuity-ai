// Su Windows un file aperto non si cancella: il database di una sessione
// (SQLite, con il suo WAL) o il registro di un servizio di prova tengono
// occupata la cartella temporanea finché il processo vive, e la pulizia dopo
// ogni prova (rmSync) falliva con EPERM o EBUSY anche quando la prova aveva
// passato tutti i suoi controlli (collaudo su Windows del 31 ottobre: circa
// 40 prove su 92). Qui, solo su Windows e solo dentro la cartella
// temporanea: si riprova qualche volta e, se il file resta aperto, la
// cartella resta (la ripulisce il sistema). Fuori dalla cartella temporanea
// nulla cambia.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { relative, resolve, isAbsolute } from "node:path";

if (process.platform === "win32") {
  const originale = fs.rmSync;
  const temporanea = resolve(tmpdir());
  const dentroTemp = (p: unknown) => {
    const r = relative(temporanea, resolve(String(p)));
    return r !== "" && !r.startsWith("..") && !isAbsolute(r);
  };
  (fs as any).rmSync = function (percorso: fs.PathLike, opzioni?: fs.RmOptions) {
    if (!dentroTemp(percorso)) return originale(percorso, opzioni);
    try {
      return originale(percorso, { maxRetries: 5, retryDelay: 100, ...opzioni });
    } catch (e: any) {
      if (["EPERM", "EBUSY", "ENOTEMPTY"].includes(e?.code)) return;
      throw e;
    }
  };
  syncBuiltinESMExports();
}
