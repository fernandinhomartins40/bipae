# Relatório de validação final

> 27/10/2026, Windows 11, Node 24, PGlite (sem Docker, PostgreSQL real nem Rust nesta máquina).
> Linha de base: commit `728df79`. Correções: árvore de trabalho, só nos arquivos listados abaixo.
> Outra sessão do Claude trabalhava ao mesmo tempo no mesmo repositório (motor fiscal, `pos.tsx`,
> `CHANGELOG.md`, `docs/TAREFAS.md`); os arquivos dela não foram tocados nem entram no commit desta auditoria.

## Comandos executados

| Comando | Quando | Resultado |
|---|---|---|
| `pnpm lint` | linha de base (R4) | verde, 336 s |
| `pnpm typecheck --force` | linha de base (R4) | 15/15, 0 erros |
| `pnpm test --force` | linha de base (R4) | 213 arquivos, 1.556 testes verdes |
| `pnpm test:e2e` | linha de base (R4) | 112 verdes, 1 falha intermitente (`admin.spec.ts:32`), 93 pulados |
| `pnpm lint` | depois das correções | verde, **50 s** (com `.claude/**` fora) |
| `pnpm typecheck` | depois das correções | 15/15, 0 erros |
| `pnpm test` | depois das correções | todos os pacotes desta auditoria verdes; ver números abaixo |
| `pnpm test:e2e` | depois das correções | ver seção E2E |

### Testes por pacote depois das correções

| Pacote | Testes | Diferença sobre a base |
|---|---|---|
| `@bipae/api` | 438 verdes | +8 (convite, IP/429, loja e autoria no sync, evento travado, limites, Dono, exportação no suporte, rotas declaradas, isolamento em todas as tabelas) |
| `@bipae/pdv-core` | 90 verdes | +1 (venda em andamento) |
| `@bipae/sync` | 8 verdes | 1 teste reforçado (recebe catálogo com envio parcial) |
| `@bipae/ui` | 14 verdes | +1 (Enter no campo de dinheiro) |
| `@bipae/erp-ui` 46 · `@bipae/pdv-ui` 49 · `@bipae/domain` 145 · `@bipae/platform` 76 · `@bipae/danfe` 27 · `@bipae/local-db` 6 · `@bipae/promotions` 11 · `@bipae/pdv-embed` 5 | verdes | sem mudança |
| `@bipae/fiscal` | 659 verdes, **1 vermelho** | o teste "dados gerados em dia com as planilhas" falha por arquivos que **a outra sessão** está trocando agora (`packages/fiscal/sources/*`, `manifest.json`, `tables.test.ts`, todos fora desta auditoria) |

### Instabilidades observadas (não são regressão)

- `pdv-embed` `node-reference.test.ts`: tempo esgotado (60 s) no preparo com 13 pacotes em paralelo; passou isolado e com `--concurrency=2`.
- `pdv-ui` "guarda só o hash com sal": falhou 1 vez em 4 execuções; passou nas outras 3 (ACH-33).
- `admin.spec.ts:32` (E2E): instável sob carga, já visto na linha de base (ACH-28).

## E2E

| Execução | Resultado |
|---|---|
| `pnpm test:e2e` completo, depois das correções (28,2 min) | 109 verdes, 4 vermelhos, 93 pulados (casca `desktop-ui`, igual à base) |
| Repetição isolada dos 4 specs vermelhos, já com o ajuste abaixo (`--project=web`, 2,7 min) | **9/9 verdes** (`nfce-contingency`, `foundation`, `mercadoflow` e `connector` inteiros) |

**Regressão encontrada e corrigida:** `nfce-contingency.spec.ts` falhou nas duas rodadas completas. O
trace do Playwright mostrou que, sem rede, o caixa passava a tentar receber o catálogo depois do envio
falhar (o service worker respondia do cache), e depois de a rede voltar nenhum envio novo apareceu nos
20 s do teste. A causa exata dessa demora não foi isolada. Ajuste: o caixa só recebe o catálogo depois de
um envio incompleto quando o servidor processou parte do lote (`PartialPushError`); sem rede, o
comportamento volta a ser o de antes. O spec passou depois do ajuste.

