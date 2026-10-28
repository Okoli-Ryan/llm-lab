// Provider-agnostic shapes for the tool-calling loop. The OpenAI adapter converts these
// to and from the Responses API format; tests use them directly with a fake model.

export type ToolCall = {
  id: string;
  name: string;
  arguments: string; // JSON text written by the model: untrusted until validated
};

export type TranscriptItem =
  | { type: "message"; role: "user" | "assistant"; content: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "tool_result"; callId: string; output: string; ok: boolean };

/** What the model wants next: either it's done, or it wants tools run. */
export type ModelTurn = { kind: "final"; text: string } | { kind: "tool_calls"; calls: ToolCall[] };

/** `signal` aborts the model request when the whole run is cancelled. */
export type AgentModel = (
  transcript: TranscriptItem[],
  options?: { signal?: AbortSignal },
) => Promise<ModelTurn>;
