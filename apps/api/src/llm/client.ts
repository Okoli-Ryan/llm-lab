import OpenAI from "openai";
import { env } from "../env.js";

/** Shared OpenAI client. Retries 429/5xx errors, but only before a stream has started. */
export const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  maxRetries: 2,
  timeout: 60_000,
});
