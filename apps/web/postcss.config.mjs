// Tailwind só processa arquivos que importam "tailwindcss" (o CSS do admin); a landing não é afetada.
export default {
  plugins: { '@tailwindcss/postcss': {} },
};
