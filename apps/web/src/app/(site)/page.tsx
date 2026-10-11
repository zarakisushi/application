import { Nav } from '@/components/site/Nav';
import { Hero } from '@/components/site/Hero';
import { About } from '@/components/site/About';
import { Quality } from '@/components/site/Quality';
import { Menu } from '@/components/site/Menu';
import { Order } from '@/components/site/Order';
import { Footer } from '@/components/site/Footer';
import { getSiteData } from '@/server/site';

// Renderizada a cada acesso (o cardápio fica em cache e é invalidado pelo admin),
// então o build não depende do banco estar acessível.
export const dynamic = 'force-dynamic';

export default async function Home() {
  const { menu, whatsapp, minDate, offline } = await getSiteData();
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <About />
        <Quality />
        <Menu items={menu} />
        <Order products={menu} whatsapp={whatsapp} minDate={minDate} offline={offline} />
      </main>
      <Footer whatsapp={whatsapp} />
    </>
  );
}
