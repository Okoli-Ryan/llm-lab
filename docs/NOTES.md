# Learning notes

The "why" behind the code: gotchas, alternatives, and what interviewers probe. The code keeps short comments; the depth lives here.

- [1. Tokens and the context window](#1-tokens-and-the-context-window)
- [2. System vs user prompts](#2-system-vs-user-prompts)
- [3. Project setup](#3-project-setup)
- [4. Streaming with SSE](#4-streaming-with-sse)
- [5. Structured output](#5-structured-output)
- [6. Tool calling](#6-tool-calling)
- [7. Deployment](#7-deployment)
- [Interview questions](#interview-questions)

---

## 1. Tokens and the context window

**Analogy:** the model is a brilliant waiter with no memory, working at a small whiteboard. Every call, you rewrite the whole order history on the whiteboard and leave space at the bottom for his reply. You pay per square inch, every time.

- **What counts against the window:** system prompt + all history + tool definitions + the new message + the reserved output (`max_output_tokens`).
- **The API is stateless.** The model remembers nothing between calls; the backend resends the whole conversation. Turn 20 pays for turns 1–19 again.
- **As history grows:** past the limit, the API rejects the request. Well before that, quality drops ("lost in the middle"), and cost and latency grow every turn.
- **Trimming (`llm/context.ts`):** keep the newest turns that fit a budget. Trade-off: facts stated early get dropped. Fixes: a running summary of old turns, pinning key facts in the system prompt, or retrieval (RAG).
- **Budget vs window:** gpt-4o-mini has a 128k window, but the chat route caps input at 8k. The window is a ceiling, not a target.
- **Token estimates:** ~4 characters per token for English. Fine for budgeting; for exact counts use a tokenizer library.

## 2. System vs user prompts

**Analogy:** the system prompt is the job description the employer hands the waiter before the shift; user messages are customers' orders.

- Both are just tokens in one sequence. The model is _trained_ to give the system role priority; it's a convention, **not a security boundary**. Prompt injection can still override it.
- **Never accept the `system` role from the browser** (the chat request schema only allows `user` and `assistant`), or any user can rewrite your instructions.
- **Prompt caching:** OpenAI caches identical prompt prefixes (1024+ tokens). Keep stable text first and volatile text (dates, names) last.
- Untrusted text (a customer message) goes inside delimiters like `<message>…</message>` with an instruction to ignore commands inside. Necessary, not sufficient.

## 3. Project setup

### Environment config (`src/env.ts`)

- Validated with Zod at startup: a missing key stops the server with a clear message instead of a confusing 401 mid-request.
- Env vars are always strings: `z.coerce.number()` for numbers, `z.stringbool()` for booleans. **Trap:** `z.coerce.boolean()` turns `"false"` into `true`.
- Secrets in production live in a secrets manager, not `.env` files. The API key never goes to the browser.

### Docker Compose

**Analogy:** a Dockerfile is the recipe for one dish; Compose is the kitchen layout.

- `ports: "HOST:CONTAINER"`. From your laptop the DB is `localhost:5432`; from another container it's `db:5432` (the service name). Inside a container, `localhost` is the container itself.
- `POSTGRES_*` variables only apply when the volume is **first created**. Changing the password later does nothing until `docker compose down -v`, which deletes the data.
- A healthcheck tells "container started" apart from "Postgres accepts connections"; `depends_on: condition: service_healthy` waits for the latter.
- The `api` service sits behind a profile, so day-to-day you run the API natively (fast reloads) and use the container as a dress rehearsal before deploying. Running the API in Docker for development on Windows is slow: bind mounts from NTFS are slow and file-change events often don't cross into the VM.

### Dockerfile (`apps/api/Dockerfile`)

**Analogy:** the kitchen vs the plate. Build stages are the kitchen (compilers, dev tools); only the plate (runtime stage) ships.

- Build context is the **repo root**, because pnpm needs the root lockfile.
- Copy manifests before source, so the slow install layer is cached until dependencies change.
- `--frozen-lockfile` fails if package.json and the lockfile disagree (reproducible builds).
- `--prod` drops TypeScript, tsx and type packages from the final image.
- Runs as the non-root `node` user.
- **Exec-form `CMD ["node", ...]`**, not `pnpm start`: node becomes PID 1 and receives SIGTERM, so graceful shutdown runs. Through a shell or pnpm the signal can get lost and Docker force-kills after 10s.
- **The pnpm symlink bug:** `apps/api/node_modules` entries are relative symlinks (`../../../node_modules/.pnpm/...`). Flattening the runtime to `/app` broke every import. Keep the `/repo/apps/api` layout, or use `pnpm deploy`.
- `.dockerignore` keeps your Windows `node_modules` and `.env` out of the build.

### Database

- One connection pool per process. A client per request exhausts Postgres connections (default max is 100).
- Drizzle wraps driver errors as "Failed query: …"; the real reason (ECONNREFUSED, auth failure) is on `error.cause`. Don't send raw error details to clients in production.
- `drizzle-kit push` is fine for learning; production uses `generate` + `migrate`, so schema changes are reviewed SQL files in git.
- Storing messages server-side means the client can't tamper with history (e.g. inject a fake assistant turn).

## 4. Streaming with SSE

**Analogy:** a normal response is a letter: wait, then it arrives whole. Streaming is a news ticker: one long-lived response with headlines appended as they happen. The network hands you the ticker torn into random strips, so the client tapes strips together until it sees a full headline.

### The flow

React `fetch` POST → Express validates and trims history → OpenAI stream → Express maps OpenAI's ~60 event types to three of its own (`delta`, `done`, `error`) → browser parses → React appends text.

Wire format, one event:

```
event: delta
data: {"type":"delta","text":"Hel"}

```

Data is JSON-encoded so newlines in model text can't break the framing.

### Why not EventSource

It only supports GET: no request body, no custom headers. A chat needs to POST the history, so we read the `fetch` body ourselves. (The AI SDK's `useChat` does the same.)

### Two-phase errors

Once the first byte is sent, the HTTP status is locked at 200. So `startChatStream` resolves only after OpenAI **accepts** the request: bad keys and 429s still return real 502/429 responses. Failures after streaming starts can only be sent as an in-stream `error` event.

### Abort, end to end

Stop clicked → `fetch` aborted → connection closes → `res.on("close")` → OpenAI request aborted → generation (and billing) stops. Without it, a closed tab keeps spending tokens.

**Gotcha:** listen on `res`, not `req`. In modern Node, `req` emits "close" as soon as the request body has been read, which would abort every stream immediately.

### How the client knows how a reply ended

Nothing on the wire says "stopped": the browser hung up, so only the browser knows.

| What happened               | On the wire                                             | How the code tells                |
| --------------------------- | ------------------------------------------------------- | --------------------------------- |
| Finished                    | deltas, then `done` (`stopReason: "end"`)               | `done` event                      |
| Hit token limit             | deltas, then `done` (`stopReason: "max_output_tokens"`) | shown as "truncated"              |
| User clicked Stop           | deltas, then nothing; DevTools shows _(canceled)_       | `signal.aborted === true`         |
| Server crash / network drop | deltas, then nothing                                    | no `done` and not aborted → error |

That's why the explicit `done` event exists: without it, "finished" and "connection broke" look identical. The server can't send a "stopped" event because the connection is already closed when it finds out.

### Headers and proxies

- `Cache-Control: no-transform` and `X-Accel-Buffering: no` stop proxies (nginx, CDNs) from compressing or buffering, which would deliver the stream all at once at the end. Caddy needs `flush_interval -1`.
- A heartbeat comment (`: ping`) every 15s stops proxies closing a quiet connection (reasoning models can be silent for 30s+).

### Parser pitfalls (`web/src/lib/sse.ts`, covered by tests)

- A chunk can end mid-event, mid-field or mid-JSON: buffer until a blank line.
- **Multi-byte characters** (emoji, "ẹ") can be split across chunks. `TextDecoder.decode(chunk, { stream: true })` holds the partial bytes; decoding chunks independently produces `�` garbage.
- **CRLF split across chunks:** converting `\r\n` per chunk turns a trailing `\r` + leading `\n` into a fake blank line, ending an event early. Normalize on the whole buffer. (Found by reading the code, confirmed with a failing test.)

### React

- Functional state updates (`setMessages(prev => …)`): tokens arrive faster than renders, so a stale `messages` closure would drop tokens.
- A `useEffect` must return nothing or a cleanup function. `useEffect(() => el.scrollIntoView())` returns whatever `scrollIntoView` returns, and newer Chrome returns a Promise. Use braces. Same reason `useEffect(async () => …)` is wrong.
- Abort on unmount, or the server keeps generating for a component that's gone.
- Scaling ideas: batch tokens per animation frame instead of one render per token; only auto-scroll when the user is already at the bottom.

### Other choices

- `store: false`: OpenAI stores responses by default; we keep history ourselves. Data retention is a question a fintech will ask.
- Always set `max_output_tokens`: it caps the cost and latency of each reply.
- `LLM_MOCK=true` lets you build the UI and test aborts without API calls.

## 5. Structured output

### Why models return invalid JSON

A model writes JSON the way autocomplete writes a sentence: one likely token at a time, with nothing forcing it to close the brace. Common failures: ` ```json ` fences, chatty preambles, trailing commas, single quotes, getting cut off at `max_output_tokens`, missing fields.

### Strict mode vs JSON mode

- **Strict (Structured Outputs):** the schema is enforced during generation (tokens that would break it are masked out). Output matches the shape.
- **JSON mode (`json_object`):** only guarantees syntactically valid JSON; the shape is described in the prompt and may be ignored. Closer to what most open models give you. **Gotcha:** the word "json" must appear in the _input messages_, or the API returns a 400. Text in `instructions` doesn't count, so the schema goes in a `developer` message inside `input`. (This was a real bug here: the first version put it in `instructions`.)
- **Still validate in strict mode:** it doesn't prevent refusals, truncation, or invented values. A made-up income is perfectly valid JSON.
- **`.nullable()`, not `.optional()`:** strict mode requires every key. `zodTextFormat` throws on `.optional()` (verified). `null` means "not stated".
- No `temperature: 0`: it reduces randomness but guarantees nothing, and reasoning models reject it. Validation is the guarantee.

### Validate-and-retry

**Analogy:** a form clerk hands your form back with sticky notes on the wrong boxes; you fix only those. Retrying _without_ the notes is just rolling the dice again and paying for it.

Three checks, cheapest first:

1. **Syntax:** is it JSON? Only the unambiguous wrapper (a code fence) is tolerated; no "JSON repair", which hides failures and can guess wrong.
2. **Shape:** Zod schema. Issues are reported as `path: message` so the model knows exactly what to fix.
3. **Meaning (grounding):** every non-null value must cite a quote, and the quote must really appear in the message. This catches hallucinations, which pass steps 1 and 2.

Retry design:

- The retry sends back the model's own answer plus the issue list.
- **Cost:** each retry resends the whole conversation, so input tokens grow every round. Three attempts is a deliberate cap; persistent failures mean the prompt or schema needs fixing.
- **Fail fast:** refusals and truncation aren't retried. Same token budget means the same truncation.
- Every attempt is kept on the error for debugging.

### Testability

The retry loop depends on a small `CallModel` function type, not on OpenAI. Tests pass a scripted fake model: fast, free, deterministic. Same idea as passing a mock `fetch` into a hook test.

## 6. Tool calling

**Analogy:** the model is a manager who can't touch the bank's systems. It writes a request slip ("look up business loan products"), you (the clerk) check the slip, run it on the real system, and staple the printout back. The manager reads it and either writes another slip or answers the customer. The model never executes anything; your code does.

### The loop (`agent/runAgent.ts`)

1. Send the conversation plus tool definitions (name, description, JSON Schema).
2. The model replies with either a text answer (done) or one or more `function_call` items, each with a `call_id`, a tool `name` and `arguments` as a JSON **string**.
3. Your code validates the arguments, runs the tool, and appends a `function_call_output` with the **same `call_id`**.
4. Send everything back and repeat, up to `maxSteps`.

With `store: false`, the API keeps no history, so each request must include the earlier `function_call` items as well as their outputs. A result whose `call_id` matches no call is rejected with a 400.

### Design choices

- **Tools never throw into the loop.** Unknown tool, bad JSON, invalid arguments, business-rule violations and timeouts all become `{ "error": "..." }` results. The model can read them and recover (fix arguments, pick another product, explain the limit). Same idea as validate-and-retry.
- **Validate arguments even in strict mode.** They're model output, and in a real system `execute` touches databases and money.
- **Safe vs unsafe error messages.** `ToolError` messages ("amount above the limit") are written for the model. Unexpected errors get a generic message, because a stack trace or connection string in the context could leak to the user.
- **Give tools IDs, not free numbers.** `calculate_repayment` takes a `productId` and looks up the rate itself, so the model can't invent a rate, and the product's limits are enforced in code rather than hoped for in the prompt.
- **Use tools for arithmetic.** Models predict digits rather than calculating them; the prompt says to always use the tool for figures.
- **Parallel calls:** the model may request several tools in one turn. They're independent, so they run with `Promise.all`, and results keep call order.
- **Guards:** `maxSteps` stops infinite loops (each step is a paid model call); outputs are truncated because they go into the context window.
- **Cancellation, not just timeouts:** each tool gets an `AbortSignal` that fires on its timeout (`AbortSignal.timeout`) or when the whole run is cancelled (`AbortSignal.any`). Racing a promise against a timer only stops _waiting_; the slow query keeps running and holding a connection. Passing the signal into `fetch` or the DB driver stops the _work_. A timeout becomes an error result the model can react to; a cancelled run throws and stops the loop, and the same signal aborts the in-flight model request. (Same idea as the streaming abort chain in section 4.)
- **Libraries exist for all of this.** Week 1 hand-rolls the loop to learn what frameworks hide. In production: an agent framework (OpenAI Agents SDK, Vercel AI SDK, LangGraph.js, Mastra) for the loop, and p-retry, p-limit or cockatiel for retries, concurrency and circuit breakers. You still own permissions, business rules, idempotency and evals.
- **Descriptions are prompts.** The model chooses tools from their names and descriptions, so write them like API docs: what it does, when to use it, units.

### What changes for real, side-effecting tools

- **Authorization:** tools run with the _user's_ permissions, never broader ones. The model choosing to call `get_customer(id)` mustn't let one user read another's data.
- **Confirmation:** anything that moves money or sends messages needs explicit user approval before execution, not just the model's decision.
- **Idempotency:** retries and repeated calls happen. Use idempotency keys so a duplicated "disburse loan" call runs once.
- **Prompt injection through tool results:** text returned by a tool (an email, a web page) can contain instructions. Treat it as data, like the `<message>` tags in the extractor.
- **Audit:** log every call, its arguments and its result.

### Provider gotcha

Reasoning models also return `reasoning` items. With `store: false` you must request `include: ["reasoning.encrypted_content"]` and send those items back, or the model loses its chain of thought between steps. The transcript here drops them, which is fine for gpt-4o-mini.

## 7. Deployment

- **Never publish Postgres on a public server.** Docker writes its own iptables rules, so a published port bypasses ufw.
- Bind the API to `127.0.0.1` and put a reverse proxy (Caddy) in front for HTTPS. An open, unauthenticated chat endpoint lets strangers spend your OpenAI credits; add auth or rate limiting before exposing it.
- Small VPSes run out of memory during builds (`Killed`, exit 137): add swap.
- Windows line endings break shell scripts (`$'\r': command not found`): `.gitattributes` forces LF.
- Real pipelines build the image **once in CI**, push it to a registry, and servers only pull. Watch the CPU architecture (ARM servers need multi-arch builds).

## Interview questions

1. What counts against the context window, and why does a long chat get more expensive per turn?
2. Is the system prompt a security boundary? How do you defend against prompt injection?
3. How do you report an error after streaming has started?
4. Walk through what happens when a user closes the tab mid-stream. What stops the billing?
5. Why `fetch` + a reader instead of `EventSource`?
6. Streaming works locally but arrives all at once in production. What's wrong?
7. OpenAI has Structured Outputs. Why validate at all?
8. Why might a retry loop make costs worse, and how do you bound it?
9. How would you detect a hallucinated field in an extraction?
10. How do you keep dev/prod parity without slowing developers down?
11. Walk through the tool-calling loop. Who executes the tool?
12. A tool fails. Do you throw, or tell the model? What do you tell it?
13. How would you make a "transfer money" tool safe?
