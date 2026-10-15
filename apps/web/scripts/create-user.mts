// Cria um usuário do admin pelo terminal (ex.: o primeiro administrador da Matriz).
//   pnpm admin:create --email ana@zaraki.com.br --name "Ana Souza" --password "senha-inicial" --platform-admin
//   pnpm admin:create --email joao@zaraki.com.br --name "João" --password "..." --role ATENDENTE --tenant matriz
// O usuário é obrigado a trocar a senha no primeiro acesso.
import { ROLES, type Role } from '@zaraki/core';
import { createDb, createUserWithPassword, findTenantBySlug, withContext } from '@zaraki/db';
import { hashPassword } from 'better-auth/crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    password: { type: 'string' },
    role: { type: 'string', default: 'ADMIN' },
    tenant: { type: 'string', default: process.env.DEFAULT_TENANT_SLUG ?? 'matriz' },
    'platform-admin': { type: 'boolean', default: false },
    /** Só para testes/automação: dispensa a troca de senha no primeiro acesso. */
    ready: { type: 'boolean', default: false },
  },
});

const fail = (message: string): never => {
  console.error(`Erro: ${message}`);
  process.exit(1);
};

const email = values.email ?? fail('informe --email');
const name = values.name ?? fail('informe --name');
const password = values.password ?? fail('informe --password');
if (password.length < 8) fail('a senha precisa ter pelo menos 8 caracteres');
const role = (ROLES as readonly string[]).includes(values.role) ? (values.role as Role) : fail(`papel inválido: ${values.role}`);

const db = createDb(process.env.DATABASE_URL ?? fail('DATABASE_URL não definida'), 1);
try {
  const tenant = (await findTenantBySlug(db, values.tenant)) ?? fail(`unidade "${values.tenant}" não encontrada (rode pnpm db:seed)`);
  const user = await withContext({ platformAdmin: true, actorLabel: 'cli' }, async (tx) =>
    createUserWithPassword(tx, {
      name,
      email,
      passwordHash: await hashPassword(password),
      isPlatformAdmin: values['platform-admin'],
      mustChangePassword: !values.ready,
      memberships: [{ tenantId: tenant.id, role }],
    }),
  db);
  console.log(`Usuário criado: ${user.name} <${user.email}> · ${role} em ${tenant.name}${user.isPlatformAdmin ? ' · Matriz (acesso à rede)' : ''}`);
} finally {
  await db.$client.end();
}
