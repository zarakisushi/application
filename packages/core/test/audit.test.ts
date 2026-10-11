import { describe, expect, it } from 'vitest';
import { auditActor, auditChanges, auditRecordTitle, formatAuditValue } from '../src';

const TZ = 'America/Sao_Paulo';

describe('apresentação da auditoria', () => {
  it('formata valores de forma legível', () => {
    expect(formatAuditValue('price_cents', 5890, TZ)).toBe('R$ 58,90');
    expect(formatAuditValue('status', false, TZ)).toBe('Excluído');
    expect(formatAuditValue('paid', true, TZ)).toBe('Sim');
    expect(formatAuditValue('stage', 'SAIU_PARA_ENTREGA', TZ)).toBe('Saiu para entrega');
    expect(formatAuditValue('role', 'GERENTE', TZ)).toBe('Gerente');
    expect(formatAuditValue('phone', '+5562981092799', TZ)).toBe('(62) 98109-2799');
    expect(formatAuditValue('birthday', '1990-05-20', TZ)).toBe('20/05/1990');
    expect(formatAuditValue('scheduled_at', '2026-10-24T22:30:00+00:00', TZ)).toBe('24/10/2026, 19:30');
    expect(formatAuditValue('notes', null, TZ)).toBe('—');
  });

  it('alteração mostra só os campos alterados, com antes e depois', () => {
    const changes = auditChanges(
      {
        action: 'UPDATE',
        entity: 'products',
        changedFields: ['price_cents', 'updated_at'],
        before: { name: 'Salmão', price_cents: 5000, updated_at: 'x' },
        after: { name: 'Salmão', price_cents: 5500, updated_at: 'y' },
      },
      TZ,
    );
    expect(changes).toEqual([{ field: 'price_cents', label: 'Preço', before: 'R$ 50,00', after: 'R$ 55,00' }]);
  });

  it('criação lista os campos preenchidos e esconde os técnicos', () => {
    const changes = auditChanges(
      {
        action: 'CREATE',
        entity: 'customers',
        changedFields: null,
        before: null,
        after: { id: 'abc', tenant_id: 't', name: 'Ana', phone: '+5562981092799', email: null, status: true },
      },
      TZ,
    );
    expect(changes.map((c) => [c.label, c.before, c.after])).toEqual([
      ['Nome', '—', 'Ana'],
      ['Telefone', '—', '(62) 98109-2799'],
      ['Situação', '—', 'Ativo'],
    ]);
  });

  it('identifica o registro e o autor', () => {
    expect(auditRecordTitle({ before: null, after: { code: 'ZK-000010', name: 'x' } })).toBe('ZK-000010');
    expect(auditRecordTitle({ before: { email: 'a@b.c' }, after: null })).toBe('a@b.c');
    expect(auditActor('Tiago', 'x')).toBe('Tiago');
    expect(auditActor(null, 'site')).toBe('Site (cliente)');
    expect(auditActor(null, 'ana@zaraki.com')).toBe('ana@zaraki.com');
    expect(auditActor(null, null)).toBe('Sistema');
  });
});
