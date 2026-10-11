import { z } from 'zod';

const isLocal = (url: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(url);

const schema = z
  .object({
    DATABASE_URL: z.string().startsWith('postgres', 'deve ser uma connection string do Postgres'),
    BETTER_AUTH_SECRET: z.string().min(32, 'precisa de pelo menos 32 caracteres (gere com: openssl rand -base64 32)'),
    BETTER_AUTH_URL: z
      .url('deve ser o endereço do site (ex.: https://zarakisushi.com.br)')
      .refine((u) => u.startsWith('https://') || isLocal(u), 'em produção precisa ser https://'),
    WHATSAPP_NUMBER: z.string().regex(/^\+?\d{12,13}$/, 'só dígitos, com DDI e DDD (ex.: 5562981092799)'),
    DEFAULT_TENANT_SLUG: z.string().min(1).default('matriz'),
    CRON_SECRET: z.string().min(16, 'precisa de pelo menos 16 caracteres (gere com: openssl rand -hex 24)'),
    GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
    GOOGLE_SERVICE_ACCOUNT_KEY: z.string().optional(),
    GOOGLE_CALENDAR_ID: z.string().optional(),
    BLOB_READ_WRITE_TOKEN: z.string().optional(),
  })
  .refine((e) => !!e.GOOGLE_SERVICE_ACCOUNT_EMAIL === !!e.GOOGLE_SERVICE_ACCOUNT_KEY, {
    path: ['GOOGLE_SERVICE_ACCOUNT_KEY'],
    message: 'informe GOOGLE_SERVICE_ACCOUNT_EMAIL e GOOGLE_SERVICE_ACCOUNT_KEY juntos',
  });

/**
 * Confere as variáveis de ambiente quando o servidor sobe (instrumentation.ts). Em produção, uma
 * configuração inválida impede a subida com uma mensagem clara; em desenvolvimento, só avisa.
 */
export function validateEnv() {
  const result = schema.safeParse(process.env);
  const warnings: string[] = [];
  if (result.success) {
    if (!result.data.GOOGLE_SERVICE_ACCOUNT_EMAIL) warnings.push('Google Agenda sem credenciais: encomendas ficam "pendentes" (docs/google-agenda.md).');
    if (!result.data.BLOB_READ_WRITE_TOKEN) warnings.push('BLOB_READ_WRITE_TOKEN ausente: envio de fotos do cardápio só funciona em desenvolvimento.');
    for (const w of warnings) console.warn(`[config] ${w}`);
    return;
  }
  const problems = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  const message = `Configuração inválida (veja .env.example e docs/deploy.md):\n${problems}`;
  if (process.env.NODE_ENV === 'production') throw new Error(message);
  console.warn(`[config] ${message}`);
}
