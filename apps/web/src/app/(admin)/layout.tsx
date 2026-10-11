import type { Metadata, Viewport } from 'next';
import { TooltipProvider } from '@/components/ui/tooltip';
import { fontVariables } from '@/fonts';
import './admin.css';

export const metadata: Metadata = {
  title: { default: 'Zaraki Admin', template: '%s · Zaraki Admin' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#0d0b09',
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={fontVariables}>
      <body>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
