'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { FLAVORS, WHATSAPP_URL, brl } from '@/data';

const ORDER_TYPES = ['Delivery', 'Festa', 'Evento'] as const;
type OrderType = (typeof ORDER_TYPES)[number];

const PAYMENT_METHODS = ['Pix', 'Cartão Débito', 'Cartão Crédito'] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

type Fields = {
  nome: string;
  tel: string;
  data: string;
  endereco: string;
  referencia: string;
  convidados: string;
  obs: string;
};

const EMPTY_FIELDS: Fields = { nome: '', tel: '', data: '', endereco: '', referencia: '', convidados: '', obs: '' };
const emptyQty = () => Object.fromEntries(FLAVORS.map((f) => [f.id, 0])) as Record<string, number>;

function buildMessage(
  type: OrderType,
  payment: PaymentMethod,
  f: Fields,
  qty: Record<string, number>,
  total: number,
) {
  const items = FLAVORS.filter((x) => qty[x.id])
    .map((x) => `• ${qty[x.id]}x ${x.name} (${brl(x.price * qty[x.id])})`)
    .join('\n');
  const lines: (string | null)[] = [
    'Olá, Zaraki Sushi! Quero fazer uma encomenda de Push-Pop Sushi.',
    '',
    `Tipo: ${type}`,
    `Nome: ${f.nome}`,
    `WhatsApp: ${f.tel}`,
    f.data ? `Data: ${f.data.split('-').reverse().join('/')}` : null,
    f.endereco ? `Endereço: ${f.endereco}` : null,
    f.referencia && type === 'Delivery' ? `Ponto de referência: ${f.referencia}` : null,
    f.convidados && type !== 'Delivery' ? `Convidados: ${f.convidados}` : null,
    '',
    items,
    `Total estimado: ${brl(total)}`,
    `Pagamento: ${payment}`,
    f.obs ? `\nObs: ${f.obs}` : null,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

export function OrderForm() {
  const [type, setType] = useState<OrderType>('Delivery');
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [qty, setQty] = useState(emptyQty);
  const [payment, setPayment] = useState<PaymentMethod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const tubes = FLAVORS.reduce((a, x) => a + qty[x.id], 0);
  const total = FLAVORS.reduce((a, x) => a + qty[x.id] * x.price, 0);
  const isEvent = type !== 'Delivery';

  const onField = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFields((s) => ({ ...s, [name]: value }));
  };

  const add = (id: string, d: number) => {
    setError(null);
    setQty((s) => ({ ...s, [id]: Math.max(0, s[id] + d) }));
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!tubes) {
      setError('Adicione pelo menos um tubo ao pedido.');
      return;
    }
    if (!payment) {
      setError('Escolha a forma de pagamento.');
      return;
    }
    const msg = buildMessage(type, payment, fields, qty, total);
    window.open(`${WHATSAPP_URL}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
    setSent(true);
  };

  const reset = () => {
    setSent(false);
    setQty(emptyQty());
    setFields(EMPTY_FIELDS);
    setPayment(null);
  };

  if (sent) {
    return (
      <div className="sent" role="status">
        <div className="sent__kanji" aria-hidden="true">感謝</div>
        <h3>Pedido enviado</h3>
        <p>
          Abrimos o WhatsApp com o resumo da sua encomenda. Nossa equipe confirma disponibilidade e entrega em seguida.
        </p>
        <button type="button" onClick={reset}>Fazer outro pedido</button>
      </div>
    );
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="form__group">
        <span className="form__group-label" id="order-type-label">Tipo de pedido</span>
        <div className="form__types" role="group" aria-labelledby="order-type-label">
          {ORDER_TYPES.map((t) => (
            <button key={t} type="button" className="form__type" aria-pressed={t === type} onClick={() => setType(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="form__fields">
        <label className="field">
          Nome
          <input name="nome" required value={fields.nome} onChange={onField} autoComplete="name" />
        </label>
        <label className="field">
          WhatsApp
          <input
            name="tel"
            type="tel"
            required
            placeholder="(62) 9 0000-0000"
            value={fields.tel}
            onChange={onField}
            autoComplete="tel"
          />
        </label>
        <label className="field">
          Data
          <input name="data" type="date" value={fields.data} onChange={onField} />
        </label>
        <label className="field">
          Bairro / endereço
          <input name="endereco" value={fields.endereco} onChange={onField} autoComplete="street-address" />
        </label>
      </div>

      {!isEvent && (
        <label className="field">
          Ponto de referência
          <input name="referencia" value={fields.referencia} onChange={onField} />
        </label>
      )}

      {isEvent && (
        <label className="field">
          Número de convidados
          <input name="convidados" type="number" min={1} value={fields.convidados} onChange={onField} />
        </label>
      )}

      <div className="form__group">
        <span className="form__group-label">Sabores (tubos de 10 peças)</span>
        <div className="lines">
          {FLAVORS.map((x) => (
            <div key={x.id} className="line">
              <span className="line__name">
                {x.name} <span>· {brl(x.price)}</span>
              </span>
              <div className="line__qty">
                <button
                  type="button"
                  className="qty-btn qty-btn--dec"
                  aria-label={`Remover ${x.name}`}
                  onClick={() => add(x.id, -1)}
                >
                  −
                </button>
                <output aria-live="polite">{qty[x.id]}</output>
                <button
                  type="button"
                  className="qty-btn qty-btn--inc"
                  aria-label={`Adicionar ${x.name}`}
                  onClick={() => add(x.id, 1)}
                >
                  +
                </button>
              </div>
            </div>
          ))}
          <div className="lines__total">
            <span>
              Total estimado <span>· {tubes === 1 ? '1 tubo' : `${tubes} tubos`}</span>
            </span>
            <span>{brl(total)}</span>
          </div>
        </div>
      </div>

      <div className="form__group">
        <span className="form__group-label" id="payment-label">Forma de pagamento</span>
        <div className="form__types" role="group" aria-labelledby="payment-label">
          {PAYMENT_METHODS.map((p) => (
            <button
              key={p}
              type="button"
              className="form__type"
              aria-pressed={p === payment}
              onClick={() => {
                setError(null);
                setPayment(p);
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        Observações
        <textarea name="obs" rows={3} value={fields.obs} onChange={onField} />
      </label>

      {error && (
        <div className="form__error" role="alert">
          {error}
        </div>
      )}

      <button type="submit" className="form__submit">Enviar pelo WhatsApp</button>
    </form>
  );
}
