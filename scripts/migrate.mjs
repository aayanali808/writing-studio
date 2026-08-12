/**
 * Applies src/lib/schema.sql to DATABASE_URL.
 * The schema is written with IF NOT EXISTS throughout, so this is idempotent.
 *
 * Run: npm run db:migrate
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, '..', 'src', 'lib', 'schema.sql');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    'DATABASE_URL is not set.\n' +
      'Create .env.local with your Neon/Supabase connection string, then re-run.'
  );
  process.exit(1);
}

const isLocal =
  connectionString.includes('localhost') || connectionString.includes('127.0.0.1');

const client = new pg.Client({
  connectionString,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query(readFileSync(schemaPath, 'utf8'));
  console.log('Schema applied successfully.');
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
