import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  useQuery,
  useAction,
  getCompanyBrandAssets,
  getCurrentCompany,
  generateTemplateContent,
} from 'wasp/client/operations';
import MDEditor from '@uiw/react-md-editor';
import toast from 'react-hot-toast';
import { LuX, LuEye, LuWand, LuSave, LuChevronLeft, LuChevronRight, LuCopy } from 'react-icons/lu';
import { TEMPLATE_VARIABLE_GROUPS, getTemplatePdfBase64, TEMPLATE_TYPES } from '../settings/templatePdf';
import type { BrandAssets } from '../documents/pdf';
import type { EditorFileInfo } from '../projects/FileEditorModal';

interface Props {
  file: EditorFileInfo;
  onClose: () => void;
  fetchContent: (id: string) => Promise<{ type: 'text'; content: string }>;
  saveContent: (id: string, content: string, contentType: 'text') => Promise<any>;
  onNavigate?: (dir: 'prev' | 'next') => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

// Strip `.md` extension for display
function displayName(name: string) {
  return name.endsWith('.md') ? name.slice(0, -3) : name;
}

export function ClientDocEditorModal({ file, onClose, fetchContent, saveContent, onNavigate, hasPrev, hasNext }: Props) {
  const { data: brand } = useQuery(getCompanyBrandAssets);
  const { data: company } = useQuery(getCurrentCompany);
  const generateContent = useAction(generateTemplateContent);

  const type = file.sourceTemplateType ?? 'autre';
  const typeLabel = TEMPLATE_TYPES.find((t) => t.value === type)?.label ?? type;

  const [content, setContent] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  const mdEditorRef = useRef<{ textarea?: HTMLTextAreaElement }>(null);

  // Load content from S3 on mount / when file changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setContent('');
    setDirty(false);
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
    fetchContent(file.id).then((res) => {
      if (!cancelled) {
        setContent(res.type === 'text' ? res.content : '');
        setLoading(false);
      }
    }).catch((e: any) => {
      if (!cancelled) { setLoadError(e?.message || 'Erreur de chargement'); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [file.id]);

  // Cleanup preview blob on unmount
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  // Auto-close PDF preview when content changes
  useEffect(() => {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
  }, [content]);

  const insertVariable = useCallback((key: string) => {
    const el = mdEditorRef.current?.textarea;
    if (!el) { setContent((c) => c + key); return; }
    el.focus();
    const scrollTop = el.scrollTop;
    const inserted = document.execCommand('insertText', false, key);
    if (!inserted) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      setContent(content.slice(0, start) + key + content.slice(end));
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + key.length, start + key.length);
        el.scrollTop = scrollTop;
      }, 0);
    } else {
      setContent(el.value);
      requestAnimationFrame(() => { el.scrollTop = scrollTop; });
    }
    setDirty(true);
  }, [content]);

  const handlePreview = async () => {
    if (previewing) return;
    setPreviewing(true);
    try {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const b64 = await getTemplatePdfBase64(
        { name: displayName(file.name), type, description: null, content },
        (brand as BrandAssets) ?? null,
        (company as any)?.name ?? 'Mon Entreprise',
      );
      const bytes = atob(b64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      setPreviewUrl(URL.createObjectURL(new Blob([arr], { type: 'application/pdf' })));
    } catch (e: any) {
      toast.error(e?.message || 'Erreur lors de la génération du PDF');
    } finally {
      setPreviewing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveContent(file.id, content, 'text');
      setDirty(false);
      toast.success('Document sauvegardé');
    } catch (e: any) {
      toast.error(e?.message || 'Erreur de sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    try {
      const hasContent = content.trim().length > 0;
      const res = await generateContent({ description: aiPrompt.trim(), type, currentContent: hasContent ? content : undefined }) as { markdown: string };
      setContent(res.markdown);
      setDirty(true);
      setAiOpen(false);
      setAiPrompt('');
      toast.success(hasContent ? 'Document mis à jour !' : 'Contenu généré !');
    } catch (e: any) {
      toast.error(e?.message || 'Erreur de génération IA');
    } finally {
      setAiLoading(false);
    }
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (!saving && dirty) handleSave();
    }
    if (e.key === 'Escape' && !aiOpen) onClose();
  }, [saving, dirty, aiOpen]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return createPortal(
    <div className='fixed inset-0 bg-ink/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4'>
      <div
        className='bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-6xl max-h-[92vh] overflow-hidden'
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className='shrink-0 px-5 py-3 border-b border-line flex items-center gap-3'>
          {/* Prev/next */}
          {onNavigate && (
            <div className='flex items-center gap-1 shrink-0'>
              <button onClick={() => onNavigate('prev')} disabled={!hasPrev} className='p-1 rounded hover:bg-canvas-200 disabled:opacity-30'><LuChevronLeft size={16} /></button>
              <button onClick={() => onNavigate('next')} disabled={!hasNext} className='p-1 rounded hover:bg-canvas-200 disabled:opacity-30'><LuChevronRight size={16} /></button>
            </div>
          )}
          <span className='flex-1 font-semibold text-lg text-ink truncate'>{displayName(file.name)}</span>
          {/* Type badge */}
          <span className='shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary'>
            {typeLabel}
          </span>
          {dirty && (
            <span className='shrink-0 text-[10px] text-muted border border-line rounded px-1.5 py-0.5'>Non sauvegardé</span>
          )}
          <button onClick={onClose} className='text-muted hover:text-ink p-1 shrink-0' aria-label='Fermer'>
            <LuX size={18} />
          </button>
        </div>

        {/* Body */}
        {loading ? (
          <div className='flex-1 flex items-center justify-center text-sm text-muted'>Chargement…</div>
        ) : loadError ? (
          <div className='flex-1 flex items-center justify-center text-sm text-red-500'>{loadError}</div>
        ) : (
          <div className='flex flex-1 min-h-0 overflow-hidden'>
            {/* Editor panel */}
            <div className='flex flex-col flex-1 min-w-0 border-r border-line'>
              <div className='flex-1 min-h-0 overflow-auto relative' data-color-mode='light'>
                <MDEditor
                  ref={mdEditorRef as any}
                  value={content}
                  onChange={(v) => { setContent(v ?? ''); setDirty(true); }}
                  preview='edit'
                  hideToolbar={false}
                  height='100%'
                  visibleDragbar={false}
                  style={{ height: '100%', borderRadius: 0, border: 'none', boxShadow: 'none' }}
                  textareaProps={{ placeholder: 'Rédigez votre document en Markdown…', spellCheck: false }}
                />
                {/* AI button */}
                <button
                  onClick={() => setAiOpen((v) => !v)}
                  title="Générer / modifier avec l'IA"
                  className='absolute bottom-3 right-3 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500 text-white text-xs font-semibold shadow-lg hover:bg-amber-600 transition-colors'
                >
                  <LuWand size={13} /> IA
                </button>
                {/* AI popover */}
                {aiOpen && (() => {
                  const hasContent = content.trim().length > 0;
                  return (
                    <div className='absolute bottom-12 right-3 z-20 w-80 bg-white rounded-xl shadow-2xl border border-line p-4 flex flex-col gap-3'>
                      <div className='flex items-center justify-between'>
                        <div className='flex items-center gap-1.5'>
                          <LuWand size={14} className='text-amber-500' />
                          <p className='text-sm font-semibold'>{hasContent ? "Modifier avec l'IA" : "Générer avec l'IA"}</p>
                        </div>
                        <button onClick={() => setAiOpen(false)} className='text-muted hover:text-ink'><LuX size={14} /></button>
                      </div>
                      <p className='text-xs text-muted'>
                        {hasContent
                          ? "Décrivez la modification souhaitée. L'IA conservera le reste du document intact."
                          : "Décrivez le document souhaité. L'IA utilisera les variables dynamiques."}
                      </p>
                      <textarea
                        className='border border-line rounded-lg p-2.5 text-sm resize-none h-24 outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400'
                        placeholder={hasContent
                          ? 'Ex : Ajoute une section sur la propriété intellectuelle…'
                          : 'Ex : Contrat de maintenance mensuelle pour site WordPress, 6 mois…'}
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
                        autoFocus
                      />
                      <p className='text-xs text-muted/70'>Type actif : <span className='font-medium text-ink'>{typeLabel}</span></p>
                      <div className='flex justify-end gap-2'>
                        <button className='btn-ghost text-xs' onClick={() => setAiOpen(false)}>Annuler</button>
                        <button
                          className='flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
                          onClick={handleGenerate}
                          disabled={aiLoading || !aiPrompt.trim()}
                        >
                          {aiLoading ? (
                            <><span className='animate-spin inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full' /> {hasContent ? 'Modification…' : 'Génération…'}</>
                          ) : (
                            <><LuWand size={12} /> {hasContent ? 'Modifier' : 'Générer'}</>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Variables sidebar */}
            <div className='w-56 shrink-0 flex flex-col overflow-y-auto border-r border-line bg-canvas-50'>
              <div className='px-3 py-2.5 border-b border-line'>
                <p className='text-xs font-semibold text-muted uppercase tracking-wide'>Variables</p>
                <p className='text-xs text-muted mt-0.5'>Cliquez pour insérer</p>
              </div>
              <div className='flex items-center gap-3 px-3 py-2 border-b border-line'>
                <span className='flex items-center gap-1 text-[10px] text-muted'>
                  <span className='inline-block w-1.5 h-1.5 rounded-full bg-emerald-400' />
                  Pré-rempli
                </span>
                <span className='flex items-center gap-1 text-[10px] text-muted'>
                  <span className='inline-block w-1.5 h-1.5 rounded-full bg-amber-400' />
                  Saisie requise
                </span>
              </div>
              <div className='flex-1 overflow-y-auto py-1'>
                {TEMPLATE_VARIABLE_GROUPS.map((group) => (
                  <div key={group.group} className='mb-1'>
                    <p className='px-3 py-1.5 text-xs font-medium text-muted uppercase tracking-wide'>{group.group}</p>
                    {group.vars.map((v) => (
                      <button
                        key={v.key}
                        onClick={() => insertVariable(v.key)}
                        title={`Exemple : ${v.sample}\n${v.autofill ? 'Pré-rempli automatiquement' : 'À saisir lors de la création du document'}`}
                        className='w-full flex items-center gap-2 px-3 py-1 text-left hover:bg-canvas-100 group'
                      >
                        <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${v.autofill ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                        <span className='text-xs text-ink truncate flex-1'>{v.label}</span>
                        <LuCopy size={10} className='text-muted opacity-0 group-hover:opacity-100 shrink-0 ml-1' />
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* PDF preview panel */}
            {previewUrl && (
              <div className='w-[45%] shrink-0 flex flex-col border-l border-line bg-canvas-50'>
                <div className='px-3 py-2.5 border-b border-line flex items-center justify-between'>
                  <p className='text-xs font-semibold text-muted'>Aperçu PDF</p>
                  <button onClick={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }} className='text-muted hover:text-ink'>
                    <LuX size={14} />
                  </button>
                </div>
                <iframe src={previewUrl} className='flex-1 w-full' title='Aperçu PDF' />
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className='shrink-0 px-5 py-3 border-t border-line flex justify-between items-center bg-canvas-50'>
          <p className='text-xs text-muted'>
            Markdown · <kbd className='bg-canvas-200 px-1 rounded text-[10px]'>⌘S</kbd> pour sauvegarder
          </p>
          <div className='flex gap-2'>
            <button className='btn-ghost' onClick={onClose}>Fermer</button>
            <button
              className='btn-secondary flex items-center gap-1.5'
              onClick={handlePreview}
              disabled={previewing || loading}
            >
              <LuEye size={14} />
              {previewing ? 'Génération…' : 'Aperçu PDF'}
            </button>
            <button
              className='btn-primary flex items-center gap-1.5'
              onClick={handleSave}
              disabled={saving || loading || !dirty}
            >
              <LuSave size={14} />
              {saving ? 'Sauvegarde…' : 'Sauvegarder'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
