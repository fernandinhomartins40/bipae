# Changelog

## [F3-03.b Tabela de NCM] — 13/10/2026

### Adicionado
- **NCM vigente do Portal Único Siscomex** (13/10/2026): 10.516 códigos de 8 dígitos, mais capítulos, posições e subposições. O arquivo original fica guardado compactado, com hash.
- `findNcm` aceita o código com ou sem pontos e só devolve NCM completo que exista na tabela.
- `ncmPath` monta o caminho do capítulo até o código, porque a descrição sozinha quase sempre é "Outros".
- `searchNcm` busca pelo começo do código ou por palavras, sem acento, em qualquer nível ("arroz polido" acha 1006.30.21). É a base da busca de NCM no cadastro de produto.
- Módulo à parte (`@bipae/fiscal/tables/ncm`), para a tabela grande não pesar em quem não precisa dela.

## [F3-03.a Tabelas oficiais: CFOP, cClassTrib e alíquotas de referência] — 13/10/2026

### Adicionado
- **Tabelas fiscais geradas dos arquivos oficiais**, nunca digitadas: as planilhas do Portal Nacional da NF-e ficam em `packages/fiscal/sources`, com data e hash, e `pnpm --filter @bipae/fiscal tables` gera os dados. Um teste falha se alguém trocar a planilha sem regerar.
  - **CFOP** (IT 2023.002 v2.10): 619 códigos, com vigência e indicadores de devolução, retorno e remessa.
  - **CST e cClassTrib do IBS e da CBS** (IT 2025.002 v1.70): 18 CSTs e 173 classificações, com a redução de alíquota de cada uma.
  - **Alíquotas de referência** com vigência e artigo da lei: CBS de 0,9% e IBS de 0,1% em 2026; IBS de 0,05% estadual + 0,05% municipal em 2027–2028 (LC 214/2025).
  - **FCP por UF**: alíquota fixa ou teto das 27 UFs.
- Uso: `import { findCfop, findClassTrib, referenceRates } from '@bipae/fiscal/tables'`.
- O lint passa a barrar qualquer leitura de arquivo, rede ou processo dentro do motor fiscal.

### Documentado
- A CBS de 2027 **não tem alíquota publicada** (o portal diz "aguarda legislação"): fica sem número na tabela, e a dúvida D-004 continua aberta.
- Dúvidas novas: D-016 (fim da vigência do cClassTrib) e D-017 (lista de CFOP do contribuinte exclusivo do IBS/CBS).
- O Portal Nacional da NF-e agora é lido direto; a tabela de CFOP vigente é a v2.10.

## [F3-02 Motor fiscal: base] — 13/10/2026

### Adicionado
- **`packages/fiscal`**, o motor fiscal puro (sem banco e sem rede), com 100% de cobertura de testes:
  - contas com decimal de precisão arbitrária, dinheiro em centavos e arredondamento explícito (ADR-0008);
  - **regras como dados**, cada uma com vigência, escopo e a norma que a justifica (ADR-0006);
  - escolha da regra em vigor na data do fato gerador, ficando com a mais específica; empate entre regras é erro, nunca escolha silenciosa;
  - conferência da tabela de regras (id repetido, vigência inválida, regra sem fonte, regras que se cruzam);
  - cálculo de base × alíquota com redução de base e **explicação passo a passo** de cada valor.
- Ainda sem alíquotas oficiais: as tabelas entram na F3-03.

## [Correção da fila e do deploy] — 13/10/2026

O deploy da F1-07 deixou o site fora do ar por alguns minutos: a API não subia e a volta automática para a versão anterior não rodou. A versão anterior foi restaurada à mão.

### Corrigido
- **A API não subia com o Redis ligado.** O BullMQ 6 não traz o driver `ioredis`, e no pacote de produção não consegue carregá-lo sozinho. Agora o driver é dependência da API e o cliente é criado por ela.
- **Fila com problema não derruba mais a API.** Redis fora do ar vira aviso no log, e a fila reconecta sozinha.
- **O deploy agora volta mesmo para a versão anterior** quando a nova não fica saudável. Antes, o script parava no primeiro erro, sem chegar a esse passo.

