import { LuMessageSquare } from 'react-icons/lu';
import { formatRelativeShort } from '../format';
import { formatPhoneDisplay, initialsFor } from './phone';
import type { SmsConversationItem } from './types';

export function SmsConversationList({
  conversations,
  loading,
  onOpen,
  onNew,
}: {
  conversations: SmsConversationItem[];
  loading: boolean;
  onOpen: (identifier: string) => void;
  onNew: () => void;
}) {
  if (loading) {
    return (
      <div className='flex-1 min-h-0 overflow-hidden px-3 py-3 space-y-2'>
        {[0, 1, 2].map(i => (
          <div key={i} className='h-9 rounded-lg bg-canvas-200 animate-pulse' />
        ))}
      </div>
    );
  }

  if (!conversations.length) {
    return (
      <div className='flex-1 flex flex-col items-center justify-center gap-2 px-6 py-10 text-center'>
        <div className='w-12 h-12 rounded-xl bg-canvas-200 flex items-center justify-center text-muted'>
          <LuMessageSquare size={20} />
        </div>
        <p className='text-sm font-semibold text-ink'>Aucune conversation</p>
        <p className='text-xs text-muted max-w-[240px]'>
          Les réponses de vos prospects et les messages reçus à votre numéro Telnyx apparaîtront ici.
        </p>
        <button className='btn-secondary text-xs px-3 py-1.5 mt-2' onClick={onNew}>
          Nouveau message
        </button>
      </div>
    );
  }

  return (
    <ul className='flex-1 min-h-0 overflow-y-auto overscroll-contain'>
      {conversations.map(c => {
        const title = c.displayName || formatPhoneDisplay(c.phone) || c.address;
        return (
          <li key={c.identifier}>
            <button
              type='button'
              onClick={() => onOpen(c.identifier)}
              className='w-full text-left px-3 py-2.5 flex items-start gap-3 border-b border-line/60 hover:bg-canvas-100 transition-colors focus:outline-none focus-visible:bg-canvas-100'
            >
              <span className='shrink-0 w-9 h-9 rounded-full bg-accent-50 text-accent-700 flex items-center justify-center font-semibold text-xs'>
                {initialsFor(c.displayName ?? c.address)}
              </span>
              <span className='min-w-0 flex-1'>
                <span className='flex items-baseline gap-2'>
                  <span className='text-sm font-medium text-ink truncate flex-1'>{title}</span>
                  <span className='text-[11px] text-muted shrink-0'>
                    {formatRelativeShort(c.lastMessageAt)}
                  </span>
                </span>
                <span className='flex items-center gap-2 mt-0.5'>
                  <span
                    className={`text-xs truncate flex-1 ${
                      c.unreadCount > 0 ? 'text-ink font-medium' : 'text-muted'
                    }`}
                  >
                    {c.lastDirection === 'outbound' && (
                      <span className='text-muted font-normal'>Vous : </span>
                    )}
                    {c.lastBody || '(message vide)'}
                  </span>
                  {c.unreadCount > 0 && (
                    <span className='shrink-0 min-w-[18px] h-[18px] rounded-full bg-accent-500 text-white text-[10px] font-bold flex items-center justify-center px-1 leading-none'>
                      {c.unreadCount > 9 ? '9+' : c.unreadCount}
                    </span>
                  )}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
