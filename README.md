# llm-lab

Week 1 of the Applied AI plan: calling LLMs from a TypeScript backend (OpenAI + Node + React + Postgres).

**What's here**

- **Streaming chat:** `POST /api/chat` streams replies over SSE into a React UI with a Stop button.
- **Structured extraction:** a CLI that turns a free-text loan request into validated JSON (Zod schema, validate-and-retry, grounding check).
- **Tool calling:** a loan assistant CLI that looks up products and calculates repayments with two tools, running the call-execute-return loop by hand.

The reasoning behind the code (gotchas, alternatives, interview questions) is in [docs/NOTES.md](docs/NOTES.md).

## Run it

```bash
pnpm install
cp .env.example .env          # PowerShell: Copy-Item .env.example .env, then set OPENAI_API_KEY
pnpm db:up                    # Postgres in Docker (Docker Desktop must be running)
pnpm --filter api db:push     # create tables

pnpm dev:api                  # terminal 1 → http://localhost:3001/api/health
pnpm dev:web                  # terminal 2 → http://localhost:5173
```

Set `LLM_MOCK=true` in `.env` to get fake streamed replies without calling OpenAI.

## Scripts

| Command                               | What it does                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                           | All tests (no API key needed)                                                                                   |
| `pnpm typecheck`                      | Type-check both apps                                                                                            |
| `pnpm format`                         | Format everything with Prettier                                                                                 |
| `pnpm --filter api agent "question"`  | Run the loan assistant and print each tool call and result                                                      |
| `pnpm --filter api extract "message"` | Run the loan extractor. Flags: `--mode=json_mode`, `--chaos` (corrupts the first answer to show the retry loop) |

## Layout

```
apps/api/src
  server.ts            Express app setup and shutdown
  env.ts               validated environment config
  routes/              HTTP routes: health, chat
  sse.ts               Server-Sent Events helpers
  llm/                 OpenAI client, chat streaming, history trimming, prompts, mock
  extract/             structured extraction: retry loop, JSON parsing, loan schema
  agent/               tool-calling loop, loan tools, OpenAI adapter
  scripts/             extract and agent CLIs
  db/                  Drizzle schema and connection pool

apps/web/src
  App.tsx              page layout
  components/          MessageList, Composer
  hooks/useChatStream  chat state, send and stop
  lib/chatApi.ts       calls /api/chat and reads the stream
  lib/sse.ts           SSE parser
```

## Docker

```bash
docker compose --profile full up -d --build   # Postgres + the production API image
curl http://localhost:3002/api/health
```

Day to day, run the API natively (fast reloads). Use the container to check the production image before deploying. For a VPS, see [DEPLOY.md](DEPLOY.md).

## Gotchas

- `POSTGRES_*` values only apply when the database volume is first created. Changed the password? `docker compose down -v` (deletes data).
- Port 5432 already in use? Set `DB_PORT=5433` and update `DATABASE_URL`.
- Inside Compose, the API reaches the database at `db:5432`, not `localhost`.
