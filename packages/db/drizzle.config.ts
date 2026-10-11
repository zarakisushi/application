import { defineConfig } from 'drizzle-kit';
import './scripts/env';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  casing: 'snake_case',
  dbCredentials: { url: process.env.DATABASE_URL_MIGRATIONS ?? '' },
});
