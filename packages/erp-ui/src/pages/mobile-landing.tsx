import { Card, PageHeader } from '@bipae/ui';
import { HandPlatter, ScanBarcode } from 'lucide-react';
import { Link, Navigate } from 'react-router';
import { useApp, useMe } from '../context';
import { mobileLanding } from '../nav';
import { HomePage } from './home';

/** Quem já passou pela abertura do app nesta sessão (não volta ao caixa toda vez que pisa no início). */
const landed = new Set<string>();

/** Só para os testes. */
export function resetMobileLanding() {
  landed.clear();
}

/**
 * Abertura do app Android (ADR-0017): um app só, que abre em Caixa ou Vendas conforme a
 * permissão. No computador e no navegador nada muda: é a tela inicial de sempre.
 */
export function IndexPage() {
  const { platform } = useApp();
  const me = useMe();
  const where = platform.mobile ? mobileLanding(me.permissions) : 'inicio';
  if (where === 'inicio') return <HomePage />;
  if (where === 'escolher') return <MobileChooser />;
  if (landed.has(me.user.id)) return <HomePage />;
  landed.add(me.user.id);
  return <Navigate to={where === 'caixa' ? '/caixa' : '/garcom'} replace />;
}

/** Quem tem as duas permissões escolhe o que vai fazer agora. */
export function MobileChooser() {
  const me = useMe();
  return (
    <>
      <PageHeader
        title={`Olá, ${me.user.name.split(' ')[0]}!`}
        description="O que vamos fazer agora?"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Link to="/caixa" className="block">
          <Card className="flex min-h-32 items-center gap-4 bg-tile-green">
            <ScanBarcode className="size-10" aria-hidden />
            <span>
              <span className="block text-xl font-bold">Caixa</span>
              <span className="text-sm text-muted">Bipe, receba e pronto.</span>
            </span>
          </Card>
        </Link>
        <Link to="/garcom" className="block">
          <Card className="flex min-h-32 items-center gap-4 bg-tile-orange">
            <HandPlatter className="size-10" aria-hidden />
            <span>
              <span className="block text-xl font-bold">Vendas</span>
              <span className="text-sm text-muted">Pedido de vendedor, mesa ou comanda.</span>
            </span>
          </Card>
        </Link>
      </div>
      <p className="mt-6 text-sm text-muted">
        <Link to="/inicio" className="underline">
          Ver a tela inicial completa
        </Link>
      </p>
    </>
  );
}
