# Contestações e conflitos — Auditor-Chefe

> Auditoria PIE V2, 27/10/2026. Commit auditado: `728df79` (main local). Produção roda `07bfa9a`.
> Os cinco revisores (R1 a R5), o especialista de produto (R2-P) e o inventariante trabalharam como
> subagentes separados, com o mesmo inventário inicial e sem ver os pareceres uns dos outros. Todos
> usam o mesmo modelo, então a independência é de contexto, não de modelo.

## Método

Para cada achado Alto e para cada ponto em que dois pareceres pareciam se contradizer, o Auditor-Chefe
leu o código citado e, quando possível, reproduziu o comportamento num teste automatizado. Nenhuma
divergência foi resolvida por votação.

## Achados de severidade Alta conferidos pelo Auditor-Chefe

| Achado | Conclusão | Como foi conferido |
|---|---|---|
| R1-02 (convite sem trava de tentativas) | **CONFIRMADO** | Leitura de `auth.service.ts:341-415`: o ramo `found` chamava `verify` sem `checkFailures`/`recordFailure` e a senha errada não consumia o convite. Depois da correção, o teste `invites.test.ts` ("trava como o login") prova o 429 na 11ª tentativa. |
| R1-03 (evento do caixa sem loja/autor) | **CONFIRMADO**, com ajuste de severidade | `sync.service.ts`: `sale.cancelled` buscava a venda só pelo id e a auditoria usava `event.operatorId` como autor. Fica restrito a membros do **mesmo** tenant com `pos.sell` (não é vazamento entre empresas): Alta como ameaça interna. |
| R3-01 (evento envenenado trava o caixa) | **CONFIRMADO e reproduzido** | Teste novo em `sync.test.ts`: um aparelho novo do mesmo caixa sem alinhar a numeração viola `unique (terminal_id, terminal_seq)`. O teste reproduz o caminho e, com a correção, mostra a fila andando. |
| R2-01 (Enter salva preço antigo) | **CONFIRMADO e reproduzido** | Teste novo em `packages/ui/src/ui.test.tsx` com um `<form>` e Enter; o `MoneyField` só repassava o valor no `onBlur`. |
| R2-04 (contagem vazia zera estoque) | **CONFIRMADO** | `products.tsx`: `Number('')` é 0 e o campo não é obrigatório. |
| R2-05 (preço do plano no admin) | **CONFIRMADO** | `admin-pages.tsx`: `"49.90"` → remove o ponto → `4990 × 100` = 499.000 centavos. |
| R2-02 (caixa perde venda no F5) e R2-03 (cobrança pendente) | **FORTE INDÍCIO**, não corrigido nesta rodada | O código confirma o mecanismo; a correção mexe no fluxo do caixa (salvar venda em andamento, cancelar cobrança no PSP) e há outra sessão editando `pos.tsx` agora. Ficam no plano como prioridade 1 da próxima rodada. |

## Conflitos entre pareceres

### C-01 — "RLS correto em todas as tabelas" (R3) × "API conecta como superusuário" (R1-12)

Parecia contradição: superusuário ignora RLS. **Resolução:** os dois estão certos. `withTenant`
executa `set local role bipae_app` em toda transação (`apps/api/src/db/client.ts:70`), então as
consultas de negócio passam pelo RLS. O R1-12 é defesa em profundidade: uma consulta feita fora de
`withTenant` rodaria como superusuário. Severidade Baixa mantida; o R4-01 (teste de vazamento só em
25 tabelas) é a lacuna que de fato importa e entra no plano.

### C-02 — IP falsificável: R1-01 (FORTE INDÍCIO, Média) × R5-08 (FORTE INDÍCIO, Média)

Mesmo achado por dois caminhos. **Resolução:** CONFIRMADO. Com `trustProxy: true` o Fastify usa o
primeiro endereço do `X-Forwarded-For`, que é escrito pelo cliente; os dois nginx só acrescentam. O
teste novo em `security.test.ts` prova que, com a correção, trocar o primeiro IP não escapa do limite.
**Achado novo durante a contestação:** o limite de login por IP respondia **500** ("Algo deu errado
do nosso lado") em vez de 429, porque o erro do `@fastify/rate-limit` não era um `AppError`.
Corrigido e coberto pelo mesmo teste.

### C-03 — Autorização do gerente: R3-05 × R1-03

R3 viu a falta de prova da autorização (`authorizedBy` livre); R1 viu a falta de conferência de loja e
de permissão. **Resolução:** mesma causa raiz, "o servidor confia no conteúdo do evento do caixa".
Consolidado como ACH-03. A regra inegociável 6 (o caixa nunca perde venda) impede recusar o evento,
então a correção é: recusar o que não é venda (cancelamento de outra loja), registrar quem enviou e
marcar na trilha quando a permissão não confere. A prova assinada da autorização (HMAC) fica no plano.

### C-04 — R4-03 (rotas sem permissão declarada) × política "negar por padrão"

R4 contou 13 rotas sem `@RequirePermission`. **Resolução:** CONFIRMADO que o guard libera qualquer
membro quando a rota não declara permissão (`apps/api/src/common/auth.ts:171-176`). Impacto real
conferido nas duas citadas: `GET /account/billing` (provavelmente intencional, mostra a situação da
assinatura) e `POST /account/billing/invoices/:id/check` (só relê a própria fatura e agenda uma
conferência). Severidade rebaixada para Média; a correção é um teste que obrigue a declaração.

### C-05 — "Aprovado com ressalvas" (R3, R4) × "Reprovado" (R1, R2) × "Não comprovado" (R5)

Não é contradição: cada um julgou o próprio escopo. O veredito consolidado está em
`VEREDITO_PRE_DEPLOY.md`.

### C-06 — Escopo do veredito: commit auditado ≠ produção

R5 mediu a produção (`07bfa9a`), e os demais analisaram `728df79`. Conferido com
`git rev-list --count origin/main..main` = 36: há 36 commits locais nunca enviados, com as migrações
0082–0089. Isso não é defeito do código, mas muda o risco do próximo deploy (8 migrações de uma vez,
rollback automático rodando código antigo sobre schema novo, R5-03).

### C-07 — R2-P: "Perfis fiscais diz que a NFC-e chega em breve"

Conferido em `fiscal-profiles.tsx:50-54`: o aviso contradizia o resto do sistema, que já emite NFC-e
em homologação. Viola a regra "capacidades nunca mentem". Corrigido.

## O que não foi contestado por falta de meio

- Achados de VPS que dependem de carga (R5-02, R5-07, R5-09): continuam HIPÓTESE ou FORTE INDÍCIO.
- Comportamento real no navegador dos achados de UX que não foram reproduzidos em teste (R2-07, R2-09
  a R2-16): análise estática.
