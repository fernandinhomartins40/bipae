# Plano de Implementação — produto e experiência (UX-01)

Seguindo o `PROTOCOLO_UNIVERSAL_PRODUTO_V2.md`, com foco em quem nunca usou um sistema de gestão.

## Resumo da aplicação

Bipaê é PDV + ERP offline-first (monorepo pnpm). A retaguarda inteira vive em `packages/erp-ui` e roda igual na web (`apps/web`) e no desktop (`apps/desktop`, ADR-0012). O caixa (`/caixa`) é uma tela própria, fora do menu. A API (NestJS + PostgreSQL com RLS) já expõe os dados que a retaguarda usa; nada novo de backend foi necessário para este trabalho.

Confirmado no repositório: 49 entradas de menu em `pages/shell.tsx`, 58 especificações E2E (Playwright, projetos `web` e `desktop-ui`), testes unitários em Vitest.

## Principais problemas encontrados

1. **P1 — Menu com 49 itens soltos, sem grupos nem ordem por tarefa.** Itens relacionados ficam longe (Clientes → Relacionamento → Assistente → Fornecedores; Compras separado de Notas de entrada e Fornecedores; financeiro espalhado em 8 itens). O leigo precisa saber o nome exato da tela.
2. **P1 — No celular o menu vira uma faixa horizontal de 49 botões** acima do conteúdo, empurrando a tela para baixo e escondendo quase tudo fora da área visível.
3. **P1 — Início não ajuda a decidir o próximo passo.** Mostra uma lista técnica de recursos do navegador e não mostra nada do que precisa de atenção (contas vencidas, lotes vencendo, certificado vencendo, notas para conferir), embora a API já tenha tudo isso.
4. **P2 — "Fazer uma venda de teste" nunca fica marcado como feito** nos primeiros passos (`done: false` fixo), mesmo depois de muitas vendas.
5. **P1 — No celular não havia "Sair" nem troca de empresa** (o rodapé do menu era `hidden md:block`).
6. **P2 — "Abrir o caixa", a ação mais usada, tem o mesmo peso visual de "Auditoria"** e no celular some no meio da faixa.

## Oportunidades de melhoria

| ID | TIPO | SITUAÇÃO ATUAL | OPORTUNIDADE | ESFORÇO ELIMINADO | BENEFÍCIO | SOLUÇÃO | PRIORIDADE | RISCO | TESTE | STATUS |
|---|---|---|---|---|---|---|---|---|---|---|
| OP-01 | JUNTAR | 49 links soltos | Agrupar por objetivo: Vender, Produtos e estoque, Compras, Clientes, Dinheiro, Notas e impostos, Minha empresa | Procurar item por item | Menu cabe na tela; cada grupo responde "o que eu quero fazer" | Sanfona; o grupo da tela atual abre sozinho; estado lembrado por pessoa | P1 | Médio (testes E2E clicam no menu) | Unitário do menu + E2E com auxiliar `abrirNoMenu` | DONE |
| OP-02 | ELIMINAR | Leigo precisa saber o nome e o grupo da tela | Busca "Procurar no menu" (sem acento, por palavra) | Abrir grupo por grupo | Achar "boleto", "ICMS", "etiqueta" digitando | Filtro local sobre os itens permitidos | P1 | Baixo | Unitário | DONE |
| OP-03 | ELIMINAR | Faixa horizontal no celular | Barra fixa com logo, "Abrir o caixa" e botão Menu; menu em gaveta | Rolar a faixa de 49 botões | Conteúdo começa no topo; ação principal sempre à mão | Gaveta com Esc, clique fora e fechamento ao navegar | P1 | Baixo | E2E celular (inventário, a11y) | DONE |
| OP-04 | ANTECIPAR | Pendências espalhadas em 6 telas | "Precisa da sua atenção" no Início | Visitar Financeiro, Lotes, Empresas e Notas para descobrir problemas | Problema aparece antes de virar prejuízo | Usa `/finance/entries/summary`, `/stock/lots?days=30`, `/fiscal/certificates`, `/mercadoflow/confere-notices` conforme permissão | P1 | Baixo (só leitura) | Unitário | DONE |
| OP-05 | CRIAR | Para ver o dia era preciso abrir Relatórios e filtrar | "Hoje na loja": vendas, faturamento e ticket médio do dia | Abrir relatório e escolher datas | Resposta imediata à pergunta mais comum do dono | `/reports/sales?from=hoje&to=hoje` | P2 | Baixo | Unitário | DONE |
| OP-06 | AUTOMATIZAR | Passo "venda de teste" nunca conclui | Marcar sozinho quando existe venda; esconder o cartão quando tudo estiver feito | Ignorar um aviso eterno | Início fica limpo depois da implantação | `/sales?limit=1` | P2 | Baixo | Unitário | DONE |
| OP-07 | ELIMINAR | Cartão técnico de recursos ocupa o topo do Início | Descer o cartão para o fim, depois dos blocos do negócio | Passar por 9 linhas técnicas antes do que importa | Início foca no negócio sem esconder o que não funciona ("capacidades nunca mentem") | Mesmo conteúdo, nova ordem | P3 | Baixo | Unitário e E2E de fundação | DONE |
| OP-08 | JUNTAR | Atalhos para tarefas frequentes inexistentes no Início | "O que você quer fazer?" com 4 tarefas em linguagem simples | Saber em qual módulo cada tarefa mora | Regra dos 3 passos: escolher → preencher → concluir | Links para telas existentes, filtrados por permissão | P2 | Baixo | Unitário | DONE |

