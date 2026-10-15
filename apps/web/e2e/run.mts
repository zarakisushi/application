// Testes ponta a ponta: banco temporário → seed → build → Playwright. Tudo offline.
import { startTestDatabase } from '@zaraki/db/testing';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const db = await startTestDatabase(5441);
const env = {
  ...process.env,
  DATABASE_URL: db.appUrl,
  DATABASE_URL_MIGRATIONS: db.ownerUrl,
  E2E_OWNER_URL: db.ownerUrl,
  DEFAULT_TENANT_SLUG: 'matriz',
  WHATSAPP_NUMBER: '5562900000000',
  BETTER_AUTH_URL: 'http://localhost:3200',
  BETTER_AUTH_SECRET: 'e2e-segredo-de-teste-com-32-caracteres!!',
  // Agenda simulada (sem credenciais do Google), para testar a sincronização offline.
  GOOGLE_SERVICE_ACCOUNT_EMAIL: '',
  GOOGLE_SERVICE_ACCOUNT_KEY: '',
  CALENDAR_DRIVER: 'fake',
  GOOGLE_CALENDAR_ID: 'zarakisushigo@gmail.com',
  CRON_SECRET: 'e2e-cron-secret-de-teste-0001',
  DEMO_DAYS: '90',
  // Fotos do cardápio gravadas em public/uploads (sem Vercel Blob nos testes).
  UPLOADS_LOCAL: '1',
  NEXT_TELEMETRY_DISABLED: '1',
};

const run = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { env, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} falhou`);
};

let failed = false;
try {
  run('npx', ['tsx', fileURLToPath(new URL('../../../packages/db/scripts/seed.ts', import.meta.url))]);
  const createUser = (...args: string[]) =>
    run('npx', ['tsx', fileURLToPath(new URL('../scripts/create-user.mts', import.meta.url)), '--password', 'SenhaInicial123', ...args]);
  createUser('--email', 'admin@zaraki.test', '--name', 'Tiago Admin', '--platform-admin');
  createUser('--email', 'atendente@zaraki.test', '--name', 'Carla Atendente', '--role', 'ATENDENTE');
  createUser('--email', 'inativo@zaraki.test', '--name', 'Ex Funcionário', '--role', 'ATENDENTE');
  createUser('--email', 'gestor@zaraki.test', '--name', 'Gestora Matriz', '--platform-admin', '--ready');
  // Dados de demonstração (90 dias) para dashboard e relatórios terem volume.
  run('npx', ['tsx', fileURLToPath(new URL('../../../packages/db/scripts/seed-demo.ts', import.meta.url))]);
  // Sem cache de dados de execuções anteriores (ele guardaria o id da unidade de outro banco).
  rmSync(fileURLToPath(new URL('../.next', import.meta.url)), { recursive: true, force: true });
  run('npx', ['next', 'build']);
  run('npx', ['playwright', 'test', ...process.argv.slice(2)]);
} catch (error) {
  console.error(String(error));
  failed = true;
} finally {
  await db.stop();
}
process.exit(failed ? 1 : 0);
