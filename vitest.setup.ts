import { afterAll } from "vitest";
import { setTestEnv } from "@/server/env";

// Runs before every test file (node + dom projects).

// Every test starts with a valid env (TEST_ENV). Override per test with
// `setTestEnv({ KEY: 'value' })`.
setTestEnv();

// Close the in-memory PGlite opened by createTestDb() in this file, if any.
afterAll(async () => {
  const state = (globalThis as { __drsDbState?: { testDb?: unknown } }).__drsDbState;
  if (!state?.testDb) return;
  const { closeTestDb } = await import("@/server/db/test-db");
  await closeTestDb();
});
