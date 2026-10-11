import 'server-only';
import { DEFAULT_MENU, formatBrPhone, todayInZone, DEFAULT_TIMEZONE } from '@zaraki/core';
import { findTenantBySlug, getDb, listActiveMenu, withContext } from '@zaraki/db';
import { unstable_cache } from 'next/cache';

export type MenuItem = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  imageUrl: string | null;
  isSpecial: boolean;
};

export type SiteTenant = {
  id: string;
  timezone: string;
  orderCodePrefix: string;
  whatsappNumber: string | null;
};

/** Tag de cache do cardápio de uma unidade; o admin a invalida ao alterar produtos. */
export const menuTag = (tenantId: string) => `menu:${tenantId}`;

export const getSiteTenant = unstable_cache(
  async (): Promise<SiteTenant> => {
    const slug = process.env.DEFAULT_TENANT_SLUG ?? 'matriz';
    const tenant = await findTenantBySlug(getDb(), slug);
    if (!tenant) throw new Error(`Unidade "${slug}" não encontrada (rode pnpm db:seed)`);
    const { id, timezone, orderCodePrefix, whatsappNumber } = tenant;
    return { id, timezone, orderCodePrefix, whatsappNumber };
  },
  ['site-tenant'],
  { revalidate: 300, tags: ['tenants'] },
);

const getMenu = (tenantId: string) =>
  unstable_cache(
    (): Promise<MenuItem[]> => withContext({ tenantId }, (tx) => listActiveMenu(tx)),
    ['site-menu', tenantId],
    { revalidate: 300, tags: [menuTag(tenantId)] },
  )();

/** Número que recebe os pedidos: o da unidade, se cadastrado; senão, a env WHATSAPP_NUMBER. */
export function siteWhatsapp(tenant?: Pick<SiteTenant, 'whatsappNumber'> | null) {
  const number = tenant?.whatsappNumber || process.env.WHATSAPP_NUMBER;
  if (!number) throw new Error('WHATSAPP_NUMBER não definida');
  return { number, label: formatBrPhone(number) };
}

/**
 * Dados da landing. Se o banco estiver indisponível, a página continua no ar com o cardápio
 * padrão e o formulário entra em modo contingência (pedido direto pelo WhatsApp).
 */
export async function getSiteData() {
  try {
    const tenant = await getSiteTenant();
    const menu = await getMenu(tenant.id);
    return {
      offline: false,
      menu,
      whatsapp: siteWhatsapp(tenant),
      minDate: todayInZone(tenant.timezone),
    };
  } catch (error) {
    console.error('[site] banco indisponível; landing em modo contingência', error);
    return {
      offline: true,
      menu: DEFAULT_MENU.map((m, i): MenuItem => ({ ...m, id: `offline-${i + 1}` })),
      whatsapp: siteWhatsapp(),
      minDate: todayInZone(DEFAULT_TIMEZONE),
    };
  }
}