### Adicionado
- **Teste do pacote compilado** (`scripts/smoke-api.mjs`): sobe a API do jeito que roda em produção, com Redis de verdade e com o Redis fora do ar. Roda no CI e antes de todo deploy.
- O teste que antecede o deploy passou a usar um Redis de verdade. Era a falta dele que deixava o erro passar.

## [F1-07 Fila de tarefas] — 13/10/2026

### Adicionado
- **Fila de tarefas em segundo plano**, com nova tentativa automática: em memória no desenvolvimento, BullMQ + Redis em produção. É a base para o envio de notas à SEFAZ na Fase 3.
- Primeira tarefa: limpeza, a cada 6 horas, dos registros de login vencidos ou encerrados há mais de 30 dias.
- **Redis** na VPS: contêiner próprio do Bipaê, sem porta no host, com 96 MB de memória. A CI testa a fila contra um Redis de verdade.

## [F1-06 Convite por link] — 13/10/2026

### Adicionado
- **Convidar por link** em Equipe:
  - escolha o papel, o e-mail (opcional) e as lojas;
  - o link vale 7 dias e só pode ser usado uma vez;
  - os convites pendentes podem ser cancelados.
- **Página do convite**: a pessoa cria a conta ou entra com a que já tem (senha e, se usar, o código da verificação em duas etapas) e cai direto na empresa.

### Mudou
- **Quem já tem conta no Bipaê** (ex.: o contador de várias empresas) não entra mais direto pela tela Adicionar pessoa. Agora precisa aceitar um convite.

### Corrigido
- **Caixa:** num computador lento, um atalho (F4, F10...) apertado logo depois de bipar se perdia. Agora ele espera a bipagem terminar.

## [F1-05 Permissões por loja] — 13/10/2026

### Adicionado
- Em **Equipe**, cada pessoa pode ter **todas as lojas** ou **só algumas**.
- Quem é restrito só vê e usa as suas lojas e os caixas delas. Vendas e estoque de outras lojas não aparecem para essa pessoa, e ela não consegue sincronizar nem enviar vendas por um caixa de outra loja.

## [F1-04 Variações e kits] — 13/10/2026

### Adicionado
- **Kits** (ex.: cesta básica):
  - a composição é montada no cadastro do produto;
  - vender o kit baixa o estoque de cada componente, e o cancelamento e a devolução devolvem;
  - um kit não pode conter outro kit.
- **Grade de variações**:
  - os atributos (ex.: Tamanho P, M, G e Cor Azul, Preto) geram uma variação por combinação, com preço e estoque próprios;
  - gerar de novo só cria as combinações que faltam.
- **No caixa**, aparecem as variações e não o modelo; o kit entra como um item só, pelo preço do kit.

## [F1-03 Tabelas de preço] — 13/10/2026

### Adicionado
- Tela **Tabelas de preço**: busca de produtos, preço especial por item e o preço normal ao lado.
- **Tabela da loja** em Empresas e lojas, que agora permite editar a loja, e **tabela do cliente** no cadastro de clientes.
- **No caixa, inclusive sem internet**, o preço segue esta ordem: tabela do cliente (pelo CPF/CNPJ na venda) → tabela da loja → preço do cadastro.
  - Ao informar o CPF, o carrinho é recalculado.
  - A tela mostra qual tabela está valendo.
  - Os preços chegam ao caixa na sincronização, só quando algo muda.

### Mudou
- Comentários no código, nomes de testes e mensagens de commit passam a ser escritos em português.

## [F1-02 Perfis fiscais] — 13/10/2026

### Adicionado
- Tela **Perfis fiscais**:
  - lista, criação e edição;
  - campos: origem da mercadoria, CFOP dentro e fora do estado, CSOSN (Simples) ou CST (Presumido/Real) e cClassTrib (IBS/CBS);
  - aviso claro de que o cálculo dos impostos chega com a NFC-e.
- Campo **Perfil fiscal** no cadastro do produto.

### Corrigido
- **Bipaê Desktop:** salvar uma edição (produto, empresa, perfil...) dava "Sem conexão com o servidor". A API só liberava GET e POST para chamadas de outro endereço; agora libera também PUT, PATCH e DELETE, com teste.

