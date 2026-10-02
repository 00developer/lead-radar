// Applies supabase/migrations/*.sql to the database in DATABASE_URL. Safe to run again: applied files are skipped.
// Usage: npm run migrate

import { migrate } from '../lib/db/migrate';
import { loadEnv, openDb, run } from './common';

run(async () => {
  const db = openDb(loadEnv());
  try {
    const applied = await migrate(db);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date. Nothing to apply.');
  } finally {
    await db.close();
  }
});
