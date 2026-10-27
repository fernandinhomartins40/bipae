# Plano mestre da auditoria

> Ordem do protocolo: vulnerabilidades e vazamentos → receita e isolamento → perda de dados → jornadas
> essenciais → regressões → gargalos medidos → produto. IDs `ACH-*` em `ACHADOS_CONSOLIDADOS.md`.

## Lote 1 — executado nesta rodada (27/10/2026)

| ID | Categoria | Problema comprovado | Evidência | Impacto | Prob. | Prioridade | Correção | Teste de aceite | Estado |
|---|---|---|---|---|---|---|---|---|---|
| ACH-01 | Segurança | Convite sem trava de tentativas | `auth.service.ts` `acceptInvite` | Tomada de conta | Média | P0 | Trava por e-mail igual ao login | `invites.test.ts`: 11ª tentativa = 429 | Feito |
| ACH-02 | Segurança | IP falsificável; limite de login dava 500 | `app.ts` `trustProxy: true` | Força bruta sem limite | Alta | P0 | `TRUST_PROXY_HOPS=2`; 429 em pt-BR | `security.test.ts` (R1-01) | Feito |
| ACH-03 | Segurança/auditoria | Evento do caixa cancela venda de outra loja; autor só pelo evento | `sync.service.ts` | Fraude interna sem rastro | Média | P0 | Recusa por loja; `sentBy` e `permissionVerified` na trilha | `sync.test.ts` (PIE R1-03) | Feito em parte |
| ACH-04 | Dados/disponibilidade | Evento envenenado trava o caixa | `sync.service.ts`, `packages/sync` | Caixa sem enviar vendas nem receber preços | Média | P0 | Pull com push parcial; savepoint; log sem PII. A recusa automática foi desfeita (perdia venda paga) | `sync.test.ts` (API e pacote) | Feito em parte |
| ACH-05 | Dados | Enter grava preço antigo | `packages/ui` `MoneyField` | Preço errado no caixa | Alta | P1 | Valor a cada tecla; Enter barra texto inválido | `ui.test.tsx` | Feito |
| ACH-06 | Dados | Contagem vazia zera estoque | `products.tsx` | Estoque zerado | Média | P1 | `parseQuantity` | typecheck + suíte | Feito |
| ACH-07 | Receita | Preço/limite do plano mal lidos | `admin-pages.tsx` | Cobrança errada | Média | P1 | `parseBRL`; limites só com dígitos | typecheck | Feito |
| ACH-12 | Receita | Reativação fura limite | `catalog.service.ts`, `team.service.ts` | Uso acima do plano | Média | P1 | `assertCanAdd` ao reativar | `platform.test.ts` | Feito |
| ACH-13 | Segurança | Dono desprotegido; papel de outra empresa | `team.service.ts` | Elevação de privilégio | Baixa | P1 | Só Dono mexe em Dono; último Dono | `platform.test.ts` | Feito |
| ACH-14 | LGPD | Suporte baixa exportação | `account.controller.ts` | Dados de clientes fora | Baixa | P1 | 403 no modo suporte | `platform.test.ts` | Feito |
| ACH-15 | UX | Validação em inglês | `common/errors.ts` | Usuário não entende | Alta | P2 | Locale pt do Zod | suíte da API | Feito |
| ACH-16 | Dados | Baixa com R$ 0,00 | `finance.tsx` | Financeiro errado | Média | P2 | Botão desabilitado sem valor | typecheck | Feito |
| ACH-17 | Produto | Aviso fiscal desatualizado | `fiscal-profiles.tsx` | Confusão | Alta | P2 | Texto correto | E2E `fiscal-profiles.spec` | Feito |
| OP-01/03/05 | Produto | Início sem lucro e sem passos fiscais; inadimplência sem atalho | `home.tsx`, `delinquency.tsx`, `parties.tsx` | Esforço do dono | — | P2 | Ver `OPORTUNIDADES_PRODUTO.md` | E2E `finance.spec`, `foundation.spec` | Feito |
| ACH-08 | Dados | Caixa perde venda ao recarregar | `pdv-ui/register.tsx` | Venda perdida | Média | P1 | Rascunho no SQLite local | `service.test.ts` (venda em andamento) | Feito |
| ACH-09 | Dinheiro | Cobrança pendente ao sair do pagamento | `pdv-ui/dialogs.tsx` | Cliente paga venda que não existe | Média | P1 | Cancela no PSP ao fechar; se já pago, entra na venda | typecheck; teste de componente no plano | Feito |
| ACH-18 | Segurança | Rotas sem permissão declarada | `common/auth.ts` | Acesso por qualquer membro | Baixa | P1 | Teste por metadados + permissão na conferência da fatura | `route-guards.test.ts` | Feito |
| ACH-19 | Segurança | Isolamento testado em 25 tabelas | `tenancy.test.ts` | Vazamento não detectado | Baixa | P1 | Lista do banco + políticas | `tenancy.test.ts` | Feito |
| R4-14 | Qualidade | Lint varria `.claude/` | `eslint.config.js` | Lint de 336 s | — | P3 | Ignorar `.claude/**` | `pnpm lint` | Feito |

## Lote 2 — próxima rodada (sem decisão pendente)

| ID | Problema | Correção proposta | Teste de aceite |
|---|---|---|---|
| ACH-04 (resto) | Evento travado sem quarentena | Tabela de eventos recusados no servidor + "reenviar" no caixa + aviso no painel | Venda com número repetido não some e o dono vê o caixa travado |
| ACH-30 | Duas tabelas sem FORCE RLS | Migração `alter table ... force row level security` | `tenancy.test.ts` sem exceções "sem motivo" |
| ACH-03 (resto) | Autorização do gerente sem prova | HMAC emitido por `/auth/authorize` e conferido no `sync` | Prova falsa vira `needs_review` |
| ACH-20 | Corrida na NFC-e | Reserva `status='sending'`; retry só enfileira | Duas emissões simultâneas = uma autorização |
| ACH-21 | Fila em série sem dedupe | `jobId` determinístico; filas por tipo | Varredura não duplica tarefas |
| ACH-22 | Outbox do MercadoFlow perde atualização | Coluna `version` (migração nova) | Alteração durante envio sai no próximo |
| ACH-23 | PSP dentro da transação | Chamar fora, aplicar com compare-and-set | Pool não esgota com PSP lento |
| ACH-25/26 | Health raso; imagem de 948 MB | `/v1/health/ready`; `pnpm deploy --prod` | Imagem < 300 MB |
| ACH-28 | E2E não segura deploy | Deploy depende do E2E essencial; estabilizar `admin.spec` | Deploy para com E2E vermelho |
| ACH-29 | UX do caixa e confirmações | `ConfirmDialog`, `QuantityField`, trava de duplo envio | Testes de componente |
| OP-02/04/06/07/08–13 | Produto | Ver `OPORTUNIDADES_PRODUTO.md` | — |

## Precisa do dono

| ID | Decisão |
|---|---|
| ACH-24 | Antes do próximo push: os 36 commits locais incluem 8 migrações. Aprovar o envio sabendo que o rollback automático roda o código antigo sobre o schema novo (as migrações conferidas são só acréscimos). |
| ACH-10 | Backup diário fora da VPS (custo de armazenamento) e teste de restauração. |
| ACH-11, ACH-27 | Swap, limites de memória das outras aplicações e usuário de deploy sem root (infra compartilhada). |
| R1-09, INV-SAAS-08 | Política de funcionalidades por plano. |
| B01–B10 | Ver `OPORTUNIDADES_PRODUTO.md`. |
