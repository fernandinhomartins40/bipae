# ADR-0014: Bipaê PDV Embed, o caixa embutível em outras aplicações

**Status:** aceita (12/10/2026) · **Data:** 12/10/2026 · **Relacionadas:** [ADR-0008](0008-dinheiro-arredondamento.md), [ADR-0012](0012-pdv-web-desktop-codigo-compartilhado.md)

## Contexto
O dono do projeto tem outras aplicações online e quer dar a elas um caixa dedicado dentro do painel admin, sem refazer o PDV a cada projeto. Essas aplicações usam linguagens e frameworks diferentes. Copiar telas React ou um backend Node para cada uma não serve.

## Decisão
Um **kit** em `kits/pdv-embed`, independente do resto da Bipaê, em três partes.

1. **Componente web:** `<bipae-pdv>`, um Custom Element com Shadow DOM.
   - É um único arquivo `dist/bipae-pdv.js` (Preact, cerca de 18 KB comprimido), carregado com `<script>` em qualquer página.
   - As regras de carrinho, pagamento, caixa, comprovante e leitura de código vêm de `@bipae/pdv-core/pure`, uma entrada sem banco local nem periféricos.
   - O código é o mesmo do caixa da Bipaê.
2. **Contrato do backend:** `contract/openapi.yaml`, com 9 rotas.
   - Dinheiro em centavos e quantidade em milésimos, com o mesmo arredondamento da ADR-0008.
   - Venda e movimento de caixa são idempotentes pelo id gerado no cliente.
   - O servidor confere preço, totais, limite de desconto e pagamentos.
   - A aplicação hospedeira implementa o contrato na própria linguagem, com o próprio login. Os produtos vêm de uma **view `pdv_products`** sobre a tabela de produtos dela, e o estoque é baixado por um gancho.
3. **Implementações de referência:** Node (`server/node`) e PHP/PDO (`server/php`).
   - Junto vão as tabelas para PostgreSQL, MySQL e SQLite e um **teste de conformidade** (`conformance/run.mjs`) que valida qualquer backend.
   - A CI roda o teste contra as duas implementações, roda o componente num navegador real e confere que o `dist` versionado está atualizado.

## Consequências
- Mudar o contrato exige uma nova versão, no cabeçalho `X-Bipae-Pdv`. Telas e regras do cliente podem evoluir sem mexer nos backends.
- `@bipae/domain` passou a declarar `sideEffects: false`. As formas de pagamento saíram para `payment-methods.ts`, sem zod: o pacote do componente caiu de 45 KB para 18 KB.
- O kit não traz modo offline, NFC-e nem periféricos diretos. Essas são as diferenças para o Bipaê completo, e o README as declara.

## Alternativas descartadas
- **Pacote React:** não serviria a aplicações em Vue, Blade, Django ou WordPress.
- **Iframe com o app da Bipaê:** exigiria contas e dados dentro da Bipaê, e a aplicação deixaria de ser dona dos seus produtos e vendas. Pode voltar no futuro como modo "Bipaê como serviço".
- **Um backend por linguagem mantido aqui:** caro de manter. O contrato mais o teste de conformidade dão o mesmo resultado com uma fração do esforço.
