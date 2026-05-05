import { useState, useRef, useEffect, useCallback } from 'react';
import { LuX, LuDownload, LuSave, LuLoader } from 'react-icons/lu';
import toast from 'react-hot-toast';
import {
  RichTextEditorComponent,
  HtmlEditor,
  Toolbar,
  QuickToolbar,
  Link,
  Table,
  Inject as RTEInject,
} from '@syncfusion/ej2-react-richtexteditor';
import {
  SpreadsheetComponent,
  Inject as SSInject,
  Resize,
  Edit,
  UndoRedo,
  Clipboard,
  Sort,
  Filter,
  Merge,
  WorkbookOpen,
  WorkbookSave,
} from '@syncfusion/ej2-react-spreadsheet';

// ─── Types ────────────────────────────────────────────────────────────────────

type EditorContent =
  | { type: 'text'; content: string }
  | { type: 'html'; content: string }
  | {
      type: 'spreadsheet';
      /** Full Syncfusion workbook JSON when available (preserves styles, dimensions, formulas, merges). */
      workbook?: any;
      /** Fallback: plain 2D cell values when no Syncfusion sidecar exists (e.g. xlsx uploaded externally). */
      sheets: { name: string; data: any[][] }[];
    };

type ContentType = 'text' | 'html' | 'spreadsheet';

export interface EditorFileInfo {
  id: string;
  name: string;
  mimeType: string | null;
  url: string | null;
}

interface Props {
  file: EditorFileInfo | null;
  onClose: () => void;
  /** Load editor content from the server (converts DOCX→HTML, XLSX→JSON, etc.) */
  fetchContent: (id: string) => Promise<EditorContent>;
  /** If not provided, editor is read-only */
  saveContent?: (id: string, content: string, contentType: ContentType) => Promise<any>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function downloadFile(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
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

// ─── HTML (DOCX) Editor ───────────────────────────────────────────────────────

const RTE_TOOLBAR = [
  'Bold', 'Italic', 'Underline', 'StrikeThrough', '|',
  'Formats', 'Alignments', '|',
  'OrderedList', 'UnorderedList', '|',
  'CreateLink', 'CreateTable', '|',
  'Undo', 'Redo',
];

function HtmlDocEditor({
  content,
  readOnly,
  rteRef,
}: {
  content: string;
  readOnly: boolean;
  rteRef: React.RefObject<RichTextEditorComponent | null>;
}) {
  return (
    <div className='w-full h-full overflow-auto'>
      <RichTextEditorComponent
        ref={rteRef as any}
        value={content}
        height='100%'
        readonly={readOnly}
        toolbarSettings={{ items: RTE_TOOLBAR }}
        enableResize={false}
      >
        <RTEInject services={[Toolbar, HtmlEditor, QuickToolbar, Link, Table]} />
      </RichTextEditorComponent>
    </div>
  );
}

// ─── Spreadsheet (XLSX) Editor ────────────────────────────────────────────────

function SpreadsheetEditor({
  workbook,
  sheets,
  readOnly,
  ssRef,
}: {
  workbook?: any;
  sheets: { name: string; data: any[][] }[];
  readOnly: boolean;
  ssRef: React.RefObject<SpreadsheetComponent | null>;
}) {
  // Keep a ref so the created callback always sees the latest data even though
  // it is a stable callback (no deps). SpreadsheetEditor is only rendered after
  // the data fetch is complete, so dataRef will be populated before created fires.
  const dataRef = useRef({ workbook, sheets });
  dataRef.current = { workbook, sheets };

  // Syncfusion fires 'created' inside its own setTimeout in React mode, which
  // guarantees the full DOM (incl. e-selectall-container) is flushed before we
  // call openFromJson. Doing the call here — instead of a useEffect — avoids the
  // querySelectorAll-on-null crash that occurs when openFromJson is deferred to
  // a later React render cycle.
  const handleCreated = useCallback(() => {
    const ss = ssRef.current;
    if (!ss) return;
    const { workbook: wb, sheets: sh } = dataRef.current;
    let workbookJson: any = wb;
    if (!workbookJson) {
      if (!sh.length) return;
      workbookJson = {
        sheets: sh.map((s) => ({
          name: s.name,
          rows: s.data.map((row, ri) => ({
            index: ri,
            cells: row.map((cell, ci) => ({
              index: ci,
              value: cell !== null && cell !== undefined ? String(cell) : '',
            })),
          })),
        })),
      };
    }
    ss.openFromJson({ file: { Workbook: workbookJson } as any });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SpreadsheetComponent
      ref={ssRef as any}
      height='100%'
      allowEditing={!readOnly}
      created={handleCreated}
      beforeOpen={(args: any) => { args.cancel = true; }}
    >
      <SSInject services={[Resize, Edit, UndoRedo, Clipboard, Sort, Filter, Merge, WorkbookOpen, WorkbookSave]} />
    </SpreadsheetComponent>
  );
}

// ─── Main Editor Modal ────────────────────────────────────────────────────────

export function FileEditorModal({ file, onClose, fetchContent, saveContent }: Props) {
  const [editorContent, setEditorContent] = useState<EditorContent | null>(null);
  const [textValue, setTextValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const rteRef = useRef<RichTextEditorComponent | null>(null);
  const ssRef = useRef<SpreadsheetComponent | null>(null);

  const readOnly = !saveContent;

  // ─── Load content on open ──────────────────────────────────────────────────
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

  // ─── Save ─────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!file || !saveContent || !editorContent) return;
    setSaving(true);
    try {
      let content: string;
      const contentType: ContentType = editorContent.type;

      if (editorContent.type === 'text') {
        content = textValue;
      } else if (editorContent.type === 'html') {
        content = rteRef.current?.value ?? '';
      } else {
        // Commit any active cell edit before serialising
        (ssRef.current as any)?.endEdit?.();
        // spreadsheet — saveAsJson() returns the full Syncfusion workbook JSON
        // (sheets, rows, cells, styles, dimensions, formulas, merges, etc.)
        const result = await (ssRef.current as any)?.saveAsJson() as any;
        const workbook = result?.jsonObject?.Workbook;
        if (!workbook) throw new Error('Impossible de sérialiser le classeur');
        // Send the full workbook — server stores both xlsx (for download) and JSON sidecar (for fidelity)
        content = JSON.stringify(workbook);
      }

      await saveContent(file.id, content, contentType);
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
            {saveContent && !readOnly && (
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
              readOnly={readOnly}
              onChange={setTextValue}
            />
          )}

          {!loading && editorContent?.type === 'html' && (
            <HtmlDocEditor
              content={editorContent.content}
              readOnly={readOnly}
              rteRef={rteRef}
            />
          )}

          {!loading && editorContent?.type === 'spreadsheet' && (
            <SpreadsheetEditor
              workbook={editorContent.workbook}
              sheets={editorContent.sheets}
              readOnly={readOnly}
              ssRef={ssRef}
            />
          )}
        </div>
      </div>
    </div>
  );
}
