import type { Page, Product } from '@bipae/domain';
import { explainCapability, type CapabilityName, type CapabilityStatus } from '@bipae/platform';
import { Badge, Card, PageHeader } from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle } from 'lucide-react';
import { Link } from 'react-router';
import { useApp, useMe } from '../context';

const CAPABILITY_LABELS: Record<CapabilityName, string> = {
  storage: 'Banco local (vender sem internet)',
  printer: 'Impressora',
  cashDrawer: 'Gaveta de dinheiro',
  scale: 'Balança',
  tef: 'TEF / pinpad',
  certificateA1: 'Certificado A1',
  certificateA3: 'Certificado A3',
  updater: 'Atualização automática',
  notifications: 'Notificações',
};

const VIA_LABEL = {
  native: 'direto',
  browser: 'pelo navegador',
  connector: 'pelo Bipaê Conector',
  server: 'pela nuvem',
};

export function HomePage() {
  const { api, platform } = useApp();
  const me = useMe();
  const products = useQuery({
    queryKey: ['products', 'count'],
    queryFn: () => api.get<Page<Product>>('/products?limit=1'),
    enabled: me.permissions.includes('catalog.read'),
  });
  const capabilities = useQuery({
    queryKey: ['capabilities'],
    queryFn: () => platform.capabilities(),
  });

  const firstName = me.user.name.split(' ')[0];
  const hasProducts = (products.data?.total ?? 0) > 0;
  const steps = [
    { done: true, label: 'Criar sua conta', to: null },
    { done: hasProducts, label: 'Cadastrar seus primeiros produtos', to: '/produtos' },
    { done: false, label: 'Fazer uma venda de teste (chega na Fase 2)', to: null },
  ];

  return (
    <>
      <PageHeader title={`Olá, ${firstName}!`} description={`Você está em ${me.tenant.name}.`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-lg font-bold">Primeiros passos</h2>
          <ol className="flex flex-col gap-3">
            {steps.map((step) => (
              <li key={step.label} className="flex items-center gap-3">
                {step.done ? (
                  <CheckCircle2 className="size-6 text-success" aria-label="Feito" />
                ) : (
                  <Circle className="size-6 text-muted" aria-label="A fazer" />
                )}
                {step.to && !step.done ? (
                  <Link to={step.to} className="font-medium text-primary underline">
                    {step.label}
                  </Link>
                ) : (
                  <span className={step.done ? 'text-muted line-through' : ''}>{step.label}</span>
                )}
              </li>
            ))}
          </ol>
        </Card>

        <Card>
          <h2 className="text-lg font-bold">
            O que funciona {platform.kind === 'desktop' ? 'neste computador' : 'neste navegador'}
          </h2>
          <p className="mb-4 text-sm text-muted">
            Bipaê {platform.kind === 'desktop' ? 'Desktop' : 'Online'} · versão {platform.version}
          </p>
          <ul className="flex flex-col gap-3">
            {capabilities.data &&
              (Object.entries(capabilities.data) as [CapabilityName, CapabilityStatus][]).map(
                ([name, status]) => {
                  const explanation = explainCapability(name, status, platform.kind);
                  return (
                    <li key={name} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{CAPABILITY_LABELS[name]}</span>
                        {status.available ? (
                          <Badge tone="success">Disponível {VIA_LABEL[status.via]}</Badge>
                        ) : (
                          <Badge tone="warning">{explanation?.title ?? 'Indisponível'}</Badge>
                        )}
                      </div>
                      {explanation && <p className="text-sm text-muted">{explanation.message}</p>}
                    </li>
                  );
                },
              )}
          </ul>
        </Card>
      </div>
    </>
  );
}
