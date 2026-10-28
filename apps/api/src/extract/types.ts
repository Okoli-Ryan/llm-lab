// A provider-agnostic "call a model" contract. The retry loop depends only on this,
// so tests can swap in a fake model (no network, no API key).

export type ModelMessage = { role: "user" | "assistant"; content: string };

export type ModelResult =
  | { kind: "text"; text: string; usage?: { input: number; output: number } }
  | { kind: "refusal"; reason: string }
  | { kind: "incomplete"; reason: string; text: string }; // cut off, e.g. at max_output_tokens

export type CallModel = (request: {
  system: string;
  messages: ModelMessage[];
}) => Promise<ModelResult>;
