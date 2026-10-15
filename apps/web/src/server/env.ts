import { z } from 'zod';

const isLocal = (url: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(url);

type EnvVar = {
  name: string;
  /** Sem ela o sistema não funciona (em produção, o servidor não sobe). */
  required: boolean;
  /** Para que serve e o que acontece sem ela. */
  purpose: string;
  /** Como obter ou gerar o valor. */
  howTo: string;
  /** Só faz sentido fora de produção (não é cobrada em produção). */
  devOnly?: boolean;
};

/** Todas as variáveis de ambiente usadas pelo sistema (mesma ordem do .env.example). */
export const ENV_CATALOG: EnvVar[] = [
  {
    name: 'DATABASE_URL',
    required: true,
    purpose: 'conexão da aplicação com o banco (papel zaraki_app).',
    howTo: 'Neon → Connection Details, com o usuário zaraki_app; local: postgres://zaraki_app:zaraki_app_dev@localhost:5433/zaraki',
  },
  {
    name: 'DATABASE_URL_MIGRATIONS',
    required: false,
    purpose: 'conexão do dono do banco, usada só pelo `pnpm db:migrate` (no build da Vercel). Sem ela, o build não aplica as migrations.',
    howTo: 'Neon → Connection Details, com o usuário dono (neondb_owner); local: postgres://postgres:postgres@localhost:5433/zaraki',
  },
  {
    name: 'APP_DB_PASSWORD',
    required: false,
    purpose: 'senha do papel zaraki_app, definida pelas migrations. Sem ela, a senha não é (re)definida e a DATABASE_URL pode não conectar.',
    howTo: 'gerar com o comando openssl rand -base64 24 (deve ser a mesma senha da DATABASE_URL)',
  },
  {
    name: 'DEFAULT_TENANT_SLUG',
    required: false,
    purpose: 'unidade que recebe os pedidos do site. Sem ela, usa "matriz".',
    howTo: 'o identificador da unidade no cadastro de Unidades (ex.: matriz)',
  },
  {
    name: 'WHATSAPP_NUMBER',
    required: true,
    purpose: 'número que recebe os pedidos do site no WhatsApp.',
    howTo: 'só dígitos, com DDI e DDD (ex.: 5562981092799)',
  },
  {
    name: 'BETTER_AUTH_SECRET',
    required: true,
    purpose: 'segredo que assina as sessões do painel /admin.',
    howTo: 'gerar com o comando openssl rand -base64 32 (um diferente por ambiente)',
  },
  {
    name: 'BETTER_AUTH_URL',
    required: true,
    purpose: 'endereço público do site, usado no login do painel.',
    howTo: 'o domínio real com https (ex.: https://zarakisushi.com.br); local: http://localhost:3000',
  },
  {
    name: 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    required: false,
    purpose: 'conta de serviço do Google Agenda. Sem ela, encomendas e festas ficam "Agenda: pendente".',
    howTo: 'campo "client_email" do JSON da conta de serviço (passo a passo em docs/google-agenda.md)',
  },
  {
    name: 'GOOGLE_SERVICE_ACCOUNT_KEY',
    required: false,
    purpose: 'chave privada da conta de serviço do Google Agenda. Sem ela, encomendas e festas ficam "Agenda: pendente".',
    howTo: 'campo "private_key" do JSON da conta de serviço, com \\n literais (docs/google-agenda.md)',
  },
  {
    name: 'GOOGLE_CALENDAR_ID',
    required: false,
    purpose: 'agenda padrão da rede. Sem ela, só sincronizam as unidades com agenda própria no cadastro.',
    howTo: 'o e-mail da agenda (ex.: zarakisushigo@gmail.com), compartilhada com a conta de serviço',
  },
  {
    name: 'CALENDAR_DRIVER',
    required: false,
    devOnly: true,
    purpose: 'agenda simulada para desenvolvimento offline. Em produção deve ficar vazia.',
    howTo: 'CALENDAR_DRIVER=fake (só no .env local)',
  },
  {
    name: 'CRON_SECRET',
    required: true,
    purpose: 'protege a rota de cron /api/cron/calendar (fila da agenda).',
    howTo: 'gerar com o comando openssl rand -hex 24 (a Vercel o envia automaticamente ao cron)',
  },
  {
    name: 'BLOB_READ_WRITE_TOKEN',
    required: false,
    purpose: 'armazenamento das fotos do cardápio. Sem ele, o envio de fotos só funciona em desenvolvimento.',
    howTo: 'Vercel → Storage → Blob → criar o store e conectar ao projeto (o token entra sozinho)',
  },
];

/** Valores de exemplo do .env.example contam como "não configurado". */
const isPlaceholder = (value: string) => value.startsWith('troque-por');

/** Variáveis do catálogo vazias, ausentes ou ainda com o valor de exemplo. */
export function missingEnv(env: NodeJS.ProcessEnv, production: boolean): EnvVar[] {
  return ENV_CATALOG.filter((v) => {
    if (v.devOnly && production) return false;
    const value = env[v.name]?.trim();
    return !value || isPlaceholder(value);
  });
}

/** Relatório legível das variáveis não configuradas (só nomes e instruções, nunca valores). */
export function missingEnvReport(missing: EnvVar[]): string {
  const section = (title: string, list: EnvVar[]) =>
    list.length ? [`  ${title}`, ...list.map((v) => `    ✗ ${v.name}: ${v.purpose}\n      Como configurar: ${v.howTo}`)] : [];
  return [
    `[config] ${missing.length} variáve${missing.length === 1 ? 'l' : 'is'} de ambiente não configurada${missing.length === 1 ? '' : 's'}`,
    '  (no .env da raiz do projeto ou em Vercel → Settings → Environment Variables; modelo em .env.example)',
    ...section('OBRIGATÓRIAS', missing.filter((v) => v.required)),
    ...section('OPCIONAIS', missing.filter((v) => !v.required)),
  ].join('\n');
}

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
 * Confere as variáveis de ambiente quando o servidor sobe (instrumentation.ts).
 * Lista no console todas as variáveis não configuradas e as que estão com formato inválido.
 * Em produção, falta de obrigatória ou formato inválido impede a subida; em desenvolvimento, só avisa.
 */
export function validateEnv() {
  const production = process.env.NODE_ENV === 'production';
  const missing = missingEnv(process.env, production);
  if (missing.length) console.log(missingEnvReport(missing));

  // Formato inválido só das variáveis preenchidas (as ausentes já estão no relatório acima).
  const missingNames = new Set(missing.map((v) => v.name));
  const result = schema.safeParse(process.env);
  const invalid = result.success ? [] : result.error.issues.filter((i) => !missingNames.has(String(i.path[0])));
  if (invalid.length) {
    console.log(`[config] Variáveis com valor inválido:\n${invalid.map((i) => `    ✗ ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }

  const blocking = missing.filter((v) => v.required).length + invalid.length;
  if (production && blocking) {
    throw new Error('Configuração incompleta ou inválida: veja a lista [config] acima, o .env.example e docs/deploy.md.');
  }
  if (!missing.length && !invalid.length) console.log('[config] Todas as variáveis de ambiente estão configuradas.');
}
