import { z } from "zod";
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().min(1), FRONTEND_URL: z.string().min(1),
  MANAGEMENT_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/).default("management_session"),
  CUSTOMER_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/).default("customer_session"),
  SESSION_SECRET: z.string().min(32), SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  TEMP_CUSTOMER_SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(20),
  PASSWORD_ARGON_MEMORY_COST: z.coerce.number().int().min(19456).default(65536),
  PASSWORD_ARGON_TIME_COST: z.coerce.number().int().min(2).default(3),
  PASSWORD_ARGON_PARALLELISM: z.coerce.number().int().min(1).default(1),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(100).default(20), UPLOAD_DIR: z.string().min(1).default("/app/data/uploads"),
  RETENTION_INTERVAL_MINUTES: z.coerce.number().int().min(5).default(60), TRUST_PROXY: z.coerce.number().int().min(0).max(2).default(1)
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) { console.error("Invalid environment configuration", parsed.error.flatten().fieldErrors); process.exit(1); }
export const env = parsed.data;
export const frontendOrigins = env.FRONTEND_URL.split(",").map((value) => value.trim()).filter(Boolean);
