# Banca R4: qualidade, funcionalidades e regressões

- **Revisor:** R4, engenheiro de qualidade
- **Commit:** `728df79`, branch `main`
- **Ambiente:** Windows 11 Pro, Node 24.21.0, pnpm 10.28.0, Playwright 1.64.0, sem Docker nem PostgreSQL (a API usa PGlite em memória)
- **Data:** 27/10/2026
- **Modo:** auditoria. Nenhum arquivo do projeto foi alterado e nenhum teste novo foi criado no repositório. Os scripts de análise ficaram fora do repositório, no scratchpad da sessão (`.../scratchpad/r4`).

## 1. Escopo

1. Executar `pnpm lint`, `pnpm typecheck` e `pnpm test` (sem cache do Turborepo).
2. Executar o E2E completo (`pnpm test:e2e`, projetos `web` e `desktop-ui`) e reexecutar o que falhar.
3. Montar a matriz módulo × testes: rotas da API × testes de API e E2E, testes negativos de tenant e de permissão, auditoria (regra 8) e cobertura do motor fiscal.
4. Procurar testes frágeis: `.skip`, `.only`, `.todo`, esperas fixas, testes sem asserção e testes que dependem da data.

**Alterações locais de outra sessão.** Havia arquivos alterados que não são deste revisor: `CHANGELOG.md`, `apps/web/e2e/connector.spec.ts`, `docs/TAREFAS.md`, `packages/erp-ui/src/pages/pos.tsx` e `packages/sync/src/update.test.ts`. O `git diff` mostra só reformatação do Prettier nos arquivos de código e de teste, sem mudança de comportamento. `crm.service.ts`, `mail.service.ts` e `docker-compose.vps.yml` aparecem como `M`, mas sem diferença de conteúdo (só fim de linha). **Nenhuma falha vem dessas alterações:** `connector.spec.ts` e `update.test.ts` passaram. Nada foi revertido.

**O que não foi executado, e por quê:**
- **API contra PostgreSQL 16 real:** não há Docker nem PostgreSQL nesta máquina. A CI cobre isso no job "API contra PostgreSQL 16 e Redis reais".
- **Testes Rust (`apps/desktop/src-tauri`) e WebView real (`tauri-driver`):** não há `cargo` nesta máquina.
- **E2E do kit `kits/pdv-embed` e conformidade PHP:** fora do escopo pedido. Só os testes unitários do kit rodaram (5 de 5 passaram).

## 2. Comandos executados

| # | Comando | Resultado | Passaram / falharam / pulados | Duração |
|---|---|---|---|---|
| 1 | `pnpm lint` | ✅ exit 0, nenhum aviso | n/a | 336 s* |
| 2 | `pnpm typecheck` | ✅ exit 0 (cache) | 15 de 15 tarefas | 1 s |
| 3 | `pnpm typecheck --force` | ✅ exit 0, 0 `error TS` | 15 de 15 tarefas, 0 em cache | 138 s |
| 4 | `pnpm test --force --continue` | ✅ exit 0 | **1.556 testes passaram, 0 falharam, 0 pulados**, em 213 arquivos (13 pacotes) | 668 s (11min07) |
| 5 | `pnpm test:e2e --reporter=list` (completo) | ❌ exit 1 | **112 passaram, 1 falhou, 93 pulados** (206 no total) | 1.406 s (23,4 min) |
| 6 | `playwright test e2e/admin.spec.ts --project=web` (nova execução isolada) | ✅ exit 0 | 2 passaram, 0 falharam | 46 s |

\* O `eslint .` também percorre `.claude/worktrees/` (seis cópias do repositório de outros agentes), porque essa pasta não está nos `ignores` do `eslint.config`. Isso explica boa parte dos 336 s. É um efeito do ambiente, não do projeto, mas vale incluir `.claude/**` nos `ignores`.

**Testes por pacote (`pnpm test`):**

