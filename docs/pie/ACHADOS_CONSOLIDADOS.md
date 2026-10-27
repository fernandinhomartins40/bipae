# Achados consolidados

> Commit auditado `728df79`; correções feitas na árvore de trabalho em 27/10/2026. Detalhes, linhas e
> reprodução de cada item estão nos pareceres `BANCA_R*.md` e em `ANALISE_PRODUTO_FRONTEND.md`.
> Estados de prova: CONFIRMADO, FORTE INDÍCIO, HIPÓTESE, NÃO REPRODUZIDO.
> Situação: **CORRIGIDO** (com teste), **PLANO** (próxima rodada), **DECISÃO DO DONO**, **AÇÃO NA VPS**.

## Bloqueadores e Altos

| ID | Causa raiz | Origem | Severidade | Prova | Situação |
|---|---|---|---|---|---|
| ACH-01 | Aceitar convite sem trava de tentativas: adivinha senha e 2FA de qualquer pessoa e entrega a sessão dela | R1-02 | Alta | CONFIRMADO | **CORRIGIDO**: `auth.service.ts` (`acceptInvite` usa `checkFailures`/`recordFailure`); teste `invites.test.ts` |
| ACH-02 | IP do cliente falsificável (`trustProxy: true`) e limite de login respondendo 500 | R1-01, R5-08 + contestação | Média→Alta pelo efeito combinado com ACH-01 | CONFIRMADO | **CORRIGIDO**: `TRUST_PROXY_HOPS=2` (`config.ts`, `app.ts`) e `errorResponseBuilder` com 429 em pt-BR; teste `security.test.ts` |
| ACH-03 | O servidor confia no conteúdo do evento do caixa: cancela venda de outra loja; autoria só pelo `operatorId` do evento; autorizador sem prova | R1-03, R3-05, R4-02 | Alta (ameaça interna) | CONFIRMADO | **CORRIGIDO em parte**: recusa cancelamento de outra loja; trilha grava `sentBy` (quem enviou) e `permissionVerified` em cancelamento e sangria; teste `sync.test.ts`. **PLANO**: prova assinada da autorização do gerente (R3-05) e limite de desconto conferido no servidor |
| ACH-04 | Evento com erro permanente de banco trava o caixa para sempre (envio e recebimento de catálogo) | R3-01 | Alta | CONFIRMADO e reproduzido | **CORRIGIDO em parte**: o caixa recebe catálogo e preços mesmo com o envio travado (`packages/sync`); a conferência de impostos roda em savepoint; o log diz qual caixa e qual evento travou, sem dados pessoais. A primeira versão recusava o evento e foi **desfeita** pela revisão adversarial: recusar perdia uma venda já paga (regra 6). **PLANO**: quarentena no servidor + "reenviar" no caixa (migração nova). Testes `sync.test.ts` (API e pacote) |
| ACH-05 | Campo de dinheiro com Enter grava o valor antigo (25 telas) | R2-01 | Alta | CONFIRMADO e reproduzido | **CORRIGIDO**: `MoneyField` avisa a cada tecla; texto inválido marca o campo como inválido para o navegador (`setCustomValidity`) e o Enter não envia; teste `ui.test.tsx`. Resíduo: formulários com `noValidate` ainda enviam pelo clique o último valor válido, com o erro visível no campo |
| ACH-06 | Contagem vazia zera o estoque | R2-04 | Alta | CONFIRMADO | **CORRIGIDO**: campo vazio recusado; contagem igual a zero continua aceita (a primeira versão recusava o zero; achado da revisão adversarial). Resíduo: usa sempre a primeira loja (PLANO) |
| ACH-07 | Preço e limites do plano no painel admin lidos errado | R2-05 | Alta (receita) | CONFIRMADO | **CORRIGIDO**: `parseBRL` e limites só com dígitos (`admin-pages.tsx`) |
| ACH-08 | Caixa perde a venda em andamento ao recarregar | R2-02 | Alta | FORTE INDÍCIO | **CORRIGIDO**: a venda em andamento fica no banco local do caixa (`PdvService.saveDraft/loadDraft`) e volta sozinha depois de recarregar; teste `pdv-core/service.test.ts` |
| ACH-09 | Sair do pagamento com Pix/maquininha pendente não cancela a cobrança | R2-03 | Alta | FORTE INDÍCIO | **CORRIGIDO**: fechar a janela cancela a cobrança pendente no banco/maquininha; se ela já tinha sido paga, o pagamento entra na venda e a janela fica aberta (`pdv-ui/dialogs.tsx`). Sem teste automatizado de componente (PLANO) |
| ACH-10 | Backup só no deploy, no mesmo disco, sem teste de restauração (~2 dias de histórico) | R5-01 | Alta | CONFIRMADO (medido) | **AÇÃO NA VPS / DECISÃO DO DONO**: backup diário por cron, cópia fora da VPS (custo) e teste de restauração |
| ACH-11 | Memória da VPS supercomprometida (~12,9 GiB de limites para 7,75 GiB), sem swap | R5-02 | Alta | CONFIRMADO (medido); efeito é HIPÓTESE | **AÇÃO NA VPS**: swap e limites nos contêineres das outras aplicações (infra compartilhada, exige aprovação) |

## Achados novos da validação

