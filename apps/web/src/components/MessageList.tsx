import { useEffect, useRef } from "react";
import type { ChatMessage, MessageStatus } from "../hooks/useChatStream";

const STATUS_LABELS: Partial<Record<MessageStatus, string>> = {
  stopped: "Stopped",
  truncated: "Cut off: hit the output token limit",
  error: "Failed",
};

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep the newest text in view as the reply streams in.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  return (
    <section className="message-list" aria-live="polite">
      {messages.length === 0 && <p className="empty">Say something to start.</p>}

      {messages.map((message) => (
        <div key={message.id} className={`bubble ${message.role}`}>
          <div className="content">
            {message.content}
            {message.status === "streaming" && <span className="cursor">▍</span>}
          </div>
          {message.status && STATUS_LABELS[message.status] && (
            <small className="status">{STATUS_LABELS[message.status]}</small>
          )}
        </div>
      ))}

      <div ref={bottomRef} />
    </section>
  );
}
