import { startTestDatabase } from '@zaraki/db/testing';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    appUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const db = await startTestDatabase();
  project.provide('appUrl', db.appUrl);
  return db.stop;
}
