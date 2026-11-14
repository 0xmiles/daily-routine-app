// Runs once when the Next.js server starts.
// In development with a local PGlite database, apply drizzle/ migrations so
// `npm run dev` works without a separate `npm run db:migrate`.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "development") return;
  try {
    const { migrateLocalPglite } = await import("@/server/db/client");
    await migrateLocalPglite();
  } catch (error) {
    console.warn("[db] Local PGlite migration skipped:", error instanceof Error ? error.message : error);
  }
}
