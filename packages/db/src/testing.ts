// Banco temporário para testes (unitários e ponta a ponta): Postgres embutido, migrations aplicadas.
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from './migrate';

// O embedded-postgres registra o async-exit-hook, que no 'beforeExit' chama process.exit(0) e apagaria
// o código de falha definido pelo executor de testes (testes falhando sairiam como sucesso).
const exit = process.exit.bind(process);
process.exit = ((code?: number | string | null) =>
  exit(Number(code) || Number(process.exitCode ?? 0))) as typeof process.exit;

export type TestDatabase = {
  ownerUrl: string;
  appUrl: string;
  stop: () => Promise<void>;
};

export async function startTestDatabase(port = 54_000 + Math.floor(Math.random() * 1000)): Promise<TestDatabase> {
  const databaseDir = mkdtempSync(join(tmpdir(), 'zaraki-pg-'));
  const pg = new EmbeddedPostgres({
    databaseDir,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('zaraki_test');

  const ownerUrl = `postgres://postgres:postgres@localhost:${port}/zaraki_test`;
  await runMigrations(ownerUrl, 'test_app');

  return {
    ownerUrl,
    appUrl: `postgres://zaraki_app:test_app@localhost:${port}/zaraki_test`,
    stop: async () => {
      await pg.stop();
      rmSync(databaseDir, { recursive: true, force: true });
    },
  };
}
