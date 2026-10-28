export type JsonResult = { ok: true; value: unknown } | { ok: false; issue: string };

const CODE_FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

/**
 * Parses model output as JSON. Tolerates one common wrapper (a ```json code fence) but does
 * not try to "repair" broken JSON: silent repairs hide failures and can guess wrong.
 */
export function parseModelJson(raw: string): JsonResult {
  const text = raw.trim().replace(CODE_FENCE, "$1");

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, issue: `Output is not valid JSON (${(error as Error).message}).` };
  }
}
