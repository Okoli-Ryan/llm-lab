// Usage: pnpm --filter api agent "your question"
// Prints each tool call and result, then the final answer.

import { parseArgs } from "node:util";
import { LOAN_AGENT_PROMPT, LOAN_TOOLS } from "../agent/loanTools.js";
import { openAIAgentModel } from "../agent/openaiAgentModel.js";
import { AgentError, runAgent } from "../agent/runAgent.js";
import type { TranscriptItem } from "../agent/types.js";

const SAMPLE_QUESTION =
  "I run a provisions shop and want to borrow ₦750k over 6 months. " +
  "Which product fits, and what would I pay each month?";

const { positionals } = parseArgs({ allowPositionals: true });
const question = positionals.join(" ") || SAMPLE_QUESTION;

const model = openAIAgentModel({ system: LOAN_AGENT_PROMPT, tools: LOAN_TOOLS });

// Ctrl+C cancels the in-flight model request and any running tool, then exits cleanly.
const controller = new AbortController();
process.once("SIGINT", () => controller.abort(new Error("Cancelled by user")));

try {
  const { text, transcript } = await runAgent({
    model,
    tools: LOAN_TOOLS,
    userMessage: question,
    signal: controller.signal,
  });
  printTrace(transcript);
  console.log(`\nAnswer:\n${text}`);
} catch (error) {
  if (error instanceof AgentError) printTrace(error.transcript);
  console.error(`\nAgent failed: ${(error as Error).message}`);
  process.exit(1);
}

function printTrace(transcript: TranscriptItem[]) {
  for (const item of transcript) {
    if (item.type === "tool_call") console.log(`→ ${item.call.name} ${item.call.arguments}`);
    if (item.type === "tool_result") console.log(`← ${item.ok ? "" : "[error] "}${item.output}`);
  }
}
