import { zodResponsesFunction } from "openai/helpers/zod";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { env } from "../env.js";
import { openai } from "../llm/client.js";
import type { Tool } from "./tool.js";
import type { AgentModel, TranscriptItem } from "./types.js";

const MAX_OUTPUT_TOKENS = 800;

/** An AgentModel backed by the OpenAI Responses API. */
export function openAIAgentModel({ system, tools }: { system: string; tools: Tool[] }): AgentModel {
  // Strict function tools: the API forces arguments to match each tool's JSON Schema.
  const toolSpecs = tools.map((tool) =>
    zodResponsesFunction({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }),
  );

  return async (transcript, { signal } = {}) => {
    const response = await openai.responses.create(
      {
        model: env.OPENAI_MODEL,
        instructions: system,
        input: transcript.map(toInputItem),
        tools: toolSpecs,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        store: false,
      },
      { signal },
    );

    if (response.status === "incomplete") {
      throw new Error(`Response incomplete: ${response.incomplete_details?.reason ?? "unknown"}`);
    }

    const calls = response.output.flatMap((item) =>
      item.type === "function_call"
        ? [{ id: item.call_id, name: item.name, arguments: item.arguments }]
        : [],
    );

    return calls.length > 0
      ? { kind: "tool_calls", calls }
      : { kind: "final", text: response.output_text };
  };
}

// Every tool result must reference the call_id of the call it answers, and the call
// itself must be sent back too (with store: false the API keeps no history for us).
function toInputItem(item: TranscriptItem): ResponseInputItem {
  switch (item.type) {
    case "message":
      return { role: item.role, content: item.content };
    case "tool_call":
      return {
        type: "function_call",
        call_id: item.call.id,
        name: item.call.name,
        arguments: item.call.arguments,
      };
    case "tool_result":
      return { type: "function_call_output", call_id: item.callId, output: item.output };
  }
}
