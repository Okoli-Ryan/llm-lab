import type { z } from "zod";

export type Tool<S extends z.ZodObject = z.ZodObject> = {
  name: string;
  /** Read by the model to decide when to call the tool, so write it like documentation. */
  description: string;
  parameters: S;
  /**
   * Pass `context.signal` to anything slow (fetch, DB queries) so a timeout or a
   * cancelled run actually stops the work instead of leaving it running.
   */
  execute(args: z.infer<S>, context: ToolContext): unknown | Promise<unknown>;
};

export type ToolContext = { signal: AbortSignal };

/** Identity helper that infers argument types for `execute` from the Zod schema. */
export function defineTool<S extends z.ZodObject>(tool: Tool<S>): Tool<S> {
  return tool;
}

/**
 * An expected failure whose message is safe to show the model, e.g. "amount above the
 * product limit". The model can read it and adjust. Unexpected errors get a generic message.
 */
export class ToolError extends Error {
  name = "ToolError";
}
