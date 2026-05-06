import { useState, useRef, useEffect, useCallback } from 'react';
import { LuX, LuDownload, LuSave, LuLoader, LuChevronLeft, LuChevronRight } from 'react-icons/lu';
import toast from 'react-hot-toast';
import {
  SpreadsheetComponent,
  Inject as SSInject,
  Resize,
  Sort,
  Filter,
  Merge,
  WorkbookOpen,
} from '@syncfusion/ej2-react-spreadsheet';
import { renderAsync } from 'docx-preview';

// ─── Types ────────────────────────────────────────────────────────────────────

type EditorContent =
  | { type: 'text'; content: string }
  | { type: 'docx'; base64: string }
  | { type: 'spreadsheet'; workbook: any; sheets: { name: string; data: any[][] }[] };

type ContentType = 'text' | 'spreadsheet';

export interface EditorFileInfo {
  id: string;
  name: string;
  mimeType: string | null;
  url: string | null;
  /** Set when the file was created from a DocumentTemplate */
  sourceTemplateType?: string | null;
}

interface Props {
  file: EditorFileInfo | null;
  onClose: () => void;
  fetchContent: (id: string) => Promise<EditorContent>;
  /** If provided, text files show a Save button */
  saveContent?: (id: string, content: string, contentType: ContentType) => Promise<any>;
  /** Navigate to previous / next file */
  onNavigate?: (direction: 'prev' | 'next') => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function downloadFile(url: string, name: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = name;
    a.click();
    URL.revokeObjectURL(blobUrl);
  } catch {
    // Fallback: open in new tab
    window.open(url, '_blank');
  }
}

// ─── Text Editor ──────────────────────────────────────────────────────────────

function TextEditor({
  content,
  readOnly,
  onChange,
}: {
  content: string;
  readOnly: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <textarea
      className='w-full h-full p-4 font-mono text-sm resize-none outline-none bg-white border-0'
      value={content}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
    />
  );
}

// ─── DOCX Viewer ──────────────────────────────────────────────────────────────

function DocxViewer({ base64 }: { base64: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    setRendering(true);
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    containerRef.current.innerHTML = '';
    renderAsync(blob, containerRef.current, undefined, {
      className: 'docx-preview',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreFonts: false,
      breakPages: true,
      useBase64URL: true,
    })
      .catch((err) => {
        if (cancelled) return;
        if (containerRef.current) {
          containerRef.current.innerHTML =
            '<p style="color:#b91c1c;padding:1rem">Impossible d\'afficher ce document.</p>';
        }
        console.error('[DocxViewer]', err);
      })
      .finally(() => { if (!cancelled) setRendering(false); });
    return () => { cancelled = true; };
  }, [base64]);

  return (
    <div className='relative w-full h-full overflow-auto bg-gray-100 flex justify-center py-6'>
      {rendering && (
        <div className='absolute inset-0 flex items-center justify-center bg-gray-100 z-10'>
          <div className='flex flex-col items-center gap-3'>
            <div className='w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden'>
              <div className='h-full bg-primary rounded-full animate-[shimmer_1.2s_ease-in-out_infinite]' style={{ width: '60%', animation: 'indeterminate 1.4s ease-in-out infinite' }} />
            </div>
            <span className='text-xs text-muted'>Rendu du document…</span>
          </div>
        </div>
      )}
      <div ref={containerRef} className='w-full max-w-4xl' />
    </div>
  );
}

// ─── Spreadsheet Viewer ───────────────────────────────────────────────────────

