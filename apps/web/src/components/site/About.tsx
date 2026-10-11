import Image from 'next/image';
import tubes from '../assets/oque-tubos.webp';
import steps from '../assets/passos-v9.png';

export function About() {
  return (
    <section id="oque" className="about">
      <div className="container">
        <div className="about__intro">
          <div className="about__copy">
            <div className="eyebrow eyebrow--red">壱 · O QUE É</div>
            <h2 className="section-title">O sushi que cabe na palma da mão</h2>
            <p className="lead">
              O push-pop nasceu nos Estados Unidos como um doce em tubo com êmbolo: você empurra a base e o doce sobe.
              Confeiteiros adotaram o formato para bolos em camadas, e chefs de sushi viram ali uma nova forma de servir o
              uramaki. A ideia viralizou nas redes sociais pelo mundo.
            </p>
            <p className="lead">
              A Zaraki traz o formato para Goiânia: 10 peças empilhadas em um tubo, com molho no compartimento lateral.
              Prático para festas, eventos, o carro ou o sofá.
            </p>
          </div>
          <div className="about__media">
            <Image src={tubes} alt="Tubos Push-Pop Sushi" sizes="(max-width: 860px) 100vw, 600px" />
            <div className="about__badge">10 PEÇAS POR TUBO</div>
          </div>
        </div>

        <div className="about__steps">
          <h3>Abra · Empurre · Saboreie</h3>
          <Image
            src={steps}
            alt="Push-Pop Sushi · Como comer: 1 Retire a tampa, 2 Adicione molho, 3 Empurre, 4 Saboreie"
            sizes="(max-width: 1240px) 100vw, 1200px"
          />
        </div>
      </div>
    </section>
  );
}
