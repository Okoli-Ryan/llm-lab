import type { Response } from "openai/resources/responses/responses";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { env } from "../env.js";
import { openai } from "../llm/client.js";
import type { CallModel, ModelResult } from "./types.js";

/**
 * "strict": Structured Outputs. The API forces output to match the schema.
 * "json_mode": only guarantees valid JSON; the schema is just described in the prompt.
 */
export type JsonMode = "strict" | "json_mode";

const MAX_OUTPUT_TOKENS = 800;

export function openAICaller<S extends z.ZodObject>(
  schema: S,
  name: string,
  mode: JsonMode = "strict",
): CallModel {
  return async ({ system, messages }) => {
    const response = await openai.responses.create({
      model: env.OPENAI_MODEL,
      instructions: system,
      input: mode === "strict" ? messages : [schemaMessage(schema), ...messages],
      text: { format: mode === "strict" ? zodTextFormat(schema, name) : { type: "json_object" } },
      max_output_tokens: MAX_OUTPUT_TOKENS,
      store: false,
    });
    return toModelResult(response);
  };
}

/**
 * JSON mode doesn't enforce a schema, so describe it in a developer message.
 * It must go in `input`: the API requires the word "JSON" in the input messages for
 * json_object mode, and `instructions` doesn't count.
 */
function schemaMessage(schema: z.ZodObject) {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
  return {
    role: "developer" as const,
    content: `Respond with one JSON object matching this JSON Schema:\n${jsonSchema}`,
  };
}

function toModelResult(response: Response): ModelResult {
  const refusal = findRefusal(response);
  if (refusal) return { kind: "refusal", reason: refusal };

  if (response.status === "incomplete") {
    const reason = response.incomplete_details?.reason ?? "unknown";
    return { kind: "incomplete", reason, text: response.output_text };
  }

  const usage = response.usage
    ? { input: response.usage.input_tokens, output: response.usage.output_tokens }
    : undefined;
  return { kind: "text", text: response.output_text, usage };
}

function findRefusal(response: Response): string | undefined {
  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const part of item.content) {
      if (part.type === "refusal") return part.refusal;
    }
  }
  return undefined;
}
