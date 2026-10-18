'use client';

import { ArrowUp, BookOpen, ListTree, Search, X } from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ManualChapter, ManualSearchEntry } from '@/server/manual';

/** Minúsculas e sem acento, caractere a caractere (mantém as posições do texto original). */
function fold(s: string) {
  let out = '';
  for (const c of s) out += c.normalize('NFD')[0]!.toLowerCase()[0]!;
  return out;
}

function termsOf(query: string) {
  return [...new Set(fold(query).split(/\s+/).filter((t) => t.length >= 2))];
}

/** Partes do texto com os termos marcados. */
function markParts(text: string, terms: string[]) {
  const f = fold(text);
  const marked = new Array<boolean>(text.length).fill(false);
  for (const t of terms) {
    for (let i = f.indexOf(t); i !== -1; i = f.indexOf(t, i + t.length)) marked.fill(true, i, i + t.length);
  }
  const parts: { text: string; mark: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts.at(-1);
    if (last && last.mark === marked[i]) last.text += text[i];
    else parts.push({ text: text[i]!, mark: marked[i]! });
  }
  return parts;
}

function Marked({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {markParts(text, terms).map((p, i) =>
        p.mark ? (
          <mark key={i} className="rounded-sm bg-brand-gold/35 px-0.5 text-foreground">
            {p.text}
          </mark>
        ) : (
          p.text
        ),
      )}
    </>
  );
}

type Indexed = ManualSearchEntry & { fTitle: string; fChapter: string; fText: string };

function searchManual(index: Indexed[], terms: string[]) {
  if (!terms.length) return [];
  return index
    .map((e, order) => {
      const all = `${e.fTitle} ${e.fChapter} ${e.fText}`;
      if (!terms.every((t) => all.includes(t))) return null;
      let score = 0;
      for (const t of terms) {
        if (e.fTitle.includes(t)) score += 20;
        if (e.fChapter.includes(t)) score += 4;
        score += Math.min(6, e.fText.split(t).length - 1);
      }
      // Trecho em volta da primeira ocorrência no texto.
      const at = Math.min(...terms.map((t) => e.fText.indexOf(t)).filter((i) => i >= 0), Infinity);
      const start = at === Infinity ? 0 : Math.max(0, at - 60);
      const end = Math.min(e.text.length, start + 190);
      const snippet = `${start > 0 ? '…' : ''}${e.text.slice(start, end).trim()}${end < e.text.length ? '…' : ''}`;
      return { entry: e, score, order, snippet };
    })
    .filter((r) => r !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order);
}

/** Destaca no texto do manual os termos buscados (CSS Custom Highlight API, quando o navegador tem). */
function useContentHighlight(root: React.RefObject<HTMLElement | null>, terms: string[]) {
  useEffect(() => {
    const registry = typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : null;
    if (!registry || !root.current) return;
    if (!terms.length) {
      registry.delete('manual-busca');
      return;
    }
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(root.current, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const f = fold(node.textContent ?? '');
      for (const t of terms) {
        for (let i = f.indexOf(t); i !== -1; i = f.indexOf(t, i + t.length)) {
          const r = new Range();
          r.setStart(node, i);
          r.setEnd(node, i + t.length);
          ranges.push(r);
        }
      }
    }
    registry.set('manual-busca', new Highlight(...ranges));
    return () => void registry.delete('manual-busca');
  }, [root, terms]);
}

/** Âncora visível no topo da tela (para marcar onde a pessoa está no sumário). */
function useActiveAnchor(root: React.RefObject<HTMLElement | null>) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const anchors = root.current?.querySelectorAll<HTMLElement>('[data-manual-anchor]') ?? [];
      let current: string | null = null;
      for (const a of anchors) {
        if (a.getBoundingClientRect().top <= 140) current = a.id;
        else break;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [root]);
  return active;
}

