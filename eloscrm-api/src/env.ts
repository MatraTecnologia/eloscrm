import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(10),
    BETTER_AUTH_URL: z.string().url(),
    WEB_ORIGIN: z.string().url(),
    PORT: z.coerce.number().default(3333),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
