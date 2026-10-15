import { sql } from 'drizzle-orm';
import { getDb, type Database, type Tx } from './client';

export type DbContext = {
  /** Unidade ativa. Sem ela, o RLS não devolve nenhuma linha de negócio. */
  tenantId?: string | null;
  userId?: string | null;
  /** Usuário da Matriz com acesso a todas as unidades. */
  platformAdmin?: boolean;
  /** Rótulo do ator quando não há usuário (ex.: "site", "seed", "cron"). */
  actorLabel?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  /** Só para seed/importação: permite gravar `created_at` no passado. */
  allowBackdate?: boolean;
};

/**
 * Executa `fn` numa transação com o contexto definido via `set_config(..., true)`.
 * Os triggers do banco leem esse contexto para carimbar autoria, gravar a auditoria
 * e aplicar o isolamento entre unidades (RLS). Toda escrita da aplicação passa por aqui.
 */
export function withContext<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>, db: Database = getDb()): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true),
      set_config('app.user_id', ${ctx.userId ?? ''}, true),
      set_config('app.platform_admin', ${ctx.platformAdmin ? 'on' : ''}, true),
      set_config('app.actor_label', ${ctx.actorLabel ?? ''}, true),
      set_config('app.ip', ${ctx.ip ?? ''}, true),
      set_config('app.user_agent', ${ctx.userAgent ?? ''}, true),
      set_config('app.request_id', ${ctx.requestId ?? ''}, true),
      set_config('app.allow_backdate', ${ctx.allowBackdate ? 'on' : ''}, true)`);
    return fn(tx);
  });
}
