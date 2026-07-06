import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Replaces the deprecated `"prisma": { "seed": ... }` key in package.json.
// See: https://pris.ly/prisma-config
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.js",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
