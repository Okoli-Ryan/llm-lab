import assert from "node:assert/strict";
import { test } from "node:test";
import { extractLoanRequest, type LoanRequest } from "./loan.js";
import { parseModelJson } from "./parseJson.js";
import { ExtractionError } from "./retry.js";
import type { CallModel, ModelMessage, ModelResult } from "./types.js";

const MESSAGE = "Hi, I'm Tunde. I need ₦500k for my business, repay over 6 months.";

const VALID: LoanRequest = {
  applicantName: "Tunde",
  amount: 500000,
  currency: "NGN",
  tenorMonths: 6,
  purpose: "business",
  monthlyIncome: null,
  evidence: [
    { field: "applicantName", quote: "I'm Tunde" },
    { field: "amount", quote: "₦500k" },
    { field: "currency", quote: "₦500k" },
    { field: "tenorMonths", quote: "over 6 months" },
    { field: "purpose", quote: "for my business" },
  ],
};

/** A fake model that returns scripted answers in order and records what it was sent. */
function fakeModel(answers: Array<string | ModelResult>) {
  const requests: ModelMessage[][] = [];
  const call: CallModel = async ({ messages }) => {
    requests.push(structuredClone(messages));
    const next = answers.shift();
    if (next === undefined) throw new Error("Fake model ran out of answers");
    return typeof next === "string" ? { kind: "text", text: next } : next;
  };
  return { call, requests };
}

const json = (value: unknown) => JSON.stringify(value);

test("valid output on the first attempt needs no retry", async () => {
  const model = fakeModel([json(VALID)]);
  const { data, attempts } = await extractLoanRequest(MESSAGE, model.call);
  assert.deepEqual(data, VALID);
  assert.equal(attempts.length, 1);
});

test("strips a ```json code fence", () => {
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { ok: true, value: { a: 1 } });
});

test("broken JSON is retried with the parse error fed back", async () => {
  const truncated = json(VALID).slice(0, 40);
  const model = fakeModel([truncated, json(VALID)]);

  const { attempts } = await extractLoanRequest(MESSAGE, model.call);

  assert.equal(attempts.length, 2);
  assert.match(attempts[0].issues[0], /not valid JSON/);

  // The retry must include the bad answer and the feedback, or the model is retrying blind.
  const retry = model.requests[1];
  assert.equal(retry.at(-2)?.role, "assistant");
  assert.equal(retry.at(-2)?.content, truncated);
  assert.match(retry.at(-1)!.content, /not valid JSON/);
});

test("schema errors name the exact field", async () => {
  const invalid = { ...VALID, tenorMonths: 6.5, currency: "naira" };
  const model = fakeModel([json(invalid), json(VALID)]);

  const { attempts } = await extractLoanRequest(MESSAGE, model.call);

  const issues = attempts[0].issues.join("\n");
  assert.match(issues, /tenorMonths/);
  assert.match(issues, /currency/);
});

test("a hallucinated value with a made-up quote is rejected", async () => {
  const invented = {
    ...VALID,
    monthlyIncome: 300000,
    evidence: [...VALID.evidence, { field: "monthlyIncome", quote: "I earn 300k monthly" }],
  };
  const model = fakeModel([json(invented), json(VALID)]);

  const { data, attempts } = await extractLoanRequest(MESSAGE, model.call);

  assert.match(attempts[0].issues[0], /does not appear in the message/);
  assert.equal(data.monthlyIncome, null);
});

test("a value without an evidence quote is rejected", async () => {
  const unsupported = { ...VALID, monthlyIncome: 300000 };
  const model = fakeModel([json(unsupported), json(VALID)]);

  const { attempts } = await extractLoanRequest(MESSAGE, model.call);

  assert.match(attempts[0].issues.join(), /monthlyIncome: has a value but no evidence/);
});

test("gives up after maxAttempts and keeps every attempt for debugging", async () => {
  const model = fakeModel(["nope", "still nope", "{"]);

  await assert.rejects(extractLoanRequest(MESSAGE, model.call), (error: unknown) => {
    assert.ok(error instanceof ExtractionError);
    assert.equal(error.attempts.length, 3);
    return true;
  });
});

test("refusals and truncated output fail immediately without retrying", async () => {
  const refusing = fakeModel([{ kind: "refusal", reason: "policy" }, json(VALID)]);
  await assert.rejects(extractLoanRequest(MESSAGE, refusing.call), /refused/);
  assert.equal(refusing.requests.length, 1);

  const truncating = fakeModel([
    { kind: "incomplete", reason: "max_output_tokens", text: '{"applicantName":' },
    json(VALID),
  ]);
  await assert.rejects(extractLoanRequest(MESSAGE, truncating.call), /truncated/);
  assert.equal(truncating.requests.length, 1);
});
