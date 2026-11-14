import { defineConfig } from "drizzle-kit";

// `npm run db:generate` only needs the schema. `npm run db:migrate` applies
// drizzle/*.sql to DATABASE_URL: a Postgres URL (Supabase) or, when empty or
// `pglite:<dir>`, the local PGlite directory (default ./.data/pglite).
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // file is optional
  }
}

const url = process.env.DATABASE_URL ?? "";
const isPglite = url === "" || url.startsWith("pglite:");

// Always talk TLS to Postgres (Supabase), like the app does.
function withSslmode(raw: string): string {
  const u = new URL(raw);
  if (!u.searchParams.has("sslmode")) u.searchParams.set("sslmode", "require");
  return u.toString();
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  ...(isPglite
    ? { driver: "pglite", dbCredentials: { url: url.slice("pglite:".length) || "./.data/pglite" } }
    : { dbCredentials: { url: withSslmode(url) } }),
});
