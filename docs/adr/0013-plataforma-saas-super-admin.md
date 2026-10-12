# ADR-0013 — Plataforma SaaS multi-clientes e painel super admin

**Status:** aceita (12/10/2026) · **Data:** 12/10/2026 · **Complementa:** [ADR-0003](0003-multi-tenant-rls.md), [ADR-0010](0010-seguranca-lgpd.md) · **Plano:** [docs/saas/plano.md](../saas/plano.md)

## Contexto
O Bipaê vai atender muitos clientes, cada um com uma ou várias empresas (CNPJs), lojas e caixas. A ADR-0003 já isola os dados de cada cliente com RLS no PostgreSQL. Faltavam:
- planos e limites;
- o ciclo de vida da conta (teste, suspensão, cancelamento);
- um painel para a equipe Bipaê operar o SaaS;
- um jeito seguro de dar suporte "entrando como o cliente".

Tudo isso sem enfraquecer o isolamento.

## Decisão

### 1. Hierarquia
`tenant` (cliente/conta) → `company` (CNPJ) → `store` (loja) → `terminal` (caixa). Uma pessoa (`user`) pode participar de vários clientes e troca entre eles na retaguarda; o token de acesso sempre carrega um único `tid`.

### 2. Planos, limites e status
- Tabela `plans`: limites por recurso (empresas, lojas, caixas, usuários, produtos; `null` = sem limite), preço e recursos. Iniciais: `gratis`, `essencial`, `profissional` e `rede`.
- O cliente tem `plan_id`, `status` (`active | trial | suspended | cancelled`), `trial_ends_at` e `limit_overrides`, que são exceções negociadas.
- `LimitsService.assertCanAdd` roda **dentro da mesma transação** da criação. Se o limite estoura, responde 403 `plan_limit` com mensagem em pt-BR.
- `AuthGuard` bloqueia conta suspensa, cancelada ou com teste vencido (403 `account_*`), **exceto** `/v1/sync/events`, `/v1/auth/me` e `/v1/account`. Venda feita offline nunca se perde.
- Cada mudança gera `tenant_events` (histórico visível ao cliente) e uma entrada na auditoria.

### 3. Equipe Bipaê separada dos clientes
- `platform_admins` com papéis `owner`, `support` e `viewer`, e permissões `platform.*` em lista fechada.
- **Login próprio:**
  - rota `/v1/admin/auth`;
  - JWT com audience `bipae-admin`, que um token de cliente (`bipae-app`) não satisfaz;
  - sessão de 12 h com refresh rotativo e acesso de 15 min.
- **2FA TOTP obrigatório** (`PLATFORM_REQUIRE_TOTP`). A semente é cifrada com AES-256-GCM usando `SECRETS_KEY`, separada do `JWT_SECRET`.
- **Banco:**
  - papel `bipae_platform` com `BYPASSRLS`, usado **só** pelos serviços do módulo `admin` via `asPlatform()`;
  - o papel dos clientes (`bipae_app`) não tem nenhum acesso às tabelas da plataforma;
  - um teste garante isso, e cada nova tabela da plataforma precisa entrar na lista permitida desse teste.
- Primeiro super admin: `admin-cli grant <e-mail> owner`, rodado na VPS. Não existe tela de cadastro de super admin.

### 4. Acesso de suporte
- Exige permissão `platform.support`, 2FA e um motivo.
- Emite um token `bipae-app` com `imp` (quem está acessando) e `ro` (somente leitura, padrão), válido por 30 min e **sem refresh**.
- Entrega na retaguarda por `/suporte#token=…`: o fragmento não vai ao servidor nem aos logs, é lido e apagado da URL na hora.
- A tela mostra a faixa "Modo suporte Bipaê". Com `ro`, a API recusa qualquer método diferente de GET.
- Registro em **duas auditorias**: a do cliente, com a marca `suporteBipae`, e a da plataforma.

### 5. Auditoria da plataforma
`platform_audit_log` encadeada por hash e imutável (trigger), como a dos clientes. Fica no painel, com verificação de integridade.

### 6. Painel
Em `/app/admin`, dentro do mesmo SPA (`packages/erp-ui/src/admin`), com cliente HTTP e armazenamento de sessão próprios. Telas:
- visão geral;
- clientes, com ficha e ações;
- pessoas;
- planos;
- avisos;
- equipe Bipaê;
- auditoria;
- sistema.

## Consequências
- Cobrança automática fica para a Fase 6 (PSP). Até lá, o plano é atribuído no painel.
- Toda rota nova de cliente que cria recursos limitados deve chamar `assertCanAdd`.
- Toda rota nova do painel declara `@PlatformPermission`. Sem declaração, só `owner` acessa.
- Rotacionar `SECRETS_KEY` exige recifrar as sementes do 2FA ou zerar o 2FA da equipe (`admin-cli reset-totp`).

## Alternativas descartadas
- **Super admin como papel dentro de um tenant:** misturaria a equipe Bipaê com os dados dos clientes e exigiria furar a RLS nas rotas comuns.
- **Banco ou esquema por cliente:** caro para operar com milhares de MEIs. A RLS (ADR-0003) já dá o isolamento.
- **Impersonação reaproveitando a sessão do cliente:** não deixaria rastro de quem agiu e não daria para limitar a somente leitura.
