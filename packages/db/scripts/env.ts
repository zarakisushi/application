// Carrega o .env da raiz do monorepo (se existir). Variáveis já definidas no ambiente têm prioridade.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente ${name} não definida (veja .env.example)`);
  return value;
}