| Pacote | Arquivos | Testes | Cobertura (linhas / ramos) |
|---|---|---|---|
| @bipae/api | 83 | 430 | sem medição |
| @bipae/fiscal | 63 | 651 | **98,07 % / 91,18 %** (statements 97,34 %, funções 99,03 %) |
| @bipae/domain | 21 | 145 | 96,89 / 90,99 |
| @bipae/pdv-core | 10 | 89 | 96,08 / 87,03 |
| @bipae/platform | 8 | 76 | 98,16 / 89,29 |
| @bipae/pdv-ui | 9 | 49 | sem medição |
| @bipae/erp-ui | 10 | 46 | sem medição |
| @bipae/danfe | 1 | 27 | 99,59 / 91,32 |
| @bipae/ui | 1 | 13 | sem medição |
| @bipae/promotions | 1 | 11 | 100 / 89,39 |
| @bipae/sync | 2 | 8 | sem medição |
| @bipae/local-db | 1 | 6 | 100 / 88,88 |
| @bipae/pdv-embed | 3 | 5 | sem medição |

`apps/web`, `apps/desktop` e `apps/site` não têm testes unitários.

**Motor fiscal: cobertura de 90 % ou mais.** ✅ VERIFICADO. `packages/fiscal/vitest.config.ts` define `thresholds` de 90 % para linhas, funções, ramos e statements, e `test` roda `vitest run --coverage`. O limite é aplicado em toda execução de `pnpm test`, inclusive na CI. O ponto mais apertado são os ramos, com 91,18 %.

**E2E:** 206 testes, 103 por projeto. No projeto `desktop-ui`, 93 dos 103 são pulados por `test.skip(() => project.name !== 'web')`, então só 10 rodam na casca desktop. O projeto `web` rodou todos os 103.

## 3. Falhas, com causa raiz e evidência

### R4-F01: `admin.spec.ts:32`, o acesso de suporte não mostrou a faixa no prazo (FALHA INTERMITENTE)

- **Execução 1 (suíte completa):** ❌ falhou em 48,1 s.
  ```
  Locator: getByText('Modo suporte Bipaê · somente leitura')
  Expected: visible   Timeout: 5000ms   Error: element(s) not found
  > 94 | await expect(supportTab.getByText('Modo suporte Bipaê · somente leitura')).toBeVisible();
  ```
  Trace: `apps/web/test-results/admin-super-admin-2FA-over-c273b-a-client-and-support-access-web/trace.zip`.
- **Execução 2 (spec isolado):** ✅ passou em 14,1 s.
- **Causa provável:** instabilidade de tempo, não erro de código. O teste abre uma **aba nova** (`adminCtx.waitForEvent('page')`) e espera a faixa de suporte com o limite padrão de 5 s. Na suíte completa, este foi o 7º teste e veio logo depois dos testes pesados de acessibilidade (`a11y.spec.ts`, até 300 s). A aba nova carrega o app inteiro do Vite e faz a troca da sessão de suporte, e isso passou de 5 s sob carga. Rodando sozinho, levou 14 s no total.
- **Classificação:** FORTE INDÍCIO de teste instável. Não foi reproduzida como falha de produto.
- **Risco para a CI:** `playwright.config.ts` usa `retries: process.env.CI ? 1 : 0`. Na CI, a nova tentativa esconde esse tipo de instabilidade.
- **Correção proposta:** esperar primeiro a navegação da aba nova (`await supportTab.waitForLoadState()`) e depois aplicar um `timeout` explícito (por exemplo 15 s) só nessa asserção. Também vale registrar o tempo da troca de sessão de suporte.
- **Aceite:** 5 execuções seguidas da suíte completa sem falha nesse teste.

Nenhuma outra falha em lint, typecheck, testes unitários ou E2E.

## 4. Matriz módulo × testes

**Método.** Um script lê os decoradores `@Controller` e `@Get/@Post/...` de `apps/api/src/modules/**` e procura cada rota (com os parâmetros trocados por curinga) nos textos de `apps/api/test/**` e `apps/web/e2e/**`. É uma heurística estática: confirmei à mão que ela errou ao dar `payments/webhooks/pix-api/:token/pix` como sem teste (está em `payment-webhooks.test.ts:113`). Os outros casos que conferi à mão estavam corretos.

