import { whatsappUrl } from '@zaraki/core';
import { OrderForm, type OrderFormProduct } from '@/components/OrderForm';

type Props = {
  products: OrderFormProduct[];
  whatsapp: { number: string; label: string };
  minDate: string;
  offline: boolean;
};

export function Order({ products, whatsapp, minDate, offline }: Props) {
  return (
    <section id="encomendas" className="order">
      <div className="container">
        <div className="order__info">
          <div className="eyebrow">肆 · ENCOMENDAS</div>
          <h2 className="section-title">Delivery, festas e eventos</h2>
          <p className="lead">
            Preencha o formulário e enviamos a confirmação pelo WhatsApp. Para festas e eventos, informe a data e a
            quantidade estimada de convidados.
          </p>
          <a href={whatsappUrl(whatsapp.number)} target="_blank" rel="noopener noreferrer" className="order__wa">
            <span aria-hidden="true">WA</span>
            {whatsapp.label}
          </a>
          <div className="order__city">Goiânia · Goiás</div>
        </div>
        <OrderForm products={products} whatsappNumber={whatsapp.number} minDate={minDate} offline={offline} />
      </div>
    </section>
  );
}
