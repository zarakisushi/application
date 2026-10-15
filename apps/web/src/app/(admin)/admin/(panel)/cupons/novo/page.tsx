import type { Metadata } from 'next';
import { CouponForm } from '@/components/admin/CouponForm';
import { PageHeader } from '@/components/admin/PageHeader';
import { requireAdmin } from '@/server/admin';
import { saveCoupon } from '../actions';

export const metadata: Metadata = { title: 'Novo cupom' };

export default async function NewCouponPage() {
  await requireAdmin('coupons:write');
  return (
    <>
      <PageHeader title="Novo cupom" description="O resumo ao lado mostra, em português, como o cupom vai funcionar." />
      <CouponForm action={saveCoupon.bind(null, null)} />
    </>
  );
}
