import type { StaticImageData } from 'next/image';
import roll1 from './assets/roll1-photo.jpg';
import roll2 from './assets/roll2-photo.jpg';
import roll3 from './assets/roll3-photo.jpg';
import roll4 from './assets/roll4-photo.jpg';

export const WHATSAPP_NUMBER = '5562981092799';
export const WHATSAPP_LABEL = '(62) 98109-2799';
export const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}`;
export const SOCIAL_HANDLE = '@zarakisushigo';

export type Flavor = {
  id: string;
  name: string;
  description: string;
  price: number;
  image: StaticImageData;
  special?: boolean;
};

export const FLAVORS: Flavor[] = [
  {
    id: 's1',
    name: 'Uramaki de salmão e cream cheese',
    description:
      'Uma camada de gergelim torrado envolve a combinação perfeita de arroz temperado e alga crocante, abraçando o frescor incomparável do nosso salmão selecionado e a cremosidade aveludada do cream cheese.',
    price: 50,
    image: roll1,
  },
  {
    id: 's2',
    name: 'Uramaki de Salmão e Manga',
    description:
      'Uma camada de gergelim torrado envolve a combinação perfeita de arroz temperado e alga crocante, abraçando o frescor incomparável do nosso salmão selecionado e a doçura suculenta da manga bem fresca.',
    price: 50,
    image: roll2,
  },
  {
    id: 's3',
    name: 'Uramaki de Camarão e Cream cheese',
    description:
      'Uma camada de gergelim torrado envolve a combinação perfeita de arroz temperado e alga crocante, abraçando o frescor incomparável do nosso camarão selecionado e a cremosidade aveludada do cream cheese.',
    price: 50,
    image: roll3,
  },
  {
    id: 's4',
    name: 'Uramaki Especial Salmão e Camarão',
    description:
      'A junção especial do salmão fresco e do camarão selecionado, unidos para formar um sushi de excelência e qualidade, envolvidos pela combinação perfeita de arroz temperado, alga crocante e uma camada de gergelim torrado.',
    price: 60,
    image: roll4,
    special: true,
  },
];

export const brl = (n: number) => 'R$ ' + n.toFixed(2).replace('.', ',');
