// Gera o PDF do manual a partir de manual.html, com o Chromium do Playwright (já usado nos testes).
//   node docs/manual/gerar-pdf.mjs
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const html = fileURLToPath(new URL('./manual.html', import.meta.url));
const out = fileURLToPath(new URL('./Zaraki-Manual-do-Sistema.pdf', import.meta.url));

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(html).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.pdf({
  path: out,
  format: 'A4',
  printBackground: true,
  // Tamanho, margens e rodapé com a numeração vêm do CSS (@page), que omite o rodapé na capa.
  preferCSSPageSize: true,
});
await browser.close();
console.log(`PDF gerado: ${out}`);
