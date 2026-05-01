import { Link, NavLink, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { logout } from 'wasp/client/auth';
import { useQuery, getCurrentCompany } from 'wasp/client/operations';
import { useState, type ReactNode } from 'react';

type AppLayoutProps = {
  user: any;
  children: ReactNode;
};

const NAV = [
  { to: '/tableau-de-bord', label: 'Tableau de bord', icon: 'home' },
  { to: '/clients', label: 'Clients', icon: 'users' },
  { to: '/projets', label: 'Projets', icon: 'folder' },
  { to: '/soumissions', label: 'Soumissions', icon: 'file' },
  { to: '/factures', label: 'Factures', icon: 'invoice' },
  { to: '/paiements', label: 'Paiements', icon: 'card' },
  { to: '/rencontres', label: 'Rencontres', icon: 'calendar' },
  { to: '/automatisations', label: 'Automatisations', icon: 'bolt' },
];

function Icon({ name, className = 'w-5 h-5' }: { name: string; className?: string }) {
  const common = { className, fill: 'none', viewBox: '0 0 24 24', strokeWidth: 1.7, stroke: 'currentColor' } as const;
  switch (name) {
    case 'home':
      return (<svg {...common}><path strokeLinecap='round' strokeLinejoin='round' d='M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-8.5Z'/></svg>);
    case 'users':
      return (<svg {...common}><path strokeLinecap='round' strokeLinejoin='round' d='M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M21 19v-1a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z'/></svg>);
    case 'folder':
      return (<svg {...common}><path strokeLinecap='round' strokeLinejoin='round' d='M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z'/></svg>);
    case 'file':
      return (<svg {...common}><path strokeLinecap='round' strokeLinejoin='round' d='M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z M14 3v6h6 M9 13h6 M9 17h6'/></svg>);
    case 'invoice':
      return (<svg {...common}><path strokeLinecap='round' strokeLinejoin='round' d='M6 3h12v18l-3-2-3 2-3-2-3 2V3Z M9 8h6 M9 12h6 M9 16h4'/></svg>);
    case 'card':
      return (<svg {...common}><path strokeLinecap='round' strokeLinejoin='round' d='M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z M3 11h18'/></svg>);
    case 'calendar':
      return (<svg {...common}><path strokeLinecap='round' strokeLinejoin='round' d='M8 3v3 M16 3v3 M3 9h18 M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z'/></svg>);
    case 'bolt':
      return (<svg {...common}><path strokeLinecap='round' strokeLinejoin='round' d='M13 3 4 14h7l-1 7 9-11h-7l1-7Z'/></svg>);
    case 'cog':
      return (<svg {...common}><path strokeLinecap='round' strokeLinejoin='round' d='M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z'/></svg>);
    default:
      return null;
  }
}

export default function AppLayout({ user, children }: AppLayoutProps) {
  const { data: company, isLoading: companyLoading } = useQuery(getCurrentCompany);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Tant que l'utilisateur n'a pas créé d'entreprise, on le force sur le tableau
  // de bord où s'affiche le formulaire d'intégration. Évite ainsi les 403 sur
  // toutes les autres pages dont les requêtes nécessitent un companyId.
  if (!companyLoading && !company && location.pathname !== '/tableau-de-bord') {
    return <Navigate to='/tableau-de-bord' replace />;
  }

  const initials = (user?.email || 'U').slice(0, 2).toUpperCase();

  const Sidebar = (
    <aside className='w-64 shrink-0 bg-white border-r border-line flex flex-col h-screen sticky top-0'>
      <div className='px-5 py-5 border-b border-line'>
        <Link to='/tableau-de-bord' className='flex items-center gap-2'>
          <span className='inline-flex w-8 h-8 rounded-lg bg-ink items-center justify-center text-white font-bold'>G</span>
          <div>
            <div className='font-semibold text-ink leading-none'>Gestia</div>
            <div className='text-[11px] text-muted mt-0.5'>{company?.name || 'Configurez votre entreprise'}</div>
          </div>
        </Link>
      </div>

      <nav className='flex-1 px-3 py-4 space-y-1 overflow-y-auto'>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`
            }
            onClick={() => setMobileOpen(false)}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className='border-t border-line p-3'>
        <Link
          to='/parametres'
          onClick={() => setMobileOpen(false)}
          className='flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-canvas transition-colors'
        >
          <div className='w-9 h-9 rounded-full bg-accent-50 text-accent-700 flex items-center justify-center font-semibold text-sm'>
            {initials}
          </div>
          <div className='flex-1 min-w-0'>
            <div className='text-sm font-medium text-ink truncate'>{user?.email || 'Utilisateur'}</div>
            <div className='text-xs text-muted'>{(user as any)?.role === 'admin' ? 'Administrateur' : 'Client'}</div>
          </div>
          <Icon name='cog' className='w-4 h-4 text-muted shrink-0' />
        </Link>
        <button
          onClick={async () => { await logout(); navigate('/connexion'); }}
          className='btn-ghost w-full justify-start mt-1 text-sm'
        >
          Se déconnecter
        </button>
      </div>
    </aside>
  );

  return (
    <div className='min-h-screen flex bg-canvas'>
      <div className='hidden lg:block'>{Sidebar}</div>

      {mobileOpen && (
        <div className='fixed inset-0 z-50 lg:hidden'>
          <div className='absolute inset-0 bg-ink/40' onClick={() => setMobileOpen(false)} />
          <div className='absolute left-0 top-0 bottom-0'>{Sidebar}</div>
        </div>
      )}

      <div className='flex-1 min-w-0 flex flex-col'>
        <header className='lg:hidden sticky top-0 z-30 bg-white border-b border-line px-4 py-3 flex items-center justify-between'>
          <button onClick={() => setMobileOpen(true)} className='btn-ghost'>
            <svg className='w-5 h-5' fill='none' viewBox='0 0 24 24' stroke='currentColor' strokeWidth='2'>
              <path strokeLinecap='round' strokeLinejoin='round' d='M4 6h16M4 12h16M4 18h16' />
            </svg>
          </button>
          <span className='font-semibold'>Gestia</span>
          <span className='w-9' />
        </header>

        <main className='flex-1 px-4 sm:px-6 lg:px-10 py-6 lg:py-8 max-w-[1400px] w-full mx-auto'>
          {children}
        </main>
      </div>
    </div>
  );
}
