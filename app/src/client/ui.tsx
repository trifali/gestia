import { type ReactNode } from 'react';

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
    <div className='flex items-start justify-between gap-4 mb-6'>
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
