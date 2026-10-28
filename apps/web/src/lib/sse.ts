// Minimal Server-Sent Events parser for a fetch() response body.
// (EventSource can't be used: it only supports GET, and the chat needs to POST.)

export type SSEMessage = { event: string; data: string };

/**
 * Yields complete SSE messages from a byte stream. Network chunks can split a message
 * anywhere, so text is buffered until a blank line marks the end of a message.
 */
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      // { stream: true } keeps multi-byte characters (emoji, accents) intact across chunks.
      // Normalize CRLF on the whole buffer: a "\r" and its "\n" can arrive in different chunks.
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");

      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const message = parseEvent(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (message) yield message;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Parses one SSE message block. Returns null for comment-only blocks (e.g. heartbeats). */
export function parseEvent(block: string): SSEMessage | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) continue; // ":" starts a comment

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");

    if (field === "event") event = value;
    if (field === "data") dataLines.push(value);
  }

  return dataLines.length > 0 ? { event, data: dataLines.join("\n") } : null;
}
