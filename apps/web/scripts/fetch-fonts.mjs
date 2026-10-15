// Baixa os subsets das fontes japonesas para src/fonts/ (usados via next/font/local).
// As fontes completas têm centenas de blocos CJK; aqui baixamos só o subset latino
// e, para a Shippori Mincho, apenas os kanji usados no site.
//
// Ao adicionar um kanji novo no site, inclua-o em KANJI e rode: npm run fonts
import { mkdir, writeFile } from 'node:fs/promises';

const KANJI = '壱弐参肆鮮感謝';
const OUT = new URL('../src/fonts/', import.meta.url);
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const jobs = [
  { family: 'Zen Kaku Gothic New', weights: [400, 500, 700], file: 'zen-kaku', subset: 'latin' },
  { family: 'Shippori Mincho', weights: [500, 700, 800], file: 'shippori', subset: 'latin' },
  { family: 'Shippori Mincho', weights: [800], file: 'shippori-kanji', text: KANJI },
];

async function css(family, weight, text) {
  const url = new URL('https://fonts.googleapis.com/css2');
  url.searchParams.set('family', `${family}:wght@${weight}`);
  if (text) url.searchParams.set('text', text);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function pickSrc(cssText, subset) {
  const blocks = cssText.split('@font-face');
  const block = subset ? blocks.find((b, i) => i > 0 && blocks[i - 1].trimEnd().endsWith(`/* ${subset} */`)) : blocks[1];
  const src = block?.match(/url\((https:[^)]+)\)/)?.[1];
  if (!src) throw new Error(`subset "${subset ?? 'text'}" não encontrado`);
  return src;
}

await mkdir(OUT, { recursive: true });
for (const { family, weights, file, subset, text } of jobs) {
  for (const w of weights) {
    const src = pickSrc(await css(family, w, text), subset);
    const buf = Buffer.from(await (await fetch(src)).arrayBuffer());
    const name = `${file}-${w}.woff2`;
    await writeFile(new URL(name, OUT), buf);
    console.log(`${name}  ${(buf.length / 1024).toFixed(1)} KB`);
  }
}
