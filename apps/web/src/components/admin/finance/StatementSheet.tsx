'use client';

import { FileText, ImagePlus, X } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { compressImage } from '@/lib/image-compress';
import { Field, type ActionResult } from '../form';
import { FormSheet } from './FinanceSheets';

type Uploaded = { id: string; name: string; image: boolean };

/**
 * "Enviar extrato": fotos ou PDF do extrato (cada arquivo sobe sozinho, reduzido no navegador), a data e
 * o saldo que o extrato mostra.
 */
export function StatementSheet({
  accountName,
  today,
  action,
  upload,
  trigger,
}: {
  accountName: string;
  today: string;
  action: (form: FormData) => Promise<ActionResult>;
  upload: (form: FormData) => Promise<ActionResult>;
  trigger: React.ReactNode;
}) {
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [uploading, startUpload] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  const send = (list: FileList | null) => {
    if (!list?.length) return;
    const picked = [...list].slice(0, 10 - files.length);
    startUpload(async () => {
      for (const file of picked) {
        const form = new FormData();
        form.set('file', await compressImage(file));
        const r = await upload(form);
        if (r?.id) setFiles((f) => [...f, { id: r.id!, name: file.name, image: file.type.startsWith('image/') }]);
        else if (r?.error) toast.error(`${file.name}: ${r.error}`);
      }
      if (input.current) input.current.value = '';
    });
  };

  return (
    <FormSheet
      trigger={trigger}
      title={`Enviar extrato · ${accountName}`}
      description="Foto ou PDF do extrato do banco, com a data e o saldo que ele mostra. O sistema compara com o saldo calculado naquela data."
      action={async (form) => {
        const r = await action(form);
        if (r?.ok) setFiles([]);
        return r;
      }}
      submitLabel={uploading ? 'Aguarde o envio dos arquivos…' : 'Guardar extrato'}
    >
      {(errors) => (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Data do extrato" htmlFor="st-date" error={errors.statementDate}>
              <Input id="st-date" name="statementDate" type="date" defaultValue={today} max={today} required />
            </Field>
            <Field label="Saldo no extrato (R$)" htmlFor="st-balance" error={errors.balance} hint="Negativo com “-”.">
              <Input id="st-balance" name="balance" inputMode="decimal" placeholder="0,00" required />
            </Field>
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium">Fotos ou PDF do extrato</span>
            {files.map((f) => (
              <input key={f.id} type="hidden" name="attachmentIds" value={f.id} />
            ))}
            <ul className="grid grid-cols-3 gap-2" aria-label="Arquivos do extrato">
              {files.map((f) => (
                <li key={f.id} className="relative overflow-hidden rounded-md border bg-muted">
                  {f.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- arquivo privado servido pela rota protegida
                    <img src={`/api/financeiro/comprovante/${f.id}`} alt={f.name} className="aspect-[3/4] w-full object-cover" />
                  ) : (
                    <div className="flex aspect-[3/4] flex-col items-center justify-center gap-1 p-2 text-center text-xs">
                      <FileText className="size-6" /> {f.name}
                    </div>
                  )}
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    className="absolute top-1 right-1 size-6"
                    onClick={() => setFiles((all) => all.filter((x) => x.id !== f.id))}
                    aria-label={`Remover ${f.name}`}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
            {files.length < 10 && (
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground hover:border-brand-gold">
                <ImagePlus className="size-5" />
                {uploading ? 'Enviando…' : files.length ? 'Adicionar mais páginas' : 'Escolher fotos ou PDF'}
                <input
                  ref={input}
                  type="file"
                  multiple
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(e) => send(e.target.files)}
                  aria-label="Escolher arquivos do extrato"
                />
              </label>
            )}
            {errors.attachmentIds && <p className="text-sm text-destructive">{errors.attachmentIds}</p>}
            <p className="text-xs text-muted-foreground">Até 10 arquivos. Fotos grandes são reduzidas automaticamente.</p>
          </div>
          <Field label="Observação (opcional)" htmlFor="st-notes" error={errors.notes}>
            <Textarea id="st-notes" name="notes" rows={2} />
          </Field>
        </>
      )}
    </FormSheet>
  );
}
