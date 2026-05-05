import { useState, useEffect } from 'react';
import { LuX, LuDownload, LuFileText, LuZoomIn, LuZoomOut, LuChevronLeft, LuChevronRight } from 'react-icons/lu';

interface PreviewFile {
  name: string;
  mimeType: string | null;
  url: string | null;
}

interface Props {
  file: PreviewFile | null;
  onClose: () => void;
  onNavigate?: (direction: 'prev' | 'next') => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

function getCategory(mimeType: string | null, name: string): 'image' | 'pdf' | 'text' | 'video' | 'audio' | 'other' {
  if (!mimeType) {
    const ext = name.toLowerCase().split('.').pop() ?? '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
    if (ext === 'pdf') return 'pdf';
    if (['txt', 'md', 'json', 'csv', 'xml', 'yaml', 'yml', 'log'].includes(ext)) return 'text';
    if (['mp4', 'webm', 'ogg', 'mov'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'flac', 'aac'].includes(ext)) return 'audio';
    return 'other';
  }
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('text/') || mimeType === 'application/json') return 'text';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'other';
}

function ImagePreview({ url, name }: { url: string; name: string }) {
  const [zoom, setZoom] = useState(1);
  return (
    <div className='flex flex-col items-center gap-3 h-full'>
      <div className='flex items-center gap-2 mb-1'>
        <button onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} className='p-1.5 rounded hover:bg-canvas-200' title='Réduire'>
          <LuZoomOut size={16} />
        </button>
        <span className='text-xs text-muted w-10 text-center'>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(4, z + 0.25))} className='p-1.5 rounded hover:bg-canvas-200' title='Agrandir'>
          <LuZoomIn size={16} />
        </button>
        <button onClick={() => setZoom(1)} className='text-xs text-muted hover:text-ink px-2'>Réinitialiser</button>
      </div>
      <div className='flex-1 overflow-auto w-full flex items-center justify-center bg-canvas-100 rounded-lg'>
        <img
          src={url}
          alt={name}
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center', transition: 'transform 0.15s' }}
          className='max-w-full max-h-full object-contain'
        />
      </div>
    </div>
  );
}

function PdfPreview({ url }: { url: string }) {
  return (
    <iframe
      src={url}
      className='w-full h-full rounded-lg border border-line'
      title='PDF'
    />
  );
}

function TextPreview({ url, name }: { url: string; name: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(url)
      .then((r) => r.text())
      .then((t) => { setContent(t); setLoading(false); })
      .catch(() => { setContent(null); setLoading(false); });
  }, [url]);

  if (loading) return <div className='flex items-center justify-center h-full text-muted'>Chargement…</div>;
  if (content === null) return <div className='flex items-center justify-center h-full text-muted'>Impossible de charger le fichier.</div>;

  const isJson = name.toLowerCase().endsWith('.json');
  let display = content;
  if (isJson) {
    try { display = JSON.stringify(JSON.parse(content), null, 2); } catch { /* ignore */ }
  }

  return (
    <pre className='w-full h-full overflow-auto rounded-lg bg-canvas-100 p-4 text-sm font-mono text-ink whitespace-pre-wrap break-words'>
      {display}
    </pre>
  );
}

function VideoPreview({ url }: { url: string }) {
  return (
    <video controls className='max-w-full max-h-full rounded-lg' src={url}>
      Votre navigateur ne supporte pas la lecture vidéo.
    </video>
  );
}

function AudioPreview({ url }: { url: string }) {
  return (
    <div className='flex items-center justify-center h-full'>
      <audio controls src={url} className='w-full max-w-md'>
        Votre navigateur ne supporte pas la lecture audio.
      </audio>
    </div>
  );
}

function OtherPreview({ name, url }: { name: string; url: string | null }) {
  const isOffice = /\.(docx?|xlsx?|pptx?)$/i.test(name);
  return (
    <div className='flex flex-col items-center justify-center h-full gap-4 text-muted'>
      <LuFileText size={56} className='text-muted' />
      <p className='text-sm text-center max-w-xs'>
        {isOffice
          ? "Les fichiers Office ne peuvent pas être prévisualisés dans le navigateur. Téléchargez le fichier pour l'ouvrir."
          : 'Prévisualisation non disponible pour ce type de fichier.'}
      </p>
      {url && (
        <button
          onClick={() => downloadFile(url, name)}
          className='btn-primary flex items-center gap-2'
        >
          <LuDownload size={16} /> Télécharger
        </button>
      )}
    </div>
  );
}

async function downloadFile(url: string, filename: string) {
  const res = await fetch(url);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

export function FilePreviewModal({ file, onClose, onNavigate, hasPrev, hasNext }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowLeft' && hasPrev && onNavigate) { e.preventDefault(); onNavigate('prev'); }
      if (e.key === 'ArrowRight' && hasNext && onNavigate) { e.preventDefault(); onNavigate('next'); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, onNavigate, hasPrev, hasNext]);

  if (!file) return null;

  const category = getCategory(file.mimeType, file.name);

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4'
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className='bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-5xl' style={{ height: '90vh' }}>
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
            <button onClick={onClose} className='p-1 rounded hover:bg-canvas-200 transition-colors'>
              <LuX size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className='flex-1 overflow-hidden p-4'>
          {!file.url ? (
            <div className='flex items-center justify-center h-full text-muted'>URL non disponible</div>
          ) : category === 'image' ? (
            <ImagePreview url={file.url} name={file.name} />
          ) : category === 'pdf' ? (
            <PdfPreview url={file.url} />
          ) : category === 'text' ? (
            <TextPreview url={file.url} name={file.name} />
          ) : category === 'video' ? (
            <VideoPreview url={file.url} />
          ) : category === 'audio' ? (
            <AudioPreview url={file.url} />
          ) : (
            <OtherPreview name={file.name} url={file.url} />
          )}
        </div>
      </div>
    </div>
  );
}
