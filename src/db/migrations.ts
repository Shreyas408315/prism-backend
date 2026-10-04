import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { pool } from './database.js';

const MIGRATION_LOCK_KEY = 714_209_318;

export async function runMigrations(
  databasePool: Pool = pool,
  migrationsDirectory = resolve(process.cwd(), 'migrations'),
): Promise<string[]> {
  const client = await databasePool.connect();
  const appliedMigrations: string[] = [];

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const appliedResult = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations',
    );
    const applied = new Set(appliedResult.rows.map((row) => row.filename));
    const files = (await readdir(migrationsDirectory))
      .filter((filename) => /^\d+_[\w-]+\.sql$/.test(filename))
      .sort();

    for (const filename of files) {
      if (applied.has(filename)) continue;

      const sql = await readFile(resolve(migrationsDirectory, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        appliedMigrations.push(filename);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    return appliedMigrations;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

export type MigrationClient = PoolClient;