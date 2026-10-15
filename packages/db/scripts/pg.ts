// Postgres local para desenvolvimento, sem Docker: binários do pacote embedded-postgres,
// dados em <raiz>/.data/pg. Uso: `pnpm db:start` (fica rodando até Ctrl+C).
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const databaseDir = fileURLToPath(new URL('../../../.data/pg', import.meta.url));
const port = Number(process.env.LOCAL_PG_PORT ?? 5433);

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  onLog: () => {},
});

if (!existsSync(`${databaseDir}/PG_VERSION`)) {
  console.log('Inicializando Postgres local em .data/pg ...');
  await pg.initialise();
}
await pg.start();

const client = pg.getPgClient();
await client.connect();
const { rowCount } = await client.query(`select 1 from pg_database where datname = 'zaraki'`);
await client.end();
if (!rowCount) await pg.createDatabase('zaraki');

console.log(`Postgres local pronto: postgres://postgres:postgres@localhost:${port}/zaraki (Ctrl+C para parar)`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await new Promise(() => {});