**Instáveis na rodada longa, verdes isolados:** `foundation.spec.ts:14`, `mercadoflow.spec.ts:144` e
`connector.spec.ts:16` (este também tem alteração local da outra sessão). Na linha de base o R4 viu o
mesmo padrão com `admin.spec.ts:32`, que desta vez passou. Ficam como ACH-28 (E2E instável sob carga).

## Revisão adversarial das correções

Um revisor independente (subagente, só leitura) tentou reprovar as correções e achou 2 problemas
altos e 4 médios. Todos foram tratados:

| Achado da revisão | Tratamento |
|---|---|
| P1: Dono ainda podia ser criado por `POST /members` | Corrigido: só Dono cria Dono; teste |
| P2: recusar evento por erro de banco perdia venda paga (fere a regra 6) | **Recusa desfeita**; fica o recebimento de catálogo com envio parcial, o savepoint e o log sem dados pessoais; quarentena no plano |
| P3: contagem igual a zero passou a ser recusada | Corrigido |
| P4: clique em "Salvar" com texto inválido enviava valor parcial | Corrigido em parte (`setCustomValidity`); resíduo em formulários `noValidate` |
| P5: textos diziam "emitir nota" sem avisar que é homologação | Corrigido |
| P6: cartão de primeiros passos nunca sumia sem certificado | Corrigido (passo opcional) |
| P7: "Lucro bruto" com conta diferente da DRE | Renomeado para "Margem (venda − custo)" |
| P8: Inadimplência abria ficha de cliente sem cadastro | Corrigido |
| P9: log de erro do sync com dados pessoais | Corrigido no ramo alterado (só código e constraint) |
| P10: devolução não confere a loja | Registrado para decisão do dono |

A própria revisão confirmou como corretos: savepoint do drizzle no PGlite e no node-postgres,
cliente do sync sem laço, venda de operador desativado e cancelamento em outro caixa da mesma loja
continuam aceitos, cadeia de proxies da produção (DNS direto na VPS, sem CDN) e o 429 do limite.

## Arquivos alterados por esta auditoria

API: `app.ts`, `config.ts`, `common/errors.ts`, `modules/auth/auth.service.ts`,
`modules/sync/sync.service.ts`, `modules/team/team.service.ts`, `modules/catalog/catalog.service.ts`,
`modules/account/account.controller.ts`, `modules/billing/billing.controller.ts`; testes
`invites`, `security`, `sync`, `platform`, `tenancy`, `route-guards` (novo).
Pacotes: `sync/src/index.ts` (+teste), `ui/src/components.tsx` (+teste), `pdv-core/src/service.ts`
(+teste), `pdv-ui/src/register.tsx`, `pdv-ui/src/dialogs.tsx`, `erp-ui/src/pages/{products,finance,home,parties,delinquency,fiscal-profiles}.tsx`,
`erp-ui/src/admin/admin-pages.tsx`. E2E `fiscal-profiles.spec.ts`. `eslint.config.js`. `docs/pie/*`.

## Riscos residuais e bloqueios

- Evento do caixa com erro permanente de banco ainda trava o **envio** daquele caixa (não perde a venda); falta a quarentena (ACH-04).
- Autorização do gerente no caixa sem prova verificável (ACH-03, resto).
- Cancelamento de cobrança pendente sem teste automatizado de componente (ACH-09).
- Backups no mesmo disco, sem teste de restauração; memória da VPS supercomprometida (ACH-10, ACH-11): exigem ação na VPS.
- 36 commits locais nunca enviados, com 8 migrações (ACH-24): o próximo push leva tudo de uma vez.
- Não executado: API contra PostgreSQL real, Rust/Tauri, Android, produção.
