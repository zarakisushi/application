import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Manual do sistema exibido no painel (/admin/manual). A fonte é a mesma do PDF: docs/manual/manual.html.
// O HTML é do próprio repositório (conteúdo confiável); aqui ele é dividido em capítulos e seções, com
// âncoras para o sumário e a busca, e as imagens passam a vir da rota protegida /api/manual/[arquivo].

export type ManualChapter = {
  id: string;
  /** "1", "7 e 8"… (do "Capítulo N" do manual). */
  number: string;
  title: string;
  /** Complemento do capítulo ("Para a Matriz"), se houver. */
  tag: string | null;
  html: string;
  sections: { id: string; title: string }[];
};

/** Trecho pesquisável: a abertura de cada capítulo e cada seção dele. */
export type ManualSearchEntry = { id: string; chapterTitle: string; title: string; text: string };

export type Manual = { version: string; chapters: ManualChapter[]; search: ManualSearchEntry[] };

export const MANUAL_PDF_NAME = 'Zaraki-Manual-do-Sistema.pdf';

function manualDir() {
  // Em produção (Vercel) e localmente o processo roda em apps/web; os arquivos entram no pacote da função
  // por outputFileTracingIncludes (next.config.ts).
  const candidates = [
    join(/* turbopackIgnore: true */ process.cwd(), '../../docs/manual'),
    join(/* turbopackIgnore: true */ process.cwd(), 'docs/manual'),
  ];
  return candidates.find((d) => existsSync(join(d, 'manual.html'))) ?? candidates[0]!;
}

/** Arquivo do manual servido pela rota protegida: o PDF ou uma imagem de docs/manual/img. */
export function manualFile(name: string): { path: string; contentType: string; fileName: string } | null {
  if (name === 'pdf') return { path: join(manualDir(), MANUAL_PDF_NAME), contentType: 'application/pdf', fileName: MANUAL_PDF_NAME };
  const m = /^[a-z0-9-]+\.(jpg|png)$/.exec(name);
  if (!m) return null;
  return { path: join(manualDir(), 'img', name), contentType: m[1] === 'png' ? 'image/png' : 'image/jpeg', fileName: name };
}

/** Largura e altura de um JPEG ou PNG (para reservar o espaço da imagem e a página não pular ao carregar). */
function imageSize(file: string): { width: number; height: number } | null {
  try {
    const b = readFileSync(file);
    if (b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  } catch {
    // imagem ausente: segue sem dimensões
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', '#39': "'" };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (_, e: string) => ENTITIES[e]!);
const textOf = (html: string) =>
  decode(html.replace(/<(br|\/p|\/li|\/tr|\/h\d|\/div|\/td|\/th)\b[^>]*>/gi, ' $& ').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();

function slug(s: string) {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function parseManual(source: string, dir = manualDir()): Manual {
  const version = /Versão de ([^<]+)</.exec(source)?.[1]?.trim() ?? '';
  const chapters: ManualChapter[] = [];
  const search: ManualSearchEntry[] = [];

  for (const [, inner] of source.matchAll(/<section class="chapter">([\s\S]*?)<\/section>/g)) {
    const kicker = textOf(/<div class="kicker">([\s\S]*?)<\/div>/.exec(inner!)?.[1] ?? '');
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(inner!);
    if (!h1) continue;
    const title = textOf(h1[1]!);
    const id = slug(title);
    const [, number = '', tag = null] = /^Cap[ií]tulos?\s+([\d\se]+?)\s*(?:·\s*(.+))?$/.exec(kicker) ?? [];
    let body = inner!.slice(h1.index + h1[0].length);

    // Títulos descem um nível (o h1 da página é "Manual do sistema"); seções ganham âncora.
    const sections: ManualChapter['sections'] = [];
    body = body
      .replace(/<(\/?)h3\b/g, '<$1h4')
      .replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/g, (_, attrs: string, inner: string) => {
        const t = textOf(inner);
        const sid = `${id}--${slug(t)}`;
        sections.push({ id: sid, title: t });
        return `<h3${attrs} id="${sid}" data-manual-anchor>${inner}</h3>`;
      })
      .replace(/<img\s+src="img\/([^"]+)"/g, (_, name: string) => {
        const size = imageSize(join(dir, 'img', name));
        const dims = size ? ` width="${size.width}" height="${size.height}"` : '';
        return `<img loading="lazy" decoding="async"${dims} src="/api/manual/${name}"`;
      })
      .replace(/<table>/g, '<div class="manual-table"><table>')
      .replace(/<\/table>/g, '</table></div>');

    // Busca: a abertura do capítulo (antes da primeira seção) e cada seção.
    const parts = body.split(/(?=<h3[^>]* id="[^"]+" data-manual-anchor>)/);
    parts.forEach((part, i) => {
      const sid = i === 0 ? id : /id="([^"]+)"/.exec(part)![1]!;
      const stitle = i === 0 ? title : sections[i - 1]!.title;
      // Sem as marcas ✓ das tabelas de permissão, que só poluiriam os trechos dos resultados.
      const text = textOf((i === 0 ? part : part.replace(/^<h3[\s\S]*?<\/h3>/, '')).replace(/<td class="c (?:yes|no)">[✓—]<\/td>/g, ''));
      if (text || i === 0) search.push({ id: sid, chapterTitle: title, title: stitle, text });
    });

    chapters.push({ id, number: number.trim(), title, tag, html: body.trim(), sections });
  }
  return { version, chapters, search };
}

let cache: Manual | null = null;

export function loadManual(): Manual {
  // Em desenvolvimento relê a cada acesso, para refletir edições no manual.html na hora.
  if (cache && process.env.NODE_ENV === 'production') return cache;
  cache = parseManual(readFileSync(join(manualDir(), 'manual.html'), 'utf8'));
  return cache;
}