## [F1-01 Verificação em duas etapas] — 13/10/2026

### Adicionado
- **Verificação em duas etapas** opcional para os usuários dos clientes, recomendada para donos e gerentes:
  - ativa em Configurações, com código QR e app autenticador;
  - o login passa a pedir o código de 6 dígitos;
  - desativar exige um código válido;
  - a semente fica cifrada no banco;
  - o suporte Bipaê, entrando como o cliente, não consegue mudá-la;
  - ativar e desativar ficam na auditoria.
- Painel super admin: **"Zerar verificação em duas etapas"** em Pessoas, para quem perdeu o celular. A ação encerra as sessões abertas e fica na auditoria da plataforma.

## [Nova landing page] — 12/10/2026

### Mudou
- **Landing page redesenhada** (www.bipae.com.br):
  - segue as referências aprovadas, com as **logos oficiais**: verde com o chapéu amarelo e a versão branca;
  - fonte Plus Jakarta Sans servida pelo próprio site;
  - seções: herói com a tela do caixa, 3 passos, recursos, "A internet caiu. A fila, não.", Online e Desktop, "O que vem por aí", planos, dúvidas e chamada final;
  - menu de celular.

### Corrigido
- **PDV Embed:** com leitor rápido e rede lenta, um código lido enquanto o anterior ainda era buscado podia se perder. Agora cada leitura entra numa fila e nenhuma se perde. Há teste novo que simula a rede lenta.

## [Bipaê PDV Embed 1.0] — 12/10/2026

### Adicionado
- **Bipaê PDV Embed** (`kits/pdv-embed`, ADR-0014): o caixa da Bipaê como uma tag HTML (`<bipae-pdv>`) para colocar no painel de qualquer aplicação web, em qualquer linguagem.
  - **O caixa:**
    - abertura de caixa;
    - bipagem, busca e `3*código`;
    - produtos por peso;
    - desconto com limite;
    - vários pagamentos com troco;
    - CPF/CNPJ na nota;
    - sangria, suprimento e fechamento cego;
    - cancelamento e reimpressão;
    - atalhos F2/F4/F9, temas claro/escuro e cores personalizáveis.
  - **Componente:** um único arquivo de 18 KB (gzip), com estilos isolados e eventos para a aplicação reagir a cada venda.
  - **Backend:**
    - contrato aberto de 9 rotas (OpenAPI);
    - implementações prontas em **Node** e **PHP** (Laravel, WordPress, PHP puro);
    - tabelas para PostgreSQL, MySQL e SQLite;
    - produtos lidos da tabela da própria aplicação, por uma view.
  - **Teste de conformidade** que valida qualquer backend. Junto vai um prompt pronto para pedir a uma IA a implementação em outras linguagens.
  - **CI:** testa as duas implementações e o componente num navegador real.

### Mudou
- `@bipae/pdv-core/pure`: entrada só com as regras puras do caixa.
- As formas de pagamento do `@bipae/domain` estão num arquivo próprio, sem zod.
- O app web aplica versões novas sozinho fora da tela do caixa. Na tela do caixa, espera o operador sair dela. Antes, páginas novas, como `/app/download`, voltavam para o início até limpar o cache.

## [Download do Bipaê Desktop] — 12/10/2026

### Adicionado
- Página **Baixar o Bipaê Desktop**:
  - pública em https://www.bipae.com.br/app/download, com links na landing;
  - item "Baixar o desktop" no menu da retaguarda e link na tela de Periféricos.
- Mostra a versão mais recente com o instalador certo para o sistema do visitante, as outras opções (MSI, .deb, AppImage), o passo a passo de instalação e o aviso do SmartScreen. Sem versão publicada, diz isso com clareza.
- API `GET /v1/downloads/desktop`, que lê a última Release estável do GitHub, com cache.
- O workflow **Release desktop** agora publica uma Release pública com instaladores de nome fixo a cada tag `vX.Y.Z`.

## [Plataforma SaaS e painel super admin] — 12/10/2026

