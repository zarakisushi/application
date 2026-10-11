'use client';

import {
  ORDER_TYPES,
  ORDER_TYPE_LABEL,
  buildOrderMessage,
  formatCents,
  isScheduled,
  priceOrder,
  whatsappUrl,
  type OrderType,
  type PublicOrderInput,
} from '@zaraki/core';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { submitOrder } from '@/app/(site)/actions';

export type OrderFormProduct = { id: string; name: string; priceCents: number };

type Props = {
  products: OrderFormProduct[];
  whatsappNumber: string;
  /** Data mínima para encomendas/festas ("hoje" no fuso da unidade). */
  minDate: string;
  /** Banco indisponível: o pedido vai direto para o WhatsApp, sem ser gravado. */
  offline: boolean;
};

type Fields = {
  name: string;
  phone: string;
  date: string;
  time: string;
  neighborhood: string;
  address: string;
  guests: string;
  notes: string;
  website: string;
};

const EMPTY_FIELDS: Fields = {
  name: '',
  phone: '',
  date: '',
  time: '',
  neighborhood: '',
  address: '',
  guests: '',
  notes: '',
  website: '',
};

type Sent = { code: string | null; url: string };

/**
 * Abre o WhatsApp numa aba aberta ainda no clique (assim o bloqueador de pop-up não intervém).
 * Se a aba não pôde ser aberta, segue na própria página.
 */
function goTo(win: Window | null, url: string) {
  if (win && !win.closed) win.location.href = url;
  else window.location.href = url;
}

