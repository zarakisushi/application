import { boolean, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { baseColumns, id, ts } from './common';

// Tabelas no formato esperado pelo Better Auth (mapeadas no adapter: user → users etc.).
// `users` e `accounts` seguem a regra de exclusão lógica; `sessions` e `verifications`
// são técnicas e podem ter exclusão física (logout, expiração).

export const users = pgTable('users', {
  id: id(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  isPlatformAdmin: boolean().notNull().default(false),
  mustChangePassword: boolean().notNull().default(false),
  ...baseColumns(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    token: text().notNull().unique(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    expiresAt: ts().notNull(),
    ipAddress: text(),
    userAgent: text(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: ts(),
    refreshTokenExpiresAt: ts(),
    scope: text(),
    password: text(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [index('accounts_user_idx').on(t.userId)],
);

export const verifications = pgTable('verifications', {
  id: id(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: ts().notNull(),
  createdAt: ts().notNull().defaultNow(),
  updatedAt: ts().notNull().defaultNow(),
});