**Resultado:** 388 rotas. 357 aparecem em testes de API, 33 são chamadas diretamente no E2E (o E2E passa pela interface, então o número é naturalmente baixo) e 29 não aparecem em teste nenhum (28 depois de descontar o erro da heurística).

| Módulo | Rotas | Rotas em teste de API | Chamadas no E2E | Sem teste | Testes negativos de tenant (cross-tenant) | Testes de permissão (403) |
|---|---|---|---|---|---|---|
| account | 3 | 3 | 0 | 0 | data-rights (exportação sem dados de outro cliente) | não |
| admin (plataforma) | 41 | 32 | 0 | **9** | platform.test (11 contas) | sim (8 asserções de 403) |
| ai | 10 | 10 | 0 | 0 | não | sim (2) |
| audit | 2 | 2 | 0 | 0 | tenancy (`audit_log` na lista) | sim (tenancy) |
| auth | 18 | 18 | 0 | 0 | auth, security (troca de empresa, suporte) | sim |
| billing | 9 | 7 | 0 | 2 | billing (10 contas) | sim (1 a 2) |
| catalog | 21 | 20 | 3 | 1 | tenancy, price-tables, product-images | sim (tenancy, product-images) |
| channels | 13 | 10 | 0 | **3** | channels.test:253 | não |
| crm | 9 | 9 | 0 | 0 | campaigns (2 contas) | sim (crm, campaigns) |
| downloads | 1 | 1 | 1 | 0 | n/a | n/a |
| finance | 17 | 17 | 0 | 0 | finance (2 contas) | sim (2) |
| fiscal | 69 | 67 | 5 | 2 | nfe-invoices, nfse, dfe, nfce-emission, certificates | **nenhum 403 nos testes fiscais** |
| mercadoflow | 33 | 26 | 19 | **5** | mercadoflow, mercadoflow-confere:474 | sim (1) |
| organization | 10 | 10 | 1 | 0 | transfers, tenancy | sim (store-permissions) |
| parties | 10 | 8 | 4 | 2 | tenancy, store-credit, conditionals | sim (store-credit) |
| payments | 22 | 19 | 0 | 3 | payment-settings:63, payment-webhooks:385, pix-api | não |
| public-api | 16 | 15 | 0 | 1 | public-api:206, api-keys | sim (api-keys) |
| purchases | 12 | 12 | 0 | 0 | purchases:148/153, purchase-orders:109 | **não** |
| reports | 3 | 3 | 0 | 0 | não | não |
| sales | 43 | 43 | 0 | 0 | sync (produto de outro tenant), sellers, service-orders, tabs | sim (sellers, operator-change) |
| stock | 14 | 13 | 0 | 1 | transfers, losses | não |
| sync | 3 | 3 | 0 | 0 | sync.test:184-206 (terminal adulterado) | sim (2) |
| team | 9 | 9 | 0 | 0 | invites, tenancy | sim (invites, store-permissions) |
| maintenance, mail | sem rotas | n/a | n/a | n/a | importados em 15 e 3 arquivos de teste | n/a |

**Rotas sem nenhum teste (heurística, conferida por amostragem):**
- **admin:** `POST /admin/tenants/:id/cancel`, `POST /admin/tenants/:id/users/:userId/revoke-sessions`, `POST /admin/users/:userId/revoke-sessions`, `PUT /admin/plans/:id`, `PUT /admin/announcements/:id`, `POST /admin/announcements/:id/end`, `POST /admin/admins/:userId/reset-totp`, `POST /admin/auth/logout`, `GET /admin/auth/me`.
- **channels:** `POST /channels/inbound/:tenantId/:key` (entrada pública de pedidos), `POST /channels/integrations/:id/secret`, `DELETE /channels/integrations/:id/links/:sku`.
- **payments:** `POST /payments/pix/charges/:txid/cancel`, `POST /boletos/:id/refresh`.
- **mercadoflow:** `confere/:storeId/upload|sync|ledger|orders|orders/:orderId`.
- **billing:** `DELETE /account/billing/pending-change`, `POST /account/billing/invoices/:id/check`.
- **Outras:** `GET/PUT /suppliers/:id`, `GET /stock/transfers/:id`, `GET /public/stores`, `GET /fiscal/municipios[/:code]`, `GET /products/categories`.