export function ManualViewer({
  chapters,
  search,
  initialQuery = '',
}: {
  chapters: ManualChapter[];
  search: ManualSearchEntry[];
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [tocOpen, setTocOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const deferred = useDeferredValue(query);
  const terms = useMemo(() => termsOf(deferred), [deferred]);

  const index = useMemo<Indexed[]>(
    () => search.map((e) => ({ ...e, fTitle: fold(e.title), fChapter: fold(e.chapterTitle), fText: fold(e.text) })),
    [search],
  );
  const results = useMemo(() => searchManual(index, terms), [index, terms]);
  const active = useActiveAnchor(contentRef);
  const activeChapter = chapters.find((c) => c.id === active || c.sections.some((s) => s.id === active))?.id ?? null;
  useContentHighlight(contentRef, terms);

  // "/" foca a busca (fora de campos de texto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && !el.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    history.replaceState(null, '', `#${id}`);
    el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    el.classList.remove('manual-flash');
    void el.offsetWidth; // reinicia a animação
    el.classList.add('manual-flash');
    setTocOpen(false);
  }, []);

  const onLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go(id);
  };

  // Imagens do manual abrem ampliadas numa nova aba.
  const onContentClick = (e: React.MouseEvent) => {
    const img = (e.target as HTMLElement).closest('img');
    if (img) window.open(img.currentSrc || img.src, '_blank', 'noopener');
  };

  const searching = terms.length > 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10">
      <aside className="lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start" aria-label="Sumário e busca do manual">
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 lg:max-h-[calc(100dvh-6rem)]">
          <form
            role="search"
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              if (results[0]) go(results[0].entry.id);
            }}
          >
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar no manual"
              aria-label="Buscar no manual"
              className="pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
              autoComplete="off"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label="Limpar busca"
              >
                <X className="size-4" />
              </button>
            )}
          </form>

          {searching ? (
            <div className="flex min-h-0 flex-col gap-2">
              <p className="px-1 text-xs text-muted-foreground" aria-live="polite">
                {results.length === 0
                  ? `Nada encontrado para "${deferred.trim()}". Tente outra palavra.`
                  : `${results.length} ${results.length === 1 ? 'seção encontrada' : 'seções encontradas'}`}
              </p>
              <ol className="-mx-1 max-h-[60vh] overflow-y-auto overscroll-contain lg:max-h-none" aria-label="Resultados da busca">
                {results.map(({ entry, snippet }) => (
                  <li key={entry.id}>
                    <a
                      href={`#${entry.id}`}
                      onClick={(e) => onLinkClick(e, entry.id)}
                      className="block rounded-lg px-2 py-2 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    >
                      <span className="block text-[0.7rem] font-semibold tracking-wide text-brand-gold uppercase">{entry.chapterTitle}</span>
                      <span className="block text-sm font-medium">
                        <Marked text={entry.title} terms={terms} />
                      </span>
                      <span className="mt-0.5 line-clamp-3 block text-xs text-muted-foreground">
                        <Marked text={snippet} terms={terms} />
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm font-medium hover:bg-muted lg:hidden"
                onClick={() => setTocOpen((o) => !o)}
                aria-expanded={tocOpen}
                aria-controls="manual-sumario"
              >
                <span className="flex items-center gap-2">
                  <ListTree className="size-4 text-brand-gold" /> Sumário
                </span>
                <span className="text-xs text-muted-foreground">{tocOpen ? 'Fechar' : `${chapters.length} capítulos`}</span>
              </button>
              <nav
                id="manual-sumario"
                aria-label="Sumário do manual"
                className={cn('-mx-1 min-h-0 overflow-y-auto overscroll-contain lg:block', tocOpen ? 'block max-h-[60vh]' : 'hidden')}
              >
                <p className="mb-1 hidden px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase lg:block">Sumário</p>
                <ol className="flex flex-col">
                  {chapters.map((c) => {
                    const current = c.id === activeChapter;
                    return (
                      <li key={c.id}>
                        <a
                          href={`#${c.id}`}
                          onClick={(e) => onLinkClick(e, c.id)}
                          aria-current={current ? 'location' : undefined}
                          className={cn(
                            'flex gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
                            current && 'bg-brand-gold/15 font-medium',
                          )}
                        >
                          <span className="w-7 shrink-0 text-right text-xs leading-5 font-semibold text-brand-gold tabular-nums">{c.number}</span>
                          <span>{c.title}</span>
                        </a>
                        {current && c.sections.length > 0 && (
                          <ol className="mt-0.5 mb-1 ml-9 border-l pl-2">
                            {c.sections.map((s) => (
                              <li key={s.id}>
                                <a
                                  href={`#${s.id}`}
                                  onClick={(e) => onLinkClick(e, s.id)}
                                  aria-current={s.id === active ? 'location' : undefined}
                                  className={cn(
                                    'block rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground',
                                    s.id === active && 'font-medium text-foreground',
                                  )}
                                >
                                  {s.title}
                                </a>
                              </li>
                            ))}
                          </ol>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </nav>
            </>
          )}
        </div>
      </aside>

      <div ref={contentRef} className="manual-doc min-w-0" onClick={onContentClick}>
        {chapters.map((c) => (
          <section key={c.id} id={c.id} data-manual-anchor aria-labelledby={`${c.id}-titulo`} className="manual-chapter">
            <p className="manual-kicker">
              <BookOpen className="size-3.5" aria-hidden /> {c.number.includes('e') ? 'Capítulos' : 'Capítulo'} {c.number}
              {c.tag && ` · ${c.tag}`}
            </p>
            <h2 id={`${c.id}-titulo`}>{c.title}</h2>
            <div dangerouslySetInnerHTML={{ __html: c.html }} />
          </section>
        ))}
      </div>

      {/* Fora do admin.css: o processador de CSS do build ainda não reconhece ::highlight(). */}
      <style>{'::highlight(manual-busca){background-color:rgb(201 164 92 / .45);color:inherit}'}</style>
      <BackToTop />
    </div>
  );
}

function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 900);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  if (!show) return null;
  return (
    <button
      type="button"
      onClick={() => {
        history.replaceState(null, '', location.pathname + location.search);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }}
      className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-20 flex items-center gap-1.5 rounded-full bg-brand-ink px-4 py-2.5 text-sm font-medium text-[#f4efe6] shadow-lg hover:bg-brand-ink/90"
    >
      <ArrowUp className="size-4" /> Sumário
    </button>
  );
}
