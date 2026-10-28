import { useCallback, useEffect, useRef, useState } from "react";
import { streamChatReply, type ChatTurn } from "../lib/chatApi";

export type MessageStatus = "streaming" | "done" | "stopped" | "truncated" | "error";

export type ChatMessage = ChatTurn & { id: string; status?: MessageStatus };

/** Chat state plus send/stop actions. A small, hand-rolled version of the AI SDK's useChat. */
export function useChatStream() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Lets `send` read the latest messages without being recreated on every token.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const send = useCallback(async (text: string) => {
    const content = text.trim();
    if (!content || abortRef.current) return;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content };
    const reply: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      status: "streaming",
    };
    const history = toHistory([...messagesRef.current, userMessage]);

    // Functional updates: tokens arrive faster than React re-renders.
    const updateReply = (change: (message: ChatMessage) => Partial<ChatMessage>) =>
      setMessages((prev) => prev.map((m) => (m.id === reply.id ? { ...m, ...change(m) } : m)));

    setMessages((prev) => [...prev, userMessage, reply]);
    setError(null);
    setIsStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChatReply(history, controller.signal, {
        onDelta: (delta) => updateReply((m) => ({ content: m.content + delta })),
        onDone: (stopReason) =>
          updateReply(() => ({ status: stopReason === "end" ? "done" : "truncated" })),
      });
    } catch (err) {
      if (controller.signal.aborted) {
        updateReply(() => ({ status: "stopped" })); // the user clicked Stop
      } else {
        updateReply(() => ({ status: "error" }));
        setError((err as Error).message);
      }
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
    }
  }, []);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  // Cancel an in-flight reply on unmount, or the server keeps generating (and billing).
  useEffect(() => () => abortRef.current?.abort(), []);

  return { messages, send, stop, isStreaming, error };
}

/** The turns worth sending back to the model: skip empty and failed replies. */
function toHistory(messages: ChatMessage[]): ChatTurn[] {
  return messages
    .filter((m) => m.content && m.status !== "error")
    .map(({ role, content }) => ({ role, content }));
}
