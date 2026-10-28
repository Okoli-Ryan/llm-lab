import { Composer } from "./components/Composer";
import { MessageList } from "./components/MessageList";
import { useChatStream } from "./hooks/useChatStream";
import "./App.css";

export function App() {
  const { messages, send, stop, isStreaming, error } = useChatStream();

  return (
    <main className="app">
      <h1>llm-lab · streaming chat</h1>
      <MessageList messages={messages} />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <Composer isStreaming={isStreaming} onSend={send} onStop={stop} />
    </main>
  );
}
