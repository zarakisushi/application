import { Cinzel } from 'next/font/google';
import localFont from 'next/font/local';

const cinzel = Cinzel({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-cinzel',
  display: 'swap',
});

// As fontes japonesas vêm de subsets locais (ver scripts/fetch-fonts.mjs):
// o pacote completo do Google tem centenas de blocos CJK por fonte.
const zenKaku = localFont({
  src: [
    { path: './zen-kaku-400.woff2', weight: '400' },
    { path: './zen-kaku-500.woff2', weight: '500' },
    { path: './zen-kaku-700.woff2', weight: '700' },
  ],
  variable: '--font-zen-kaku',
  display: 'swap',
});

const shippori = localFont({
  src: [
    { path: './shippori-500.woff2', weight: '500' },
    { path: './shippori-700.woff2', weight: '700' },
    { path: './shippori-800.woff2', weight: '800' },
  ],
  variable: '--font-shippori',
  display: 'swap',
});

const shipporiKanji = localFont({
  src: './shippori-kanji-800.woff2',
  weight: '800',
  variable: '--font-shippori-kanji',
  display: 'swap',
});

/** Classes que expõem as fontes como variáveis CSS (--font-cinzel, --font-zen-kaku...). */
export const fontVariables = [cinzel.variable, shippori.variable, shipporiKanji.variable, zenKaku.variable].join(' ');
