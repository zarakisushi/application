import 'server-only';
import { DomainError, fieldErrors } from '@zaraki/core';
import type { z } from 'zod';

/** Resultado padrão das Server Actions do painel. */
export type ActionResult =
  | {
      ok?: boolean;
      error?: string;
      fieldErrors?: Record<string, string>;
      message?: string;
      /** Segredo mostrado uma única vez (ex.: senha provisória). */
      secret?: string;
      /** Página para onde o formulário deve ir, se for diferente da atual. */
      redirectTo?: string;
      /** Id do registro criado. */
      id?: string;
      /** Endereço de um arquivo enviado. */
      url?: string;
    }
  | undefined;

/** Campos do formulário como objeto (ignora os campos internos do Next). */
export function formToObject(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (!key.startsWith('$') && typeof value === 'string') out[key] = value;
  }
  return out;
}

/** Valida o formulário com o schema; devolve os dados ou o resultado com os erros por campo. */
export function parseForm<S extends z.ZodType>(schema: S, form: FormData | Record<string, unknown>) {
  const raw = form instanceof FormData ? formToObject(form) : form;
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { data: parsed.data as z.output<S> };
  return { result: { error: 'Confira os campos destacados.', fieldErrors: fieldErrors(parsed.error) } satisfies ActionResult };
}

/** Executa a operação convertendo erros de regra de negócio em mensagem para o usuário. */
export async function attempt(fn: () => Promise<ActionResult | void>): Promise<ActionResult> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
}
