import { useState, useMemo } from 'react';
import {
  useQuery,
  useAction,
  getClientFiles,
  createClientFolder,
  uploadClientFile,
  deleteClientFiles,
  renameClientFile,
  moveClientFiles,
  createNewClientFile,
  getClientFileEditorContent,
  updateClientFileContent,
  getDocumentTemplates,
  createClientFileFromTemplate,
} from 'wasp/client/operations';
import { LuFolderOpen, LuFilePlus, LuX, LuFileText, LuChevronRight } from 'react-icons/lu';
import { SharedFileManager } from '../projects/SharedFileManager';

interface Props {
  clientId: string;
  clientName: string;
}

// ─── Template type labels ─────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  contract:           'Contrat',
  cahier_des_charges: 'Cahier des charges',
  hebergement:        'Hébergement',
  maintenance:        'Maintenance',
  autre:              'Autre',
};

const TYPE_COLORS: Record<string, string> = {
  contract:           'bg-blue-100 text-blue-700',
  cahier_des_charges: 'bg-purple-100 text-purple-700',
  hebergement:        'bg-emerald-100 text-emerald-700',
  maintenance:        'bg-amber-100 text-amber-700',
  autre:              'bg-slate-100 text-slate-600',
};

// ─── FromTemplateModal ────────────────────────────────────────────────────────

