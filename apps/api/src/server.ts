import express from "express";
import { pool } from "./db/client.js";
import { env } from "./env.js";
import { chatRouter } from "./routes/chat.js";
import { healthRouter } from "./routes/health.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use("/api", healthRouter);
// Local use only: /api/chat has no auth or rate limiting yet. Never expose it publicly.
app.use("/api", chatRouter);

const server = app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});

/** Stop accepting requests, then close database connections. */
function shutdown() {
  server.close(() => {
    pool.end().then(() => process.exit(0));
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
