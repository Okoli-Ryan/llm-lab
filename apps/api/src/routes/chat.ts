import { Router, type Response } from "express";
import { z } from "zod";
import { startChatStream, type ChatEvent } from "../llm/chat.js";
import { trimHistory } from "../llm/context.js";
import { CHAT_SYSTEM_PROMPT } from "../llm/prompts.js";
import { pipeToSSE } from "../sse.js";

const MAX_INPUT_TOKENS = 8_000;

// Only "user" and "assistant": accepting "system" would let any user rewrite the system prompt.
const ChatRequest = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8_000),
      }),
    )
    .min(1)
    .max(100),
});

export const chatRouter = Router();

chatRouter.post("/chat", async (req, res) => {
  const body = ChatRequest.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: z.prettifyError(body.error) });
    return;
  }

  const history = trimHistory(CHAT_SYSTEM_PROMPT, body.data.messages, MAX_INPUT_TOKENS);
  if (history.length === 0) {
    res.status(413).json({ error: "Latest message is too long for the context budget." });
    return;
  }

  const abort = abortWhenClientDisconnects(res);

  let events: AsyncIterable<ChatEvent>;
  try {
    events = await startChatStream(history, abort.signal);
  } catch (error) {
    respondWithStartError(res, error);
    return;
  }

  await pipeToSSE(res, events, abort.signal);
});

/** Aborts the model request when the browser goes away (tab closed, Stop clicked). */
function abortWhenClientDisconnects(res: Response): AbortController {
  const controller = new AbortController();
  // Listen on `res`, not `req`: req "close" fires as soon as the request body has been read.
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller;
}

/** Nothing has been streamed yet, so we can still reply with a real HTTP status. */
function respondWithStartError(res: Response, error: unknown) {
  console.error("Chat request failed:", error);
  const isRateLimited = (error as { status?: number }).status === 429;

  // Generic messages only: provider errors can leak configuration details.
  if (isRateLimited) {
    res.status(429).json({ error: "Rate limited by the model provider. Try again shortly." });
  } else {
    res.status(502).json({ error: "Model request failed." });
  }
}