function FromTemplateModal({
  clientId,
  clientName,
  currentFolderId,
  onClose,
  onCreated,
}: {
  clientId: string;
  clientName: string;
  currentFolderId: string | null;
  onClose: () => void;
  onCreated: (file: any) => void;
}) {
  const { data: templates = [] } = useQuery(getDocumentTemplates);
  const createFromTemplate = useAction(createClientFileFromTemplate);

  const [step, setStep] = useState<'pick' | 'fill'>('pick');
  const [selected, setSelected] = useState<any | null>(null);
  const [fileName, setFileName] = useState('');
  const [dateExpiry, setDateExpiry] = useState('');
  const [paymentLink, setPaymentLink] = useState('');
  const [saving, setSaving] = useState(false);

  const activeTemplates = useMemo(
    () => (templates as any[]).filter((t: any) => t.isActive),
    [templates],
  );

  // Group by type
  const grouped = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const t of activeTemplates) {
      (m[t.type] = m[t.type] ?? []).push(t);
    }
    return m;
  }, [activeTemplates]);

  // Which manual vars does this template use?
  const needsDateExpiry = selected?.content?.includes('{{date_expiry}}');
  const needsPaymentLink = selected?.content?.includes('{{payment.link}}');

  function handlePick(tmpl: any) {
    setSelected(tmpl);
    setFileName(`${tmpl.name} — ${clientName}`);
    setStep('fill');
  }

  async function handleCreate() {
    if (!selected || !fileName.trim()) return;
    setSaving(true);
    try {
      const file = await createFromTemplate({
        clientId,
        templateId: selected.id,
        name: fileName.trim(),
        parentId: currentFolderId ?? null,
        extraVars: {
          date_expiry: dateExpiry.trim() || undefined,
          payment_link: paymentLink.trim() || undefined,
        },
      });
      onCreated(file);
      onClose();
    } catch (err: any) {
      import('react-hot-toast').then(({ default: toast }) =>
        toast.error(err?.message || 'Erreur lors de la création'),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className='bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden' style={{ maxHeight: '85vh' }}>
        {/* Header */}
        <div className='flex items-center justify-between px-5 py-4 border-b border-line'>
          {step === 'fill' ? (
            <button
              onClick={() => setStep('pick')}
              className='flex items-center gap-1.5 text-sm text-muted hover:text-ink'
            >
              ← Retour
            </button>
          ) : (
            <div className='flex items-center gap-2'>
              <LuFileText size={16} className='text-primary' />
              <h2 className='font-semibold text-ink'>Créer depuis un modèle</h2>
            </div>
          )}
          <button onClick={onClose} className='p-1 rounded hover:bg-canvas-200'><LuX size={16} /></button>
        </div>

        {/* Step 1 — pick template */}
        {step === 'pick' && (
          <div className='flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4'>
            {activeTemplates.length === 0 ? (
              <p className='text-sm text-muted text-center py-8'>
                Aucun modèle actif. Créez-en un dans Paramètres → Modèles.
              </p>
            ) : (
              Object.entries(grouped).map(([type, tmpls]) => (
                <div key={type}>
                  <p className='text-xs font-semibold text-muted uppercase tracking-wide mb-2'>
                    {TYPE_LABELS[type] ?? type}
                  </p>
                  <div className='flex flex-col gap-1.5'>
                    {tmpls.map((t: any) => (
                      <button
                        key={t.id}
                        onClick={() => handlePick(t)}
                        className='flex items-center gap-3 px-4 py-3 rounded-xl border border-line bg-canvas-50 hover:bg-canvas-100 hover:border-primary/30 text-left transition-colors group'
                      >
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${TYPE_COLORS[type] ?? 'bg-slate-100 text-slate-600'}`}>
                          {TYPE_LABELS[type] ?? type}
                        </span>
                        <span className='flex-1 text-sm font-medium text-ink'>{t.name}</span>
                        {t.description && (
                          <span className='text-xs text-muted truncate max-w-[120px]'>{t.description}</span>
                        )}
                        <LuChevronRight size={14} className='text-muted shrink-0 group-hover:text-primary' />
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Step 2 — fill variables */}
        {step === 'fill' && selected && (
          <div className='flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5'>
            {/* Selected template badge */}
            <div className='flex items-center gap-2 p-3 rounded-lg bg-canvas-100 border border-line'>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TYPE_COLORS[selected.type] ?? 'bg-slate-100 text-slate-600'}`}>
                {TYPE_LABELS[selected.type] ?? selected.type}
              </span>
              <span className='text-sm font-medium text-ink'>{selected.name}</span>
            </div>

            {/* Auto-filled info */}
            <div className='rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800'>
              <span className='font-semibold'>Pré-rempli automatiquement :</span>{' '}
              date du jour, informations du client ({clientName}), coordonnées de votre entreprise.
            </div>

            {/* File name */}
            <div>
              <label className='label'>Nom du fichier</label>
              <input
                autoFocus
                className='input mt-1 w-full'
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder='Ex. Contrat hébergement — Acme Inc.'
              />
            </div>

            {/* Manual vars — only shown if used in template */}
            {needsDateExpiry && (
              <div>
                <label className='label'>
                  Date d'expiration <span className='text-muted font-normal'>(optionnel)</span>
                </label>
                <input
                  className='input mt-1 w-full'
                  value={dateExpiry}
                  onChange={(e) => setDateExpiry(e.target.value)}
                  placeholder='Ex. 6 juin 2026'
                />
              </div>
            )}

            {needsPaymentLink && (
              <div>
                <label className='label'>
                  Lien de paiement <span className='text-muted font-normal'>(optionnel)</span>
                </label>
                <input
                  className='input mt-1 w-full'
                  type='url'
                  value={paymentLink}
                  onChange={(e) => setPaymentLink(e.target.value)}
                  placeholder='https://billing.stripe.com/...'
                />
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        {step === 'fill' && (
          <div className='px-5 py-4 border-t border-line flex justify-end gap-2 bg-canvas-50'>
            <button className='btn-secondary' onClick={onClose}>Annuler</button>
            <button
              className='btn-primary flex items-center gap-2'
              disabled={!fileName.trim() || saving}
              onClick={handleCreate}
            >
              {saving ? (
                <><span className='animate-spin inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full' /> Création…</>
              ) : (
                <><LuFilePlus size={14} /> Créer le document</>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DriveInfo ────────────────────────────────────────────────────────────────

function DriveInfo() {
  return (
    <div className='mb-4 rounded-lg border border-base-200 bg-base-50 px-3 py-2 flex flex-col gap-1 text-xs text-base-content/60'>
      <div className='flex items-center gap-1.5'>
        <LuFolderOpen className='shrink-0 text-primary' size={13} />
        <span><span className='font-medium text-base-content/80'>Drive client</span> — contrats, briefs, visuels de référence, notes internes. Indépendamment des projets.</span>
      </div>
    </div>
  );
}

// ─── ClientFileManagerTab ─────────────────────────────────────────────────────

export function ClientFileManagerTab({ clientId, clientName }: Props) {
  const { data: rawFiles, refetch, isFetching } = useQuery(getClientFiles, { clientId });
  const createFolder = useAction(createClientFolder);
  const uploadFile = useAction(uploadClientFile);
  const deleteFiles = useAction(deleteClientFiles);
  const renameFile = useAction(renameClientFile);
  const moveFiles = useAction(moveClientFiles);
  const createFile = useAction(createNewClientFile);
  const updateFileContent = useAction(updateClientFileContent);

  const [showFromTemplate, setShowFromTemplate] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);

  return (
    <>
      <DriveInfo />

      {/* Extra action row — "Depuis un modèle" */}
      <div className='mb-3'>
        <button
          className='btn-secondary flex items-center gap-2 text-sm'
          onClick={() => setShowFromTemplate(true)}
        >
          <LuFileText size={15} /> Depuis un modèle
        </button>
      </div>

      <SharedFileManager
        ops={{
          files: rawFiles as any[] | undefined,
          isFetching,
          refetch,
          upload: ({ dataUrl, name, originalName, parentId }) =>
            uploadFile({ clientId, dataUrl, name, originalName, parentId }),
          createFolder: ({ name, parentId }) =>
            createFolder({ clientId, name, parentId }),
          deleteFiles: ({ ids }) =>
            deleteFiles({ clientId, ids }),
          renameFile: ({ id, name }) =>
            renameFile({ id, name }),
          moveFiles: ({ ids, targetParentId }) =>
            moveFiles({ clientId, ids, targetParentId }),
          createNewFile: ({ name, type, parentId }) =>
            createFile({ clientId, name, type, parentId }),
          getEditorContent: (id) => getClientFileEditorContent({ id }),
          saveFileContent: (id, content, contentType) =>
            updateFileContent({ id, content, contentType }),
          instanceId: `client-${clientId}`,
          onFolderChange: setCurrentFolderId,
        }}
      />

      {showFromTemplate && (
        <FromTemplateModal
          clientId={clientId}
          clientName={clientName}
          currentFolderId={currentFolderId}
          onClose={() => setShowFromTemplate(false)}
          onCreated={() => refetch()}
        />
      )}
    </>
  );
}

