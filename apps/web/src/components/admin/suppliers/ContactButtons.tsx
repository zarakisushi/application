import { formatSupplierPhone, supplierWhatsappUrl, telHref } from '@zaraki/core';
import { MessageCircle, Phone } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Abre a conversa no WhatsApp (nova aba) com a saudação da unidade. */
export function WhatsappButton({ number, unitName, label, className }: { number: string; unitName: string; label?: string; className?: string }) {
  return (
    <a
      href={supplierWhatsappUrl(number, unitName)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Conversar no WhatsApp: ${formatSupplierPhone(number)}`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-[#1f9d55] px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white shadow-xs transition-colors hover:bg-[#178048] focus-visible:ring-2 focus-visible:ring-[#1f9d55]/50 focus-visible:outline-none',
        className,
      )}
    >
      <MessageCircle className="size-4" aria-hidden />
      {label ?? formatSupplierPhone(number)}
    </a>
  );
}

/** Liga para o número (no celular, abre o discador). */
export function CallButton({ number, label, className }: { number: string; label?: string; className?: string }) {
  return (
    <a
      href={telHref(number)}
      aria-label={`Ligar: ${formatSupplierPhone(number)}`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        className,
      )}
    >
      <Phone className="size-4 text-brand-gold" aria-hidden />
      {label ?? formatSupplierPhone(number)}
    </a>
  );
}
