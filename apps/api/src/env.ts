import { z } from "zod";

/** Validated environment config. The server refuses to start if anything is missing or malformed. */
const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().startsWith("sk-", "should start with sk-"),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  LLM_MOCK: z.stringbool().default(false), // true = fake replies, no API calls
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().default(3001),
});

const result = EnvSchema.safeParse(process.env);

if (!result.success) {
  console.error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  process.exit(1);
}

export const env = result.data;
