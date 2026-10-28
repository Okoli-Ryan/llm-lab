import { test } from "node:test";
import assert from "node:assert/strict";
import { readSSE, parseEvent } from "./sse";

// Build a stream that delivers bytes in the exact chunks given, simulating TCP splits.
function streamOf(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(c) {
      chunks.forEach((ch) => c.enqueue(ch));
      c.close();
    },
  });
}
async function collect(s: ReadableStream<Uint8Array>) {
  const out = [];
  for await (const m of readSSE(s)) out.push(m);
  return out;
}
const enc = new TextEncoder();

test("parses events split at arbitrary chunk boundaries", async () => {
  const wire = 'event: delta\ndata: {"text":"Hel"}\n\nevent: delta\ndata: {"text":"lo"}\n\n';
  const bytes = enc.encode(wire);
  // Split into 3-byte chunks: events, field names and JSON all get cut mid-way.
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 3) chunks.push(bytes.slice(i, i + 3));
  const msgs = await collect(streamOf(chunks));
  assert.deepEqual(
    msgs.map((m) => JSON.parse(m.data).text),
    ["Hel", "lo"],
  );
});

test("keeps multi-byte characters intact when split across chunks", async () => {
  const bytes = enc.encode('event: delta\ndata: {"text":"ẹ 👋"}\n\n');
  const emojiStart = bytes.length - 8; // lands inside the 4-byte emoji
  const msgs = await collect(streamOf([bytes.slice(0, emojiStart), bytes.slice(emojiStart)]));
  assert.equal(JSON.parse(msgs[0].data).text, "ẹ 👋");
});

test("ignores heartbeat comments and handles CRLF", async () => {
  const msgs = await collect(
    streamOf([enc.encode(": ping\r\n\r\nevent: done\r\ndata: {}\r\n\r\n")]),
  );
  assert.deepEqual(msgs, [{ event: "done", data: "{}" }]);
});

test("does not emit an incomplete trailing event", async () => {
  const msgs = await collect(streamOf([enc.encode('event: delta\ndata: {"text":"cut')]));
  assert.equal(msgs.length, 0);
});

test("parseEvent defaults event name and joins multi-line data", () => {
  assert.deepEqual(parseEvent("data: a\ndata: b"), { event: "message", data: "a\nb" });
});

test("CRLF split between \\r and \\n does not create a fake event boundary", async () => {
  const msgs = await collect(
    streamOf([enc.encode("event: delta\r"), enc.encode('\ndata: {"text":"x"}\r\n\r\n')]),
  );
  assert.deepEqual(msgs, [{ event: "delta", data: '{"text":"x"}' }]);
});
