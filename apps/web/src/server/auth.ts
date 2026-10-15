import 'server-only';
import { getDb, isUserActive, schema } from '@zaraki/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';

function createAuth() {
  const db = getDb();
  return betterAuth({
    appName: 'Zaraki Sushi',
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),
    advanced: {
      cookiePrefix: 'zk',
      database: { generateId: 'uuid' },
    },
    // Usuários são criados só pelo admin (CRUD de usuários / CLI); não há cadastro público.
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8, autoSignIn: false },
    session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 60 },
    user: {
      additionalFields: {
        status: { type: 'boolean', input: false, defaultValue: true },
        isPlatformAdmin: { type: 'boolean', input: false, defaultValue: false },
        mustChangePassword: { type: 'boolean', input: false, defaultValue: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // Usuário excluído logicamente (status = false) não consegue entrar.
          before: async (session) => {
            if (!(await isUserActive(db, session.userId))) return false;
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { __zarakiAuth?: Auth };

/** Instância do Better Auth (criada sob demanda, para o build não depender do banco). */
export function getAuth(): Auth {
  return (globalForAuth.__zarakiAuth ??= createAuth());
}
