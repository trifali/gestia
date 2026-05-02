import { useEffect, useState } from 'react';
import { Modal } from '../../client/ui';
import { buildDocumentPdfFilename, getDocumentPdfBase64 } from '../documents/pdf';
import type { DocForPdf, CompanyForPdf, BrandAssets } from '../documents/pdf';

type Props = {
  doc: DocForPdf & { id: string };
  company: CompanyForPdf;
  brand: BrandAssets;
  onClose: () => void;
};

export function PdfPreviewModal({ doc, company, brand, onClose }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let blobUrl: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const b64 = await getDocumentPdfBase64(doc, company, brand);
        if (cancelled) return;
        const bytes = atob(b64);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        const blob = new Blob([arr], { type: 'application/pdf' });
        blobUrl = URL.createObjectURL(blob);
        setUrl(blobUrl);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Erreur lors de la génération du PDF');
      }
    })();
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [doc, company, brand]);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Aperçu — ${buildDocumentPdfFilename(doc)}`}
      footer={
        <button className='btn-secondary' onClick={onClose}>
          Fermer
        </button>
      }
    >
      <div className='h-[70vh] -mx-6 -my-5'>
        {error ? (
          <div className='p-6 text-danger'>{error}</div>
        ) : url ? (
          <iframe
            src={url}
            title='Aperçu du PDF'
            className='w-full h-full border-0'
          />
        ) : (
          <div className='p-6 text-muted'>Génération du PDF…</div>
        )}
      </div>
    </Modal>
  );
}