function SpreadsheetViewer({
  workbook,
  ssRef,
}: {
  workbook: any;
  sheets: { name: string; data: any[][] }[];
  ssRef: React.RefObject<SpreadsheetComponent | null>;
}) {
  const workbookRef = useRef(workbook);
  workbookRef.current = workbook;
  const [rendering, setRendering] = useState(true);

  const handleCreated = useCallback(function (this: SpreadsheetComponent) {
    const ss = ssRef.current;
    if (!ss || (ss as any) !== this) return;
    ss.openFromJson({ file: { Workbook: workbookRef.current } as any });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset loading overlay whenever workbook changes (new file opened)
  useEffect(() => { setRendering(true); }, [workbook]);

  return (
    <div className='flex flex-col h-full'>
      <div className='flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs shrink-0'>
        <span>⚠️</span>
        <span>L'aperçu Excel peut ne pas refléter le style exact du fichier.</span>
        <span className='text-amber-600'>Téléchargez-le pour voir la mise en forme complète.</span>
      </div>
      <div className='flex-1 overflow-hidden relative'>
        {rendering && (
          <div className='absolute inset-0 flex items-center justify-center bg-white z-10'>
            <div className='flex flex-col items-center gap-3'>
              <div className='w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden'>
                <div className='h-full bg-primary rounded-full' style={{ width: '70%', animation: 'indeterminate 1.4s ease-in-out infinite' }} />
              </div>
              <span className='text-xs text-muted'>Chargement du tableur…</span>
            </div>
          </div>
        )}
        <style>{`.e-add-sheet-tab { display: none !important; }
@keyframes indeterminate { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }`}</style>
        <SpreadsheetComponent
          ref={ssRef as any}
          height='100%'
          allowEditing={false}
          allowInsert={false}
          showRibbon={false}
          showFormulaBar={false}
          created={handleCreated}
          dataBound={() => setRendering(false)}
          beforeOpen={(args: any) => { args.cancel = true; }}
          contextMenuBeforeOpen={(args: any) => {
            // Cancel the entire sheet-tab context menu (rename, duplicate, protect, etc.)
            const target = (args.event?.target ?? args.target) as HTMLElement | null;
            if (target?.closest('.e-sheet-tab-panel') || target?.closest('.e-spreadsheet-sheet-tab')) {
              args.cancel = true;
            }
          }}
        >
          <SSInject services={[Resize, Sort, Filter, Merge, WorkbookOpen]} />
        </SpreadsheetComponent>
      </div>
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export function FileEditorModal({ file, onClose, fetchContent, saveContent, onNavigate, hasPrev, hasNext }: Props) {
  const [editorContent, setEditorContent] = useState<EditorContent | null>(null);
  const [textValue, setTextValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const ssRef = useRef<SpreadsheetComponent | null>(null);

  const canSave = !!saveContent && editorContent?.type === 'text';

  // Keyboard navigation
  useEffect(() => {
    if (!onNavigate || !file) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft' && hasPrev) { e.preventDefault(); onNavigate('prev'); }
      if (e.key === 'ArrowRight' && hasNext) { e.preventDefault(); onNavigate('next'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onNavigate, file, hasPrev, hasNext]);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setEditorContent(null);
    setTextValue('');
    setLoading(true);
    fetchContent(file.id)
      .then((data) => {
        if (cancelled) return;
        setEditorContent(data);
        if (data.type === 'text') setTextValue(data.content);
      })
      .catch((err: any) => {
        if (cancelled) return;
        toast.error(err?.message || 'Impossible de charger le fichier');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [file?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = useCallback(async () => {
    if (!file || !saveContent || editorContent?.type !== 'text') return;
    setSaving(true);
    try {
      await saveContent(file.id, textValue, 'text');
      toast.success('Fichier sauvegardé');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  }, [file, saveContent, editorContent, textValue]);

  if (!file) return null;

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4'
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className='bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-6xl' style={{ height: '92vh' }}>

        {/* Header */}
        <div className='flex items-center justify-between px-5 py-3 border-b border-line shrink-0'>
          <div className='flex items-center gap-2 min-w-0'>
            {onNavigate && (
              <button
                onClick={() => onNavigate('prev')}
                disabled={!hasPrev}
                className='p-1 rounded hover:bg-canvas-200 transition-colors disabled:opacity-30 shrink-0'
                title='Fichier précédent (←)'
              >
                <LuChevronLeft size={18} />
              </button>
            )}
            <p className='text-sm font-semibold text-ink truncate max-w-lg'>{file.name}</p>
            {onNavigate && (
              <button
                onClick={() => onNavigate('next')}
                disabled={!hasNext}
                className='p-1 rounded hover:bg-canvas-200 transition-colors disabled:opacity-30 shrink-0'
                title='Fichier suivant (→)'
              >
                <LuChevronRight size={18} />
              </button>
            )}
          </div>
          <div className='flex items-center gap-2'>
            {file.url && (
              <button
                onClick={() => downloadFile(file.url!, file.name)}
                className='flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors'
                title='Télécharger'
              >
                <LuDownload size={16} />
              </button>
            )}
            {canSave && (
              <button
                onClick={handleSave}
                disabled={saving || loading}
                className='flex items-center gap-1.5 btn-primary text-sm py-1.5 px-3'
              >
                {saving ? <LuLoader size={14} className='animate-spin' /> : <LuSave size={14} />}
                Sauvegarder
              </button>
            )}
            <button onClick={onClose} className='p-1 rounded hover:bg-canvas-200 transition-colors'>
              <LuX size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className='flex-1 overflow-hidden'>
          {loading && (
            <div className='flex items-center justify-center h-full gap-2 text-muted'>
              <LuLoader size={18} className='animate-spin' />
              <span className='text-sm'>Chargement…</span>
            </div>
          )}

          {!loading && !editorContent && (
            <div className='flex items-center justify-center h-full text-muted text-sm'>
              Contenu non disponible
            </div>
          )}

          {!loading && editorContent?.type === 'text' && (
            <TextEditor
              content={textValue}
              readOnly={!saveContent}
              onChange={setTextValue}
            />
          )}

          {!loading && editorContent?.type === 'docx' && (
            <DocxViewer base64={editorContent.base64} />
          )}

          {!loading && editorContent?.type === 'spreadsheet' && (
            <SpreadsheetViewer
              workbook={editorContent.workbook}
              sheets={editorContent.sheets}
              ssRef={ssRef}
            />
          )}
        </div>
      </div>
    </div>
  );
}
