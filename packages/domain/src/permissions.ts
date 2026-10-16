/**
 * Permission catalog. Codes are stable identifiers stored in the database; labels are pt-BR.
 * `sensitive` permissions always produce an audit entry when exercised (CLAUDE.md rule 8).
 */
export const PERMISSIONS = {
  'catalog.read': { label: 'Ver produtos e preços', sensitive: false },
  'catalog.write': { label: 'Cadastrar e editar produtos', sensitive: false },
  'catalog.price.write': { label: 'Alterar preços', sensitive: true },
  'parties.read': { label: 'Ver clientes e fornecedores', sensitive: false },
  'parties.write': { label: 'Cadastrar e editar clientes e fornecedores', sensitive: false },
  'parties.credit': { label: 'Definir limite e receber no crediário', sensitive: true },
  'fiscal.profile.write': { label: 'Alterar configuração fiscal', sensitive: true },
  'pos.sell': { label: 'Vender no caixa', sensitive: false },
  'pos.discount.above_limit': { label: 'Dar desconto acima do limite', sensitive: true },
  'pos.sale.cancel': { label: 'Cancelar venda', sensitive: true },
  'pos.cash.withdrawal': { label: 'Fazer sangria', sensitive: true },
  'admin.users': { label: 'Gerenciar usuários e papéis', sensitive: true },
  'admin.terminals': { label: 'Gerenciar caixas (terminais)', sensitive: true },
  'admin.stores': { label: 'Gerenciar empresas e lojas', sensitive: true },
  'admin.integrations': { label: 'Criar chaves de API e webhooks', sensitive: true },
  'audit.read': { label: 'Ver trilha de auditoria', sensitive: false },
  'finance.read': { label: 'Ver contas a pagar e a receber', sensitive: false },
  'finance.write': { label: 'Lançar e dar baixa em contas a pagar e a receber', sensitive: true },
} as const satisfies Record<string, { label: string; sensitive: boolean }>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return value in PERMISSIONS;
}

export type SystemRoleKey = 'owner' | 'manager' | 'cashier' | 'accountant';

export const SYSTEM_ROLES: Record<SystemRoleKey, { name: string; permissions: Permission[] }> = {
  owner: { name: 'Dono', permissions: ALL_PERMISSIONS },
  manager: {
    name: 'Gerente',
    permissions: ALL_PERMISSIONS.filter(
      (p) => p !== 'admin.users' && p !== 'admin.stores' && p !== 'admin.integrations',
    ),
  },
  cashier: {
    name: 'Operador de caixa',
    permissions: ['catalog.read', 'parties.read', 'parties.write', 'pos.sell'],
  },
  accountant: {
    name: 'Contador',
    permissions: ['catalog.read', 'parties.read', 'audit.read', 'finance.read'],
  },
};

export function hasPermission(granted: readonly string[], required: Permission): boolean {
  return granted.includes(required);
}
