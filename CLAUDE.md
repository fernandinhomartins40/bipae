# CLAUDE.md — Convenções do projeto Bipaê

Bipaê é um PDV + ERP brasileiro, offline-first e pronto para a Reforma Tributária. O briefing completo está em [docs/PROMPT.md](docs/PROMPT.md), o PRD em [docs/PRD.md](docs/PRD.md) e as decisões de arquitetura em [docs/adr/](docs/adr/).

## Estado atual

- Fases 0, 1 e 2 entregues (12/10/2026), mais a plataforma SaaS com painel super admin em `/app/admin` (ADR-0013). Próxima: **Fase 3 — Fiscal** (revalidar `docs/fiscal/versoes.md` antes de codificar).
- Tudo o que falta está no backlog [docs/TAREFAS.md](docs/TAREFAS.md) (`pnpm tarefas`); como executar está na seção "Backlog" abaixo.

## Nomes e idioma

- Marca: **Bipaê** em interface e textos; `bipae` (sem acento) em código, pacotes (`@bipae/*`), URLs e e-mails.
- **Código** (identificadores, nomes de arquivos, commits): inglês.
- **Termos fiscais oficiais** mantêm o nome do leiaute, sem tradução: `cClassTrib`, `CFOP`, `NCM`, `CEST`, `CST`, `CSOSN`, `vNF`, `IBS`, `CBS`, `IS`. Ex.: `calculateIbsCbs(item)`, `item.cClassTrib`.
- **Documentação, UI e mensagens ao usuário**: português do Brasil. Tom leve, simpático e direto ("Bipou? Bipaê!"), sem infantilizar.
- UI: moeda BRL (`R$ 1.234,56`), datas `dd/mm/aaaa`, CPF/CNPJ sempre com máscara e validação de dígito.

## Regras inegociáveis

1. **Dinheiro nunca é `number` de ponto flutuante.** Valores monetários em centavos (`bigint`/inteiro) na persistência; cálculos fiscais com decimal de precisão arbitrária e regra de arredondamento explícita (ADR-0008).
2. **Regra fiscal não vai em `if` no código.** Alíquotas, CSTs, cClassTrib, reduções e vigências ficam em tabelas versionadas por data (ADR-0006). Código só interpreta regras.
3. **Toda ambiguidade fiscal** vai para [docs/fiscal/duvidas.md](docs/fiscal/duvidas.md) e vira configuração, nunca suposição silenciosa.
4. **Emissão fiscal só em homologação** (`tpAmb=2`). Produção exige pedido explícito do dono do projeto.
5. **Sala limpa:** nada de código, textos, ícones, layouts ou dados de concorrentes. Benchmark registra comportamento observável apenas (ver `docs/benchmark/README.md`).
6. **Offline-first:** o PDV nunca depende de rede para concluir uma venda. Toda escrita do PDV é um evento idempotente com ID gerado no cliente (UUIDv7) (ADR-0004).
7. **Multi-tenant:** toda tabela de negócio tem `tenant_id` e política RLS no PostgreSQL. Nenhuma consulta ignora o tenant (ADR-0003).
8. **Ações sensíveis** (cancelamento, desconto acima do limite, sangria, estorno, alteração de preço, alteração fiscal) geram registro na trilha de auditoria imutável.
9. **Um código, dois alvos (ADR-0012):** telas e regras vivem em `packages/*`. `apps/web` e `apps/desktop` são cascas finas. Nada em `packages/pdv-*`/`erp-ui` importa `@tauri-apps/*` nem APIs de navegador específicas de periférico: só os ports de `packages/platform`.
10. **Segredos** (certificado A1, senhas, tokens de PSP) nunca em texto puro no banco, em log ou em fixture de teste versionado.

## Stack (resumo; detalhes nas ADRs)

- Monorepo pnpm + Turborepo, TypeScript estrito em tudo.
- API: NestJS sobre Fastify, PostgreSQL 16 com RLS, Drizzle ORM, Redis + BullMQ.
- Web (backoffice + PDV PWA): React + Vite + Tailwind; componentes acessíveis (Radix).
- PDV desktop: Tauri 2 (Rust para periféricos e certificado A3); o mesmo app roda como Bipaê Conector (bandeja) para o PDV web.
- Banco local do PDV: SQLite (nativo no Tauri; WASM com OPFS no navegador). Mesmo schema e mesmas migrações nos dois.
- Motor fiscal: `packages/fiscal`, puro (sem I/O), testável, cobertura ≥ 90%.

## Comandos

- `pnpm install`, `pnpm db:seed`, `pnpm dev` (API :3333 + web :5173). Sem `DATABASE_URL` a API usa PGlite em `apps/api/.data`.
- `pnpm lint && pnpm typecheck && pnpm test`; `pnpm test:e2e` (Playwright, projetos `web` e `desktop-ui`).
- Desktop: `pnpm --filter @bipae/desktop tauri:dev` (requer Rust).
- Simulador do Bipaê Conector: `pnpm --filter @bipae/web connector:sim`.
- E2E roda com 1 worker (API única com PGlite). A primeira execução após mudar dependências pode falhar por recarga do Vite; rode de novo antes de investigar.

