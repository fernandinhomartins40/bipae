# ADR-0008 — Dinheiro em centavos inteiros; decimal para cálculo fiscal

**Status:** aceita (12/10/2026) · **Data:** 11/10/2026

## Contexto
`0.1 + 0.2 !== 0.3`. Em PDV e fiscal, um centavo de diferença rejeita nota (validação de totais) e quebra conciliação.

## Decisão
- **Persistência e tráfego:** valores monetários como inteiro em centavos (`bigint` no PostgreSQL, `INTEGER` no SQLite, `number` inteiro seguro ou `bigint` no TS, encapsulado no tipo `Money`).
- **Quantidades:** inteiro escalado com 4 casas (padrão do leiaute para `qCom`); pesáveis em gramas no código de barras convertidos para kg com 3–4 casas.
- **Cálculos fiscais e de rateio:** `decimal.js` com precisão fixa; arredondamento explícito por campo (padrão: meia para cima em 2 casas para valores, conforme o leiaute), parametrizado na tabela de regras (D-008 em `docs/fiscal/duvidas.md`).
- **Rateio** (desconto/frete por item): método do maior resto, garantindo que a soma dos itens = total exato.
- Lint proíbe aritmética com `number` em campos `Money`.

## Consequências
- Formatação BRL só na borda (UI/relatório), nunca no domínio.
