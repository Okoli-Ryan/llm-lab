import type { ResponseStreamEvent, ResponseUsage } from "openai/resources/responses/responses";
import { env } from "../env.js";
import { openai } from "./client.js";
import type { ChatTurn } from "./context.js";
import { mockChatStream } from "./mockChat.js";
import { CHAT_SYSTEM_PROMPT } from "./prompts.js";

const MAX_OUTPUT_TOKENS = 1024;

export type StopReason = "end" | "max_output_tokens" | "content_filter" | "other";
export type Usage = { input: number; output: number };

/** Our own small event vocabulary, so the frontend doesn't depend on OpenAI's event types. */
export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "done"; stopReason: StopReason; usage?: Usage }
  | { type: "error"; message: string };

/**
 * Starts streaming a chat reply.
 *
 * Resolves once the provider has accepted the request, so auth and rate-limit errors throw
 * here, before anything has been sent to the client (see docs/NOTES.md, "Two-phase errors").
 */
export async function startChatStream(
  history: ChatTurn[],
  signal: AbortSignal,
): Promise<AsyncIterable<ChatEvent>> {
  if (env.LLM_MOCK) return mockChatStream(history, signal);

  const stream = await openai.responses.create(
    {
      model: env.OPENAI_MODEL,
      instructions: CHAT_SYSTEM_PROMPT,
      input: history,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      stream: true,
      store: false, // we keep history ourselves; don't retain it at OpenAI
    },
    { signal }, // aborting cancels generation, so we stop paying
  );

  return toChatEvents(stream);
}

async function* toChatEvents(
  stream: AsyncIterable<ResponseStreamEvent>,
): AsyncGenerator<ChatEvent> {
  for await (const event of stream) {
    switch (event.type) {
      case "response.output_text.delta":
        yield { type: "delta", text: event.delta };
        break;

      case "response.completed":
        yield { type: "done", stopReason: "end", usage: toUsage(event.response.usage) };
        return;

      case "response.incomplete":
        yield {
          type: "done",
          stopReason: toStopReason(event.response.incomplete_details?.reason),
          usage: toUsage(event.response.usage),
        };
        return;

      case "response.failed":
        throw new Error(event.response.error?.message ?? "Response failed");

      case "error":
        throw new Error(event.message);

      // Other event types (created, in_progress, ...) are not needed.
    }
  }
}

function toStopReason(reason: string | undefined): StopReason {
  return reason === "max_output_tokens" || reason === "content_filter" ? reason : "other";
}

function toUsage(usage: ResponseUsage | null | undefined): Usage | undefined {
  return usage ? { input: usage.input_tokens, output: usage.output_tokens } : undefined;
}
