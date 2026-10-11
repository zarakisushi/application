import { boolean, timestamp, uuid } from 'drizzle-orm/pg-core';

export const id = () => uuid().primaryKey().defaultRandom();

export const ts = () => timestamp({ withTimezone: true, mode: 'date' });

/**
 * Colunas padrão de toda tabela de negócio.
 * - `status`: exclusão lógica (false = excluído). DELETE físico é bloqueado por trigger.
 * - `created_*` / `updated_*`: preenchidos pelo trigger `stamp_row` a partir do contexto da transação
 *   (ver `withContext`), então a aplicação não consegue falsificá-los.
 */
export const baseColumns = () => ({
  status: boolean().notNull().default(true),
  createdAt: ts().notNull().defaultNow(),
  createdBy: uuid(),
  updatedAt: ts().notNull().defaultNow(),
  updatedBy: uuid(),
});
