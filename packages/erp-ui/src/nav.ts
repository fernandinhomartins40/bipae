import {
  AlertTriangle,
  ArrowLeftRight,
  BadgePercent,
  BarChart3,
  Bike,
  Bot,
  Building2,
  CalendarClock,
  ChefHat,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  Download,
  FileBarChart,
  FileOutput,
  FileX,
  FolderDown,
  HandCoins,
  HandPlatter,
  HeartHandshake,
  Landmark,
  Barcode,
  ShoppingBag,
  ListChecks,
  Monitor,
  Package,
  PackagePlus,
  Percent,
  PieChart,
  QrCode,
  Plug,
  Printer,
  Scale,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Shirt,
  Sparkles,
  Tag,
  Tags,
  TrendingUp,
  Truck,
  UserCheck,
  UserRound,
  Users,
  UtensilsCrossed,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission: string | null;
  /** Palavras que o leigo usa no dia a dia e que não estão no nome da tela. */
  keywords?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

/**
 * Menu da retaguarda agrupado pelo que a pessoa quer fazer, não pela estrutura do sistema.
 * "Início", "Abrir o caixa" e "Ajuda" ficam fora dos grupos, sempre à vista (shell.tsx).
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'vendas',
    label: 'Vendas e atendimento',
    items: [
      {
        to: '/vendas',
        label: 'Vendas',
        icon: BarChart3,
        permission: 'catalog.read',
        keywords: 'cupom histórico cancelar nota do consumidor nfc-e',
      },
      {
        to: '/vendedores',
        label: 'Vendedores',
        icon: UserCheck,
        permission: 'catalog.read',
        keywords: 'equipe de vendas código quem vendeu',
      },
      {
        to: '/comissoes',
        label: 'Comissões',
        icon: HandCoins,
        permission: 'finance.read',
        keywords: 'comissão vendedor percentual quanto ganhou',
      },
      {
        to: '/comandas',
        label: 'Comandas abertas',
        icon: UtensilsCrossed,
        permission: 'pos.sell',
        keywords: 'mesa restaurante bar conta',
      },
      {
        to: '/garcom',
        label: 'Pedidos pelo celular',
        icon: HandPlatter,
        permission: 'pos.order',
        keywords: 'garçom vendedor mesa pedido pré-venda cliente paga no caixa',
      },
      {
        to: '/cozinha',
        label: 'Cozinha',
        icon: ChefHat,
        permission: 'pos.sell',
        keywords: 'pedido preparo restaurante',
      },
      {
        to: '/canais',
        label: 'Pedidos de canais',
        icon: ShoppingBag,
        permission: 'pos.order',
        keywords: 'ifood marketplace pedido online delivery loja virtual',
      },
      {
        to: '/delivery',
        label: 'Delivery',
        icon: Bike,
        permission: 'pos.sell',
        keywords: 'entrega motoboy taxa de entrega',
      },
      {
        to: '/condicional',
        label: 'Condicional',
        icon: Shirt,
        permission: 'pos.sell',
        keywords: 'levar para provar roupa devolver',
      },
      {
        to: '/ordens-de-servico',
        label: 'Ordens de serviço',
        icon: Wrench,
        permission: 'pos.sell',
        keywords: 'os conserto oficina assistência técnica',
      },
      {
        to: '/promocoes',
        label: 'Promoções',
        icon: BadgePercent,
        permission: 'catalog.read',
        keywords: 'desconto oferta leve pague',
      },
    ],
  },
  {
    id: 'estoque',
    label: 'Produtos e estoque',
    items: [
      {
        to: '/produtos',
        label: 'Produtos',
        icon: Package,
        permission: 'catalog.read',
        keywords: 'cadastro mercadoria preço código de barras estoque',
      },
      {
        to: '/servicos',
        label: 'Serviços',
        icon: ClipboardList,
        permission: 'catalog.read',
        keywords: 'cadastro mão de obra nfs-e',
      },
      {
        to: '/tabelas-de-preco',
        label: 'Tabelas de preço',
        icon: Tags,
        permission: 'catalog.read',
        keywords: 'atacado varejo preço especial',
      },
      {
        to: '/etiquetas',
        label: 'Etiquetas',
        icon: Tag,
        permission: 'catalog.read',
        keywords: 'imprimir preço gôndola código de barras',
      },
      {
        to: '/inventario',
        label: 'Inventário',
        icon: ListChecks,
        permission: 'catalog.read',
        keywords: 'contagem balanço estoque',
      },
      {
        to: '/lotes',
        label: 'Lote e validade',
        icon: CalendarClock,
        permission: 'catalog.read',
        keywords: 'vencimento vencido validade',
      },
      {
        to: '/transferencias',
        label: 'Transferências',
        icon: ArrowLeftRight,
        permission: 'catalog.read',
        keywords: 'mandar estoque outra loja filial',
      },
      {
        to: '/prevencao-de-perdas',
        label: 'Prevenção de perdas',
        icon: ShieldAlert,
        permission: 'audit.read',
        keywords: 'furto quebra cancelamento suspeito',
      },
    ],
  },
  {
    id: 'compras',
    label: 'Compras e fornecedores',
    items: [
      {
        to: '/pedidos-de-compra',
        label: 'Pedidos de compra',
        icon: ClipboardList,
        permission: 'catalog.read',
        keywords: 'encomenda cotação repor',
      },
      {
        to: '/compras',
        label: 'Compras',
        icon: PackagePlus,
        permission: 'catalog.read',
        keywords: 'entrada de mercadoria xml chegou',
      },
      {
        to: '/notas-de-entrada',
        label: 'Notas de entrada',
        icon: ClipboardCheck,
        permission: 'catalog.read',
        keywords: 'xml conferir nota do fornecedor',
      },
      {
        to: '/fornecedores',
        label: 'Fornecedores',
        icon: Truck,
        permission: 'parties.read',
        keywords: 'cadastro cnpj distribuidora',
      },
    ],
  },
  {
    id: 'clientes',
    label: 'Clientes e fidelidade',
    items: [
      {
        to: '/clientes',
        label: 'Clientes',
        icon: UserRound,
        permission: 'parties.read',
        keywords: 'cadastro cpf crediário fiado limite',
      },
      {
        to: '/relacionamento',
        label: 'Relacionamento',
        icon: HeartHandshake,
        permission: 'parties.read',
        keywords: 'fidelidade pontos campanha e-mail',
      },
    ],
  },
  {
    id: 'financeiro',
    label: 'Financeiro',
    items: [
      {
        to: '/financeiro',
        label: 'Contas a pagar e receber',
        icon: Wallet,
        permission: 'finance.read',
        keywords: 'boleto despesa conta pagar receber vencimento',
      },
      {
        to: '/boletos',
        label: 'Boletos',
        icon: Barcode,
        permission: 'finance.read',
        keywords: 'boleto cobrança cobrar asaas linha digitável',
      },
      {
        to: '/fluxo-de-caixa',
        label: 'Fluxo de caixa',
        icon: TrendingUp,
        permission: 'finance.read',
        keywords: 'saldo entradas saídas dinheiro',
      },
      {
        to: '/meios-de-pagamento',
        label: 'Meios de pagamento',
        icon: QrCode,
        permission: 'catalog.read',
        keywords: 'pix qr code chave maquininha cartão tef integração',
      },
      {
        to: '/recebiveis',
        label: 'Recebíveis de cartão e Pix',
        icon: CreditCard,
        permission: 'finance.read',
        keywords: 'maquininha taxa cartão crédito débito pix',
      },
      {
        to: '/conciliacao-bancaria',
        label: 'Conciliação bancária',
        icon: Landmark,
        permission: 'finance.read',
        keywords: 'extrato banco ofx',
      },
      {
        to: '/inadimplencia',
        label: 'Inadimplência',
        icon: AlertTriangle,
        permission: 'finance.read',
        keywords: 'fiado crediário devedor atraso cobrança',
      },
      {
        to: '/relatorios',
        label: 'Relatórios',
        icon: PieChart,
        permission: 'finance.read',
        keywords: 'mais vendidos curva abc margem lucro operador',
      },
      {
        to: '/dre',
        label: 'DRE gerencial',
        icon: FileBarChart,
        permission: 'finance.read',
        keywords: 'lucro resultado do mês',
      },
      {
        to: '/assistente',
        label: 'Assistente',
        icon: Bot,
        permission: 'finance.read',
        keywords: 'perguntar dúvida',
      },
    ],
  },
  {
    id: 'fiscal',
    label: 'Notas e impostos',
    items: [
      {
        to: '/nfe',
        label: 'NF-e',
        icon: FileOutput,
        permission: 'catalog.read',
        keywords: 'nota fiscal emitir danfe',
      },
      {
        to: '/inutilizacao',
        label: 'Inutilização de números',
        icon: FileX,
        permission: 'catalog.read',
        keywords: 'numeração pulada nota fiscal',
      },
      {
        to: '/perfis-fiscais',
        label: 'Perfis fiscais',
        icon: Landmark,
        permission: 'catalog.read',
        keywords: 'imposto tributação ncm cfop cst',
      },
      {
        to: '/regras-icms',
        label: 'Regras de ICMS',
        icon: Percent,
        permission: 'catalog.read',
        keywords: 'imposto alíquota estado',
      },
      {
        to: '/apuracao-ibs-cbs',
        label: 'Apuração de IBS e CBS',
        icon: Scale,
        permission: 'finance.read',
        keywords: 'reforma tributária imposto',
      },
      {
        to: '/contador',
        label: 'Arquivos para o contador',
        icon: FolderDown,
        permission: 'finance.read',
        keywords: 'xml sped exportar contabilidade',
      },
    ],
  },
  {
    id: 'empresa',
    label: 'Minha empresa',
    items: [
      {
        to: '/empresas',
        label: 'Empresas e lojas',
        icon: Building2,
        permission: 'admin.terminals',
        keywords: 'cnpj endereço filial certificado digital',
      },
      {
        to: '/caixas',
        label: 'Caixas',
        icon: Monitor,
        permission: 'admin.terminals',
        keywords: 'pdv terminal computador',
      },
      {
        to: '/equipe',
        label: 'Equipe',
        icon: Users,
        permission: 'admin.users',
        keywords: 'usuário funcionário operador permissão convite senha',
      },
      {
        to: '/perifericos',
        label: 'Periféricos',
        icon: Printer,
        permission: 'pos.sell',
        keywords: 'impressora balança gaveta leitor conector',
      },
      {
        to: '/configuracoes',
        label: 'Configurações',
        icon: Settings,
        permission: null,
        keywords: 'tema escuro fonte som aparência',
      },
      {
        to: '/assinatura',
        label: 'Minha assinatura',
        icon: CreditCard,
        permission: 'admin.users',
        keywords: 'plano pagamento mensalidade exportar dados cancelar conta',
      },
      {
        to: '/auditoria',
        label: 'Auditoria',
        icon: ShieldCheck,
        permission: 'audit.read',
        keywords: 'histórico quem fez registro',
      },
      {
        to: '/integracoes',
        label: 'Integrações (API)',
        icon: Plug,
        permission: 'admin.integrations',
        keywords: 'chave webhook sistema',
      },
      {
        to: '/mercadoflow',
        label: 'MercadoFlow',
        icon: Sparkles,
        permission: 'admin.stores',
        keywords: 'tino sugestões',
      },
      {
        to: '/baixar',
        label: 'Baixar o desktop',
        icon: Download,
        permission: null,
        keywords: 'instalar programa windows linux',
      },
    ],
  },
];

/** Minúsculas e sem acento: "Promoções" e "promocoes" são a mesma busca. */
export const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Itens que a pessoa pode ver, nos grupos que sobraram com algum item. */
export function visibleGroups(
  permissions: readonly string[],
  hide: (item: NavItem) => boolean = () => false,
): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => (!item.permission || permissions.includes(item.permission)) && !hide(item),
    ),
  })).filter((group) => group.items.length > 0);
}

/** Cada palavra digitada precisa aparecer no nome, no grupo ou nas palavras do dia a dia. */
export function searchNav(groups: NavGroup[], query: string): { group: NavGroup; item: NavItem }[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return groups.flatMap((group) =>
    group.items
      .filter((item) => {
        const text = normalize(`${item.label} ${group.label} ${item.keywords ?? ''}`);
        return words.every((w) => text.includes(w));
      })
      .map((item) => ({ group, item })),
  );
}

/** Grupo da tela aberta, para o menu já abrir no lugar certo. */
export function groupOf(pathname: string): string | null {
  for (const group of NAV_GROUPS) {
    if (group.items.some((i) => pathname === i.to || pathname.startsWith(`${i.to}/`))) {
      return group.id;
    }
  }
  return null;
}
