// Zone de rédaction de la messagerie. Volontairement ignorante : elle ne sait
// rien des identifiants ni des destinataires, seulement écrire et remonter le
// texte. La fiche prospect garde sa propre zone (modèles, génération IA) —
// unifier les deux ferait descendre la prospection dans le shell.

import { useEffect, useRef, type FormEvent } from 'react';
import { LuLoader, LuSend } from 'react-icons/lu';
import { MagicTextarea } from '../magic';
import { smsSegments } from './smsText';

export function SmsComposer({
  value,
  onChange,
  onSend,
  sending,
  canSend,
  reason,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  onSend: () => void;
  sending: boolean;
  canSend: boolean;
  reason?: string | null;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const counts = smsSegments(value);

  // Auto-grandissement plafonné : une réponse courte ne doit pas manger la
  // conversation, une longue ne doit pas défiler dans deux lignes.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (sending || !canSend || !value.trim()) return;
    onSend();
  }

  return (
    <form onSubmit={submit} className='shrink-0 border-t border-line p-2.5 bg-white'>
      {!canSend && reason && (
        <div className='text-xs bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-amber-700 mb-2'>
          {reason}
        </div>
      )}
      <div className='flex gap-2 items-end'>
        <MagicTextarea
          ref={ref}
          containerClassName='flex-1 min-w-0'
          className='input resize-none text-sm min-h-[38px] max-h-[120px] py-2'
          rows={1}
          placeholder='Votre message…'
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(e as unknown as FormEvent);
            }
          }}
          disabled={sending || !canSend}
        />
        <button
          type='submit'
          className='btn-primary self-end shrink-0 px-3'
          disabled={sending || !canSend || !value.trim()}
          title={!canSend ? (reason ?? '') : 'Envoyer (Entrée)'}
          aria-label='Envoyer'
        >
          {sending ? <LuLoader size={14} className='animate-spin' /> : <LuSend size={14} />}
        </button>
      </div>
      <div className='text-[11px] text-muted mt-1 flex items-center gap-1.5 min-h-[14px]'>
        {value.length > 0 && (
          <span>{counts.chars} caractère(s) · {counts.segments} SMS</span>
        )}
        {counts.unicode && (
          <span className='text-amber-600'>caractères spéciaux — limite 70 par SMS</span>
        )}
      </div>
    </form>
  );
}
