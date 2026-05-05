import { useState, useRef, useCallback, useEffect } from 'react';
import {
  FileManagerComponent,
  Inject,
  DetailsView,
  NavigationPane,
  Toolbar,
  type FileData,
} from '@syncfusion/ej2-react-filemanager';
import toast from 'react-hot-toast';
import { LuUpload, LuFilePlus, LuX } from 'react-icons/lu';
import { FilePreviewModal } from './FilePreviewModal';
import { FileEditorModal, type EditorFileInfo } from './FileEditorModal';

// ─── Types ────────────────────────────────────────────────────────────────────

type NewFileType = 'txt' | 'md' | 'json' | 'xlsx' | 'docx';

const NEW_FILE_OPTIONS: { type: NewFileType; label: string; icon: string }[] = [
  { type: 'txt', label: 'Fichier texte (.txt)', icon: '📄' },
  { type: 'md', label: 'Markdown (.md)', icon: '📝' },
  { type: 'json', label: 'JSON (.json)', icon: '🔧' },
  { type: 'xlsx', label: 'Classeur Excel (.xlsx)', icon: '📊' },
  { type: 'docx', label: 'Document Word (.docx)', icon: '📃' },
];

export interface FileManagerOperations {
  /** Fetch all files for the current scope. Must return the raw file array. */
  files: any[] | undefined;
  isFetching: boolean;
  refetch: () => void;
  upload: (params: { dataUrl: string; name: string; originalName: string; parentId: string | null }) => Promise<any>;
  createFolder: (params: { name: string; parentId: string | null }) => Promise<any>;
  deleteFiles: (params: { ids: string[] }) => Promise<any>;
  renameFile: (params: { id: string; name: string }) => Promise<any>;
  moveFiles: (params: { ids: string[]; targetParentId: string | null }) => Promise<any>;
  /** Optional — if not provided the "Nouveau fichier" button is hidden */
  createNewFile?: (params: { name: string; type: NewFileType; parentId: string | null }) => Promise<any>;
  /** Load editor content for a file (txt/md/json/docx/xlsx). If not provided, no inline editing. */
  getEditorContent?: (id: string) => Promise<any>;
  /** Save edited content back. If not provided, editor is read-only. */
  saveFileContent?: (id: string, content: string, contentType: 'text' | 'html' | 'spreadsheet') => Promise<any>;
  /** Unique DOM id suffix (prevents collisions when both are on screen) */
  instanceId: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VIRTUAL_ROOT_ID = '__root__';

function mimeToFileType(mimeType: string | null, name: string): string {
  if (!mimeType) {
    const last = name.includes('.') ? name.split('.').pop()! : '';
    const ext = /^[a-zA-Z0-9+]{1,5}$/.test(last) ? '.' + last.toLowerCase() : '';
    return ext;
  }
  const map: Record<string, string> = {
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
    'text/plain': '.txt',
    'text/markdown': '.md',
    'application/json': '.json',
    'text/csv': '.csv',
    'application/zip': '.zip',
    'video/mp4': '.mp4',
    'audio/mpeg': '.mp3',
  };
  return map[mimeType] ?? (mimeType.startsWith('image/') ? '.img' : '');
}

function buildFilterPath(parentId: string | null, idToItem: Map<string, any>): string {
  if (!parentId || parentId === VIRTUAL_ROOT_ID) return '\\';
  const parent = idToItem.get(parentId);
  if (!parent) return '\\';
  const ancestorPath = buildFilterPath(parent.parentId, idToItem);
  return (ancestorPath === '\\' ? '\\' : ancestorPath) + parent.name + '\\';
}

export function toFileData(files: any[]): FileData[] {
  const idToItem = new Map(files.map((f) => [f.id, f]));

  const root: FileData = {
    id: VIRTUAL_ROOT_ID,
    name: 'Fichiers',
    parentId: undefined,
    isFile: false,
    size: 0,
    type: 'folder',
    dateCreated: new Date(),
    dateModified: new Date(),
    filterPath: '',
    hasChild: files.some((f) => !f.parentId && f.isFolder),
  };

  const items: FileData[] = files.map((f) => {
    const ext = f.isFolder ? '' : mimeToFileType(f.mimeType, f.name);
    const displayName =
      ext && !f.name.toLowerCase().endsWith(ext.toLowerCase())
        ? f.name + ext
        : f.name;
    return {
      id: f.id,
      name: displayName,
      parentId: f.parentId ?? VIRTUAL_ROOT_ID,
      isFile: !f.isFolder,
      size: f.size,
      type: f.isFolder ? 'folder' : mimeToFileType(f.mimeType, f.name),
      dateCreated: new Date(f.createdAt),
      dateModified: new Date(f.updatedAt ?? f.createdAt),
      filterPath: buildFilterPath(f.parentId, idToItem),
      hasChild: f.isFolder && files.some((c) => c.parentId === f.id && c.isFolder),
      imageUrl: f.mimeType?.startsWith('image/') && f.url ? f.url : undefined,
      _mimeType: f.mimeType,
      _url: f.url,
      _key: f.key,
    } as any;
  });

  return [root, ...items];
}

// ─── New File Dialog ──────────────────────────────────────────────────────────

function NewFileDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (name: string, type: NewFileType) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<NewFileType>('txt');

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className='bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4'>
        <div className='flex items-center justify-between'>
          <h2 className='font-semibold text-ink'>Nouveau fichier</h2>
          <button onClick={onClose} className='p-1 rounded hover:bg-canvas-200'><LuX size={16} /></button>
        </div>
        <div>
          <label className='label'>Type de fichier</label>
          <div className='flex flex-col gap-1 mt-1'>
            {NEW_FILE_OPTIONS.map((o) => (
              <button
                key={o.type}
                onClick={() => setType(o.type)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
                  type === o.type ? 'border-accent bg-accent-50 text-accent' : 'border-line hover:border-accent'
                }`}
              >
                <span>{o.icon}</span>
                <span>{o.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className='label'>Nom (sans extension)</label>
          <input
            autoFocus
            className='input mt-1 w-full'
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='Ex. rapport-client'
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onConfirm(name.trim(), type)}
          />
        </div>
        <div className='flex gap-2 justify-end'>
          <button className='btn-secondary' onClick={onClose}>Annuler</button>
          <button
            className='btn-primary'
            disabled={!name.trim()}
            onClick={() => name.trim() && onConfirm(name.trim(), type)}
          >
            Créer
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Shared File Manager ──────────────────────────────────────────────────────

export function SharedFileManager({ ops }: { ops: FileManagerOperations }) {
  const { files: rawFiles, isFetching, refetch, upload, createFolder, deleteFiles, renameFile, moveFiles, createNewFile, getEditorContent, saveFileContent, instanceId } = ops;

  const [fileSystemData, setFileSystemData] = useState<FileData[]>(() => toFileData([]));
  const [dataReady, setDataReady] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ name: string; mimeType: string | null; url: string | null } | null>(null);
  const [editorFile, setEditorFile] = useState<EditorFileInfo | null>(null);
  const [showNewFileDialog, setShowNewFileDialog] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fmRef = useRef<FileManagerComponent>(null);

  useEffect(() => {
    if (!rawFiles) return;
    const tid = setTimeout(() => {
      setFileSystemData(toFileData(rawFiles as any[]));
      setDataReady(true);
    }, 150);
    return () => clearTimeout(tid);
  }, [rawFiles]);

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const stripExt = (filename: string) => filename.replace(/\.[^.]+$/, '');

  // ─── Upload ───────────────────────────────────────────────────────────────

  const handleUpload = useCallback(async (fileList: FileList) => {
    const arr = Array.from(fileList);
    if (!arr.length) return;
    let ok = 0;
    let fail = 0;
    for (const file of arr) {
      try {
        const dataUrl = await fileToDataUrl(file);
        await upload({ dataUrl, name: stripExt(file.name), originalName: file.name, parentId: currentFolderId });
        ok++;
      } catch (err: any) {
        fail++;
        console.error(err);
      }
    }
    if (ok > 0) toast.success(`${ok} fichier${ok > 1 ? 's' : ''} téléversé${ok > 1 ? 's' : ''}`);
    if (fail > 0) toast.error(`${fail} fichier${fail > 1 ? 's' : ''} échoué${fail > 1 ? 's' : ''}`);
    refetch();
  }, [currentFolderId, upload, refetch]);

  // ─── Folder create ────────────────────────────────────────────────────────

  const handleFolderCreate = useCallback((args: any) => {
    const name: string = args?.folderName ?? '';
    if (!name) return;
    (async () => {
      try {
        await createFolder({ name, parentId: currentFolderId });
      } catch (err: any) {
        toast.error(err?.message || 'Erreur lors de la création du dossier');
        refetch();
      }
    })();
  }, [currentFolderId, createFolder, refetch]);

  // ─── Delete ───────────────────────────────────────────────────────────────

  const handleDelete = useCallback((args: any) => {
    (async () => {
      try {
        const itemData = args?.itemData;
        const detailArr: any[] = Array.isArray(itemData) ? itemData : itemData ? [itemData] : [];
        const ids = detailArr
          .map((d: any) => d?.id)
          .filter((id: any): id is string => !!id && id !== VIRTUAL_ROOT_ID);
        if (!ids.length) return;
        await deleteFiles({ ids });
      } catch (err: any) {
        toast.error(err?.message || 'Erreur lors de la suppression');
        refetch();
      }
    })();
  }, [deleteFiles, refetch]);

  // ─── Rename ───────────────────────────────────────────────────────────────

  const handleRename = useCallback((args: any) => {
    (async () => {
      try {
        const itemData = args?.itemData;
        const detailArr: any[] = Array.isArray(itemData) ? itemData : itemData ? [itemData] : [];
        const id: string | undefined = detailArr[0]?.id;
        const newName: string = args?.newName ?? '';
        if (!id || id === VIRTUAL_ROOT_ID || !newName) return;
        await renameFile({ id, name: newName });
      } catch (err: any) {
        toast.error(err?.message || 'Erreur lors du renommage');
        refetch();
      }
    })();
  }, [renameFile, refetch]);

  // ─── Move ─────────────────────────────────────────────────────────────────

  const handleMove = useCallback((args: any) => {
    (async () => {
      try {
        const itemData = args?.itemData;
        const detailArr: any[] = Array.isArray(itemData) ? itemData : itemData ? [itemData] : [];
        const ids = detailArr
          .map((d: any) => d?.id)
          .filter((id: any): id is string => !!id && id !== VIRTUAL_ROOT_ID);
        if (!ids.length) return;
        const targetRaw = args?.targetData;
        const targetId = (!targetRaw?.id || targetRaw?.id === VIRTUAL_ROOT_ID) ? null : String(targetRaw.id);
        await moveFiles({ ids, targetParentId: targetId });
      } catch (err: any) {
        toast.error(err?.message || 'Erreur lors du déplacement');
        refetch();
      }
    })();
  }, [moveFiles, refetch]);

  // ─── File open / folder navigate ──────────────────────────────────────────

  const EDITABLE_EXTS = new Set(['txt', 'md', 'json', 'csv', 'docx', 'xlsx']);

  const handleFileOpen = useCallback((args: any) => {
    const d = args?.fileDetails as any;
    if (!d) return;
    if (!d.isFile) {
      setCurrentFolderId(d.id === VIRTUAL_ROOT_ID ? null : d.id);
      return;
    }
    args.cancel = true;
    const ext = d.name.split('.').pop()?.toLowerCase() ?? '';
    if (getEditorContent && EDITABLE_EXTS.has(ext)) {
      setEditorFile({ id: d.id, name: d.name, mimeType: d._mimeType ?? null, url: d._url ?? null });
    } else {
      setPreviewFile({ name: d.name, mimeType: d._mimeType ?? null, url: d._url ?? null });
    }
  }, [getEditorContent]);

  // ─── Syncfusion restoreFocus crash workaround ─────────────────────────────

  const handleCreated = useCallback(() => {
    const fm = fmRef.current as any;
    if (!fm) return;
    const original = fm.restoreFocus?.bind(fm);
    if (original) {
      fm.restoreFocus = () => { try { original(); } catch { /* suppress */ } };
    }
  }, []);

  // ─── New file ─────────────────────────────────────────────────────────────

  const handleNewFile = useCallback(async (name: string, type: NewFileType) => {
    setShowNewFileDialog(false);
    try {
      await createNewFile!({ name, type, parentId: currentFolderId });
      toast.success(`${name}.${type} créé`);
      refetch();
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors de la création');
    }
  }, [currentFolderId, createNewFile, refetch]);

  return (
    <div className='flex flex-col gap-3'>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type='file'
        multiple
        className='hidden'
        onChange={(e) => e.target.files && handleUpload(e.target.files)}
      />

      {/* Action buttons */}
      <div className='flex items-center gap-2'>
        <button
          className='btn-secondary flex items-center gap-2 text-sm'
          onClick={() => fileInputRef.current?.click()}
        >
          <LuUpload size={15} /> Téléverser
        </button>
        {createNewFile && (
          <button
            className='btn-secondary flex items-center gap-2 text-sm'
            onClick={() => setShowNewFileDialog(true)}
          >
            <LuFilePlus size={15} /> Nouveau fichier
          </button>
        )}
      </div>

      {/* Syncfusion FileManager */}
      <div className='rounded-xl border border-line overflow-hidden' style={{ height: '520px' }}>
        {!dataReady && (
          <div className='flex items-center justify-center h-full text-muted text-sm'>Chargement…</div>
        )}
        {dataReady && (
          <FileManagerComponent
            ref={fmRef}
            id={`fm-${instanceId}`}
            fileSystemData={fileSystemData as any}
            view='Details'
            height='100%'
            toolbarSettings={{
              items: ['NewFolder', '|', 'Cut', 'Copy', 'Paste', 'Delete', 'Rename', 'Refresh', '|', 'SortBy', 'Details'],
            }}
            contextMenuSettings={{
              file: ['Open', '|', 'Cut', 'Copy', 'Delete', 'Rename', '|', 'Details'],
              folder: ['Open', '|', 'Cut', 'Copy', 'Paste', 'Delete', 'Rename'],
              layout: ['Refresh', '|', 'NewFolder', 'Paste', '|', 'Details'],
            }}
            allowDragAndDrop={true}
            created={handleCreated}
            folderCreate={handleFolderCreate}
            beforeDelete={handleDelete}
            beforeRename={handleRename}
            beforeMove={handleMove}
            fileOpen={handleFileOpen}
          >
            <Inject services={[DetailsView, NavigationPane, Toolbar]} />
          </FileManagerComponent>
        )}
      </div>

      {showNewFileDialog && createNewFile && (
        <NewFileDialog
          onClose={() => setShowNewFileDialog(false)}
          onConfirm={handleNewFile}
        />
      )}

      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />

      {getEditorContent && (
        <FileEditorModal
          file={editorFile}
          onClose={() => setEditorFile(null)}
          fetchContent={getEditorContent}
          saveContent={saveFileContent}
        />
      )}
    </div>
  );
}
