import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite loads its WASM/data files from node_modules at runtime; bundling breaks that.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Pin the workspace root (a stray lockfile in a parent directory would otherwise be picked).
  turbopack: { root: __dirname },
};

export default nextConfig;
