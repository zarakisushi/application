import { Lock } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import symbol from '../../assets/symbol.png';
import { whatsappUrl } from '@zaraki/core';

const SOCIAL_HANDLE = '@zarakisushigo';

export function Footer({ whatsapp }: { whatsapp: { number: string; label: string } }) {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__brand">
          <Image src={symbol} alt="Zaraki Sushi" width={60} height={56} />
          <div>
            <span className="footer__name">ZARAKI SUSHI</span>
            <span className="footer__sub">Push-Pop Sushi · Goiânia, GO</span>
          </div>
        </div>
        <div className="footer__links">
          <a href="https://instagram.com/zarakisushigo" target="_blank" rel="noopener noreferrer" aria-label={`Instagram ${SOCIAL_HANDLE}`}>
            <span className="social-icon social-icon--ig" aria-hidden="true">
              <span />
              <span />
            </span>
            {SOCIAL_HANDLE}
          </a>
          <a href="https://www.tiktok.com/@zarakisushigo" target="_blank" rel="noopener noreferrer" aria-label={`TikTok ${SOCIAL_HANDLE}`}>
            <span className="social-icon social-icon--tt" aria-hidden="true">♪</span>
            {SOCIAL_HANDLE}
          </a>
          <a href={whatsappUrl(whatsapp.number)} target="_blank" rel="noopener noreferrer">
            {whatsapp.label}
          </a>
          <Link href="/admin" rel="nofollow" className="footer__admin">
            <Lock size={14} aria-hidden="true" />
            Área administrativa
          </Link>
        </div>
      </div>
    </footer>
  );
}
