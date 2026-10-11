import { attachDatabasePool } from '@vercel/functions';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema> & { $client: Pool };
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export function createDb(connectionString: string, max = 5): Database {
  const pool = new Pool({
    connectionString,
    max,
    // Em funções serverless, conexões ociosas são fechadas logo (o Neon tem pooler próprio).
    idleTimeoutMillis: process.env.VERCEL ? 5_000 : 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // Na Vercel (Fluid compute), libera as conexões ociosas antes de a função ser suspensa.
  if (process.env.VERCEL) attachDatabasePool(pool);
  return drizzle({ client: pool, schema, casing: 'snake_case' });
}

// Reaproveita o pool entre recarregamentos do Next em dev.
const globalForDb = globalThis as unknown as { __zarakiDb?: Database };

/** Conexão da aplicação (papel `zaraki_app`, sujeito a RLS e sem DELETE). */
export function getDb(): Database {
  if (!globalForDb.__zarakiDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL não definida');
    globalForDb.__zarakiDb = createDb(url);
  }
  return globalForDb.__zarakiDb;
}

/** Teste de conectividade para a rota de saúde. */
export async function pingDatabase(db: Database = getDb()) {
  await db.$client.query('select 1');
}
