import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  fsyncSync,
  closeSync,
  chmodSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join, resolve, dirname, relative, sep } from "node:path";
import { ambienteGit } from "./ambiente.js";
import { dentroDi } from "../core/percorsi.js";
export const hash = (x: string | Buffer) =>
  createHash("sha256").update(x).digest("hex");
export function atomic(path: string, data: string | Buffer) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = path + "." + randomUUID();
  writeFileSync(tmp, data, { mode: 0o600, flag: "wx" });
  // «r+»: Windows sincronizza solo un file aperto anche in scrittura.
  const fd = openSync(tmp, "r+");
  fsyncSync(fd);
  closeSync(fd);
  renameSync(tmp, path);
  const parent = openSync(dirname(path), "r");
  try {
    fsyncSync(parent);
  } catch (e: any) {
    // Windows non sincronizza le cartelle (EPERM): il rename è già sul disco.
    if (!["EINVAL", "ENOTSUP", "EPERM", "EISDIR"].includes(e.code)) throw e;
  } finally {
    closeSync(parent);
  }
}
export function safe(root: string, path: string) {
  if (
    !path ||
    path.includes("\\") ||
    path.split("/").some((p) => p === ".." || p === "." || !p)
  )
    throw Error("Percorso non valido");
  const full = resolve(root, path);
  if (!dentroDi(root, full)) throw Error("Path traversal");
  return full;
}
// Ignored paths stay out of the snapshot: they are build output and caches, not
// the work. Keeping them in also made every verification look like a change,
// because test runners write there while they run.
function ignoredPaths(root: string) {
  try {
    return new Set(
      execFileSync(
        "git",
        [
          "ls-files",
          "--others",
          "--ignored",
          "--exclude-standard",
          "--directory",
        ],
        {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
          env: ambienteGit(root),
        },
      )
        .split("\n")
        .filter(Boolean)
        .map((riga) => riga.replace(/\/$/, "")),
    );
  } catch {
    return new Set<string>();
  }
}
// «tollerante»: sui progetti veri collegamenti e file enormi si escludono
// invece di fermare tutto; le prove dimostrative restano rigide come da
// specifica.
export function inventory(root: string, tollerante = false) {
  const ignored = ignoredPaths(root);
  const files: { path: string; sha256: string; size: number; mode: number }[] =
    [];
  const excludedPaths: string[] = [];
  let size = 0;
  function walk(dir: string) {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name),
        // Sempre con «/», come i percorsi di Git, anche su Windows.
        path = relative(root, full).split(sep).join("/");
      if (
        [
          ".git",
          "node_modules",
          "dist",
          ".continuity",
          ".venv",
          "venv",
          "vendor",
          // Materiale dell'utente: non è lavoro prodotto e non va conservato
          // nei blob né incluso nei pacchetti esportabili.
          "allegati",
        ].includes(name) ||
        name.startsWith(".env") ||
        /\.(pem|key)$/.test(name) ||
        ignored.has(path)
      ) {
        excludedPaths.push(path);
        continue;
      }
      const st = lstatSync(full);
      if (st.isDirectory() && !st.isSymbolicLink()) {
        walk(full);
        continue;
      }
      if (!tollerante) {
        if (st.isSymbolicLink()) throw Error("Symlink non supportato: " + path);
        if (!st.isFile()) throw Error("Tipo file non supportato");
        if (st.size > 10 * 1024 * 1024 || size + st.size > 100 * 1024 * 1024)
          throw Error("Limite snapshot superato");
      }
      // Collegamenti, file speciali e file molto grandi restano fuori dalla
      // fotografia, come node_modules: interrompere qui bloccava il turno
      // appena l'AI creava un ambiente Python o scaricava un dataset.
      if (
        !st.isFile() ||
        st.size > 10 * 1024 * 1024 ||
        size + st.size > 100 * 1024 * 1024
      ) {
        excludedPaths.push(path);
        continue;
      }
      size += st.size;
      files.push({
        path,
        sha256: hash(readFileSync(full)),
        size: st.size,
        mode: st.mode & 0o777,
      });
    }
  }
  walk(root);
  return { files, excludedPaths };
}
export function snapshot(root: string, store: string, tollerante = false) {
  const manifest = inventory(root, tollerante);
  for (const f of manifest.files) {
    const data = readFileSync(safe(root, f.path));
    if (hash(data) !== f.sha256) throw Error("Writer esterno rilevato");
    atomic(join(store, "blobs", f.sha256), data);
  }
  if (JSON.stringify(inventory(root, tollerante)) !== JSON.stringify(manifest))
    throw Error("Snapshot instabile");
  const digest = hash(JSON.stringify(manifest));
  atomic(
    join(store, "snapshots", digest + ".json"),
    JSON.stringify(manifest, null, 2),
  );
  verify(store, digest);
  return { id: digest, manifest };
}
export function verify(store: string, id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw Error("Digest non valido");
  const m = JSON.parse(
    readFileSync(join(store, "snapshots", id + ".json"), "utf8"),
  );
  if (hash(JSON.stringify(m)) !== id) throw Error("Manifest corrotto");
  for (const f of m.files) {
    safe("/fixture", f.path);
    if (
      !/^[a-f0-9]{64}$/.test(f.sha256) ||
      hash(readFileSync(join(store, "blobs", f.sha256))) !== f.sha256
    )
      throw Error("Artefatto corrotto");
  }
  return m;
}
export function restore(
  store: string,
  id: string,
  target: string,
  repository?: string,
  base?: string,
) {
  if (existsSync(target)) throw Error("La destinazione esiste già");
  const m = verify(store, id);
  if (repository && base) {
    execFileSync(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "worktree",
        "add",
        "--detach",
        target,
        base,
      ],
      { cwd: repository, stdio: "pipe" },
    );
    for (const name of readdirSync(target)) {
      if (name !== ".git")
        rmSync(join(target, name), { recursive: true, force: true });
    }
  } else mkdirSync(target, { recursive: true, mode: 0o700 });
  for (const f of m.files) {
    const p = safe(target, f.path);
    atomic(p, readFileSync(join(store, "blobs", f.sha256)));
    chmodSync(p, f.mode);
  }
  if (JSON.stringify(inventory(target, true).files) !== JSON.stringify(m.files))
    throw Error("Ripristino non corrispondente");
  return target;
}
// Rimette la cartella com'era nella fotografia «id», sul posto: i file
// cambiati tornano com'erano, quelli nuovi si tolgono. Tocca solo ciò che la
// fotografia considera (non .git, node_modules, allegati, file ignorati).
// Serve quando un'AI che doveva solo leggere ha scritto (flussi, Fase 3).
export function ripristinaSulPosto(store: string, id: string, root: string, tollerante = false): string[] {
  const m = verify(store, id);
  const ora = inventory(root, tollerante);
  const voluti = new Map<string, any>(m.files.map((f: any) => [f.path, f]));
  const attuali = new Map(ora.files.map((f) => [f.path, f]));
  const toccati: string[] = [];
  for (const f of ora.files)
    if (!voluti.has(f.path)) {
      rmSync(safe(root, f.path), { force: true });
      toccati.push(f.path);
    }
  for (const f of m.files) {
    const a = attuali.get(f.path);
    if (a && a.sha256 === f.sha256 && a.mode === f.mode) continue;
    const p = safe(root, f.path);
    atomic(p, readFileSync(join(store, "blobs", f.sha256)));
    chmodSync(p, f.mode);
    toccati.push(f.path);
  }
  return toccati;
}
