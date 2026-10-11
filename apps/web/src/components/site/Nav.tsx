import Image from 'next/image';
import symbol from '../assets/symbol.png';

export function Nav() {
  return (
    <nav className="nav">
      <a href="#topo" className="nav__brand">
        <Image src={symbol} alt="Zaraki Sushi" width={47} height={44} priority />
        <span>ZARAKI</span>
      </a>
      <div className="nav__right">
        <div className="nav__links">
          <a href="#oque">O que é</a>
          <a href="#qualidade">Qualidade</a>
          <a href="#cardapio">Cardápio</a>
        </div>
        <a href="#encomendas" className="nav__cta">Encomendar</a>
      </div>
    </nav>
  );
}
