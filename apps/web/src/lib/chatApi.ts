import { readSSE } from "./sse";

export type ChatTurn = { role: "user" | "assistant"; content: string };

type StreamHandlers = {
  onDelta: (text: string) => void;
  onDone: (stopReason: string) => void;
};

/**
 * Sends the conversation to the API and streams the reply through `handlers`.
 * Resolves when the reply is complete. Throws if the request fails, the server reports an
 * error, or the connection drops before the "done" event. Abort with `signal` to stop early.
 */
export async function streamChatReply(
  history: ChatTurn[],
  signal: AbortSignal,
  { onDelta, onDone }: StreamHandlers,
): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: history }),
    signal,
  });

  // Errors before streaming starts (400, 429, 502) come back as normal JSON.
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }

  for await (const { event, data } of readSSE(response.body)) {
    const payload = JSON.parse(data);

    if (event === "delta") onDelta(payload.text);
    if (event === "error") throw new Error(payload.message);
    if (event === "done") {
      onDone(payload.stopReason);
      return;
    }
  }

  // Without a "done" event we can't tell a finished reply from a dropped connection.
  throw new Error("Connection closed before the reply finished.");
}
