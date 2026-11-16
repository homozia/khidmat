import { pool } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';

const applied = await migrate(pool);
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
await pool.end();