### Adicionado
- **Multi-clientes e multi-empresas** (ADR-0013):
  - cada cliente (conta) pode ter várias empresas (CNPJs), cada empresa várias lojas, cada loja vários caixas;
  - nova tela **Empresas e lojas**;
  - quem participa de mais de um cliente troca pelo seletor no menu.
- **Planos e limites**:
  - planos Grátis, Essencial, Profissional e Rede, com limites de empresas, lojas, caixas, usuários e produtos;
  - limite aplicado na API com mensagem clara;
  - exceções negociadas por cliente;
  - nova tela **Minha assinatura**, com uso do plano e histórico da conta.
- **Ciclo de vida da conta**:
  - estados ativo, em teste (com data de fim), suspenso e cancelado;
  - conta bloqueada vê uma tela explicando o motivo, mas os caixas **continuam enviando as vendas feitas offline**.
- **Painel super admin** em `/app/admin`, para a equipe Bipaê:
  - **visão geral**: clientes ativos, receita mensal estimada, uso na semana, caixas ativos, novos clientes e faturamento por dia, clientes por plano, testes terminando;
  - **clientes**: busca e filtros; ficha com uso do plano, movimento, empresas, caixas, equipe, histórico e auditoria; ações de mudar plano ou teste, limites especiais, suspender, reativar, cancelar, anotar e encerrar sessões;
  - **pessoas**: busca em todos os clientes;
  - **planos, avisos** (faixa na retaguarda dos clientes) e **equipe Bipaê** (papéis Administrador, Suporte e Consulta);
  - **auditoria da plataforma** encadeada por hash, com verificação de integridade;
  - **sistema**: versões, banco e migrações.
- **Segurança do painel**:
  - login próprio, separado do login dos clientes;
  - verificação em duas etapas (app autenticador) obrigatória;
  - papel de banco exclusivo, que os clientes não enxergam;
  - rota sem permissão declarada só libera o Administrador.
- **Acesso de suporte**:
  - "entrar como o cliente" por 30 minutos, somente leitura por padrão, com motivo obrigatório;
  - faixa visível na tela do cliente;
  - registro nas duas auditorias.
- `admin-cli` para promover o primeiro super admin na VPS.

### Mudou
- Produção ganhou `SECRETS_KEY` (gerada no próximo deploy), usada para cifrar as sementes do 2FA.

## [Fase 2 — PDV offline-first] — 12/10/2026

### Adicionado
- **Caixa (PDV)** igual no navegador e no app desktop:
  - bipagem com multiplicador (`3*código`), busca sem acento, pesáveis com leitura de balança e etiquetas de balança (prefixo 2);
  - desconto com limite (acima de 10%, autorização de gerente com as credenciais dele, registrada na auditoria);
  - vários pagamentos na mesma venda com troco; Pix e cartão por **simulador**;
  - CPF/CNPJ na nota, orçamentos, sangria, suprimento, **fechamento cego**;
  - cancelamento, devolução por item sem sobra de centavo, reimpressão de comprovante (não fiscal);
  - atalhos F2–F12 e operação por toque, som de bip.
- **Offline-first**: banco local SQLite em todos os caixas (WASM + OPFS no navegador, nativo no desktop), venda e evento gravados na mesma transação, sincronização a cada 30 s e ao reconectar.
- **Servidor**:
  - eventos idempotentes (`/v1/sync/events`) com rejeição explicada em pt-BR;
  - catálogo incremental (`/v1/sync/pull`);
  - vendas, caixa e estoque como livro de movimentações;
  - contagem e ajuste de estoque; autorização de gerente.
- **Retaguarda**: tela de Vendas (faturamento, ticket médio), coluna e contagem de estoque, tela de Periféricos.
- **Periféricos** (desktop): impressora ESC/POS por rede ou serial, gaveta pela impressora, balança Toledo/Filizola.
- **Bipaê Conector**:
  - o app desktop serve impressora, balança e gaveta ao caixa do navegador, com pareamento por código, tokens revogáveis, checagem de origem e lista fechada de comandos;
  - modo bandeja (`--connector`);
  - simulador para desenvolvimento e testes.
