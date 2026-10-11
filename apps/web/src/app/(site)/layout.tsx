import type { Metadata, Viewport } from 'next';
import { Cinzel } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';

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
    { path: '../fonts/zen-kaku-400.woff2', weight: '400' },
    { path: '../fonts/zen-kaku-500.woff2', weight: '500' },
    { path: '../fonts/zen-kaku-700.woff2', weight: '700' },
  ],
  variable: '--font-zen-kaku',
  display: 'swap',
});

const shippori = localFont({
  src: [
    { path: '../fonts/shippori-500.woff2', weight: '500' },
    { path: '../fonts/shippori-700.woff2', weight: '700' },
    { path: '../fonts/shippori-800.woff2', weight: '800' },
  ],
  variable: '--font-shippori',
  display: 'swap',
});

const shipporiKanji = localFont({
  src: '../fonts/shippori-kanji-800.woff2',
  weight: '800',
  variable: '--font-shippori-kanji',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Push-Pop Sushi · Zaraki Sushi Goiânia',
  description:
    'Sushi no tubo. Abra, empurre e saboreie 10 peças frescas, sem hashi e sem bagunça. Delivery, festas e eventos em Goiânia.',
};

export const viewport: Viewport = {
  themeColor: '#0d0b09',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${cinzel.variable} ${shippori.variable} ${shipporiKanji.variable} ${zenKaku.variable}`}>
      <body>{children}</body>
    </html>
  );
}
