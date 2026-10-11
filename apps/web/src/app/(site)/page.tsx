import { Nav } from '@/components/Nav';
import { Hero } from '@/components/Hero';
import { About } from '@/components/About';
import { Quality } from '@/components/Quality';
import { Menu } from '@/components/Menu';
import { Order } from '@/components/Order';
import { Footer } from '@/components/Footer';

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <About />
        <Quality />
        <Menu />
        <Order />
      </main>
      <Footer />
    </>
  );
}
