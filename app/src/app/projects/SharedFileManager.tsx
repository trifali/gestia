import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  FileManagerComponent,
  Inject,
  DetailsView,
  NavigationPane,
  Toolbar,
  type FileData,
} from '@syncfusion/ej2-react-filemanager';
import toast from 'react-hot-toast';
import { LuUpload, LuFilePlus, LuX, LuFileText, LuChevronDown, LuSlidersHorizontal } from 'react-icons/lu';
import { FilePreviewModal } from './FilePreviewModal';
import { FileEditorModal, type EditorFileInfo } from './FileEditorModal';
import { ClientDocEditorModal, StandaloneEditDynamicVarsModal } from '../clients/ClientDocEditorModal';

// ─── Types ────────────────────────────────────────────────────────────────────

type NewFileType = 'md';

const NEW_FILE_OPTIONS: { type: NewFileType; label: string; icon: string }[] = [
  { type: 'md', label: 'Document Markdown (.md)', icon: '📝' },
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
  saveFileContent?: (id: string, content: string, contentType: 'text' | 'spreadsheet') => Promise<any>;
  /** Unique DOM id suffix (prevents collisions when both are on screen) */
  instanceId: string;
  /** Called whenever the user navigates into/out of a folder */
  onFolderChange?: (folderId: string | null) => void;
  /** When provided, "Nouveau fichier" shows a picker: template vs blank */
  onFromTemplate?: () => void;
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
      _itemCount: f.isFolder ? files.filter((c) => c.parentId === f.id).length : 0,
      imageUrl: f.mimeType?.startsWith('image/') && f.url ? f.url : undefined,
      _mimeType: f.mimeType,
      _url: f.url,
      _key: f.key,
      _sourceTemplateType: f.sourceTemplateType ?? null,
      _clientId: f.clientId ?? null,
      _dynamicVars: f.dynamicVars ?? null,
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

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className='bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4'>
        <div className='flex items-center justify-between'>
          <h2 className='font-semibold text-ink'>Nouveau document Markdown</h2>
          <button onClick={onClose} className='p-1 rounded hover:bg-canvas-200'><LuX size={16} /></button>
        </div>
        <div>
          <label className='label'>Nom (sans extension)</label>
          <input
            autoFocus
            className='input mt-1 w-full'
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='Ex. notes-projet'
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onConfirm(name.trim(), 'md')}
          />
        </div>
        <div className='flex gap-2 justify-end'>
          <button className='btn-secondary' onClick={onClose}>Annuler</button>
          <button
            className='btn-primary'
            disabled={!name.trim()}
            onClick={() => name.trim() && onConfirm(name.trim(), 'md')}
          >
            Créer
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── New File Menu (blank vs template) ───────────────────────────────────────

