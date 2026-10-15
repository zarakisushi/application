import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { createDb } from './client';
import { withContext } from './context';
import { backfillOrderFinance, ensureFinanceDefaultsForAll } from './finance';

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
  await prepareData(ownerUrl);
}

/**
 * Dados derivados que acompanham as migrations (idempotente): contas e categorias do financeiro de cada
 * unidade e as entradas no caixa dos pedidos que já estavam pagos.
 */
async function prepareData(ownerUrl: string) {
  const db = createDb(ownerUrl, 1);
  try {
    await withContext({ platformAdmin: true, actorLabel: 'migrate' }, async (tx) => {
      await ensureFinanceDefaultsForAll(tx);
      await backfillOrderFinance(tx);
    }, db);
  } finally {
    await db.$client.end();
  }
}
