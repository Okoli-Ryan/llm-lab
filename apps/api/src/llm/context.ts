export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Rough token estimate (~4 characters per token in English). Fine for budgeting, not billing. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

/**
 * Keeps the newest turns that fit within `maxInputTokens` (system prompt included).
 * Older turns are dropped first, because the API resends the whole history every call.
 */
export const trimHistory = (
  system: string,
  history: ChatTurn[],
  maxInputTokens: number,
): ChatTurn[] => {
  let remaining = maxInputTokens - estimateTokens(system);
  const kept: ChatTurn[] = [];

  for (const turn of [...history].reverse()) {
    const cost = estimateTokens(turn.content);
    if (cost > remaining) break;
    remaining -= cost;
    kept.unshift(turn);
  }

  // A conversation shouldn't start with an assistant turn.
  while (kept[0]?.role === "assistant") kept.shift();

  return kept;
};
