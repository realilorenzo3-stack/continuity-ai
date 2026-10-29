// Tipi del programma dei permessi (permessi-mcp.mjs), per i test.
export const SOLO_LETTURA: RegExp;
export const CAMBIA: RegExp;
export function nomeBreve(strumento: string): string;
export function soloLettura(strumento: string): boolean;
export function decidi(args: { tool_name?: string; input?: unknown }): Promise<
  { behavior: "allow"; updatedInput: unknown } | { behavior: "deny"; message: string }
>;
