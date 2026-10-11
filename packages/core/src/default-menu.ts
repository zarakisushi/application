/**
 * Cardápio inicial da Zaraki. Fonte única para o seed do banco e para o modo de contingência
 * do site (quando o banco está fora do ar). Os preços válidos são sempre os do banco.
 */
export const DEFAULT_MENU = [
  {
    slug: 'uramaki-salmao-cream-cheese',
    name: 'Uramaki de salmão e cream cheese',
    description:
      'Uma camada de gergelim torrado envolve a combinação perfeita de arroz temperado e alga crocante, abraçando o frescor incomparável do nosso salmão selecionado e a cremosidade aveludada do cream cheese.',
    priceCents: 5000,
    imageUrl: '/menu/roll1-photo.jpg',
    isSpecial: false,
  },
  {
    slug: 'uramaki-salmao-manga',
    name: 'Uramaki de Salmão e Manga',
    description:
      'Uma camada de gergelim torrado envolve a combinação perfeita de arroz temperado e alga crocante, abraçando o frescor incomparável do nosso salmão selecionado e a doçura suculenta da manga bem fresca.',
    priceCents: 5000,
    imageUrl: '/menu/roll2-photo.jpg',
    isSpecial: false,
  },
  {
    slug: 'uramaki-camarao-cream-cheese',
    name: 'Uramaki de Camarão e Cream cheese',
    description:
      'Uma camada de gergelim torrado envolve a combinação perfeita de arroz temperado e alga crocante, abraçando o frescor incomparável do nosso camarão selecionado e a cremosidade aveludada do cream cheese.',
    priceCents: 5000,
    imageUrl: '/menu/roll3-photo.jpg',
    isSpecial: false,
  },
  {
    slug: 'uramaki-especial-salmao-camarao',
    name: 'Uramaki Especial Salmão e Camarão',
    description:
      'A junção especial do salmão fresco e do camarão selecionado, unidos para formar um sushi de excelência e qualidade, envolvidos pela combinação perfeita de arroz temperado, alga crocante e uma camada de gergelim torrado.',
    priceCents: 6000,
    imageUrl: '/menu/roll4-photo.jpg',
    isSpecial: true,
  },
] as const;
