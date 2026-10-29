import { it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  leggiAgenti,
  agentiPerClaude,
  agentiPerCodex,
  preparaCartellaContinuity,
} from "../src/core/agenti.js";
import {
  liveCommand,
  projectPrompt,
  LIVELLI_RAGIONAMENTO,
} from "../src/adapters/live.js";

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);
const progetto = () => {
  const d = mkdtempSync(join(tmpdir(), "agenti-"));
  dirs.push(d);
  mkdirSync(join(d, "continuity", "agenti"), { recursive: true });
  return d;
};
const scrivi = (root: string, nome: string, testo: string) =>
  writeFileSync(join(root, "continuity", "agenti", nome), testo);

it("legge il formato standard, i file di Codex e quelli di Claude, e scarta quelli incompleti", () => {
  const root = progetto();
  scrivi(
    root,
    "revisore-git.md",
    "---\nnome: revisore-git\ndescrizione: Controlla la storia Git\npermessi: lettura\nragionamento: medio\nmodello-codex: gpt-6-luna\nmodello-claude: sonnet\n---\nControlla commit e rami.\n",
  );
  scrivi(
    root,
    "git-workflow-manager.toml",
    'name = "git-workflow-manager"\ndescription = "Branching strategy"\nmodel = "gpt-5.6-terra"\nmodel_reasoning_effort = "medium"\nsandbox_mode = "read-only"\ndeveloper_instructions = """\nOwn Git workflow.\n"""\n',
  );
  scrivi(
    root,
    "designer.md",
    "---\nname: designer\ndescription: Interfacce\ntools: Read, Edit, Write\nmodel: opus\n---\nDisegna.\n",
  );
  scrivi(root, "rotto.md", "senza intestazione");
  scrivi(root, "README.md", "# leggimi");
  const agenti = leggiAgenti(root);
  expect(agenti.map((a) => a.nome)).toEqual([
    "designer",
    "git-workflow-manager",
    "revisore-git",
  ]);
  const [designer, git, revisore] = agenti;
  expect(revisore).toMatchObject({
    permessi: "lettura",
    ragionamento: "medio",
    modelli: { claude: "sonnet", codex: "gpt-6-luna" },
    istruzioni: "Controlla commit e rami.",
  });
  expect(git).toMatchObject({
    permessi: "lettura",
    ragionamento: "medio",
    modelli: { codex: "gpt-5.6-terra" },
    istruzioni: "Own Git workflow.",
  });
  expect(designer).toMatchObject({
    permessi: "scrittura",
    modelli: { claude: "opus" },
  });
});

it("per Claude un agente in sola lettura ha solo strumenti che leggono; per Codex diventa un ruolo con i suoi permessi", () => {
  const root = progetto();
  scrivi(
    root,
    "revisore.md",
    "---\nnome: revisore\ndescrizione: Rilegge\npermessi: lettura\nragionamento: massimo\nmodello-codex: gpt-6-luna\n---\nRileggi.\n",
  );
  const agenti = leggiAgenti(root);
  expect(agentiPerClaude(agenti).revisore).toMatchObject({
    description: "Rilegge",
    prompt: "Rileggi.",
    tools: ["Read", "Glob", "Grep", "WebFetch", "WebSearch"],
  });
  const fuori = mkdtempSync(join(tmpdir(), "ruoli-"));
  dirs.push(fuori);
  const args = agentiPerCodex(agenti, fuori, LIVELLI_RAGIONAMENTO.codex);
  expect(args).toEqual([
    "-c",
    'agents.revisore.description="Rilegge"',
    "-c",
    `agents.revisore.config_file=${JSON.stringify(join(fuori, "revisore.toml"))}`,
  ]);
  const toml = readFileSync(join(fuori, "revisore.toml"), "utf8");
  expect(toml).toContain('model = "gpt-6-luna"');
  expect(toml).toContain('model_reasoning_effort = "xhigh"');
  expect(toml).toContain('sandbox_mode = "read-only"');
  expect(toml).toContain('developer_instructions = "Rileggi."');
});

it("alla prima sessione crea continuity/ con il leggimi e copia gli agenti già presenti, senza toccare gli originali", () => {
  const root = mkdtempSync(join(tmpdir(), "nuovo-"));
  dirs.push(root);
  mkdirSync(join(root, "agents"));
  writeFileSync(
    join(root, "agents", "code-reviewer.toml"),
    'name = "code-reviewer"\n',
  );
  mkdirSync(join(root, ".claude", "agents"), { recursive: true });
  writeFileSync(
    join(root, ".claude", "agents", "tester.md"),
    "---\nname: tester\n---\n",
  );
  const esito = preparaCartellaContinuity(root);
  expect(esito.creata).toBe(true);
  expect(esito.importati.sort()).toEqual(["code-reviewer.toml", "tester.md"]);
  expect(existsSync(join(root, "continuity", "README.md"))).toBe(true);
  expect(existsSync(join(root, "agents", "code-reviewer.toml"))).toBe(true);
  // Una seconda volta non cambia nulla.
  expect(preparaCartellaContinuity(root)).toEqual({
    creata: false,
    importati: [],
  });
});

it("al lancio gli agenti arrivano a Claude (--agents) e a Codex (ruoli), e le istruzioni li nominano", () => {
  const root = progetto();
  scrivi(
    root,
    "revisore.md",
    "---\nnome: revisore\ndescrizione: Rilegge\npermessi: lettura\n---\nRileggi.\n",
  );
  const agenti = leggiAgenti(root);
  const ruoli = mkdtempSync(join(tmpdir(), "ruoli-"));
  dirs.push(ruoli);
  const claude = liveCommand(
    "claude",
    root,
    undefined,
    undefined,
    "project",
    undefined,
    undefined,
    { agenti },
  ).args;
  expect(
    JSON.parse(claude[claude.indexOf("--agents") + 1]).revisore.prompt,
  ).toBe("Rileggi.");
  const codex = liveCommand(
    "codex",
    root,
    undefined,
    undefined,
    "project",
    undefined,
    undefined,
    { agenti, cartellaAgenti: ruoli },
  ).args;
  expect(codex).toContain('agents.revisore.description="Rilegge"');
  const prompt = projectPrompt({
    role: "writer",
    goal: "x",
    work: root,
    criteria: [],
    agenti: [{ nome: "revisore", descrizione: "Rilegge" }],
  });
  expect(prompt).toContain("revisore — Rilegge");
  expect(prompt).toMatch(/agent_type/);
});