| ID | Achado | Origem | Prova | Situação |
|---|---|---|---|---|
| ACH-30 | `company_certificates` e `company_icms_rules` com RLS ligado mas não forçado (contradiz o R3, que viu "force em todas") | teste novo do ACH-19 | CONFIRMADO | Sem vazamento (a API nunca é dona da tabela). **PLANO**: migração que force as duas. `memberships` e `invites` não forçam de propósito (funções do login) |
| ACH-31 | Textos novos falavam em "emitir nota" sem dizer que é homologação | revisão adversarial | CONFIRMADO | **CORRIGIDO** |
| ACH-32 | Inadimplência abria ficha de "cliente sem cadastro" | revisão adversarial | CONFIRMADO | **CORRIGIDO** |
| ACH-33 | Teste `pdv-ui` "guarda só o hash com sal" falhou 1 vez em 4 | execução | CONFIRMADO (instável) | **PLANO** |

## Médios

| ID | Achado | Origem | Prova | Situação |
|---|---|---|---|---|
| ACH-12 | Reativar produto/pessoa contorna o limite do plano | R1-04 | CONFIRMADO | **CORRIGIDO** (`catalog.service.ts`, `team.service.ts`); teste `platform.test.ts` |
| ACH-13 | Quem tem `admin.users` sem ser Dono desativa o Dono, dá ou cria o papel de Dono; papel de outra empresa aceito | R1-05, R1-13, revisão adversarial | CONFIRMADO | **CORRIGIDO**: `updateMember` e `addMember` (porta achada na revisão adversarial); teste `platform.test.ts` |
| ACH-14 | Suporte em modo leitura baixa a exportação LGPD completa | R1-06 | CONFIRMADO | **CORRIGIDO** (`account.controller.ts`); teste `platform.test.ts` |
| ACH-15 | Validações em inglês chegando ao usuário | R2-06 | CONFIRMADO | **CORRIGIDO**: `z.config(z.locales.pt())` em `common/errors.ts` |
| ACH-16 | Baixa de conta com "Valor pago" vazio registra R$ 0,00 | R2-08 | CONFIRMADO | **CORRIGIDO** (botão desabilitado sem valor, `finance.tsx`) |
| ACH-17 | Aviso "NFC-e chega em breve" desatualizado em Perfis fiscais | R2-P | CONFIRMADO | **CORRIGIDO** (`fiscal-profiles.tsx` e E2E) |
| ACH-18 | Rotas sem permissão declarada passam para qualquer membro | R4-03 | CONFIRMADO | **CORRIGIDO**: teste `route-guards.test.ts` lê os metadados reais do Nest e só aceita a lista justificada de 14 rotas da própria conta; `POST /account/billing/invoices/:id/check` passou a exigir `admin.users` |
| ACH-19 | Teste de isolamento entre empresas só em 25 de ~105 tabelas | R4-01 | CONFIRMADO | **CORRIGIDO**: `tenancy.test.ts` monta a lista no banco (`information_schema`) e confere RLS, política pelo tenant e vazamento em todas. Achou ACH-30 |
| ACH-20 | Corrida na emissão da NFC-e ("Tentar de novo" × fila) | R3-02 | FORTE INDÍCIO | **PLANO** (fiscal só em homologação hoje) |
| ACH-21 | Fila BullMQ em série, sem `jobId`; varredura reenfileira até 200 notas a cada 5 min | R3-03 | FORTE INDÍCIO | **PLANO** |
| ACH-22 | Outbox do MercadoFlow perde atualização feita durante o envio | R3-04 | CONFIRMADO | **PLANO** (coluna `version`, migração nova) |
| ACH-23 | Chamadas ao PSP dentro da transação (pool de 10) | R3-06, R5-09 | FORTE INDÍCIO | **PLANO** |
| ACH-24 | Rollback automático roda código antigo sobre schema novo; 8 migrações pendentes | R5-03, R5-13 | CONFIRMADO | **DECISÃO DO DONO** antes do próximo push (ver veredito) |
| ACH-25 | `/v1/health` não verifica banco nem Redis; sem observabilidade nem alerta | R5-05, R5-06 | CONFIRMADO | **PLANO** |
| ACH-26 | Imagem da API com 948 MB | R5-04 | CONFIRMADO (medido) | **PLANO** |
| ACH-27 | Deploy entra como root na VPS compartilhada | R5-11 | CONFIRMADO | **AÇÃO NA VPS** |
| ACH-28 | E2E não segura o deploy; `admin.spec` instável sob carga | R4-06, R4-09 | CONFIRMADO | **PLANO** |
| ACH-29 | UX: sangria sem trava de duplo envio, ações destrutivas sem confirmação, vírgula impossível na conferência e na ficha técnica, erro de campo invisível | R2-07, R2-09 a R2-12 | CONFIRMADO (estático) | **PLANO** (ver `OPORTUNIDADES_PRODUTO.md`) |

## Baixos

R1-07 a R1-11, R1-14, R1-15; R2-13 a R2-16; R3-07 a R3-15; R4-10 a R4-15; R5-07, R5-10, R5-12.
Todos ficam como **PLANO** nos pareceres de origem. O R4-14 (lint varrendo `.claude/`) foi
**CORRIGIDO** em `eslint.config.js`.

## Controles comprovados como corretos (não são achados)

- RLS com `force` em todas as tabelas com `tenant_id` e `set local role bipae_app` por transação (R1, R3).
- JWT com audiências separadas, renovação girando e detectando reuso, argon2 (R1).
- Webhooks de pagamento confirmam na API do provedor antes de marcar pago (R1).
- Dinheiro em `bigint`/centavos e `decimal.js` no motor fiscal; cobertura do motor 98,07 % das linhas (R3, R4).
- Auditoria encadeada por hash; eventos do caixa idempotentes e em ordem (R3).
- Nenhum segredo no repositório público (R1). Só `127.0.0.1:3400` exposto no host; limites, healthcheck e rotação de log em todos os contêineres do Bipaê (R5).
