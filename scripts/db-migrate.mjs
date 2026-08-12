#!/usr/bin/env node
// Applies src/lib/schema.sql to DATABASE_URL. Safe to re-run — every statement
// is CREATE ... IF NOT EXISTS.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    "DATABASE_URL is not set. Put it in .env.local, or export it before running.",
  );
  process.exit(1);
}

const schema = await readFile(join(here, "..", "src", "lib", "schema.sql"), "utf8");

const client = new pg.Client({
  connectionString,
  ssl: connectionString.includes("localhost")
    ? undefined
    : { rejectUnauthorized: false },
});

await client.connect();
try {
  await client.query(schema);
  console.log("Schema applied.");
} finally {
  await client.end();
}
