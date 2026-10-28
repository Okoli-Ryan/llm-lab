import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { calculateRepayment, LOAN_TOOLS } from "./loanTools.js";
import { AgentError, executeToolCall, runAgent } from "./runAgent.js";
import { defineTool } from "./tool.js";
import type { AgentModel, ModelTurn, ToolCall, TranscriptItem } from "./types.js";

/** A fake model that plays scripted turns in order and records each transcript it saw. */
function fakeModel(turns: ModelTurn[]) {
  const seen: TranscriptItem[][] = [];
  const model: AgentModel = async (transcript) => {
    seen.push(structuredClone(transcript));
    const next = turns.shift();
    if (!next) throw new Error("Fake model ran out of turns");
    return next;
  };
  return { model, seen };
}

const call = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  name,
  arguments: typeof args === "string" ? args : JSON.stringify(args),
});
const final = (text: string): ModelTurn => ({ kind: "final", text });
const toolCalls = (...calls: ToolCall[]): ModelTurn => ({ kind: "tool_calls", calls });
const resultsIn = (transcript: TranscriptItem[]) =>
  transcript.filter((i) => i.type === "tool_result");

test("answers directly when no tool is needed", async () => {
  const { model } = fakeModel([final("Hello!")]);
  const { text, transcript } = await runAgent({ model, tools: LOAN_TOOLS, userMessage: "hi" });
  assert.equal(text, "Hello!");
  assert.equal(transcript.length, 2);
});

test("runs a tool and sends the result back with the matching call id", async () => {
  const { model, seen } = fakeModel([
    toolCalls(call("c1", "get_loan_products", { purpose: "business" })),
    final("The SME Working Capital loan fits."),
  ]);

  await runAgent({ model, tools: LOAN_TOOLS, userMessage: "business loan?" });

  const secondRequest = seen[1];
  assert.deepEqual(
    secondRequest.map((i) => i.type),
    ["message", "tool_call", "tool_result"],
  );
  const [result] = resultsIn(secondRequest);
  assert.equal(result.callId, "c1");
  assert.ok(result.ok);
  assert.match(result.output, /sme-working-capital/);
});

test("runs parallel tool calls and keeps results in call order", async () => {
  const { model, seen } = fakeModel([
    toolCalls(
      call("a", "get_loan_products", { purpose: "education" }),
      call("b", "calculate_repayment", { productId: "personal", amount: 100000, tenorMonths: 3 }),
    ),
    final("done"),
  ]);

  await runAgent({ model, tools: LOAN_TOOLS, userMessage: "q" });

  assert.deepEqual(
    resultsIn(seen[1]).map((r) => r.callId),
    ["a", "b"],
  );
});

test("invalid arguments go back to the model as an error, and it can correct itself", async () => {
  const { model, seen } = fakeModel([
    toolCalls(
      call("c1", "calculate_repayment", { productId: "personal", amount: "lots", tenorMonths: 3 }),
    ),
    toolCalls(
      call("c2", "calculate_repayment", { productId: "personal", amount: 100000, tenorMonths: 3 }),
    ),
    final("ok"),
  ]);

  const { transcript } = await runAgent({ model, tools: LOAN_TOOLS, userMessage: "q" });

  const [first] = resultsIn(seen[1]);
  assert.equal(first.ok, false);
  assert.match(first.output, /Invalid arguments/);
  assert.match(first.output, /amount/);
  assert.equal(resultsIn(transcript)[1].ok, true);
});

test("unknown tools and malformed JSON become error results, not crashes", async () => {
  const unknown = await executeToolCall(call("x", "transfer_money", {}), LOAN_TOOLS);
  assert.equal(JSON.parse(unknown.output).error, 'Unknown tool "transfer_money".');

  const malformed = await executeToolCall(call("y", "get_loan_products", "{purpose:"), LOAN_TOOLS);
  assert.match(malformed.output, /not valid JSON/);
});

test("business-rule errors are shown to the model; unexpected errors are hidden", async () => {
  const tooBig = await executeToolCall(
    call("c", "calculate_repayment", { productId: "personal", amount: 5_000_000, tenorMonths: 6 }),
    LOAN_TOOLS,
  );
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.output, /between ₦20,000 and ₦1,000,000/);

  const crashing = defineTool({
    name: "crash",
    description: "always throws",
    parameters: z.object({}),
    execute: () => {
      throw new Error("db password is hunter2");
    },
  });
  const originalError = console.error;
  console.error = () => {}; // keep test output clean
  const crashed = await executeToolCall(call("d", "crash", {}), [crashing]);
  console.error = originalError;
  assert.match(crashed.output, /failed unexpectedly/);
  assert.doesNotMatch(crashed.output, /hunter2/);
});

test("stops after maxSteps instead of looping forever", async () => {
  const loopForever = Array.from({ length: 10 }, (_, i) =>
    toolCalls(call(`c${i}`, "get_loan_products", { purpose: null })),
  );
  const { model } = fakeModel(loopForever);

  await assert.rejects(
    runAgent({ model, tools: LOAN_TOOLS, userMessage: "q", maxSteps: 3 }),
    (error: unknown) => error instanceof AgentError && /after 3 model calls/.test(error.message),
  );
});

test("repayment maths matches the amortization formula", async () => {
  // Expected values computed independently in Python.
  const result = await calculateRepayment.execute(
    { productId: "sme-working-capital", amount: 750_000, tenorMonths: 6 },
    { signal: new AbortController().signal },
  );
  assert.deepEqual(result, {
    productId: "sme-working-capital",
    amount: 750_000,
    tenorMonths: 6,
    annualRatePercent: 30,
    monthlyPayment: 136162.48,
    totalRepayment: 816974.87,
    totalInterest: 66974.87,
  });
});

/** A tool that waits `ms` unless its signal fires first, and records whether it was cancelled. */
function slowTool(ms: number) {
  const state = { cancelled: false, finished: false };
  const tool = defineTool({
    name: "slow",
    description: "waits",
    parameters: z.object({}),
    execute: (_args, { signal }) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          state.finished = true;
          resolve("done");
        }, ms);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          state.cancelled = true;
          reject(signal.reason);
        });
      }),
  });
  return { tool, state };
}

test("a timeout is reported to the model AND cancels the tool's work", async () => {
  const { tool, state } = slowTool(5_000);

  const result = await executeToolCall(call("t", "slow", {}), [tool], { timeoutMs: 50 });

  assert.equal(result.ok, false);
  assert.match(result.output, /timed out after 50 ms/);
  assert.equal(state.cancelled, true); // the work stopped, not just the waiting
  assert.equal(state.finished, false);
});

test("cancelling the run aborts running tools and stops the loop", async () => {
  const { tool, state } = slowTool(5_000);
  const controller = new AbortController();
  const { model, seen } = fakeModel([toolCalls(call("t", "slow", {})), final("never reached")]);

  setTimeout(() => controller.abort(new Error("user cancelled")), 50);

  await assert.rejects(
    runAgent({ model, tools: [tool], userMessage: "q", signal: controller.signal }),
    /user cancelled/,
  );
  assert.equal(state.cancelled, true);
  assert.equal(seen.length, 1); // no further model calls after cancellation
});

test("the run's signal is passed to the model request", async () => {
  const controller = new AbortController();
  let received: AbortSignal | undefined;
  const model: AgentModel = async (_transcript, options) => {
    received = options?.signal;
    return final("ok");
  };

  await runAgent({ model, tools: [], userMessage: "q", signal: controller.signal });

  assert.equal(received, controller.signal);
});
