import { Button, cx, Logo } from '@bipae/ui';
import {
  Home,
  LogOut,
  Monitor,
  Package,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  UserRound,
} from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useApp, useMe } from '../context';

const NAV = [
  { to: '/', label: 'Início', icon: Home, permission: null },
  { to: '/produtos', label: 'Produtos', icon: Package, permission: 'catalog.read' },
  { to: '/clientes', label: 'Clientes', icon: UserRound, permission: 'parties.read' },
  { to: '/fornecedores', label: 'Fornecedores', icon: Truck, permission: 'parties.read' },
  { to: '/caixas', label: 'Caixas', icon: Monitor, permission: 'admin.terminals' },
  { to: '/equipe', label: 'Equipe', icon: Users, permission: 'admin.users' },
  { to: '/auditoria', label: 'Auditoria', icon: ShieldCheck, permission: 'audit.read' },
  { to: '/configuracoes', label: 'Configurações', icon: Settings, permission: null },
] as const;

export function Shell() {
  const { api, setMe, platform } = useApp();
  const me = useMe();
  const navigate = useNavigate();
  const items = NAV.filter((n) => !n.permission || me.permissions.includes(n.permission));

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-border bg-surface md:w-64 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between p-4">
          <Logo className="text-xl" />
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">
            {platform.kind === 'desktop' ? 'Desktop' : 'Online'}
          </span>
        </div>
        <nav aria-label="Menu principal" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cx(
                  'flex min-h-11 shrink-0 items-center gap-3 rounded-ui px-3 font-medium',
                  isActive ? 'bg-primary text-primary-contrast' : 'hover:bg-surface-2',
                )
              }
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden border-t border-border p-4 md:block">
          <p className="truncate font-semibold">{me.tenant.name}</p>
          <p className="truncate text-sm text-muted">{me.user.name}</p>
          <Button
            variant="ghost"
            className="mt-2 w-full justify-start"
            icon={<LogOut className="size-5" aria-hidden />}
            onClick={async () => {
              await api.logout();
              setMe(null);
              navigate('/entrar');
            }}
          >
            Sair
          </Button>
        </div>
      </aside>
      <main className="flex-1 p-4 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}

