import { requireEnv } from './env';
import { runMigrations } from '../src/migrate';

await runMigrations(requireEnv('DATABASE_URL_MIGRATIONS'), process.env.APP_DB_PASSWORD);
console.log('Migrations aplicadas.');
