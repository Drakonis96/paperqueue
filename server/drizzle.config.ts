import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// drizzle-kit loads this file with its own bundler, so we read env directly
// instead of importing the validated `env` object from src/config.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "./data/paperqueue.db",
  },
  verbose: true,
  strict: true,
});
