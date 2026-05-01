import { Link } from 'react-router';
import { type ReactNode } from 'react';

export function AuthPageLayout({ children, title, subtitle }: { children: ReactNode; title: string; subtitle?: string }) {
  return (
    <div className='min-h-screen flex'>
      <div className='hidden lg:flex flex-col justify-between w-1/2 bg-ink text-white p-10'>
        <Link to='/' className='flex items-center gap-2'>
          <span className='inline-flex w-9 h-9 rounded-lg bg-accent items-center justify-center font-bold'>G</span>
          <span className='font-semibold text-lg'>Gestia</span>
        </Link>
        <div>
          <h2 className='text-3xl lg:text-4xl font-semibold leading-tight'>
            La gestion de votre entreprise,<br />
            <span className='text-accent'>en français.</span>
          </h2>
          <p className='mt-4 text-white/70 max-w-md'>
            Gérez vos clients, projets, soumissions, factures et paiements depuis une seule plateforme — pensée pour le Québec.
          </p>
        </div>
        <div className='text-xs text-white/50'>© Gestia · Fait au Québec</div>
      </div>

      <div className='flex-1 flex items-center justify-center px-6 py-12 bg-canvas'>
        <div className='w-full max-w-md'>
          <Link to='/' className='lg:hidden flex items-center gap-2 mb-8'>
            <span className='inline-flex w-8 h-8 rounded-lg bg-ink text-white items-center justify-center font-bold'>G</span>
            <span className='font-semibold'>Gestia</span>
          </Link>

          <h1 className='text-2xl font-semibold text-ink'>{title}</h1>
          {subtitle && <p className='text-sm text-muted mt-1'>{subtitle}</p>}

          <div className='mt-6 card p-6 [&_form]:space-y-4 [&_label]:block [&_label]:text-sm [&_label]:font-medium [&_label]:text-ink [&_label]:mb-1.5 [&_input]:input [&_button[type="submit"]]:btn-primary [&_button[type="submit"]]:w-full'>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
