import { describe, expect, it } from "vitest";
import { POSTGRES_OPTIONS, resolveDbTarget } from "./client";

describe("db client", () => {
  it("postgres connections use TLS and no prepared statements (Supabase transaction pooler)", () => {
    expect(POSTGRES_OPTIONS.ssl).toBe("require");
    expect(POSTGRES_OPTIONS.prepare).toBe(false);
  });

  it("empty or pglite: URLs use local PGlite", () => {
    expect(resolveDbTarget(undefined, {})).toEqual({ kind: "pglite", dir: "./.data/pglite" });
    expect(resolveDbTarget("pglite:./x", {})).toEqual({ kind: "pglite", dir: "./x" });
    expect(resolveDbTarget("postgresql://u:p@h:6543/postgres", {})).toEqual({
      kind: "postgres",
      url: "postgresql://u:p@h:6543/postgres",
    });
  });

  it("refuses PGlite on Vercel so a missing DATABASE_URL fails loudly", () => {
    expect(() => resolveDbTarget(undefined, { VERCEL: "1" })).toThrowError(/DATABASE_URL/);
    expect(() => resolveDbTarget("pglite:./x", { VERCEL: "1" })).toThrowError(/DATABASE_URL/);
    expect(resolveDbTarget("postgresql://h/db", { VERCEL: "1" }).kind).toBe("postgres");
  });
});
