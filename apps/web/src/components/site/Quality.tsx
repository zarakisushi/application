import Image from 'next/image';
import banner from '../assets/banner.jpg';

const PILLARS = [
  { num: '壱', title: 'Produtos frescos', text: 'Peixes e frutos do mar selecionados, recebidos e preparados no mesmo dia.' },
  { num: '弐', title: 'Reposição diária', text: 'Nada fica de um dia para o outro. Os tubos são montados todos os dias.' },
  { num: '参', title: 'Apresentação impecável', text: 'Peças alinhadas, corte preciso e embalagem que chega intacta.' },
  {
    num: '肆',
    title: 'Sushi chef experiente',
    text: 'Vasta experiência na culinária japonesa e busca constante por inovação, sem abrir mão do clássico.',
  },
];

export function Quality() {
  return (
    <section id="qualidade" className="quality">
      <div className="quality__kanji" aria-hidden="true">鮮</div>
      <div className="container">
        <div className="quality__head">
          <div className="eyebrow">弐 · NOSSA QUALIDADE</div>
          <h2 className="section-title">A força de um capitão em cada peça</h2>
          <p className="lead">
            Inovação no formato, respeito à tradição no preparo. Cada tubo sai da nossa cozinha montado à mão e
            conferido peça por peça.
          </p>
        </div>

        <div className="quality__body">
          <figure className="quality__figure">
            <Image src={banner} alt="Zaraki Push Pop Sushi" sizes="(max-width: 960px) 100vw, 600px" />
          </figure>
          <ul className="quality__list">
            {PILLARS.map((p) => (
              <li key={p.num} className="quality__item">
                <span className="quality__num" aria-hidden="true">{p.num}</span>
                <div>
                  <h4>{p.title}</h4>
                  <p>{p.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
