import { defineConfig } from "drizzle-kit";

// `pnpm --filter api db:push` syncs src/db/schema.ts to the database.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
