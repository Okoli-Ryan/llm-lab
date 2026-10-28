// Usage: pnpm --filter api extract [--mode=json_mode] [--chaos] "message text"
//   --chaos  corrupts the model's first answer so you can watch the retry loop recover.

import { parseArgs } from "node:util";
import { extractLoanRequest, LoanRequest } from "../extract/loan.js";
import { openAICaller, type JsonMode } from "../extract/openaiCaller.js";
import { ExtractionError, type Attempt } from "../extract/retry.js";
import type { CallModel } from "../extract/types.js";

const SAMPLE_MESSAGE =
  "Good afternoon, my name is Adaeze Okafor. I run a provisions shop in Yaba and I'd like to " +
  "borrow ₦750k to restock before December. I can pay back over 6 months. My shop makes about " +
  "400,000 naira a month.";

const { values, positionals } = parseArgs({
  options: {
    mode: { type: "string", default: "strict" },
    chaos: { type: "boolean", default: false },
  },
  allowPositionals: true,
});

const mode = values.mode as JsonMode;
const message = positionals.join(" ") || SAMPLE_MESSAGE;

let callModel = openAICaller(LoanRequest, "loan_request", mode);
if (values.chaos) callModel = corruptFirstAnswer(callModel);

try {
  const { data, attempts } = await extractLoanRequest(message, callModel);
  printAttempts(attempts);
  console.log(`\nmode=${mode}  attempts=${attempts.length}\n`);
  console.log(JSON.stringify(data, null, 2));
} catch (error) {
  if (error instanceof ExtractionError) {
    console.error(error.message);
    printAttempts(error.attempts);
  } else {
    // e.g. bad API key (401), rate limit (429), no network.
    console.error(`Model call failed: ${(error as Error).message}`);
  }
  process.exit(1);
}

function printAttempts(attempts: Attempt[]) {
  attempts.forEach(({ issues }, i) => {
    const status = issues.length ? `REJECTED\n  - ${issues.join("\n  - ")}` : "ok";
    console.log(`attempt ${i + 1}: ${status}`);
  });
}

/** Chops the first text answer in half, simulating truncated JSON. */
function corruptFirstAnswer(callModel: CallModel): CallModel {
  let calls = 0;
  return async (request) => {
    const result = await callModel(request);
    calls++;
    if (calls === 1 && result.kind === "text") {
      return { ...result, text: result.text.slice(0, Math.floor(result.text.length * 0.6)) };
    }
    return result;
  };
}
