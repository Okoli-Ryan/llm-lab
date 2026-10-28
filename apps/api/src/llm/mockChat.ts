import type { ChatEvent } from "./chat.js";
import type { ChatTurn } from "./context.js";

const WORD_DELAY_MS = 60;

/** Fake streamed reply for LLM_MOCK=true: test the UI and abort handling without API calls. */
export async function* mockChatStream(
  history: ChatTurn[],
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const lastMessage = history.at(-1)?.content.slice(0, 80) ?? "";
  const reply =
    `(mock) You said: "${lastMessage}". This reply streams word by word so you can test ` +
    `the UI, the Stop button and abort handling without calling OpenAI.`;
  const words = reply.split(" ");

  for (const word of words) {
    if (signal.aborted) return;
    await sleep(WORD_DELAY_MS);
    yield { type: "delta", text: `${word} ` };
  }

  yield { type: "done", stopReason: "end", usage: { input: 0, output: words.length } };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