**Isolamento de tenant (`apps/api/test/tenancy.test.ts`).** Pontos fortes:
1. Verifica que **todas** as tabelas do schema `public` têm `relrowsecurity` ligado, menos as de plataforma.
2. Verifica que um tenant B vê zero linhas do tenant A e que a escrita com `tenant_id` alheio é recusada.
3. Verifica que B recebe 404 no produto de A.
4. Verifica que o papel de cliente não acessa as tabelas de plataforma.

`withTenant` troca para o papel `bipae_app` (`apps/api/src/db/client.ts:70`), então o RLS realmente vale nos testes. **Lacuna:** a verificação de vazamento de linhas usa uma lista fixa de 25 tabelas (`TENANT_TABLES`, as de `0001_init`). Há cerca de 105 `create table` nas migrações. Nas tabelas novas, o teste só confere se o RLS está ligado, não se a **policy** está correta: uma policy `using (true)` passaria. Não há teste que leia `pg_policies` (ver R4-01).

**Permissões.** Há um guard global (`APP_GUARD`, `AuthGuard`) e 368 usos de `@RequirePermission`. 13 rotas não declaram permissão. São rotas de autoatendimento da conta (`auth/me`, `totp/*`, `switch-tenant`, `account`, `announcements`) e duas de cobrança: `GET /account/billing` e `POST /account/billing/invoices/:id/check`. Essas duas ficam abertas a qualquer papel autenticado, inclusive o operador de caixa. Não há teste genérico que garanta que toda rota declara `@RequirePermission`, `@Public` ou `@PlatformPermission`. As asserções de 403 aparecem em 21 dos 83 arquivos de API e não aparecem nos módulos fiscal, purchases, payments, channels, stock e reports.

**Trilha de auditoria (regra 8).** O código registra 131 ações diferentes. Os testes verificam `sale.cancelled`, `sale.returned`, `stock.adjusted`, `product.price_changed`, `nfe.cancelled`, `nfse.cancelled`, `finance.cancelled` e as alterações fiscais de ICMS. **Nenhum teste verifica `sale.discount_authorized`** (desconto acima do limite, `sync.service.ts:438`) **nem `cash.withdrawal`** (sangria, `sync.service.ts:299`). Também ficam sem verificação `boleto.canceled` e `fiscal_rule.deleted`.

**Jornadas essenciais no E2E** (projeto `web`, todas ✅ nesta execução):

| Jornada | Spec |
|---|---|
| Fundação (cadastro, produto, caixa, login) | `foundation.spec.ts` |
| Venda online e offline, desconto com gerente, crediário, troca de operador, OPFS e IndexedDB | `pos.spec.ts` (7) |
| Pedido offline | `order-offline.spec.ts` |
| Pix e maquininha | `payments.spec.ts` |
| Financeiro | `finance.spec.ts` (6) |
| NFC-e em contingência | `nfce-contingency.spec.ts` |
| Painel super admin | `admin.spec.ts` (falha intermitente, ver R4-F01) |
| Recuperação de senha | `password-reset.spec.ts` (3) |
| Convites | `invites.spec.ts` |
| Permissão por loja | `store-permissions.spec.ts` |
| Duas etapas | `two-step.spec.ts` |
| Acessibilidade | `a11y.spec.ts` |
| Carga com 100 mil produtos | `load.spec.ts` |

**Gate do deploy.** `deploy.yml` roda lint, typecheck, test, os testes da API com PostgreSQL e o smoke test, mas **não roda o E2E**. O E2E só roda no `ci.yml`, em paralelo, então um E2E vermelho não segura o deploy (ver R4-06).

