import { useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { LuBold, LuItalic, LuLink, LuList, LuListOrdered } from 'react-icons/lu';

// Messages du fil fournisseur, en Markdown.
//
// Pas `MDEditor.Markdown` : il active le HTML brut (rehype-raw) et laisse passer
// toutes les adresses, `javascript:` compris. Un message vient d'un tiers — le
// fournisseur, par son portail — et s'affiche dans l'application : ici le HTML
// est ignoré et react-markdown ne garde que les liens http(s), mailto et tel.

/**
 * Une touche Entrée donne une nouvelle ligne, comme dans toute messagerie. En
 * Markdown strict il en faut deux ; on ajoute la coupure explicite, sauf dans
 * un bloc de code.
 */
function keepLineBreaks(md: string): string {
  let fenced = false;
  return md
    .split('\n')
    .map((line, i, all) => {
      if (/^\s*```/.test(line)) fenced = !fenced;
      const next = all[i + 1];
      if (fenced || next === undefined || !line.trim() || !next.trim()) return line;
      return `${line}  `;
    })
    .join('\n');
}

const COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a href={href} target='_blank' rel='noopener noreferrer' className='text-sky-700 underline break-all hover:text-sky-900'>
      {children}
    </a>
  ),
  // Une image distante peut servir de pisteur : on montre le lien, pas l'image.
  img: ({ src, alt }) => (
    <a href={typeof src === 'string' ? src : undefined} target='_blank' rel='noopener noreferrer' className='text-sky-700 underline break-all'>
      {alt || 'Image'}
    </a>
  ),
};

export function MessageBody({ source }: { source: string }) {
  return (
    <div className='prose prose-sm max-w-none text-ink break-words prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-headings:my-2 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none'>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS} skipHtml>
        {keepLineBreaks(source)}
      </ReactMarkdown>
    </div>
  );
}

type Wrap = { before: string; after?: string; placeholder: string; linePrefix?: boolean };

const TOOLS: { label: string; icon: React.ReactNode; wrap: Wrap; key?: string }[] = [
  { label: 'Gras (⌘B)', icon: <LuBold size={14} />, wrap: { before: '**', after: '**', placeholder: 'texte en gras' }, key: 'b' },
  { label: 'Italique (⌘I)', icon: <LuItalic size={14} />, wrap: { before: '*', after: '*', placeholder: 'texte en italique' }, key: 'i' },
  { label: 'Lien (⌘K)', icon: <LuLink size={14} />, wrap: { before: '[', after: '](https://)', placeholder: 'texte du lien' }, key: 'k' },
  { label: 'Liste à puces', icon: <LuList size={14} />, wrap: { before: '- ', placeholder: 'élément', linePrefix: true } },
  { label: 'Liste numérotée', icon: <LuListOrdered size={14} />, wrap: { before: '1. ', placeholder: 'élément', linePrefix: true } },
];

/** Zone de saisie avec une barre de mise en forme et un aperçu. Entrée = nouvelle ligne. */
export function MessageComposer({
  value,
  onChange,
  placeholder,
  rows = 3,
  autoFocus,
  onSubmitShortcut,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  /** ⌘/Ctrl + Entrée */
  onSubmitShortcut?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  const apply = ({ before, after = '', placeholder: ph, linePrefix }: Wrap) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const selected = value.slice(s, e) || ph;
    let insert: string;
    if (linePrefix) {
      const atLineStart = s === 0 || value[s - 1] === '\n';
      insert = (atLineStart ? '' : '\n') + selected.split('\n').map((l) => `${before}${l}`).join('\n');
    } else {
      insert = `${before}${selected}${after}`;
    }
    onChange(value.slice(0, s) + insert + value.slice(e));
    // Resélectionne le texte inséré pour qu'on puisse le taper par-dessus.
    const selStart = s + insert.length - after.length - selected.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selStart, selStart + selected.length);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key === 'Enter' && onSubmitShortcut) { e.preventDefault(); onSubmitShortcut(); return; }
    const tool = TOOLS.find((t) => t.key === e.key.toLowerCase());
    if (tool) { e.preventDefault(); apply(tool.wrap); }
  };

  return (
    <div className='rounded-lg border border-line bg-white focus-within:ring-2 focus-within:ring-ink/10 focus-within:border-ink/40'>
      <div className='flex items-center gap-0.5 border-b border-line px-1.5 py-1'>
        {TOOLS.map((t) => (
          <button
            key={t.label}
            type='button'
            title={t.label}
            disabled={preview}
            onClick={() => apply(t.wrap)}
            className='p-1.5 rounded text-muted hover:text-ink hover:bg-canvas-200 disabled:opacity-30'
          >
            {t.icon}
          </button>
        ))}
        <div className='ml-auto flex text-xs'>
          <button type='button' onClick={() => setPreview(false)} className={`px-2 py-1 rounded ${!preview ? 'bg-canvas-200 text-ink font-medium' : 'text-muted hover:text-ink'}`}>Écrire</button>
          <button type='button' onClick={() => setPreview(true)} className={`px-2 py-1 rounded ${preview ? 'bg-canvas-200 text-ink font-medium' : 'text-muted hover:text-ink'}`}>Aperçu</button>
        </div>
      </div>
      {preview ? (
        <div className='px-3 py-2 min-h-[5rem]'>
          {value.trim() ? <MessageBody source={value} /> : <p className='text-sm text-muted'>Rien à afficher.</p>}
        </div>
      ) : (
        <textarea
          ref={ref}
          className='w-full resize-y border-0 bg-transparent px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-0'
          rows={rows}
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
      )}
      <p className='px-3 pb-1.5 text-[11px] text-muted'>Markdown accepté · les adresses web deviennent des liens</p>
    </div>
  );
}
