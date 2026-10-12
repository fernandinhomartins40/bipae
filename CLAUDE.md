# CLAUDE.md — Convenções do projeto Bipaê

Bipaê é um PDV + ERP brasileiro, offline-first e pronto para a Reforma Tributária. O briefing completo está em [docs/PROMPT.md](docs/PROMPT.md), o PRD em [docs/PRD.md](docs/PRD.md) e as decisões de arquitetura em [docs/adr/](docs/adr/).

## Estado atual

- Fase 0 e Adendo 01 (web + desktop) aprovados em 12/10/2026. **Fase 1 (fundação) em andamento.**
- Tarefas da fase atual e das próximas: [docs/TAREFAS.md](docs/TAREFAS.md). Mantenha esse arquivo atualizado.

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

## Testes e qualidade

- Unitários: Vitest. E2E: Playwright (inclui cenário com rede desligada).
- Motor fiscal: casos por regime (Simples, Presumido, Real) × período (2026, 2027, transição 2029–2032, 2033).
- XML fiscal validado contra os XSD oficiais em teste automatizado.
- Antes de concluir uma tarefa: `pnpm lint && pnpm typecheck && pnpm test`.

## Git

- Conventional Commits em inglês (`feat(pos): ...`, `fix(fiscal): ...`).
- Commit ao fim de cada etapa estável. Uma fase só fecha com README e `CHANGELOG.md` atualizados.
