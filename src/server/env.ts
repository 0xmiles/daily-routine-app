import { z } from "zod";

// Server-only configuration. Never import this from client components: the only
// value allowed in the browser is NEXT_PUBLIC_VAPID_PUBLIC_KEY, and client code
// should read it directly as `process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
//
// `getEnv()` validates on first call (not at import), so `next build` works
// without a .env file. Keys must match `.env.example`.

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

// "work@company.com, me@gmail.com" → ["work@company.com", "me@gmail.com"].
// The first address is the primary one (dev login, test sessions).
const emailList = z.string().transform((value, ctx) => {
  const list = value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0 || list.some((email) => !z.email().safeParse(email).success)) {
    ctx.addIssue({ code: "custom", message: "must be one email or a comma-separated list of emails" });
    return z.NEVER;
  }
  return list;
});

const envSchema = z.object({
  APP_URL: z.url().transform((url) => url.replace(/\/+$/, "")),
  AUTH_SECRET: z.string().min(32),
  ALLOWED_EMAIL: emailList,
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => BASE64_RE.test(v) && Buffer.from(v, "base64").length === 32, {
      message: "must be base64 of exactly 32 bytes (openssl rand -base64 32)",
    }),
  DATABASE_URL: z.string().min(1).optional(),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().min(1),
  VAPID_PRIVATE_KEY: z.string().min(1),
  // Apple's push service rejects a bare "mailto:", so require an address or URL after it.
  VAPID_SUBJECT: z.string().regex(/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/, {
    message: "must be mailto:<email> or an https:// URL",
  }),
  CRON_SECRET: z.string().min(16),
  DEV_LOGIN: z.enum(["0", "1"]).optional(),
});

type ParsedEnv = z.output<typeof envSchema>;
export type Env = Omit<ParsedEnv, "ALLOWED_EMAIL"> & {
  /** Primary allowed email (the first in the list). */
  ALLOWED_EMAIL: string;
  /** Every email allowed to log in, lowercased. */
  ALLOWED_EMAILS: readonly string[];
};
export type EnvKey = keyof z.input<typeof envSchema>;
export type EnvInput = Partial<Record<EnvKey, string | undefined>>;

export const ENV_KEYS = Object.keys(envSchema.shape) as EnvKey[];

/** Validates a raw env object. Throws an Error naming each bad key (values are never echoed). */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const raw: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    const value = source[key];
    raw[key] = value === "" ? undefined : value;
  }
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`);
    throw new Error(
      `Invalid environment variables: ${problems.join(", ")}. Copy .env.example to .env.local and fill in the values.`,
    );
  }
  const { ALLOWED_EMAIL: emails, ...rest } = result.data;
  return { ...rest, ALLOWED_EMAIL: emails[0], ALLOWED_EMAILS: Object.freeze(emails) };
}

let cached: Env | undefined;
let override: Env | undefined;

/** Validated server env. Parsed once, on first call. */
export function getEnv(): Env {
  if (override) return override;
  cached ??= parseEnv(process.env);
  return cached;
}

/** True when `email` (any case) is one of ALLOWED_EMAIL's addresses. */
export function isAllowedEmail(email: string, env: Env = getEnv()): boolean {
  return env.ALLOWED_EMAILS.includes(email.trim().toLowerCase());
}

/** True only when DEV_LOGIN=1 and NODE_ENV is not production. */
export function devLoginEnabled(env: Env = getEnv()): boolean {
  return env.DEV_LOGIN === "1" && process.env.NODE_ENV !== "production";
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Valid, non-secret values for tests. The VAPID pair is a throwaway keypair so
 * `web-push` accepts it; the encryption key is random test-only bytes.
 */
export const TEST_ENV: Readonly<Record<EnvKey, string | undefined>> = Object.freeze({
  APP_URL: "http://localhost:3000",
  AUTH_SECRET: "test-auth-secret-at-least-32-characters-long",
  ALLOWED_EMAIL: "me@example.com",
  GOOGLE_CLIENT_ID: "test-google-client-id",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  ENCRYPTION_KEY: "FQ5oQ/CgSGhbDqVRVcMugDYDjvpZchQ610ybzqcKWtU=",
  DATABASE_URL: undefined,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY:
    "BA2sgyhPqP17WD0086yydYya2ClzFQQ1KK_OchtSR_AkOfGXzH0dhbViPu7LpgiySUxdlvnVKrCNwXTgPzJ361w",
  VAPID_PRIVATE_KEY: "NE4IwjEjfgUNgyycsrlbPmDrQzBYscha-qV5jOMsIlA",
  VAPID_SUBJECT: "mailto:me@example.com",
  CRON_SECRET: "test-cron-secret-0123456789",
  DEV_LOGIN: undefined,
});

/**
 * Test-only: make `getEnv()` return TEST_ENV merged with `partial`.
 * `vitest.setup.ts` calls `setTestEnv()` before every test file, so tests only
 * need this to override specific keys, e.g. `setTestEnv({ DEV_LOGIN: '1' })`.
 * Each call starts from TEST_ENV again (overrides do not accumulate).
 */
export function setTestEnv(partial: EnvInput = {}): Env {
  if (process.env.NODE_ENV === "production") throw new Error("setTestEnv is test-only");
  override = parseEnv({ ...TEST_ENV, ...partial });
  return override;
}

/** Test-only: drop overrides and the cache so the next `getEnv()` re-reads process.env. */
export function resetEnvForTests(): void {
  override = undefined;
  cached = undefined;
}
