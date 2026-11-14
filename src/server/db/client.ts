import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/server/env";
import * as schema from "./schema";

export type Schema = typeof schema;
/** Drizzle database (PGlite locally/tests, postgres-js in production). A transaction `tx` is also a `Db`. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

const PGLITE_PREFIX = "pglite:";
const DEFAULT_PGLITE_DIR = "./.data/pglite";

// Kept on globalThis so dev HMR and separately bundled route modules share one
// connection (a PGlite directory must only be opened once per process).
interface DbState {
  db?: Db;
  testDb?: Db | null;
  localMigration?: Promise<void>;
}
const g = globalThis as typeof globalThis & { __drsDbState?: DbState };
const state: DbState = (g.__drsDbState ??= {});

function pgliteTarget(url: string | undefined): string | null {
  if (!url) return DEFAULT_PGLITE_DIR;
  if (!url.startsWith(PGLITE_PREFIX)) return null;
  return url.slice(PGLITE_PREFIX.length) || DEFAULT_PGLITE_DIR;
}

/**
 * postgres-js options for Supabase's transaction pooler: TLS always (postgres-js
 * defaults to plaintext unless the URL says sslmode), no prepared statements
 * (the pooler can't keep them), and a small pool per serverless instance.
 */
export const POSTGRES_OPTIONS = {
  prepare: false,
  ssl: "require",
  max: 3,
  idle_timeout: 20,
  connect_timeout: 10,
} as const;

export type DbTarget = { kind: "pglite"; dir: string } | { kind: "postgres"; url: string };

/** Where `getDb()` connects. On Vercel a Postgres URL is required (the filesystem is read-only). */
export function resolveDbTarget(
  url: string | undefined,
  runtime: Record<string, string | undefined> = process.env,
): DbTarget {
  const dir = pgliteTarget(url);
  if (dir === null) return { kind: "postgres", url: url as string };
  if (runtime.VERCEL) {
    throw new Error("DATABASE_URL must be a Postgres URL on Vercel (local PGlite can't run there). Set it in the project's environment variables.");
  }
  return { kind: "pglite", dir };
}

/**
 * The app database. `DATABASE_URL` empty or `pglite:<dir>` → PGlite at that
 * directory (default ./.data/pglite); otherwise postgres-js with `prepare:false`
 * (Supabase pooler). In tests it returns the db from the latest `createTestDb()`.
 */
export function getDb(): Db {
  if (state.testDb) return state.testDb;
  if (process.env.VITEST) {
    throw new Error("getDb() was called in a test before createTestDb(). Call `await createTestDb()` first.");
  }
  if (state.db) return state.db;

  const target = resolveDbTarget(getEnv().DATABASE_URL);
  if (target.kind === "pglite") {
    // Local/dev only; the ignore comments stop Turbopack tracing the whole project.
    const dataDir = target.dir.startsWith("memory://") ? target.dir : path.resolve(/*turbopackIgnore: true*/ target.dir);
    if (!dataDir.startsWith("memory://")) fs.mkdirSync(/*turbopackIgnore: true*/ dataDir, { recursive: true });
    state.db = drizzlePglite({ client: new PGlite(dataDir), schema });
  } else {
    state.db = drizzlePostgres({ client: postgres(target.url, POSTGRES_OPTIONS), schema });
  }
  return state.db;
}

/**
 * Local dev convenience: apply drizzle/ migrations to the PGlite database once
 * per process. No-op for Postgres URLs (use `npm run db:migrate`). Called from
 * src/instrumentation.ts in development.
 */
export async function migrateLocalPglite(): Promise<void> {
  if (pgliteTarget(getEnv().DATABASE_URL) === null) return;
  state.localMigration ??= (async () => {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(getDb() as unknown as PgliteDatabase<Schema>, {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
  })();
  await state.localMigration;
}

/** Test-only: make `getDb()` return `db` (or clear it with null). `createTestDb()` calls this for you. */
export function setTestDb(db: Db | null): void {
  state.testDb = db;
}
