import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { setTestDb, type Db } from "./client";
import * as schema from "./schema";

// Test-only. Never import from app code.

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../drizzle", import.meta.url));

// One migrated in-memory template per test worker; each test DB is a clone of it,
// which is much faster than re-running migrations every time.
let template: Promise<PGlite> | undefined;

function migratedTemplate(): Promise<PGlite> {
  template ??= (async () => {
    const pg = new PGlite();
    const db = drizzle({ client: pg, schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    await db.insert(schema.settings).values({ id: 1 }).onConflictDoNothing();
    return pg;
  })();
  return template;
}

let current: PGlite | undefined;

/**
 * A fresh, isolated in-memory Postgres (PGlite) with all drizzle/ migrations
 * applied and the settings row (id=1) seeded. It is also registered so that
 * `getDb()` — and therefore route handlers — use it until the next call.
 *
 * Only the latest test DB stays open: calling this again closes the previous
 * one (PGlite instances are memory-heavy). The last one is closed after each
 * test file by vitest.setup.ts.
 *
 *   let db: Db;
 *   beforeEach(async () => { db = await createTestDb(); });
 */
export async function createTestDb(): Promise<Db> {
  await closeTestDb();
  const pg = (await (await migratedTemplate()).clone()) as PGlite;
  current = pg;
  const db = drizzle({ client: pg, schema });
  setTestDb(db);
  return db;
}

/** Closes the current test DB (if any) and unregisters it from `getDb()`. */
export async function closeTestDb(): Promise<void> {
  const pg = current;
  current = undefined;
  setTestDb(null);
  if (pg && !pg.closed) await pg.close();
}
