import type { Response } from "express";

const HEARTBEAT_MS = 15_000;

/**
 * Streams events to the client as Server-Sent Events, then ends the response.
 * Each event is written as `event: <type>` + `data: <json>` + a blank line.
 */
export async function pipeToSSE(
  res: Response,
  events: AsyncIterable<{ type: string }>,
  signal: AbortSignal,
): Promise<void> {
  openStream(res);
  const stopHeartbeat = startHeartbeat(res);

  try {
    for await (const event of events) {
      if (signal.aborted) break;
      writeEvent(res, event.type, event);
    }
  } catch (error) {
    // Headers (status 200) are already sent, so errors can only be reported in-stream.
    if (!signal.aborted) {
      console.error("Stream failed:", error);
      writeEvent(res, "error", { type: "error", message: "The response was interrupted." });
    }
  } finally {
    stopHeartbeat();
    if (!res.writableEnded) res.end();
  }
}

function openStream(res: Response) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform"); // stop proxies compressing/buffering
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // stop nginx buffering
  res.flushHeaders();
}

function writeEvent(res: Response, type: string, data: unknown) {
  // JSON-encoding escapes newlines, so model text can't break the event framing.
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Sends a comment line periodically so proxies don't close a quiet connection. */
function startHeartbeat(res: Response) {
  const timer = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
  return () => clearInterval(timer);
}