function NewFileMenu({ onBlank, onFromTemplate }: { onBlank: () => void; onFromTemplate: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className='relative'>
      <button
        className='btn-secondary flex items-center gap-2 text-sm'
        onClick={() => setOpen((v) => !v)}
      >
        <LuFilePlus size={15} /> Nouveau fichier <LuChevronDown size={13} />
      </button>
      {open && (
        <>
          {/* backdrop */}
          <div className='fixed inset-0 z-40' onClick={() => setOpen(false)} />
          <div className='absolute left-0 top-full mt-1 z-50 bg-white rounded-xl border border-line shadow-lg py-1 min-w-[200px]'>
            <button
              className='flex items-center gap-2.5 w-full px-4 py-2.5 text-sm hover:bg-canvas-100 text-left'
              onClick={() => { setOpen(false); onFromTemplate(); }}
            >
              <LuFileText size={14} className='text-primary shrink-0' />
              <div>
                <div className='font-medium text-ink'>Depuis un modèle</div>
                <div className='text-xs text-muted'>Contrat, maintenance, hébergement…</div>
              </div>
            </button>
            <button
              className='flex items-center gap-2.5 w-full px-4 py-2.5 text-sm hover:bg-canvas-100 text-left'
              onClick={() => { setOpen(false); onBlank(); }}
            >
              <LuFilePlus size={14} className='text-muted shrink-0' />
              <div>
                <div className='font-medium text-ink'>Document vide</div>
                <div className='text-xs text-muted'>Fichier Markdown sans contenu</div>
              </div>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Shared File Manager ──────────────────────────────────────────────────────

export function SharedFileManager({ ops }: { ops: FileManagerOperations }) {
  const { files: rawFiles, isFetching, refetch, upload, createFolder, deleteFiles, renameFile, moveFiles, createNewFile, getEditorContent, saveFileContent, instanceId, onFolderChange, onFromTemplate } = ops;

  const [fileSystemData, setFileSystemData] = useState<FileData[]>(() => toFileData([]));
  const [dataReady, setDataReady] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ name: string; mimeType: string | null; url: string | null } | null>(null);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [editorFile, setEditorFile] = useState<EditorFileInfo | null>(null);
  const [showNewFileDialog, setShowNewFileDialog] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  // Track dynamicVars per file id so we can refresh the editor without a full refetch
  const [dynVarsCache, setDynVarsCache] = useState<Record<string, string>>({});
  // File targeted by the right-click "Modifier les variables" action (no editor, just vars modal)
  const [ctxVarsFile, setCtxVarsFile] = useState<{ id: string; clientId: string | null; dynamicVars: string | null } | null>(null);

  const updateFolder = useCallback((id: string | null) => {
    setCurrentFolderId(id);
    onFolderChange?.(id);
  }, [onFolderChange]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fmRef = useRef<FileManagerComponent>(null);
  const fmWrapperRef = useRef<HTMLDivElement>(null);

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
        const item = detailArr[0];
        const id: string | undefined = item?.id;
        const newName: string = args?.newName ?? '';
        if (!id || id === VIRTUAL_ROOT_ID || !newName) return;

        // Check for duplicate name among siblings (same parent folder)
        const parentId = item?.parentId ?? VIRTUAL_ROOT_ID;
        const duplicate = fileSystemData.some(
          (f: any) => f.id !== id && f.parentId === parentId && f.name.toLowerCase() === newName.toLowerCase()
        );
        if (duplicate) {
          args.cancel = true;
          toast.error(`Un fichier nommé "${newName}" existe déjà dans ce dossier`);
          refetch();
          return;
        }

        await renameFile({ id, name: newName });
      } catch (err: any) {
        toast.error(err?.message || 'Erreur lors du renommage');
        refetch();
      }
    })();
  }, [renameFile, refetch, fileSystemData]);

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

  const EDITABLE_EXTS = new Set(['txt', 'md', 'json', 'csv', 'docx', 'xlsx', 'xls', 'xlsm', 'xlsb']);

  const handleFileOpen = useCallback((args: any) => {
    const d = args?.fileDetails as any;
    if (!d) return;
    if (!d.isFile) {
      updateFolder(d.id === VIRTUAL_ROOT_ID ? null : d.id);
      return;
    }
    args.cancel = true;
    const ext = d.name.split('.').pop()?.toLowerCase() ?? '';
    const sorted = (() => {
      const fm = fmRef.current as any;
      const viewData: any[] | undefined = fm?.detailsviewModule?.gridObj?.currentViewData;
      if (viewData && viewData.length > 0) {
        const idOrder = new Map<string, number>();
        viewData.forEach((item: any, i: number) => { if (item?.id) idOrder.set(String(item.id), i); });
        const base = fileSystemData.filter((f: any) => f.isFile && f.parentId === (currentFolderId ?? VIRTUAL_ROOT_ID));
        const s = [...base].sort((a: any, b: any) => {
          const ia = idOrder.has(String(a.id)) ? idOrder.get(String(a.id))! : 9999;
          const ib = idOrder.has(String(b.id)) ? idOrder.get(String(b.id))! : 9999;
          return ia - ib;
        });
        if (s.length) return s;
      }
      return fileSystemData
        .filter((f: any) => f.isFile && f.parentId === (currentFolderId ?? VIRTUAL_ROOT_ID))
        .sort((a: any, b: any) => (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' }));
    })();
    sortedFilesRef.current = sorted;
    if (getEditorContent && EDITABLE_EXTS.has(ext)) {
      setEditorFile({ id: d.id, name: d.name, mimeType: d._mimeType ?? null, url: d._url ?? null, sourceTemplateType: d._sourceTemplateType ?? null, clientId: d._clientId ?? null, dynamicVars: d._dynamicVars ?? null });
    } else {
      setPreviewFileId(d.id);
      setPreviewFile({ name: d.name, mimeType: d._mimeType ?? null, url: d._url ?? null });
    }
  }, [getEditorContent, fileSystemData, currentFolderId]);

  // ─── Intercept OS file drops into the FileManager (before Syncfusion) ──────

  const handleUploadRef = useRef(handleUpload);
  useEffect(() => { handleUploadRef.current = handleUpload; }, [handleUpload]);

  useEffect(() => {
    const wrapper = fmWrapperRef.current;
    if (!wrapper) return;
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      e.stopPropagation();
      handleUploadRef.current(e.dataTransfer.files);
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    wrapper.addEventListener('drop', onDrop, true);
    wrapper.addEventListener('dragover', onDragOver, true);
    return () => {
      wrapper.removeEventListener('drop', onDrop, true);
      wrapper.removeEventListener('dragover', onDragOver, true);
    };
  }, []);

  // ─── Syncfusion restoreFocus crash workaround ─────────────────────────────

  const handleCreated = useCallback(() => {
    const fm = fmRef.current as any;
    if (!fm) return;
    const original = fm.restoreFocus?.bind(fm);
    if (original) {
      fm.restoreFocus = () => { try { original(); } catch { /* suppress */ } };
    }
  }, []);

  // ─── Context menu: show "Modifier les variables" only for template files ───

  const handleMenuOpen = useCallback((args: any) => {
    if (!args.items) return;
    // args.fileDetails contains the Syncfusion FileData object(s) for the target
    const fileDetails: any[] = Array.isArray(args.fileDetails) ? args.fileDetails : (args.fileDetails ? [args.fileDetails] : []);
    const target = fileDetails[0];
    const isTemplateFile = target?._sourceTemplateType;
    // Remove the custom item when the file is not a template
    if (!isTemplateFile) {
      args.items = args.items.filter((i: any) => i.text !== 'Modifier les variables');
    } else {
      // Add icon to the item
      for (const item of args.items) {
        if (item.text === 'Modifier les variables') {
          item.iconCss = 'e-icons e-settings';
        }
      }
    }
  }, []);

  const handleMenuClick = useCallback((args: any) => {
    if (args.item?.text !== 'Modifier les variables') return;
    const fileDetails: any[] = Array.isArray(args.fileDetails) ? args.fileDetails : (args.fileDetails ? [args.fileDetails] : []);
    const target = fileDetails[0];
    if (!target) return;
    // Open vars modal directly — no need to open the full editor
    setCtxVarsFile({
      id: target.id,
      clientId: target._clientId ?? null,
      dynamicVars: dynVarsCache[target.id] ?? target._dynamicVars ?? null,
    });
  }, [dynVarsCache]);



  useEffect(() => {
    if (!dataReady) return;
    const container = (fmRef.current as any)?.element as HTMLElement | undefined;
    if (!container) return;

    // Build name→count map for folders that have children
    const folderCounts = new Map<string, number>();
    fileSystemData.forEach((f: any) => {
      if (!f.isFile && f._itemCount > 0) folderCounts.set(f.name, f._itemCount);
    });

    // Build name→templateType map for template-based files
    const TMPL_TYPE_LABELS: Record<string, { label: string; color: string }> = {
      contract:           { label: 'Contrat',     color: '#3b82f6' },
      cahier_des_charges: { label: 'Cahier',      color: '#8b5cf6' },
      hebergement:        { label: 'Héberg.',     color: '#10b981' },
      maintenance:        { label: 'Mainten.',    color: '#f59e0b' },
      autre:              { label: 'Autre',        color: '#6b7280' },
    };
    const templateTypes = new Map<string, { label: string; color: string }>();
    fileSystemData.forEach((f: any) => {
      if (f.isFile && f._sourceTemplateType) {
        const meta = TMPL_TYPE_LABELS[f._sourceTemplateType] ?? { label: f._sourceTemplateType, color: '#6b7280' };
        templateTypes.set(f.name, meta);
      }
    });

    const applyBadge = (nameEl: HTMLElement, rawName: string) => {
      const existing = nameEl.querySelector('.fm-count-badge') as HTMLElement | null;
      const count = folderCounts.get(rawName);
      if (!count) { existing?.remove(); return; }
      const countStr = String(count);
      if (existing) { existing.textContent = countStr; return; }
      const badge = document.createElement('span');
      badge.className = 'fm-count-badge';
      badge.style.cssText = 'margin-left:6px;font-size:10px;padding:1px 5px;border-radius:9px;background:#e5e7eb;color:#6b7280;font-weight:500;vertical-align:middle;white-space:nowrap';
      badge.textContent = countStr;
      nameEl.appendChild(badge);
    };

    const applyTemplateBadge = (nameEl: HTMLElement, rawName: string) => {
      const existing = nameEl.querySelector('.fm-template-badge') as HTMLElement | null;
      const meta = templateTypes.get(rawName);
      if (!meta) { existing?.remove(); return; }
      if (existing) return; // already there
      const badge = document.createElement('span');
      badge.className = 'fm-template-badge';
      badge.style.cssText = `margin-left:6px;font-size:9px;padding:1px 6px;border-radius:9px;background:${meta.color}1a;color:${meta.color};font-weight:600;vertical-align:middle;white-space:nowrap;letter-spacing:0.02em`;
      badge.textContent = meta.label;
      nameEl.appendChild(badge);
    };

    const injectBadges = () => {
      // Details view rows — folders get count badge, template files get type badge
      container.querySelectorAll('.e-row').forEach((row) => {
        const nameCell = row.querySelector('.e-fe-text') as HTMLElement | null;
        if (!nameCell) return;
        const rawName = Array.from(nameCell.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent?.trim()).join('') || nameCell.textContent?.trim() || '';
        if (row.querySelector('.e-fe-folder')) {
          applyBadge(nameCell, rawName);
        } else {
          applyTemplateBadge(nameCell, rawName);
        }
      });
      // Navigation pane tree nodes (folders only)
      container.querySelectorAll('.e-list-item .e-list-text').forEach((el) => {
        const textEl = el as HTMLElement;
        const rawName = Array.from(textEl.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent?.trim()).join('') || textEl.textContent?.trim() || '';
        applyBadge(textEl, rawName);
      });
    };

    const observer = new MutationObserver(() => {
      observer.disconnect();
      injectBadges();
      observer.observe(container, { childList: true, subtree: true });
    });
    injectBadges();
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [dataReady, fileSystemData]);

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

  // ─── Navigable files (all non-folder files) ──────────────────────────────

  const EDITABLE_MIMES = new Set([
    'text/plain', 'text/markdown', 'application/json', 'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.ms-excel.sheet.macroEnabled.12',
    'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
  ]);

  const isEditable = (f: any) => {
    const mime = f._mimeType ?? f.mimeType;
    if (mime && EDITABLE_MIMES.has(mime)) return true;
    const ext = (f.name ?? '').split('.').pop()?.toLowerCase() ?? '';
    return EDITABLE_EXTS.has(ext);
  };

  // Base list for the current folder. Sorted lazily at navigate time via getSortedFiles().
  const currentParentId = currentFolderId ?? VIRTUAL_ROOT_ID;
  const navigableFiles = useMemo(
    () => fileSystemData.filter((f: any) => f.isFile && f.parentId === currentParentId),
    [fileSystemData, currentParentId]
  );

  // Read current sort from the FM instance and return a sorted copy of navigableFiles.
  const getSortedFiles = useCallback(() => {
    const fm = fmRef.current as any;
    // Use the grid's currentViewData — it reflects the actual rendered sort order
    const viewData: any[] | undefined = fm?.detailsviewModule?.gridObj?.currentViewData;
    if (viewData && viewData.length > 0) {
      const idOrder = new Map<string, number>();
      viewData.forEach((item: any, i: number) => { if (item?.id) idOrder.set(String(item.id), i); });
      const sorted = [...navigableFiles].sort((a: any, b: any) => {
        const ia = idOrder.has(String(a.id)) ? idOrder.get(String(a.id))! : 9999;
        const ib = idOrder.has(String(b.id)) ? idOrder.get(String(b.id))! : 9999;
        return ia - ib;
      });
      return sorted;
    }
    // Fallback: alphabetical
    return [...navigableFiles].sort((a: any, b: any) =>
      (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' })
    );
  }, [navigableFiles]);

  // Keeps the last-known sorted list so hasPrev/hasNext stay accurate between renders
  const sortedFilesRef = useRef<any[]>([]);

  const openFileAtIdx = useCallback((idx: number, files: any[]) => {
    const f = files[idx] as any;
    if (!f) return;
    sortedFilesRef.current = files;
    if (getEditorContent && isEditable(f)) {
      setPreviewFile(null);
      setPreviewFileId(null);
      setEditorFile({ id: f.id, name: f.name, mimeType: f._mimeType ?? null, url: f._url ?? null, sourceTemplateType: f._sourceTemplateType ?? null, clientId: f._clientId ?? null, dynamicVars: f._dynamicVars ?? null });
    } else {
      setEditorFile(null);
      setPreviewFileId(f.id);
      setPreviewFile({ name: f.name, mimeType: f._mimeType ?? null, url: f._url ?? null });
    }
  }, [getEditorContent]);

  // Current open file index — use sortedFilesRef for accurate prev/next bounds
  const openFileId = editorFile?.id ?? previewFileId;
  const sortedList = sortedFilesRef.current.length ? sortedFilesRef.current : navigableFiles;
  const openFileIdx = openFileId ? sortedList.findIndex((f: any) => f.id === openFileId) : -1;

  const handleNavigate = useCallback((dir: 'prev' | 'next') => {
    const sorted = getSortedFiles();
    sortedFilesRef.current = sorted;
    const idx = sorted.findIndex((f: any) => f.id === openFileId);
    openFileAtIdx(idx + (dir === 'next' ? 1 : -1), sorted);
  }, [getSortedFiles, openFileId, openFileAtIdx]);

  const editorFileIdx = openFileIdx;

  const handleClosePreview = useCallback(() => {
    setPreviewFile(null);
    setPreviewFileId(null);
  }, []);

  return (
    <>
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
        {createNewFile && !onFromTemplate && (
          <button
            className='btn-secondary flex items-center gap-2 text-sm'
            onClick={() => setShowNewFileDialog(true)}
          >
            <LuFilePlus size={15} /> Nouveau fichier
          </button>
        )}
        {createNewFile && onFromTemplate && (
          <NewFileMenu
            onBlank={() => setShowNewFileDialog(true)}
            onFromTemplate={onFromTemplate}
          />
        )}
      </div>

      {/* Syncfusion FileManager */}
      <div ref={fmWrapperRef} className='rounded-xl border border-line overflow-hidden' style={{ height: '520px' }}>
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
            contextMenuSettings={{
              file: ['Open', '|', 'Modifier les variables', '|', 'Cut', 'Copy', 'Delete', 'Rename', '|', 'Details'],
              folder: ['Open', '|', 'Cut', 'Copy', 'Paste', 'Delete', 'Rename'],
              layout: ['Refresh', '|', 'NewFolder', 'Paste', '|', 'Details'],
            }}
            toolbarSettings={{
              items: ['NewFolder', '|', 'Cut', 'Copy', 'Paste', 'Delete', 'Rename', 'Refresh', '|', 'SortBy', 'Details'],
            }}
            allowDragAndDrop={true}
            created={handleCreated}
            folderCreate={handleFolderCreate}
            beforeDelete={handleDelete}
            beforeRename={handleRename}
            beforeMove={handleMove}
            fileOpen={handleFileOpen}
            menuOpen={handleMenuOpen}
            menuClick={handleMenuClick}
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

      <FilePreviewModal
        file={previewFile}
        onClose={handleClosePreview}
        onNavigate={handleNavigate}
        hasPrev={openFileIdx > 0}
        hasNext={openFileIdx >= 0 && openFileIdx < sortedList.length - 1}
      />

      {getEditorContent && editorFile?.sourceTemplateType ? (
        <ClientDocEditorModal
          file={editorFile}
          onClose={() => setEditorFile(null)}
          fetchContent={getEditorContent}
          saveContent={(id, content, contentType) => saveFileContent?.(id, content, contentType) ?? Promise.resolve()}
          onNavigate={handleNavigate}
          hasPrev={editorFileIdx > 0}
          hasNext={editorFileIdx >= 0 && editorFileIdx < sortedList.length - 1}
          clientId={editorFile.clientId ?? null}
          dynamicVars={dynVarsCache[editorFile.id] ?? editorFile.dynamicVars ?? null}
          onDynamicVarsUpdated={(newJson) => {
            setDynVarsCache((prev) => ({ ...prev, [editorFile.id]: newJson }));
          }}
        />
      ) : getEditorContent && (
        <FileEditorModal
          file={editorFile}
          onClose={() => setEditorFile(null)}
          fetchContent={getEditorContent}
          saveContent={saveFileContent}
          onNavigate={handleNavigate}
          hasPrev={editorFileIdx > 0}
          hasNext={editorFileIdx >= 0 && editorFileIdx < sortedList.length - 1}
        />
      )}
    </div>

    {ctxVarsFile && (
      <StandaloneEditDynamicVarsModal
        fileId={ctxVarsFile.id}
        clientId={ctxVarsFile.clientId}
        dynamicVars={ctxVarsFile.dynamicVars}
        onSave={(newJson) => {
          setDynVarsCache((prev) => ({ ...prev, [ctxVarsFile.id]: newJson }));
        }}
        onClose={() => setCtxVarsFile(null)}
      />
    )}
    </>
  );
}
