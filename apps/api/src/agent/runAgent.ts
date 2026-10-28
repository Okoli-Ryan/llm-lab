import { z } from "zod";
import { ToolError, type Tool } from "./tool.js";
import type { AgentModel, ToolCall, TranscriptItem } from "./types.js";

const DEFAULT_MAX_STEPS = 5;
const DEFAULT_TOOL_TIMEOUT_MS = 10_000;
const MAX_TOOL_OUTPUT_CHARS = 4_000; // tool output goes into the context window too

type ToolResult = Extract<TranscriptItem, { type: "tool_result" }>;

export class AgentError extends Error {
  constructor(
    message: string,
    public readonly transcript: TranscriptItem[],
  ) {
    super(message);
    this.name = "AgentError";
  }
}

type RunAgentOptions = {
  model: AgentModel;
  tools: Tool[];
  userMessage: string;
  maxSteps?: number;
  toolTimeoutMs?: number;
  /** Cancels the whole run: the current model request and any running tools. */
  signal?: AbortSignal;
};

/**
 * The tool-calling loop: the model asks for tools, we run them, the results go back,
 * and we repeat until the model answers in text or `maxSteps` model calls are used up.
 */
export async function runAgent({
  model,
  tools,
  userMessage,
  maxSteps = DEFAULT_MAX_STEPS,
  toolTimeoutMs = DEFAULT_TOOL_TIMEOUT_MS,
  signal,
}: RunAgentOptions): Promise<{ text: string; transcript: TranscriptItem[] }> {
  const transcript: TranscriptItem[] = [{ type: "message", role: "user", content: userMessage }];

  for (let step = 0; step < maxSteps; step++) {
    signal?.throwIfAborted();
    const turn = await model(transcript, { signal });

    if (turn.kind === "final") {
      transcript.push({ type: "message", role: "assistant", content: turn.text });
      return { text: turn.text, transcript };
    }

    // The model may ask for several tools at once; they're independent, so run them in parallel.
    transcript.push(...turn.calls.map((call) => ({ type: "tool_call" as const, call })));
    const results = await Promise.all(
      turn.calls.map((call) => executeToolCall(call, tools, { timeoutMs: toolTimeoutMs, signal })),
    );
    transcript.push(...results);
  }

  throw new AgentError(`No final answer after ${maxSteps} model calls.`, transcript);
}

type ExecuteOptions = { timeoutMs?: number; signal?: AbortSignal };

/**
 * Runs one tool call. Tool failures (including timeouts) become tool results the model can
 * read and recover from. The only thing that throws is a cancelled run (`signal` aborted).
 */
export async function executeToolCall(
  call: ToolCall,
  tools: Tool[],
  { timeoutMs = DEFAULT_TOOL_TIMEOUT_MS, signal: runSignal }: ExecuteOptions = {},
): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return failure(call, `Unknown tool "${call.name}".`);

  let rawArgs: unknown;
  try {
    rawArgs = JSON.parse(call.arguments);
  } catch {
    return failure(call, "Arguments are not valid JSON.");
  }

  // Validate even with strict mode on: the arguments are model output, and execute() may
  // touch real systems. This is the same validate-then-feed-back idea as the extractor.
  const args = tool.parameters.safeParse(rawArgs);
  if (!args.success) return failure(call, `Invalid arguments:\n${z.prettifyError(args.error)}`);

  // One signal that fires on timeout OR when the whole run is cancelled.
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = runSignal ? AbortSignal.any([runSignal, timeout]) : timeout;

  try {
    const output = await untilAborted(Promise.resolve(tool.execute(args.data, { signal })), signal);
    return { type: "tool_result", callId: call.id, ok: true, output: serialize(output) };
  } catch (error) {
    if (runSignal?.aborted) throw runSignal.reason; // run cancelled: stop the loop, don't report
    if (timeout.aborted) return failure(call, `Tool timed out after ${timeoutMs} ms.`);
    if (error instanceof ToolError) return failure(call, error.message);
    console.error(`Tool "${call.name}" crashed:`, error);
    return failure(call, "The tool failed unexpectedly."); // don't leak internals to the model
  }
}

function failure(call: ToolCall, message: string): ToolResult {
  return {
    type: "tool_result",
    callId: call.id,
    ok: false,
    output: JSON.stringify({ error: message }),
  };
}

function serialize(output: unknown): string {
  const text = JSON.stringify(output) ?? "null";
  return text.length > MAX_TOOL_OUTPUT_CHARS
    ? `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}… [truncated]`
    : text;
}

/**
 * Stops *waiting* when `signal` fires. Tools that pass the signal on (to fetch, DB queries)
 * also stop *working*; tools that ignore it may keep running in the background.
 */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