## Plano de execução

| ID | PRIORIDADE | PROBLEMA | SOLUÇÃO | ARQUIVOS/ÁREAS | RISCO | TESTE | STATUS |
|---|---|---|---|---|---|---|---|
| UX-01.a | P1 | Menu plano (1, 2, 5) | OP-01, OP-02, OP-03 | `packages/erp-ui/src/pages/shell.tsx`, `nav.ts` | Médio | `nav.test.ts`, `erp-ui.test.tsx` | DONE |
| UX-01.b | P1 | E2E dependem do menu plano | Auxiliar único `e2e/menu.ts` (`abrirNoMenu`) | `apps/web/e2e/*.spec.ts` | Médio | Suíte E2E | DONE |
| UX-01.c | P1 | Início passivo (3, 4) | OP-04 a OP-08 | `packages/erp-ui/src/pages/home.tsx` | Baixo | `erp-ui.test.tsx` | DONE |
| UX-01.d | — | Registro | CHANGELOG, plano, relatório | `CHANGELOG.md`, `docs/` | — | — | DONE |

## Ordem de implementação

1. Mapa do menu em arquivo puro (`nav.ts`) com teste de busca e grupos.
2. Shell com sanfona, busca e gaveta móvel.
3. Ajuste dos testes (unitário e E2E) para o menu novo.
4. Início com tarefas, pendências, resumo do dia e primeiros passos automáticos.
5. lint, typecheck, testes, E2E, relatório.

## Itens que não serão alterados

- **Rotas e URLs**: nenhuma mudou; links salvos, ajuda (`/ajuda/:slug`) e testes que usam `page.goto` continuam valendo.
- **Fusão física de páginas** (por exemplo, juntar as 8 telas de dinheiro em uma só com abas): cada tela tem formulários e permissões próprios; juntar agora mexeria em código grande sem ganho que o menu agrupado já não entregue. Fica como próxima melhoria.
- **Caixa (`/caixa`)**: já segue fluxo de 3 passos (bipar → pagar → concluir) e tem alterações locais do dono não commitadas em `pos.tsx`, que foram preservadas.
- **Painel super admin (`/admin`)**: público interno, fora do escopo de leigos.

## Bloqueios reais

Nenhum.
