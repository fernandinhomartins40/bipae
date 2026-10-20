/**
 * Central de ajuda (F7-04): artigos curtos, em passos, com os nomes exatos dos botões e das
 * telas. Ficam dentro do aplicativo, então funcionam sem internet. Ao mudar uma tela, atualize
 * o artigo dela aqui.
 */
export type HelpBlock =
  | { kind: 'p'; text: string }
  | { kind: 'steps'; items: string[] }
  | { kind: 'tip'; text: string }
  | { kind: 'warning'; text: string };

export interface HelpArticle {
  slug: string;
  title: string;
  category:
    | 'Começar'
    | 'Caixa'
    | 'Produtos e estoque'
    | 'Clientes'
    | 'Fiscal'
    | 'Financeiro'
    | 'Integrações';
  summary: string;
  /** Palavras que as pessoas usam para procurar (além das do título). */
  keywords: string[];
  body: HelpBlock[];
  /** Tela do Bipaê onde se faz o que o artigo explica. */
  screen?: { label: string; to: string };
}

export const HELP_CATEGORIES: HelpArticle['category'][] = [
  'Começar',
  'Caixa',
  'Produtos e estoque',
  'Clientes',
  'Fiscal',
  'Financeiro',
  'Integrações',
];

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: 'primeiros-passos',
    title: 'Primeiros passos no Bipaê',
    category: 'Começar',
    summary: 'O que configurar antes da primeira venda.',
    keywords: ['começar', 'configurar', 'cadastro inicial', 'empresa'],
    screen: { label: 'Empresas e lojas', to: '/empresas' },
    body: [
      {
        kind: 'p',
        text: 'Em poucos minutos o caixa já vende. Para a nota fiscal sair, a empresa precisa dos dados fiscais.',
      },
      {
        kind: 'steps',
        items: [
          'Em "Empresas e lojas", confira a razão social, o CNPJ, a UF e o "Regime tributário" (Simples, MEI, Presumido ou Real). Na dúvida sobre o regime, veja no cartão do CNPJ ou com quem cuida dos seus impostos.',
          'Preencha a "Inscrição estadual" e o endereço em "Dados para a nota fiscal (NFC-e)".',
          'Envie o certificado digital A1 da empresa na mesma tela.',
          'Cadastre os produtos em "Produtos", um a um ou pelo XML das notas de compra.',
          'Abra o caixa em "Abrir o caixa".',
        ],
      },
      {
        kind: 'tip',
        text: 'Sem os dados fiscais o caixa vende do mesmo jeito; a nota aparece como "falta configurar" e sai quando a empresa estiver pronta.',
      },
    ],
  },
  {
    slug: 'abrir-o-caixa',
    title: 'Abrir o caixa e fazer a primeira venda',
    category: 'Caixa',
    summary: 'Do troco inicial à venda concluída.',
    keywords: ['vender', 'venda', 'pdv', 'troco', 'bipar', 'código de barras'],
    screen: { label: 'Abrir o caixa', to: '/caixa' },
    body: [
      {
        kind: 'steps',
        items: [
          'Clique em "Abrir o caixa". No primeiro uso, dê um nome ao caixa (por exemplo, "Caixa 1") e clique em "Criar e usar este caixa".',
          'Informe o "Dinheiro na gaveta para troco (R$)" e clique em "Abrir caixa".',
          'Bipe o código de barras ou digite o nome do produto e tecle Enter.',
          'Clique em "Pagar (F10)", escolha a forma de pagamento e finalize a venda.',
        ],
      },
      {
        kind: 'tip',
        text: 'O caixa funciona sem internet. As vendas sobem sozinhas quando a conexão volta; o ícone de sincronização mostra o que ainda falta enviar.',
      },
    ],
  },
  {
    slug: 'atalhos-do-caixa',
    title: 'Atalhos de teclado do caixa',
    category: 'Caixa',
    summary: 'As teclas F que agilizam a venda.',
    keywords: ['teclado', 'f2', 'f10', 'tecla', 'rápido'],
    body: [
      {
        kind: 'steps',
        items: [
          'F2 — buscar produto; F3 — quantidade; F4 — desconto.',
          'F5 — salvar orçamento; F7 — orçamentos salvos.',
          'F6 — CPF ou CNPJ na nota.',
          'F8 — remover item; F12 — limpar a venda.',
          'F9 — caixa (sangria, suprimento, fechar); F10 — pagar; F11 — vendas deste caixa.',
        ],
      },
    ],
  },
  {
    slug: 'sangria-e-fechamento',
    title: 'Sangria, suprimento e fechamento do caixa',
    category: 'Caixa',
    summary: 'Tirar ou colocar dinheiro na gaveta e fechar o dia.',
    keywords: ['sangria', 'suprimento', 'fechar caixa', 'fechamento', 'conferência', 'gaveta'],
    body: [
      {
        kind: 'steps',
        items: [
          'No caixa, tecle F9 (ou clique em "Caixa (F9)").',
          'Para tirar dinheiro, use "Sangria (retirar dinheiro)"; para colocar troco, "Suprimento". Informe o valor e o motivo.',
          'No fim do dia, clique em "Fechar o caixa" e informe o que contou de cada forma de pagamento. O Bipaê mostra o esperado, o contado e a diferença de cada uma.',
        ],
      },
      {
        kind: 'warning',
        text: 'Sangria e diferença no fechamento ficam registradas na auditoria, com quem fez e quando.',
      },
    ],
  },
  {
    slug: 'cancelar-e-devolver',
    title: 'Cancelar uma venda ou fazer uma devolução',
    category: 'Caixa',
    summary: 'Desfazer a venda inteira ou devolver só alguns itens.',
    keywords: ['cancelar', 'cancelamento', 'devolução', 'devolver', 'troca', 'estorno'],
    body: [
      {
        kind: 'steps',
        items: [
          'No caixa, tecle F11 para ver as "Vendas deste caixa" e escolha a venda.',
          'Para desfazer tudo, clique em "Cancelar venda" e informe o motivo. A nota fiscal é cancelada na SEFAZ automaticamente.',
          'Para devolver só parte, clique em "Devolver", escolha os itens e a forma de devolver o dinheiro.',
        ],
      },
      {
        kind: 'tip',
        text: 'Cancelamento pede a permissão "Cancelar venda"; um gerente pode autorizar na hora, com a senha dele.',
      },
    ],
  },
  {
    slug: 'crediario',
    title: 'Vender no crediário (fiado)',
    category: 'Clientes',
    summary: 'Limite por cliente e venda com o CPF.',
    keywords: ['fiado', 'crediário', 'conta', 'limite', 'prazo', 'receber'],
    screen: { label: 'Clientes', to: '/clientes' },
    body: [
      {
        kind: 'steps',
        items: [
          'Em "Clientes", cadastre o cliente com o CPF ou CNPJ e preencha o "Limite do crediário (R$)".',
          'No caixa, tecle F6 e informe o CPF do cliente.',
          'Em "Pagar (F10)", escolha "Crediário". O caixa mostra quanto ainda está disponível.',
          'Para receber, abra o cliente em "Clientes" e registre o pagamento.',
        ],
      },
      {
        kind: 'tip',
        text: 'Cliente com parcela vencida fica bloqueado no crediário até pagar o atrasado. Veja quem está devendo em "Inadimplência".',
      },
    ],
  },
  {
    slug: 'fidelidade',
    title: 'Programa de fidelidade (pontos)',
    category: 'Clientes',
    summary: 'O cliente ganha pontos nas compras com CPF e usa como desconto.',
    keywords: ['pontos', 'fidelidade', 'cashback', 'programa', 'desconto'],
    screen: { label: 'Relacionamento', to: '/relacionamento' },
    body: [
      {
        kind: 'steps',
        items: [
          'Em "Relacionamento", no "Programa de fidelidade", defina quanto de compra vale 1 ponto, quanto cada ponto vale no caixa, em quantos meses vencem e o mínimo para usar.',
          'Marque "Programa ligado" e clique em "Salvar programa".',
          'No caixa, com o CPF do cliente na venda (F6), aparecem os pontos dele. Clique em "Usar pontos" para virar desconto.',
        ],
      },
      {
        kind: 'tip',
        text: 'Funciona sem internet. O desconto dos pontos não conta no limite de desconto do operador.',
      },
    ],
  },
  {
    slug: 'relacionamento',
    title: 'Relacionamento: clientes novos, frequentes e sumidos',
    category: 'Clientes',
    summary: 'Quem compra, quanto e quem parou de vir.',
    keywords: ['crm', 'clientes', 'segmentos', 'sumidos', 'ofertas', 'lista', 'lgpd'],
    screen: { label: 'Relacionamento', to: '/relacionamento' },
    body: [
      {
        kind: 'p',
        text: 'As compras com CPF ou CNPJ na nota viram histórico na ficha do cliente e separam os clientes em novos, frequentes, ativos e sumidos.',
      },
      {
        kind: 'steps',
        items: [
          'Abra "Relacionamento" e escolha o grupo nos botões do topo.',
          'Clique em "Lista para ofertas (CSV)" para baixar só quem aceitou receber ofertas.',
        ],
      },
      {
        kind: 'warning',
        text: 'Mande ofertas só para quem aceitou (LGPD). Marque o aceite no cadastro do cliente, em "Aceita receber ofertas por WhatsApp ou e-mail".',
      },
    ],
  },
  {
    slug: 'cadastrar-produtos',
    title: 'Cadastrar produtos, grade e kits',
    category: 'Produtos e estoque',
    summary: 'Produto simples, variações (tamanho e cor) e kits.',
    keywords: [
      'produto',
      'cadastro',
      'grade',
      'tamanho',
      'cor',
      'kit',
      'ficha técnica',
      'código de barras',
    ],
    screen: { label: 'Produtos', to: '/produtos' },
    body: [
      {
        kind: 'steps',
        items: [
          'Em "Produtos", clique em "Novo produto", preencha o nome, o preço e o código de barras e salve.',
          'Para tamanho e cor, abra o produto e, em "Variações (grade)", escreva os valores separados por vírgula (P, M, G). Clique em "Gerar variações".',
          'A grade aparece como tabela, com o estoque de cada combinação; o preço pode ser trocado ali mesmo.',
          'Para kit ou prato com ficha técnica, marque "Este produto é um kit..." e escolha os componentes.',
        ],
      },
    ],
  },
  {
    slug: 'compras-pelo-xml',
    title: 'Dar entrada nas compras pelo XML',
    category: 'Produtos e estoque',
    summary: 'Fornecedor, produtos, custo e estoque de uma vez.',
    keywords: ['compra', 'xml', 'nota de compra', 'fornecedor', 'entrada', 'estoque', 'custo'],
    screen: { label: 'Compras', to: '/compras' },
    body: [
      {
        kind: 'steps',
        items: [
          'Peça ao fornecedor o XML da nota (vem por e-mail).',
          'Em "Compras", clique em "Importar XML" e escolha o arquivo.',
          'Confira cada item: ligue a um produto que já existe ou crie um novo, e ajuste o fator (por exemplo, caixa com 12).',
          'Clique em "Dar entrada no estoque".',
        ],
      },
      {
        kind: 'tip',
        text: 'Compra para uso pessoal (do dono ou dos funcionários) deve ser marcada em "Uso pessoal": ela não gera crédito de IBS e CBS.',
      },
    ],
  },
  {
    slug: 'condicional',
    title: 'Venda condicional (levar para provar)',
    category: 'Produtos e estoque',
    summary: 'O cliente leva as peças e volta no prazo.',
    keywords: ['condicional', 'provar', 'experimentar', 'moda', 'roupa', 'devolver peças'],
    screen: { label: 'Condicional', to: '/condicional' },
    body: [
      {
        kind: 'steps',
        items: [
          'Em "Condicional", clique em "Novo condicional", escolha o cliente e as peças e clique em "Registrar a saída". As peças saem do estoque.',
          'Na volta, abra o condicional, informe o que o cliente ficou e clique em "Registrar a volta".',
          'O que ele ficou vai para o caixa como a comanda "Condicional nº"; é só abrir e cobrar.',
        ],
      },
      {
        kind: 'warning',
        text: 'O prazo máximo é de 60 dias (Ajuste SINIEF 02/18). A nota de remessa (CFOP 5.912) ainda é emitida fora do Bipaê.',
      },
    ],
  },
  {
    slug: 'nfce',
    title: 'Nota fiscal do consumidor (NFC-e)',
    category: 'Fiscal',
    summary: 'Como a nota sai e o que fazer quando é recusada.',
    keywords: ['nfce', 'nota fiscal', 'sefaz', 'rejeição', 'recusada', 'qr code', 'cupom'],
    screen: { label: 'Vendas', to: '/vendas' },
    body: [
      {
        kind: 'p',
        text: 'A NFC-e sai sozinha a cada venda. Sem internet, a venda continua normal e a nota é emitida quando a conexão volta; se o certificado estiver instalado no aparelho (em "Periféricos"), o caixa emite em contingência na hora.',
      },
      {
        kind: 'steps',
        items: [
          'Em "Vendas", abra a venda para ver a situação da nota.',
          'Se a SEFAZ recusar, a tela explica o motivo em português e o que corrigir (por exemplo, o NCM do produto).',
          'Depois de corrigir, a nota é enviada de novo automaticamente.',
        ],
      },
      {
        kind: 'tip',
        text: 'Número de nota que não foi usado precisa ser inutilizado: veja em "Inutilização de números".',
      },
    ],
  },
  {
    slug: 'contador',
    title: 'Arquivos para o contador',
    category: 'Fiscal',
    summary: 'Os XML do mês num arquivo só.',
    keywords: ['contador', 'xml', 'mês', 'zip', 'sped', 'arquivos'],
    screen: { label: 'Arquivos para o contador', to: '/contador' },
    body: [
      {
        kind: 'steps',
        items: [
          'Abra "Arquivos para o contador".',
          'Escolha a empresa e o mês e baixe o pacote: os XML das notas, dos cancelamentos e das inutilizações, mais um resumo em planilha.',
        ],
      },
    ],
  },
  {
    slug: 'contas-e-relatorios',
    title: 'Contas a pagar e receber, fluxo de caixa e relatórios',
    category: 'Financeiro',
    summary: 'Onde ver o dinheiro que entra e sai.',
    keywords: [
      'financeiro',
      'contas',
      'pagar',
      'receber',
      'fluxo de caixa',
      'dre',
      'relatórios',
      'lucro',
    ],
    screen: { label: 'Contas a pagar e receber', to: '/financeiro' },
    body: [
      {
        kind: 'steps',
        items: [
          'Em "Contas a pagar e receber", lance as contas com vencimento e dê baixa quando pagar ou receber.',
          '"Fluxo de caixa" mostra o saldo previsto dia a dia; "DRE gerencial", o resultado do mês.',
          'Em "Relatórios", veja vendas por período, produto e forma de pagamento, e exporte em planilha ou PDF.',
        ],
      },
    ],
  },
  {
    slug: 'equipe-e-permissoes',
    title: 'Equipe e permissões',
    category: 'Começar',
    summary: 'Quem pode fazer o quê.',
    keywords: ['usuário', 'funcionário', 'operador', 'gerente', 'permissão', 'senha', 'acesso'],
    screen: { label: 'Equipe', to: '/equipe' },
    body: [
      {
        kind: 'steps',
        items: [
          'Em "Equipe", convide a pessoa e escolha o papel: Dono, Gerente, Operador de caixa ou Contador.',
          'Para limitar a pessoa a algumas lojas, escolha as lojas no cadastro dela.',
        ],
      },
      {
        kind: 'tip',
        text: 'Ações sensíveis (cancelar venda, desconto acima do limite, sangria, mudar preço) ficam na "Auditoria", com quem fez e quem autorizou.',
      },
    ],
  },
  {
    slug: 'api-e-webhooks',
    title: 'Ligar o Bipaê a outro sistema (API e webhooks)',
    category: 'Integrações',
    summary: 'Chaves de API e avisos automáticos para loja virtual ou BI.',
    keywords: ['api', 'integração', 'webhook', 'chave', 'loja virtual', 'ecommerce', 'bi'],
    screen: { label: 'Integrações (API)', to: '/integracoes' },
    body: [
      {
        kind: 'steps',
        items: [
          'Em "Integrações (API)", clique em "Nova chave", dê um nome e escolha o que ela pode ler. Copie a chave: ela só aparece uma vez.',
          'Para o outro sistema ser avisado na hora de cada venda, clique em "Novo webhook", informe o endereço (https) e os avisos.',
          'Use "Enviar teste" para conferir se o endereço está recebendo.',
        ],
      },
      {
        kind: 'tip',
        text: 'A documentação técnica para quem vai programar está em /v1/public/openapi.json.',
      },
    ],
  },
  {
    slug: 'nfe',
    title: 'Emitir NF-e (modelo 55) pela retaguarda',
    category: 'Fiscal',
    summary: 'Venda para empresa, para outro estado, devolução e contingência.',
    keywords: [
      'nota fiscal eletronica',
      'modelo 55',
      'danfe',
      'atacado',
      'svc',
      'contingencia',
      'devolucao',
    ],
    screen: { label: 'NF-e', to: '/nfe' },
    body: [
      {
        kind: 'p',
        text: 'A NF-e é a nota de venda para empresas, para outro estado ou com transporte. No balcão, para o consumidor, continua valendo a NFC-e do caixa.',
      },
      {
        kind: 'steps',
        items: [
          'Em "NF-e", clique em "Nova NF-e" e escolha a "Empresa emitente".',
          'Informe o destinatário: busque no cadastro de clientes ou digite o CPF ou CNPJ, o endereço e a inscrição estadual.',
          'Adicione os produtos, o frete e a forma de pagamento. A prazo, use "Adicionar parcela" para cada vencimento.',
          'Clique em "Salvar rascunho e conferir". O Bipaê calcula os impostos e mostra o que falta, item por item.',
          'Na devolução de compra ao fornecedor, escolha a finalidade "Devolução de compra", cole a "Chave da nota devolvida" e, em cada produto, diga o "Item na nota devolvida" (o número da linha dele na nota do fornecedor). A SEFAZ exige essa referência item a item.',
          'Quando não faltar nada, clique em "Emitir NF-e". Depois de autorizada, use "Baixar o DANFE (PDF)" e "Baixar o XML".',
          'Para corrigir um dado que não muda o imposto (endereço de entrega, transportadora, observações), use "Carta de correção": escreva tudo o que está sendo corrigido e clique em "Enviar carta de correção". Cada carta substitui a anterior, até 20 por nota.',
          'Para cancelar uma nota autorizada, em até 24 horas, escreva o "Motivo do cancelamento" e clique em "Cancelar a NF-e". Quando a SEFAZ registrar, a mercadoria volta ao estoque e as parcelas abertas são canceladas.',
        ],
      },
      {
        kind: 'tip',
        text: 'Antes de emitir, "Baixar a prévia do DANFE" mostra como a nota vai ficar (a prévia não tem valor fiscal).',
      },
      {
        kind: 'warning',
        text: 'Se a SEFAZ do seu estado estiver fora do ar, a tela oferece "Emitir em contingência (SVC)". Depois que ela voltar, o Bipaê confere se a tentativa normal também foi autorizada e avisa para cancelar uma das duas.',
      },
    ],
  },
  {
    slug: 'notas-recebidas',
    title: 'Notas emitidas para a sua empresa',
    category: 'Fiscal',
    summary: 'Ver as notas que fornecedores emitiram para o seu CNPJ e responder à SEFAZ.',
    keywords: [
      'manifestacao',
      'ciencia',
      'dfe',
      'nota de fornecedor',
      'desconhecimento',
      'entrada',
    ],
    screen: { label: 'Compras', to: '/compras' },
    body: [
      {
        kind: 'p',
        text: 'Com o certificado da empresa enviado, o Bipaê busca de hora em hora as notas emitidas para o seu CNPJ.',
      },
      {
        kind: 'steps',
        items: [
          'Em "Compras", veja "Notas emitidas para a sua empresa". Para não esperar, clique em "Buscar notas agora".',
          'Abra a nota e clique em "Registrar a ciência" para baixar o XML completo.',
          'Com o XML, clique em "Dar entrada na compra": o estoque e a conta a pagar entram sozinhos.',
          'Se a compra não aconteceu, escolha em "O que aconteceu com esta compra", explique o motivo e clique em "Enviar a manifestação".',
        ],
      },
    ],
  },
  {
    slug: 'ordem-de-servico',
    title: 'Ordem de serviço e NFS-e',
    category: 'Fiscal',
    summary: 'Abrir a OS, entregar ao cliente e emitir a NFS-e Nacional.',
    keywords: ['os', 'assistencia tecnica', 'oficina', 'nfse', 'nota de servico', 'iss', 'danfse'],
    screen: { label: 'Ordens de serviço', to: '/ordens-de-servico' },
    body: [
      {
        kind: 'steps',
        items: [
          'Em "Empresas e lojas", na parte "NFS-e Nacional", informe a inscrição municipal e o percentual dos tributos do seu regime. No Simples, se não souber o número, use "Não sei o percentual: calcular para mim": escolha o anexo e o faturamento dos últimos 12 meses e clique em "Usar".',
          'Depois cadastre os serviços em "Serviços", com o "Código na lista nacional de serviços" e a "Alíquota do ISS no município (%)".',
          'Em "Ordens de serviço", clique em "Nova ordem de serviço", escolha o cliente, descreva o equipamento e o defeito e adicione serviços e peças.',
          'Clique em "Salvar a OS". Quando terminar o trabalho, use "Entregar ao cliente": as peças saem do estoque e a conta a receber é criada.',
          'Na OS entregue, clique em "Emitir NFS-e". Depois de autorizada, use "Baixar o DANFSE" e "Baixar o XML".',
          'Para cancelar a NFS-e, escolha o "Motivo do cancelamento", explique e clique em "Cancelar a NFS-e". O prazo e o valor-limite são definidos pelo município; se ele recusar, a tela mostra o motivo.',
        ],
      },
      {
        kind: 'tip',
        text: 'Se faltar algo para a NFS-e (inscrição municipal, código do serviço, alíquota), a tela lista em "O que falta para a NFS-e".',
      },
    ],
  },
  {
    slug: 'assistente',
    title: 'Assistente de IA',
    category: 'Começar',
    summary: 'Perguntar sobre as vendas e receber sugestão de NCM e CEST.',
    keywords: ['ia', 'inteligencia artificial', 'pergunta', 'sugestao fiscal', 'ncm automatico'],
    screen: { label: 'Assistente', to: '/assistente' },
    body: [
      {
        kind: 'p',
        text: 'O assistente é opcional. Desligado, nada muda no Bipaê. Ele nunca altera nada sozinho.',
      },
      {
        kind: 'steps',
        items: [
          'Em "Assistente", quem cuida da conta marca "Assistente ligado".',
          'Escreva em "Sua pergunta", por exemplo "Quanto vendi nesta semana?", e clique em "Perguntar". A resposta mostra quais relatórios foram consultados.',
          'No cadastro de um produto, use "Sugerir com IA" para receber NCM, CEST e cClassTrib conferidos nas tabelas oficiais. Confira e clique em "Aprovar e gravar", ou em "Recusar".',
        ],
      },
      {
        kind: 'tip',
        text: 'Nome, CPF e contato de clientes não saem do Bipaê: o assistente só recebe números dos relatórios e o cadastro dos produtos.',
      },
    ],
  },
  {
    slug: 'campanhas',
    title: 'Campanhas por e-mail',
    category: 'Clientes',
    summary: 'Mandar ofertas para quem aceitou receber, por segmento.',
    keywords: ['email marketing', 'ofertas', 'promocao por email', 'descadastro', 'lgpd'],
    screen: { label: 'Relacionamento', to: '/relacionamento' },
    body: [
      {
        kind: 'steps',
        items: [
          'Em "Relacionamento", escolha o segmento (novos, frequentes, ativos, sumidos) ou "Todos".',
          'Em "Campanhas por e-mail", preencha o nome, o assunto e o texto. Deixe uma linha em branco entre os parágrafos.',
          'Clique em "Enviar para". Vai só para quem aceitou receber ofertas e tem e-mail.',
        ],
      },
      {
        kind: 'tip',
        text: 'Cada e-mail leva um link para a pessoa não receber mais. A lista de campanhas mostra quantos receberam e quantos saíram.',
      },
    ],
  },
  {
    slug: 'seguranca-da-conta',
    title: 'Senha e segurança da conta',
    category: 'Começar',
    summary: 'Esqueci a senha, verificação em duas etapas e avisos de segurança.',
    keywords: ['senha', 'esqueci', 'login', 'duas etapas', '2fa', 'autenticador', 'bloqueado'],
    screen: { label: 'Configurações', to: '/configuracoes' },
    body: [
      {
        kind: 'steps',
        items: [
          'Esqueceu a senha? Na tela de entrar, clique em "Esqueci a senha". O link chega por e-mail, vale 1 hora e encerra as sessões abertas.',
          'Para proteger a conta, em "Configurações" clique em "Ativar verificação em duas etapas" e leia o código com o aplicativo autenticador do celular.',
        ],
      },
      {
        kind: 'warning',
        text: 'Depois de 10 senhas erradas em 15 minutos, o e-mail fica bloqueado por 15 minutos. Senhas muito comuns, ou iguais ao seu e-mail ou nome, não são aceitas.',
      },
      {
        kind: 'tip',
        text: 'Você recebe um e-mail sempre que a senha é trocada ou a verificação em duas etapas muda. Se não foi você, troque a senha na hora.',
      },
    ],
  },
  {
    slug: 'pauta-da-st',
    title: 'Pauta da substituição tributária',
    category: 'Fiscal',
    summary: 'Para distribuidores: a base da ST pelo valor da pauta da marca e embalagem.',
    keywords: [
      'pauta',
      'st',
      'substituicao tributaria',
      'cerveja',
      'refrigerante',
      'mva',
      'iva-st',
    ],
    screen: { label: 'Produtos', to: '/produtos' },
    body: [
      {
        kind: 'p',
        text: 'Em algumas bebidas, a UF publica o preço em reais de cada marca e embalagem (em SP, a Portaria SRE 27/2026). Isso só interessa a quem retém a ST: indústria, importador ou distribuidor.',
      },
      {
        kind: 'steps',
        items: [
          'No cadastro do produto, preencha o CEST. Se ele estiver na pauta da UF da empresa, aparece "Pauta da ST".',
          'Em "Procurar na pauta", digite a marca e a embalagem (ex.: "lata 350") e escolha o item certo.',
          'Salve o produto. Na NF-e para essa UF, a base da ST passa a ser o valor da pauta vezes a quantidade.',
        ],
      },
      {
        kind: 'warning',
        text: 'A pauta tem prazo. Quando sair a nova portaria, o rascunho da NF-e avisa para escolher o item da pauta nova.',
      },
    ],
  },
];

/** Busca sem acento e sem diferença de maiúsculas, no título, no resumo e nas palavras. */
export function searchHelp(query: string, articles: HelpArticle[] = HELP_ARTICLES): HelpArticle[] {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return articles;
  return articles.filter((a) => {
    const text = norm(
      [
        a.title,
        a.summary,
        ...a.keywords,
        ...a.body.flatMap((b) => (b.kind === 'steps' ? b.items : [b.text])),
      ].join(' '),
    );
    return terms.every((t) => text.includes(t));
  });
}
