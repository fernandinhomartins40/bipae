# Changelog

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