## 5. Lacunas de teste priorizadas

| ID | Sev. | Arquivo / alvo | Teste proposto |
|---|---|---|---|
| R4-01 | Alta | `apps/api/test/tenancy.test.ts` | Gerar a lista de tabelas com `tenant_id` dinamicamente (`information_schema.columns`), semear pelo menos uma linha no tenant A em cada uma (direto pelo papel de plataforma) e afirmar que B vê zero. Conferir também em `pg_policies` que toda policy usa `app.tenant_id`. |
| R4-02 | Alta | `apps/api/test/sync.test.ts` | Venda com desconto acima do limite autorizada pelo gerente: o evento grava `sale.discount_authorized` com `authorizedBy`. Sangria grava `cash.withdrawal` com o valor. `/audit/verify` continua íntegro (regra 8). |
| R4-03 | Alta | novo `apps/api/test/route-guards.test.ts` | Percorrer as rotas registradas no Nest e afirmar que cada uma tem `@RequirePermission`, `@Public`, `@PlatformPermission` ou está numa lista explícita de autoatendimento. Rota nova sem declaração derruba o teste. |
| R4-04 | Média | fiscal, purchases, payments, channels, stock, reports | Operador de caixa recebe 403 nas rotas de escrita, por exemplo `POST /fiscal/nfe`, `POST /purchases`, `POST /payments/pix/charges/:txid/cancel`, `POST /stock/adjustments` e cancelamento de NF-e. |
| R4-05 | Média | `apps/api/test/platform.test.ts` | Cobrir as 9 rotas do painel sem teste, principalmente `tenants/:id/cancel` (afeta a exclusão LGPD), `revoke-sessions` (a sessão revogada recebe 401 depois) e `admins/:userId/reset-totp` (exige permissão e grava em `platformAudit`). Incluir o caso negativo do papel sem a `@PlatformPermission`. |
| R4-06 | Média | `.github/workflows/deploy.yml` | Fazer o deploy depender do E2E (no mínimo das jornadas essenciais), ou disparar o deploy por `workflow_run` do CI verde. |
| R4-07 | Média | `apps/api/test/channels.test.ts` | `POST /channels/inbound/:tenantId/:key`: chave errada dá 401/404, chave de outro tenant é recusada, pedido repetido é idempotente. |
| R4-08 | Média | `apps/api/test/pix-api.test.ts`, `boletos.test.ts` | Cancelamento de cobrança Pix (`/pix/charges/:txid/cancel`): grava auditoria, não cancela cobrança paga, outro tenant recebe 404. `boletos/:id/refresh` fica idempotente. |
| R4-09 | Média | `apps/web/e2e/admin.spec.ts:94` | Tornar a espera da aba de suporte robusta (R4-F01). |
| R4-10 | Baixa | `apps/web/e2e/st-pauta.spec.ts:7`, `apps/api/test/st-pauta.test.ts:15-18` | Bomba-relógio: depois de 31/12/2026 o E2E é pulado e o teste da API só verifica o ramo "sem pauta". Fixar a data com `vi.setSystemTime` e a data do navegador (`page.clock`) para testar os dois ramos sempre. |
| R4-11 | Baixa | `apps/api/test/mercadoflow-confere.test.ts` | Cobrir `confere/:storeId/upload`, `sync`, `ledger` e `orders`, incluindo loja de outro tenant (404). |
| R4-12 | Baixa | `apps/api/test/billing.test.ts` | Cobrir `DELETE pending-change` e `invoices/:id/check`. Decidir se o operador de caixa deve ler `GET /account/billing`. |
| R4-13 | Baixa | `apps/web/e2e/*` (projeto `desktop-ui`) | Só 10 de 103 testes rodam na casca desktop. Rodar ao menos `pos.spec.ts` e `foundation.spec.ts` também ali (alguns já rodam), para provar a ADR-0012 nas jornadas de venda. |
| R4-14 | Baixa | `eslint.config.*` | Ignorar `.claude/**`, para o lint local não varrer os worktrees de agentes (336 s). |
| R4-15 | Baixa | `apps/web`, `apps/site` | Nenhum teste unitário. As cascas são finas (ADR-0012), então o risco é baixo, mas falta ao menos um teste de fumaça do roteamento e do service worker. |

