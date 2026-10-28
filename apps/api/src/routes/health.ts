import { sql } from "drizzle-orm";
import { Router } from "express";
import { db } from "../db/client.js";

export const healthRouter = Router();

/** Reports whether the API can serve traffic, which includes reaching the database. */
healthRouter.get("/health", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.json({ ok: true, db: "up" });
  } catch (error) {
    // Drizzle wraps driver errors; the useful reason (e.g. ECONNREFUSED) is on `cause`.
    const { message, cause } = error as Error & { cause?: Error };
    res.status(503).json({ ok: false, db: "down", error: cause?.message ?? message });
  }
});
