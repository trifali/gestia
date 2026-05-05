import { useState, useRef, useEffect, useCallback } from 'react';
import { LuX, LuDownload, LuSave, LuLoader } from 'react-icons/lu';
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
}

interface Props {
  file: EditorFileInfo | null;
  onClose: () => void;
  fetchContent: (id: string) => Promise<EditorContent>;
  /** If provided, text files show a Save button */
  saveContent?: (id: string, content: string, contentType: ContentType) => Promise<any>;
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

  useEffect(() => {
    if (!containerRef.current) return;
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
    }).catch((err) => {
      if (containerRef.current) {
        containerRef.current.innerHTML =
          '<p style="color:#b91c1c;padding:1rem">Impossible d\'afficher ce document.</p>';
      }
      console.error('[DocxViewer]', err);
    });
  }, [base64]);

  return (
    <div className='w-full h-full overflow-auto bg-gray-100 flex justify-center py-6'>
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

  const handleCreated = useCallback(function (this: SpreadsheetComponent) {
    const ss = ssRef.current;
    if (!ss || (ss as any) !== this) return;
    ss.openFromJson({ file: { Workbook: workbookRef.current } as any });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className='flex flex-col h-full'>
      <div className='flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs shrink-0'>
        <span>⚠️</span>
        <span>L'aperçu Excel peut ne pas refléter le style exact du fichier.</span>
        <span className='text-amber-600'>Téléchargez-le pour voir la mise en forme complète.</span>
      </div>
      <div className='flex-1 overflow-hidden'>
        <style>{`.e-add-sheet-tab { display: none !important; }`}</style>
        <SpreadsheetComponent
          ref={ssRef as any}
          height='100%'
          allowEditing={false}
          allowInsert={false}
          showRibbon={false}
          showFormulaBar={false}
          created={handleCreated}
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

export function FileEditorModal({ file, onClose, fetchContent, saveContent }: Props) {
  const [editorContent, setEditorContent] = useState<EditorContent | null>(null);
  const [textValue, setTextValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const ssRef = useRef<SpreadsheetComponent | null>(null);

  const canSave = !!saveContent && editorContent?.type === 'text';

  useEffect(() => {
    if (!file) return;
    setEditorContent(null);
    setTextValue('');
    setLoading(true);
    fetchContent(file.id)
      .then((data) => {
        setEditorContent(data);
        if (data.type === 'text') setTextValue(data.content);
      })
      .catch((err: any) => {
        toast.error(err?.message || 'Impossible de charger le fichier');
      })
      .finally(() => setLoading(false));
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
          <p className='text-sm font-semibold text-ink truncate max-w-lg'>{file.name}</p>
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
