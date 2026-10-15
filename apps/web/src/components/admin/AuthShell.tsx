import Image from 'next/image';
import symbol from '@/assets/symbol.png';

/** Moldura das telas sem menu (login, troca de senha): fundo tinta com a marca. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-brand-ink px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Image src={symbol} alt="Zaraki Sushi" width={64} height={60} priority />
          <span className="font-display text-sm font-bold tracking-[0.3em] text-brand-gold-light">ZARAKI · ADMIN</span>
        </div>
        <div className="rounded-xl border border-brand-gold/30 bg-card p-6 shadow-2xl sm:p-8">
          <h1 className="font-display text-xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </main>
  );
}
