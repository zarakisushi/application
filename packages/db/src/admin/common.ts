import { count, eq, type AnyColumn, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Tx } from '../client';

export type StatusFilter = 'ativos' | 'inativos' | 'todos';

export type ListParams = {
  q?: string;
  status?: StatusFilter;
  page?: number;
  pageSize?: number;
};

export type Page<T> = { rows: T[]; total: number; page: number; pageSize: number; pages: number };

/** Filtro da exclusão lógica: ativos (padrão), inativos ou todos. */
export function statusWhere(column: AnyColumn, status: StatusFilter = 'ativos'): SQL | undefined {
  return status === 'todos' ? undefined : eq(column, status === 'ativos');
}

export function paging(params: ListParams) {
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const page = Math.max(1, Math.floor(params.page ?? 1));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** Termo de busca para ILIKE, com curingas escapados. */
export const contains = (q: string) => `%${q.trim().replace(/[\\%_]/g, '\\$&')}%`;

export async function countWhere(tx: Tx, table: PgTable, where: SQL | undefined) {
  const [row] = await tx.select({ n: count() }).from(table).where(where);
  return row?.n ?? 0;
}

export function toPage<T>(rows: T[], total: number, page: number, pageSize: number): Page<T> {
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}
