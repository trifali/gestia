import { Link, NavLink, useNavigate, useLocation, Navigate } from 'react-router';
import { logout } from 'wasp/client/auth';
import { useQuery, getCurrentCompany } from 'wasp/client/operations';
import { useState, type ReactNode } from 'react';
import {
  LuLayoutDashboard, LuUsers, LuFolder, LuFileText,
  LuCreditCard, LuCalendar, LuSearch, LuSettings, LuMenu, LuX, LuShield
} from 'react-icons/lu';
import Logo from './Logo';

type AppLayoutProps = {
  user: any;
  children: ReactNode;
};

const NAV = [
  { to: '/tableau-de-bord', label: 'Tableau de bord', icon: LuLayoutDashboard },
  { to: '/clients', label: 'Clients', icon: LuUsers },
  { to: '/projets', label: 'Projets', icon: LuFolder },
  { to: '/facturation', label: 'Facturation', icon: LuFileText },
  { to: '/paiements', label: 'Paiements', icon: LuCreditCard },
  { to: '/rencontres', label: 'Rencontres', icon: LuCalendar },
  { to: '/prospection', label: 'Prospection', icon: LuSearch },
];

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

  const isAdmin = user?.role === 'admin' || user?.isAdmin;
  const initials = (user?.email || 'U').slice(0, 2).toUpperCase();

  const Sidebar = (
    <aside className='w-64 shrink-0 bg-white border-r border-line flex flex-col h-screen sticky top-0'>
      <div className='px-5 py-5 border-b border-line'>
        <Link to='/tableau-de-bord' className='flex items-center gap-2'>
          <Logo height={28} />
          <div className='text-[11px] text-muted mt-0.5'>{company?.name || 'Configurez votre entreprise'}</div>
        </Link>
      </div>

      <nav className='flex-1 px-3 py-4 overflow-y-auto'>
        <div className='space-y-1'>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`
              }
              onClick={() => setMobileOpen(false)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>

        {(user?.role === 'admin' || user?.isAdmin) && (
          <div className='mt-4 pt-4 border-t border-line'>
            <p className='px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted'>Administration</p>
            <NavLink
              to='/admin/utilisateurs'
              className={({ isActive }) =>
                `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`
              }
              onClick={() => setMobileOpen(false)}
            >
              <LuShield size={18} />
              <span>Utilisateurs</span>
            </NavLink>
          </div>
        )}
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
          <LuSettings size={16} className='text-muted shrink-0' />
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
            <LuMenu size={20} />
          </button>
          <Logo height={24} />
          <span className='w-9' />
        </header>

        <main className='flex-1 px-4 sm:px-6 lg:px-10 py-6 lg:py-8 max-w-[1400px] w-full mx-auto'>
          {children}
        </main>
      </div>
    </div>
  );
}
