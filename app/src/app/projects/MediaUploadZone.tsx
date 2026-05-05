import { useRef } from 'react';
import { LuUpload } from 'react-icons/lu';

interface MediaUploadZoneProps {
  onFiles: (files: FileList) => void;
  uploading: boolean;
  /** File input accept attribute. Defaults to images + common document types. */
  accept?: string;
  /** Primary label. Defaults to "Déposer ou cliquer pour téléverser". */
  title?: string;
  /** Label shown while uploading. Defaults to "Traitement en cours…". */
  busyLabel?: string;
  /** Whether to show the JPEG auto-conversion note. Defaults to true. */
  showJpegNote?: boolean;
}

export function MediaUploadZone({
  onFiles,
  uploading,
  accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.txt',
  title = 'Déposer ou cliquer pour téléverser',
  busyLabel = 'Traitement en cours…',
  showJpegNote = true,
}: MediaUploadZoneProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
  };

  return (
    <div
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
      onClick={() => fileRef.current?.click()}
      className='border-2 border-dashed border-line hover:border-accent cursor-pointer rounded-xl p-8 text-center transition-colors'
    >
      <LuUpload size={28} className='mx-auto mb-2 text-muted' />
      <p className='text-sm font-medium text-ink'>{title}</p>
      <p className='text-xs text-muted mt-1'>Images (PNG, JPG, WEBP…) et PDF — max 20 Mo par fichier</p>
      {showJpegNote && (
        <p className='text-xs text-muted'>Les images sont automatiquement converties et compressées en JPEG</p>
      )}
      {uploading && <p className='text-sm text-accent mt-2 font-medium'>{busyLabel}</p>}
      <input
        ref={fileRef}
        type='file'
        multiple
        accept={accept}
        className='hidden'
        onChange={(e) => e.target.files && onFiles(e.target.files)}
      />
    </div>
  );
}
