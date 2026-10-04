import { closeDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migrations.js';

try {
  const applied = await runMigrations();
  console.info(`Database migrations complete (${applied.length} applied)`);
} catch {
  console.error('Database migration failed; check connectivity and migration SQL.');
  process.exitCode = 1;
} finally {
  await closeDatabase();
}