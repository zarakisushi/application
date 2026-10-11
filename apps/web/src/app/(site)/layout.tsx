import type { Metadata, Viewport } from 'next';
import { fontVariables } from '@/fonts';
import './globals.css';

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
    <html lang="pt-BR" className={fontVariables}>
      <body>{children}</body>
    </html>
  );
}
