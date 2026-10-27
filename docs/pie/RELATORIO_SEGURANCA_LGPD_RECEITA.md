# Relatório de segurança, LGPD e proteção de receita

> Base: `BANCA_R1_SEGURANCA.md` (análise estática), contestação do Auditor-Chefe e testes negativos
> escritos e executados nesta rodada (PGlite, ambiente de teste, dados sintéticos). Nenhum teste foi
> feito contra a produção nem contra dados reais. Isto não é um parecer jurídico de conformidade com a
> LGPD.

## Testes negativos executados (automatizados, verdes)

| Cenário | Esperado | Arquivo |
|---|---|---|
| 10 senhas erradas no aceite de convite com o e-mail de outra pessoa | 11ª tentativa recebe 429, mesmo com a senha certa; convite continua válido | `apps/api/test/invites.test.ts` |
| Cliente troca o primeiro IP do `X-Forwarded-For` a cada login | Limite por IP vale igual e responde 429 em pt-BR (antes: escapava e, quando barrava, respondia 500) | `apps/api/test/security.test.ts` |
| Caixa da loja B cancela venda da loja A | Evento recusado com motivo | `apps/api/test/sync.test.ts` |
| Operador sem `pos.sale.cancel` cancela venda | Venda cancelada (o caixa nunca perde evento), mas a trilha grava `sentBy` e `permissionVerified: false` | `apps/api/test/sync.test.ts` |
| Suporte Bipaê em modo leitura pede a exportação LGPD | 403 `support_export` | `apps/api/test/platform.test.ts` |
| Reativar produto e pessoa no limite do plano | 403 | `apps/api/test/platform.test.ts` |
| Papel personalizado com `admin.users` tenta desativar o Dono ou dar o papel de Dono | 403 `owner_only` | `apps/api/test/platform.test.ts` |

Já existiam e continuam verdes: isolamento entre empresas em 25 tabelas (`tenancy.test.ts`), trava de
login por e-mail, 2FA, rotação de sessão, webhooks de pagamento confirmados na API do provedor,
SSRF do Pix, chaves da API pública (`security.test.ts`, `payment-webhooks.test.ts`, `api-keys.test.ts`).

## Riscos que continuam abertos

| Risco | Severidade | O que falta |
|---|---|---|
| Teste de vazamento entre empresas cobre 25 de ~105 tabelas (R4-01) | Alta | Teste gerado de `information_schema` + `pg_policies` |
| Autorização do gerente no caixa sem prova verificável (R3-05) | Média | Prova assinada (HMAC) emitida pelo `/auth/authorize` e conferida no `sync` |
| Rotas sem permissão declarada passam para qualquer membro (R4-03) | Média | Teste que obrigue a declaração; decidir `GET /account/billing` |
| Recursos do plano (`features`) não aplicados no servidor (R1-09) | Baixa até o dono definir a política comercial | Decisão comercial |
| Cota da IA conferida uma vez por pergunta (R1-08) | Baixa | Trava por chamada |
| Webhook de saída com janela de DNS rebinding (R1-07, risco aceito A-05) | Baixa | Fixar o IP resolvido na conexão |
| Erros 500 registrados por inteiro no log (R1-14) | Baixa (PII em log) | Sanitizar a mensagem do PostgreSQL |
| `node-forge` com vulnerabilidade alta ignorada com justificativa (A-01) | Registrada | Acompanhar |

## Receita (fluxo identidade → tenant → plano → pagamento → autorização)

- Limites de quantidade: `limits.assertCanAdd` na criação **e agora na reativação** (produtos,
  pessoas). Empresas, lojas e caixas não têm reativação que contorne o limite (conferido por R1).
- Assinatura: webhooks de PSP não confirmam sozinhos; a cobrança é consultada no provedor (R1).
- Painel admin: preço do plano agora é lido como reais com `parseBRL` (antes "49.90" virava R$ 4.990,00).
- Funcionalidades diferentes por plano (PRD §8): **não localizadas** no servidor (inventário INV-SAAS-08).

## LGPD (técnico, não jurídico)

- Exportação e exclusão de dados existem e têm teste (`data-rights.test.ts`); exportação agora não
  pode ser feita pela equipe de suporte em modo leitura.
- Backups do banco ficam no mesmo disco da VPS, guardam ~2 dias e não têm teste de restauração
  (R5-01): risco de disponibilidade e também de retenção não documentada.
- Páginas de privacidade e termos dependem de item externo (E7, inventário INV-LGPD-01).
- Questões para o responsável jurídico/encarregado: prazo de retenção dos backups e dos registros de
  auditoria, base legal das campanhas de CRM e do assistente de IA.
