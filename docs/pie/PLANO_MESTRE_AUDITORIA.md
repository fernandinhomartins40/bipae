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

## Lote 2 — executado em 28/10/2026

| ID | Problema | Correção | Teste de aceite | Estado |
|---|---|---|---|---|
| ACH-04 (resto) | Evento travado sem quarentena | Tabela `sync_quarantine` (migração 0091): depois de `SYNC_QUARANTINE_ATTEMPTS` falhas em `SYNC_QUARANTINE_MINUTES`, o evento é guardado inteiro e o caixa segue; aviso em Caixas e no Início; "Tentar de novo" reprocessa; trilha `sync.event.quarantined` e `sync.event.reprocessed` | `sync-quarantine.test.ts`: caixa segue, venda guardada, reprocesso falha enquanto a causa existe e entra depois | Feito |
| ACH-30 | Duas tabelas sem FORCE RLS | Migração 0090 | `tenancy.test.ts` sem exceções "sem motivo" | Feito |
| ACH-03 (resto) | Autorização do gerente sem prova | `/auth/authorize` devolve prova HMAC (empresa, gerente, permissão, hora); o caixa manda no evento; o sync marca `authorizationProven` e `needsReview` na trilha, sem recusar a venda | `authorization-proof.test.ts`; `sync.test.ts` (prova válida, ausente e de outra permissão) | Feito |
| ACH-20 | Corrida na NFC-e | Reserva `sending_until` com `select … for update` (migração 0092) na NFC-e e na NF-e; "tentar de novo" com reserva ativa responde 409 | `nfce-emission.test.ts`: três emissões simultâneas = uma consulta e um envio (falha sem a correção) | Feito |
| ACH-21 | Fila em série sem dedupe | `dedupeId` (deduplicação do BullMQ e da fila em memória) nas emissões, cancelamentos, buscas de documentos e avisos de pagamento; `QUEUE_CONCURRENCY` (padrão 4) | `queue.test.ts`: repetida ignorada enquanto roda; tarefa lenta não segura outra | Feito |
| ACH-22 | Outbox do MercadoFlow perde atualização | Coluna `version` (migração 0093); o envio só marca o item que não mudou | `mercadoflow.test.ts`: alteração no meio do envio sai na rodada seguinte | Feito |
| ACH-23 | PSP dentro da transação | Pix e maquininha: lê, chama fora da transação, grava com a cobrança ainda pendente; pedido da maquininha sem registro é cancelado. Pool com tempos máximos e ouvinte de erro (R5-09) | `pix-psp.test.ts`: com o parceiro parado, `/products` responde (trava sem a correção) | Feito |
| ACH-25 | Health raso | `/v1/health/ready` confere banco (503 sem ele) e fila (degradado); o deploy confere no domínio | `health.test.ts` | Feito |
| ACH-26 | Imagem de 948 MB | `pnpm deploy --prod`; a imagem leva só `dist` e dependências de produção (cerca de 125 MB + base) | API sobe e responde `/v1/health/ready` a partir dessa estrutura (Docker indisponível nesta máquina: tamanho final conferido no deploy) | Feito |
| ACH-28 | E2E não segura deploy | Job `e2e` no deploy (foundation, pos, pos-modes, nfce-contingency) antes do build; `admin.spec` espera a aba de suporte | Deploy depende do job | Feito |
| ACH-29 | UX do caixa e confirmações | `ConfirmDialog`, `QuantityField`, trava de duplo envio na sangria, revisão do fechamento, aviso geral para erro sem campo (R2-07, R2-09 a R2-12) | `ui.test.tsx`, `cash-dialog.test.tsx`, `forms.test.ts`, `payment-dialog.test.tsx` (ACH-09), E2E `pos` e `icms-rules` | Feito |
| R3-08 | Cancelamento e devolução só conferidos no caixa | Venda travada; recusa cancelar com devolução e devolver acima do total ou de venda cancelada | `sync.test.ts` (PIE R3-08) | Feito |
| OP-04, OP-07, OP-11, OP-13 (parte) | Produto | Primeiro caixa com um toque; limpar venda e desativar caixa com `ConfirmDialog`; foco em "Finalizar venda" quando o pagamento cobre o total; "N produtos sem estoque" no Início | `pos-app.test.tsx`, `payment-dialog.test.tsx`, typecheck | Feito |

### Ainda no plano (sem decisão pendente)

| ID | Problema | Por que ficou |
|---|---|---|
| OP-08 | Menu em abas | Mexe em 51 rotas e nos seletores de dezenas de specs E2E: rodada própria com o E2E inteiro como rede |
| OP-02 | Compras + Notas de entrada numa tela | Junta duas telas grandes; depende da OP-08 |
| OP-06, OP-09, OP-10, OP-12, OP-13 | Produto (busca no XML, convite por WhatsApp, "Como funciona?", estados vazios, `alert()` restantes) | Próxima rodada de produto |
| R3-07, R3-12, R3-13 | Numeração com lock, chave de `sync_events`, boleto idempotente | Baixos; próxima rodada técnica |

## Precisa do dono

| ID | Decisão |
|---|---|
| ACH-24 | Antes do próximo push: os 36 commits locais incluem 8 migrações. Aprovar o envio sabendo que o rollback automático roda o código antigo sobre o schema novo (as migrações conferidas são só acréscimos). |
| ACH-10 | Backup diário fora da VPS (custo de armazenamento) e teste de restauração. |
| ACH-11, ACH-27 | Swap, limites de memória das outras aplicações e usuário de deploy sem root (infra compartilhada). |
| R1-09, INV-SAAS-08 | Política de funcionalidades por plano. |
| B01–B10 | Ver `OPORTUNIDADES_PRODUTO.md`. |
