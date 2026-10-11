// Sobe um Postgres temporário, aplica as migrations e entrega as URLs aos testes.
import type { TestProject } from 'vitest/node';
import { startTestDatabase } from '../src/testing';

declare module 'vitest' {
  export interface ProvidedContext {
    ownerUrl: string;
    appUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const db = await startTestDatabase();
  project.provide('ownerUrl', db.ownerUrl);
  project.provide('appUrl', db.appUrl);
  return db.stop;
}
