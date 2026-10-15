import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { fontVariables } from '@/fonts';
import './globals.css';

/**
 * Google Analytics (GA4) do site. Só no site público (o painel /admin não é rastreado) e só no site publicado em
 * produção na Vercel: desenvolvimento, testes automáticos e prévias não geram visitas falsas nos números.
 */
const GA_ID = 'G-J9M66XFMY8';
const analytics = process.env.VERCEL_ENV === 'production';

export const metadata: Metadata = {
  title: 'Push Pop Sushi · Zaraki Sushi Goiânia',
  description:
    'Sushi no tubo. Abra, empurre e saboreie 10 peças frescas, sem hashi e sem bagunça. Delivery, festas e eventos em Goiânia.',
};

export const viewport: Viewport = {
  themeColor: '#0d0b09',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={fontVariables}>
      <body>
        {children}
        {analytics && (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
            <Script id="google-analytics" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');`}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
