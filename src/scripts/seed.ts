// Creates the owner's workspace with the four services and starting keywords. Safe to run again.
// Usage: npm run seed [-- --name "My company"]

import { seedOwnerWorkspace } from '../lib/seed';
import { loadEnv, openDb, parseArgs, run, strArg } from './common';

run(async () => {
  const args = parseArgs(process.argv.slice(2));
  const db = openDb(loadEnv());
  try {
    const id = await seedOwnerWorkspace(db, strArg(args, 'name'));
    console.log(`Workspace ready: ${id}`);
  } finally {
    await db.close();
  }
});
