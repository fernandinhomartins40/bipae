---
description: Trabalha sozinho no backlog (docs/TAREFAS.md) até atingir o objetivo
argument-hint: "<alvo> [máximo] | status | parar   (alvo: tudo, F3, F3-07, P...)"
---

Modo objetivo do Bipaê. Argumentos: `$ARGUMENTS`

1. Se os argumentos forem `status` ou `parar`, rode `node scripts/goal.mjs $ARGUMENTS`, mostre o resultado e termine.
2. Senão, rode `node scripts/goal.mjs iniciar $ARGUMENTS`. Sem argumentos, o alvo é `tudo`.
3. Comece imediatamente pela tarefa indicada, seguindo o protocolo da seção "Backlog" do `CLAUDE.md`:
   - marque `[~]` na tarefa;
   - implemente com testes que provem o "Pronto quando";
   - rode `pnpm lint && pnpm typecheck && pnpm test` e o E2E afetado;
   - marque `[x]` e registre no `CHANGELOG.md`;
   - faça commit e push, e confira o CI e o deploy.
4. Ao terminar cada tarefa, siga para a próxima. Quando você for parar, o Stop hook do projeto diz se o objetivo continua e qual é a próxima tarefa.
5. Converse sempre em português do Brasil. Entre tarefas, mande uma linha curta dizendo o que foi entregue.
6. Pare e pergunte ao dono antes de decisões irreversíveis ou caras, em ambiguidade fiscal ou quando faltar algo externo (itens E*).