- **Atualização automática** do desktop: assinada, canais estável/beta, nunca durante uma venda; workflow de release com assinatura de código opcional.
- **Testes**: 161 automatizados rodando nesta máquina (152 unitários e de integração + 9 E2E), mais 9 testes Rust que só rodam na CI:
  - dois caixas (web e desktop) vendendo offline ao mesmo tempo com estoque e numeração exatos;
  - atualização com vendas pendentes sem perda;
  - Conector com impressora e balança simuladas;
  - E2E de venda online e offline, fechamento cego e autorização nos dois frontends;
  - testes Rust para banco local, periféricos e Conector.

### Corrigido (achado pelos testes)
- Produto marcado como "vendido por peso" ficava com unidade UN.
- Caixa recém-vinculado não tinha catálogo no primeiro bip.
- Montagem dupla do React (modo de desenvolvimento) travava o banco do navegador.
- Bipar e apertar uma tecla de atalho logo em seguida usava o carrinho antigo.

### Limitações conhecidas
- O código Rust (banco nativo, periféricos, Conector, bandeja, atualizador) **não foi compilado nem testado em hardware** nesta máquina; depende da primeira execução da CI.
- O E2E dentro do WebView real (tauri-driver) ainda não existe; a suíte roda o frontend desktop no Chromium.
- Detalhes em `docs/TAREFAS.md`.

## [Fase 1 — Fundação] — 12/10/2026

### Adicionado
- **Monorepo** pnpm + Turborepo, TypeScript estrito, ESLint com regras de fronteira do ADR-0012 (pacotes não importam Tauri nem cascas).
- **`packages/domain`**: dinheiro em centavos, CPF e CNPJ (inclusive o CNPJ alfanumérico de julho/2026), GTIN, UUIDv7, catálogo de permissões e papéis, série de NFC-e por caixa, política de versão mínima de cliente, contratos Zod com mensagens em pt-BR.
- **`packages/platform`**: os oito ports do ADR-0012, matriz de capacidades web × desktop com explicações em pt-BR, estado "chega em breve" e simuladores.
- **API** (NestJS + Fastify):
  - PostgreSQL com Row-Level Security forçada em todas as tabelas de negócio; PGlite para desenvolver e testar sem Docker.
  - Cadastro sem configuração obrigatória; login; refresh token rotativo com detecção de reuso; troca de empresa (contador com vários clientes); limite de tentativas de login.
  - Papéis e permissões, recarregados a cada requisição.
  - Trilha de auditoria encadeada por hash e imutável no banco.
  - Cadastros: produtos (códigos de barras, variações, kits, pesáveis), unidades, perfis fiscais (só dados), tabelas de preço, clientes (com consentimento LGPD separado), fornecedores, empresas, lojas e caixas com série de NFC-e exclusiva.
  - API `/v1` com versão mínima de cliente (HTTP 426), que nunca bloqueia o envio de vendas.
  - Seed de demonstração.
- **Telas** (`packages/ui` e `packages/erp-ui`): entrar, criar conta, início com primeiros passos e capacidades da plataforma, produtos, clientes, fornecedores, caixas, equipe, auditoria e configurações (tema, alto contraste, fonte grande, som de bip).
- **Cascas** `apps/web` (PWA) e `apps/desktop` (Tauri 2), finas, sobre as mesmas telas.
- **Testes**: 98 unitários e de integração, e E2E Playwright com a mesma suíte nas duas cascas.
- **CI**: lint, typecheck, testes, API contra PostgreSQL 16 real, E2E e build dos instaladores desktop (Windows e Linux).
- **Docker Compose** com PostgreSQL, API e web, já com os dados de demonstração.

### Limitações conhecidas
- O `docker compose` e a compilação do app Tauri não puderam ser executados na máquina de desenvolvimento (sem WSL e sem Rust); ficam validados pela CI.
- Ver pendências em `docs/TAREFAS.md`.

## [Fase 0] — 11/10/2026

### Adicionado
- Briefing (`docs/PROMPT.md`), PRD, ADRs, benchmark de mercado em sala limpa, registro de versões fiscais e dúvidas fiscais.
- Adendo 01 (web + desktop): análise de impacto e ADR-0012.
