import { readFileSync } from "node:fs";
import { join } from "node:path";
import { safe, hash, verify } from "../git/snapshot.js";
import { z } from "zod";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const handoffSchema = z.object({
  schemaVersion: z.literal("0.1.0"),
  handoffId: z.string().uuid(),
  projectId: z.string(),
  runId: z.string().uuid(),
  taskId: z.string().uuid(),
  fromAttemptId: z.string().uuid(),
  // In una sessione la rotazione può riportare il lavoro a Codex: anche lui è
  // un destinatario legittimo del passaggio.
  toAgent: z.enum(["codex", "claude", "gemini", "antigravity"]),
  createdAt: z.iso.datetime(),
  goal: z.string().min(3),
  constraints: z.array(z.string()),
  switch: z.object({
    kind: z.literal("quota_exhausted"),
    confidence: z.literal("confirmed"),
    simulated: z.boolean(),
    evidenceIds: z.array(z.string()).min(1),
  }),
  snapshot: z.object({
    id: digest,
    baseCommit: z.string(),
    manifestSha256: digest,
    manifestRef: z.string().regex(/^snapshots\/[a-f0-9]{64}\.json$/),
    integrity: z.literal("verified"),
  }),
  acceptance: z.array(
    z
      .object({
        id: z.string(),
        status: z.enum(["passed", "failed"]),
        snapshotId: digest,
      })
      .passthrough(),
  ),
  verified: z.array(
    z.object({
      claim: z.string(),
      status: z.enum(["passed", "failed"]),
      snapshotId: digest,
    }),
  ),
  agentReported: z.array(z.unknown()),
  decisions: z.array(z.unknown()),
  nextActions: z.array(z.string()),
  uncertainties: z.array(z.string()),
  interruptedActions: z.array(z.unknown()),
  policy: z.object({
    id: z.enum([
      "demo-local-v1",
      "live-subscription-fixture-v1",
      "live-google-fixture-v1",
      "project-worktree-v1",
    ]),
    providers: z.array(
      z.enum(["mock", "codex", "claude", "gemini", "antigravity"]),
    ),
    externalEffects: z.literal("deny"),
    maxSwitches: z.literal(1),
    quota: z.literal("unknown"),
  }),
  budget: z.object({
    remaining: z.literal("unknown"),
    remainingSwitches: z.literal(0),
  }),
  artifacts: z.array(
    z.object({ id: z.string().uuid(), ref: z.string(), sha256: digest }),
  ),
  expiresAt: z.iso.datetime(),
});
export function validateHandoff(
  value: unknown,
  runId: string,
  snapshotId: string,
) {
  const h = handoffSchema.parse(value);
  if (
    h.runId !== runId ||
    h.snapshot.id !== snapshotId ||
    h.snapshot.manifestSha256 !== snapshotId ||
    Date.parse(h.expiresAt) < Date.now() ||
    h.acceptance.some((c) => c.snapshotId !== snapshotId)
  )
    throw Error("Handoff estraneo, scaduto o obsoleto");
  if (
    !["demo-local-v1", "project-worktree-v1"].includes(h.policy.id) &&
    !h.policy.providers.includes(h.toAgent)
  )
    throw Error("Successore non autorizzato dalla policy");
  return h;
}

export function validatePackage(
  root: string,
  runId: string,
  snapshotId: string,
) {
  const h = validateHandoff(
    JSON.parse(readFileSync(join(root, "handoff.json"), "utf8")),
    runId,
    snapshotId,
  );
  verify(root, h.snapshot.id);
  for (const artifact of h.artifacts) {
    const full = safe(root, artifact.ref);
    if (hash(readFileSync(full)) !== artifact.sha256)
      throw Error("Evidenza handoff alterata");
  }
  return h;
}
