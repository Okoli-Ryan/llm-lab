import { useState, type FormEvent, type KeyboardEvent } from "react";

type ComposerProps = {
  isStreaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
};

/** Message input. Enter sends, Shift+Enter adds a new line. */
export function Composer({ isStreaming, onSend, onStop }: ComposerProps) {
  const [input, setInput] = useState("");

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (isStreaming || !input.trim()) return;
    onSend(input);
    setInput("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing: don't send while an IME (e.g. for accented characters) is mid-input.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form className="composer" onSubmit={submit}>
      <textarea
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Message… (Enter to send, Shift+Enter for a new line)"
        rows={2}
      />
      {isStreaming ? (
        <button type="button" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button type="submit" disabled={!input.trim()}>
          Send
        </button>
      )}
    </form>
  );
}
