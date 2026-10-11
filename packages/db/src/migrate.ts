import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Aplica as migrations com o papel dono do banco e, se `appPassword` for informado,
 * habilita o login do papel da aplicação (`zaraki_app`) com essa senha.
 */
export async function runMigrations(ownerUrl: string, appPassword?: string) {
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await migrate(drizzle({ client }), { migrationsFolder });
    if (appPassword) {
      await client.query(`alter role zaraki_app login password ${client.escapeLiteral(appPassword)}`);
    }
  } finally {
    await client.end();
  }
}
