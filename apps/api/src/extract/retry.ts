import type { z } from "zod";
import { parseModelJson } from "./parseJson.js";
import type { CallModel, ModelMessage, ModelResult } from "./types.js";

export type Attempt = { raw: string; issues: string[] };

export class ExtractionError extends Error {
  constructor(
    message: string,
    public readonly attempts: Attempt[],
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}

type ExtractOptions<S extends z.ZodType> = {
  schema: S;
  system: string;
  input: string;
  callModel: CallModel;
  /** Extra checks a schema can't express. Returns a list of problems (empty = valid). */
  check?: (data: z.infer<S>) => string[];
  maxAttempts?: number;
};

type Validation<T> = { ok: true; data: T } | { ok: false; issues: string[] };

/**
 * Asks the model for JSON, validates it, and on failure retries with the specific problems
 * fed back to the model. Refusals and truncated output fail immediately: retrying won't help.
 */
export async function extractWithRetry<S extends z.ZodType>({
  schema,
  system,
  input,
  callModel,
  check = () => [],
  maxAttempts = 3,
}: ExtractOptions<S>): Promise<{ data: z.infer<S>; attempts: Attempt[] }> {
  const messages: ModelMessage[] = [{ role: "user", content: input }];
  const attempts: Attempt[] = [];

  for (let i = 0; i < maxAttempts; i++) {
    const result = await callModel({ system, messages });
    failIfUnusable(result, attempts);

    const validation = validate(result.text, schema, check);
    attempts.push({ raw: result.text, issues: validation.ok ? [] : validation.issues });

    if (validation.ok) return { data: validation.data, attempts };

    messages.push(
      { role: "assistant", content: result.text },
      { role: "user", content: correctionRequest(validation.issues) },
    );
  }

  throw new ExtractionError(`Extraction failed after ${maxAttempts} attempts.`, attempts);
}

function failIfUnusable(
  result: ModelResult,
  attempts: Attempt[],
): asserts result is Extract<ModelResult, { kind: "text" }> {
  if (result.kind === "refusal") {
    throw new ExtractionError(`Model refused: ${result.reason}`, [
      ...attempts,
      { raw: "", issues: ["refusal"] },
    ]);
  }
  if (result.kind === "incomplete") {
    throw new ExtractionError(`Output truncated (${result.reason}); raise max_output_tokens.`, [
      ...attempts,
      { raw: result.text, issues: [`incomplete: ${result.reason}`] },
    ]);
  }
}

/** Three checks, cheapest first: is it JSON? does it match the schema? does it pass `check`? */
function validate<S extends z.ZodType>(
  raw: string,
  schema: S,
  check: (data: z.infer<S>) => string[],
): Validation<z.infer<S>> {
  const json = parseModelJson(raw);
  if (!json.ok) return { ok: false, issues: [json.issue] };

  const parsed = schema.safeParse(json.value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    return { ok: false, issues };
  }

  const problems = check(parsed.data);
  return problems.length > 0 ? { ok: false, issues: problems } : { ok: true, data: parsed.data };
}

function correctionRequest(issues: string[]): string {
  const list = issues.map((issue) => `- ${issue}`).join("\n");
  return `Your previous output was rejected:\n${list}\nReturn the complete corrected JSON object only, with no commentary.`;
}