export function OrderForm({ products, whatsappNumber, minDate, offline }: Props) {
  const [type, setType] = useState<OrderType>('DELIVERY');
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);

  const items = products.filter((p) => qty[p.id]).map((p) => ({ productId: p.id, qty: qty[p.id]! }));
  const priced = priceOrder(products, items);
  const scheduled = isScheduled(type);
  const delivery = type === 'DELIVERY';

  const onField = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFields((s) => ({ ...s, [name]: value }));
    setFieldErrors(({ [name]: _, ...rest }) => rest);
  };

  const add = (id: string, d: number) => {
    setError(null);
    setFieldErrors(({ items: _, ...rest }) => rest);
    setQty((s) => ({ ...s, [id]: Math.max(0, (s[id] ?? 0) + d) }));
  };

  const payload = (): PublicOrderInput => ({
    type,
    name: fields.name,
    phone: fields.phone,
    date: scheduled ? fields.date : '',
    time: scheduled ? fields.time : '',
    neighborhood: fields.neighborhood,
    address: fields.address,
    guests: type === 'FESTA' && fields.guests ? Number(fields.guests) : undefined,
    notes: fields.notes,
    items,
    website: fields.website,
  });

  /** Mensagem montada no navegador: usada quando o pedido não pôde ser gravado. */
  const localWhatsappUrl = () =>
    whatsappUrl(
      whatsappNumber,
      buildOrderMessage({ ...payload(), lines: priced.lines, totalCents: priced.totalCents }),
    );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!priced.tubes) {
      setError('Adicione pelo menos um tubo ao pedido.');
      return;
    }
    if (offline) {
      const url = localWhatsappUrl();
      goTo(window.open(url, '_blank'), url);
      setSent({ code: null, url });
      return;
    }

    const win = window.open('', '_blank');
    if (win) {
      win.opener = null;
      win.document.title = 'Zaraki Sushi';
      win.document.body.textContent = 'Abrindo o WhatsApp…';
    }
    setPending(true);
    setError(null);
    const result = await submitOrder(payload()).catch(() => ({ ok: false as const, fallback: true as const }));
    setPending(false);

    if (result.ok) {
      goTo(win, result.whatsappUrl);
      setSent({ code: result.code, url: result.whatsappUrl });
    } else if ('fallback' in result) {
      const url = localWhatsappUrl();
      goTo(win, url);
      setSent({ code: null, url });
    } else {
      win?.close();
      setError(result.error);
      setFieldErrors(result.fieldErrors ?? {});
    }
  };

  const reset = () => {
    setSent(null);
    setQty({});
    setFields(EMPTY_FIELDS);
    setFieldErrors({});
  };

  if (sent) {
    return (
      <div className="sent" role="status">
        <div className="sent__kanji" aria-hidden="true">感謝</div>
        <h3>Pedido enviado</h3>
        {sent.code && (
          <div className="sent__code">
            Pedido <strong>{sent.code}</strong>
          </div>
        )}
        <p>
          Abrimos o WhatsApp com o resumo da sua encomenda. Nossa equipe confirma disponibilidade e entrega em seguida.
        </p>
        <div className="sent__actions">
          <a className="sent__wa" href={sent.url} target="_blank" rel="noopener noreferrer">
            Abrir WhatsApp
          </a>
          <button type="button" onClick={reset}>Fazer outro pedido</button>
        </div>
      </div>
    );
  }

  const fieldError = (name: string) =>
    fieldErrors[name] ? (
      <span className="field__error" id={`err-${name}`}>
        {fieldErrors[name]}
      </span>
    ) : null;

  const inputProps = (name: keyof Fields) => ({
    name,
    value: fields[name],
    onChange: onField,
    'aria-invalid': fieldErrors[name] ? true : undefined,
    'aria-describedby': fieldErrors[name] ? `err-${name}` : undefined,
  });

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="form__group">
        <span className="form__group-label" id="order-type-label">Tipo de pedido</span>
        <div className="form__types" role="group" aria-labelledby="order-type-label">
          {ORDER_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className="form__type"
              aria-pressed={t === type}
              onClick={() => {
                setType(t);
                setFieldErrors({});
              }}
            >
              {ORDER_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="form__fields">
        <label className="field">
          Nome
          <input {...inputProps('name')} required autoComplete="name" />
          {fieldError('name')}
        </label>
        <label className="field">
          WhatsApp
          <input {...inputProps('phone')} type="tel" required placeholder="(62) 9 0000-0000" autoComplete="tel" />
          {fieldError('phone')}
        </label>
        {scheduled && (
          <>
            <label className="field">
              Data
              <input {...inputProps('date')} type="date" required min={minDate} />
              {fieldError('date')}
            </label>
            <label className="field">
              Horário
              <input {...inputProps('time')} type="time" required step={900} />
              {fieldError('time')}
            </label>
          </>
        )}
        <label className="field">
          {delivery ? 'Bairro' : 'Bairro (opcional)'}
          <input {...inputProps('neighborhood')} required={delivery} autoComplete="address-level3" />
          {fieldError('neighborhood')}
        </label>
        <label className="field">
          {delivery ? 'Endereço' : type === 'FESTA' ? 'Endereço da festa (opcional)' : 'Endereço (opcional)'}
          <input {...inputProps('address')} required={delivery} autoComplete="street-address" />
          {fieldError('address')}
        </label>
      </div>

      {type === 'FESTA' && (
        <label className="field">
          Número de convidados
          <input {...inputProps('guests')} type="number" min={1} required inputMode="numeric" />
          {fieldError('guests')}
        </label>
      )}

      <div className="form__group">
        <span className="form__group-label">Sabores (tubos de 10 peças)</span>
        <div className="lines">
          {products.map((x) => (
            <div key={x.id} className="line">
              <span className="line__name">
                {x.name} <span>· {formatCents(x.priceCents)}</span>
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
                <output aria-live="polite">{qty[x.id] ?? 0}</output>
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
              Total estimado <span>· {priced.tubes === 1 ? '1 tubo' : `${priced.tubes} tubos`}</span>
            </span>
            <span>{formatCents(priced.totalCents)}</span>
          </div>
        </div>
      </div>

      <label className="field">
        Observações
        <textarea {...inputProps('notes')} rows={3} />
      </label>

      {/* Campo isca para robôs: invisível para pessoas e leitores de tela. */}
      <input
        className="hp"
        name="website"
        value={fields.website}
        onChange={onField}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />

      {(error || fieldErrors.items) && (
        <div className="form__error" role="alert">
          {fieldErrors.items ?? error}
        </div>
      )}

      <button type="submit" className="form__submit" disabled={pending}>
        {pending ? 'Enviando…' : 'Enviar pelo WhatsApp'}
      </button>
    </form>
  );
}
