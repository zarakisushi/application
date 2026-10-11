import Image from 'next/image';
import tumbler from '../assets/tumbler.jpg';

export function Hero() {
  return (
    <header id="topo" className="hero">
      <Image
        className="hero__bg"
        src={tumbler}
        alt="Push-Pop Sushi Zaraki no balcão de sushi"
        fill
        priority
        sizes="100vw"
        placeholder="blur"
      />
      <div className="hero__shade hero__shade--v" />
      <div className="hero__shade hero__shade--h" />

      <div className="hero__inner">
        <div className="hero__content">
          <div className="hero__kicker">
            <span />
            Novidade em Goiânia
          </div>
          <h1 className="hero__title">
            Push-Pop <span>Sushi</span>
          </h1>
          <p className="hero__text">
            Sushi no tubo. Abra, empurre e saboreie 10 peças frescas, sem hashi e sem bagunça. Onde você estiver.
          </p>
          <div className="hero__actions">
            <a href="#cardapio" className="btn btn--gold">Ver cardápio</a>
            <a href="#encomendas" className="btn btn--outline">Festas e eventos</a>
          </div>
        </div>
      </div>
    </header>
  );
}
