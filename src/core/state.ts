export type RunState =
  | "READY"
  | "STARTING"
  | "RUNNING"
  | "QUIESCING"
  | "SNAPSHOTTING"
  | "VERIFYING"
  | "HANDOFF_READY"
  | "PAUSED"
  | "CANCELLED"
  | "FAILED"
  | "BLOCKED"
  | "SUCCEEDED";
const transitions: Record<RunState, RunState[]> = {
  // Una sessione può essere chiusa senza aver mai scritto niente.
  READY: ["STARTING", "CANCELLED", "BLOCKED"],
  STARTING: ["RUNNING", "BLOCKED"],
  RUNNING: ["QUIESCING", "BLOCKED"],
  QUIESCING: ["SNAPSHOTTING", "BLOCKED"],
  SNAPSHOTTING: ["VERIFYING", "PAUSED", "CANCELLED", "BLOCKED"],
  // In a session the verification does not end the run: it informs the next turn.
  VERIFYING: ["HANDOFF_READY", "SUCCEEDED", "FAILED", "PAUSED", "BLOCKED"],
  HANDOFF_READY: ["STARTING", "QUIESCING", "BLOCKED", "PAUSED", "CANCELLED"],
  PAUSED: ["STARTING", "QUIESCING", "CANCELLED", "BLOCKED"],
  // Da BLOCKED si deve poter tornare: un guasto in una sessione lasciava
  // conversazione e file irraggiungibili, senza alcuna via d'uscita.
  BLOCKED: ["QUIESCING", "PAUSED", "CANCELLED", "BLOCKED"],
  CANCELLED: [],
  FAILED: [],
  SUCCEEDED: ["BLOCKED"],
};
export function assertTransition(from: RunState, to: RunState) {
  if (from !== to && !transitions[from]?.includes(to))
    throw Error(`Transizione illegale: ${from} → ${to}`);
}
