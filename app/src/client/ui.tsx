import { type ReactNode, useState } from 'react';

// ─── Confirmation dialog ───────────────────────────────────────────────────

type ConfirmState = { message: string; confirmLabel?: string; resolve: (v: boolean) => void };

function ConfirmDialog({ state, onAnswer }: { state: ConfirmState; onAnswer: (v: boolean) => void }) {
  return (
    <div className='modal-backdrop' onClick={() => onAnswer(false)}>
      <div
        className='bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6'
        onClick={(e) => e.stopPropagation()}
      >
        <div className='flex items-start gap-4 mb-5'>
          <div className='shrink-0 w-10 h-10 rounded-full bg-red-50 flex items-center justify-center'>
            <svg className='w-5 h-5 text-danger' fill='none' viewBox='0 0 24 24' stroke='currentColor' strokeWidth='2'>
              <path strokeLinecap='round' strokeLinejoin='round' d='M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'/>
            </svg>
          </div>
          <p className='text-ink text-sm leading-relaxed pt-1'>{state.message}</p>
        </div>
        <div className='flex justify-end gap-2'>
          <button className='btn-secondary' onClick={() => onAnswer(false)}>Annuler</button>
          <button className='btn-danger' onClick={() => onAnswer(true)}>
            {state.confirmLabel ?? 'Supprimer'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);

  const ask = (message: string, confirmLabel?: string): Promise<boolean> =>
    new Promise((resolve) => setState({ message, confirmLabel, resolve }));

  const handle = (answer: boolean) => {
    state?.resolve(answer);
    setState(null);
  };

  const Dialog = state ? <ConfirmDialog state={state} onAnswer={handle} /> : null;
  return { ask, Dialog };
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6'>
      <div>
        <h1 className='page-title'>{title}</h1>
        {subtitle && <p className='page-subtitle'>{subtitle}</p>}
      </div>
      {actions && <div className='flex items-center gap-2 shrink-0'>{actions}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className='card p-10 text-center'>
      {icon && <div className='mx-auto mb-4 w-12 h-12 rounded-xl bg-canvas-200 flex items-center justify-center text-muted'>{icon}</div>}
      <h3 className='font-semibold text-ink'>{title}</h3>
      {description && <p className='text-sm text-muted mt-1 max-w-md mx-auto'>{description}</p>}
      {action && <div className='mt-5 flex justify-center'>{action}</div>}
    </div>
  );
}

export function StatusBadge({ status, map }: { status: string; map: Record<string, { label: string; className: string }> }) {
  const item = map[status] || { label: status, className: 'badge-neutral' };
  return <span className={item.className}>{item.label}</span>;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className='modal-backdrop' onClick={onClose}>
      <div className='modal-panel' onClick={(e) => e.stopPropagation()}>
        <div className='px-6 py-4 border-b border-line flex items-center justify-between'>
          <h2 className='font-semibold text-lg'>{title}</h2>
          <button onClick={onClose} className='text-muted hover:text-ink' aria-label='Fermer'>
            <svg className='w-5 h-5' fill='none' viewBox='0 0 24 24' stroke='currentColor' strokeWidth='2'>
              <path strokeLinecap='round' strokeLinejoin='round' d='M6 6l12 12M6 18L18 6' />
            </svg>
          </button>
        </div>
        <div className='px-6 py-5'>{children}</div>
        {footer && <div className='px-6 py-4 border-t border-line flex justify-end gap-2 bg-canvas-100'>{footer}</div>}
      </div>
    </div>
  );
}