## 6. Testes frágeis

- **`.only`, `.todo`, `fixme`, `xit`:** nenhum encontrado.
- **`test.skip` condicional:** 67 ocorrências por projeto (`project.name !== 'web'`), que são intencionais e documentadas. Há duas exceções:
  - `st-pauta.spec.ts:7` depende da data (ver R4-10).
  - `kits/pdv-embed/e2e/pdv.spec.ts:29,142,162` pula por projeto, o que é intencional.
- **Testes sem asserção:** de 1.643 blocos `it`/`test` varridos, só um não tem `expect`: `queue.test.ts:49`, que afirma de forma implícita com o helper `ate()`, que lança erro no tempo limite. É aceitável.
- **Esperas fixas:**
  - Em sondagem com limite (`for ... setTimeout(100)` e depois `throw`), em `nfce-emission`, `nfe-invoices`, `nfse`, `conditional-nfe` e `dfe`. É aceitável.
  - **Esperas que provam ausência** (frágeis, podem dar falso positivo):
    - `password-reset.test.ts:172` e `:186` (100 ms antes de afirmar que nenhum e-mail saiu);
    - `mercadoflow-pendings.test.ts:429` (200 ms antes de afirmar que não foi criado um segundo pedido);
    - `pdv-ui/src/register-redesign.test.tsx:201` (300 ms antes de afirmar que a busca não abriu).

    Proposta: esvaziar a fila e esperar ela ficar ociosa, em vez de esperar um tempo fixo.
- **E2E:** nenhum `waitForTimeout`. Os `test.setTimeout` longos (`a11y` 300 s, `load` 600 s) são justificados.
- **Instabilidade confirmada:** `admin.spec.ts:32` (R4-F01). `retries: 1` na CI esconde esse tipo de caso.

## 7. Parecer R4

- **Executado:** lint ✅, typecheck ✅ (sem cache) e testes unitários e de integração ✅. Foram **1.556 de 1.556** testes, sendo 430 da API com PGlite e 651 do motor fiscal com cobertura de 98,07 % das linhas e 91,18 % dos ramos, acima do limite de 90 % aplicado por configuração.
- **E2E completo:** 112 passaram, 1 falhou e 93 foram pulados (por casca). A única falha foi intermitente e passou ao reexecutar isolada.
- **Bloqueado:** API com PostgreSQL real, testes Rust e WebView real do Tauri, por falta de Docker, PostgreSQL e `cargo` na máquina. A CI cobre esses pontos e não foram verificados aqui.
- **Análise estática:** 92,5 % das rotas da API (357 de 388) aparecem em testes de API. As lacunas relevantes são:
  - verificação de vazamento entre tenants limitada a 25 tabelas;
  - nenhum teste da auditoria de desconto autorizado e de sangria;
  - nenhum teste que obrigue toda rota a declarar permissão;
  - nenhum 403 nos testes de fiscal, compras, pagamentos, canais, estoque e relatórios;
  - 9 rotas do painel sem teste;
  - deploy sem gate de E2E.
- **Conclusão R4:** **APROVADO COM RESSALVAS** quanto a regressões. Nenhuma falha reproduzível de produto foi encontrada no escopo executado. As lacunas R4-01 a R4-03 (Alta) devem virar testes na fase de correção. A instabilidade R4-F01 deve ser corrigida antes de contar com o E2E como gate.

**Portas e processos.** Depois de todas as execuções, as portas 3333, 3334, 5173, 5174, 1421, 47810 e 47811 estão livres. Não ficou nenhum processo `node` ou `chromium` do Playwright. Os dois `chrome.exe` novos são do Chrome do usuário (`C:\Program Files\Google\Chrome`).