## Padrões do caixa (PDV)

- Toda ação do caixa grava a projeção local **e** o evento na outbox na mesma transação (`PdvService.enqueue`). Eventos são validados pelos schemas de `@bipae/domain/events`.
- O servidor aplica cada evento uma vez (`sync_events`), cada um na sua transação; rejeições permanentes usam `Rejection` com motivo pt-BR; falha temporária interrompe o lote para preservar a ordem.
- Protocolos de periféricos (ESC/POS, balança, Conector) ficam em TypeScript puro e testável; o Rust só move bytes e espelha `ConnectorCore`.
- Capacidades nunca mentem: o que não está construído ou configurado aparece como "chega em breve" ou "falta configurar".

## Padrões da API

- Injeção de dependência sempre com `@Inject(Token)` explícito (não há metadados de decorators: tsx/esbuild/Vite não os emitem).
- Toda consulta de negócio passa por `withTenant(db, ctx, fn)`; ações relevantes chamam `audit.record(tx, ...)` na mesma transação.
- Plataforma SaaS (ADR-0013): `asPlatform()` (papel `bipae_platform`, sem RLS) **só** dentro de `modules/admin`, na `admin-cli`, no seed e no atalho de desenvolvimento `PLATFORM_BOOTSTRAP_EMAIL`; nunca em rotas de clientes. Criar empresa/loja/caixa/usuário/produto chama `limits.assertCanAdd(tx, recurso)` na mesma transação. Rota nova do painel declara `@PlatformPermission(...)` (sem isso, só `owner` passa) e registra em `platformAudit.record`.
- Validação com os schemas Zod de `@bipae/domain` via `parse()`; erros sempre com mensagem pt-BR para o usuário.
- Migrações em `apps/api/src/db/migrations/*.sql` (fonte da verdade); `schema.ts` é o espelho tipado. Nunca editar migração já aplicada.

## Backlog (execução automática)

O plano inteiro está em [docs/TAREFAS.md](docs/TAREFAS.md). Quando o dono pedir "continue", "próxima tarefa" ou "siga o backlog":

1. Rode `pnpm tarefas proxima`. Retome a tarefa marcada `[~]`; se não houver, pegue a primeira liberada e marque `[~]`.
2. Se a tarefa for grande, quebre-a em subtarefas `CÓDIGO.a`, `CÓDIGO.b` no próprio arquivo antes de começar.
3. Implemente seguindo as regras deste arquivo, com testes que provem o "Pronto quando".
4. Rode `pnpm lint && pnpm typecheck && pnpm test` e o E2E afetado. Se falhar, corrija. Não marque como feita com teste vermelho.
5. Marque `[x]`, registre no `CHANGELOG.md` e faça o commit (`feat(...)`), com o código da tarefa na mensagem.
6. Faça o push para `main`: o deploy roda pelo GitHub Actions. Acompanhe e só siga para a próxima com CI e deploy verdes.
7. Pare e pergunte ao dono antes de uma decisão irreversível ou cara, de uma ambiguidade fiscal (registre em `docs/fiscal/duvidas.md`) ou quando só sobrarem tarefas que dependem de itens `E*`. Nesse caso, mostre `pnpm tarefas bloqueadas`.
8. Ao terminar, diga em uma linha o que foi entregue e qual é a próxima tarefa.

Tarefas novas, descobertas no caminho, entram no backlog com código novo, no lugar certo da ordem.

## Kit PDV Embed (`kits/pdv-embed`, ADR-0014)

- O contrato `contract/openapi.yaml` é a fonte da verdade. Toda regra nova entra no contrato, nas duas implementações de referência (Node e PHP) e no `conformance/run.mjs`. Mudança incompatível exige nova versão (`X-Bipae-Pdv`).
- O componente usa só `@bipae/pdv-core/pure` e partes de `@bipae/domain` sem zod. Confira o tamanho no build (hoje cerca de 18 KB comprimido).
- Depois de mexer em `src/` ou nas regras do `pdv-core`, rode `pnpm --filter @bipae/pdv-embed build` e versione o `dist/`. A CI recusa um `dist` desatualizado.

## Testes e qualidade

- Unitários: Vitest. E2E: Playwright (inclui cenário com rede desligada).
- Motor fiscal: casos por regime (Simples, Presumido, Real) × período (2026, 2027, transição 2029–2032, 2033).
- XML fiscal validado contra os XSD oficiais em teste automatizado.
- Antes de concluir uma tarefa: `pnpm lint && pnpm typecheck && pnpm test`.

## Git

- Conventional Commits em inglês (`feat(pos): ...`, `fix(fiscal): ...`).
- Commit ao fim de cada etapa estável. Uma fase só fecha com README e `CHANGELOG.md` atualizados.
