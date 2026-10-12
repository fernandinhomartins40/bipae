# ADR-0004 — Offline-first: banco local + log de eventos idempotente

**Status:** aceita (12/10/2026) · **Data:** 11/10/2026

## Contexto
"O caixa nunca para." O PDV precisa vender, emitir NFC-e em contingência, abrir/fechar caixa e registrar sangrias sem internet, por horas ou dias, e sincronizar sem perder nem duplicar nada. Meta: venda finalizada em < 1 s localmente.

## Decisão

### Banco local
SQLite em todos os PDVs: nativo no Tauri; **SQLite WASM com OPFS** no navegador (em vez de IndexedDB puro), para ter **um único schema e as mesmas consultas** nos dois ambientes (`packages/local-db`). IndexedDB fica só como fallback para navegadores sem OPFS.

### Escrita: eventos imutáveis
Toda ação do PDV gera um evento (`SaleCompleted`, `CashWithdrawal`, `RegisterClosed`, `StockAdjusted`...) com:
- `id` UUIDv7 gerado no dispositivo (ordenável e chave de idempotência);
- `deviceId`, `storeId`, `operatorId`, relógio local e contador monotônico por dispositivo;
- payload validado por Zod (`packages/domain`).

Os eventos são gravados localmente na mesma transação que atualiza as projeções locais, e enviados em lote ao servidor. O servidor aplica cada `id` **uma única vez** (tabela de eventos com chave primária = `id`); reenvio é inofensivo.

### Política de conflitos (por tipo de dado)
| Dado | Estratégia | Por quê |
|---|---|---|
| Vendas, pagamentos, sangrias, eventos de caixa | **Só acrescenta (append-only)**: nunca há conflito | Fatos que aconteceram não se "mesclam" |
| Estoque | **Livro de movimentações** (deltas comutativos); saldo = soma | Duas lojas vendendo offline somam corretamente; saldo negativo vira alerta, não erro |
| Cadastro (produto, preço, cliente) | Servidor autoritativo; versão por registro; **último que escreve ganha por campo**, com registro do conflito para revisão | Edição de cadastro offline é rara |
| Numeração fiscal | **Série de NFC-e exclusiva por terminal**, web ou desktop (ADR-0012) | Evita colisão de número de NFC-e entre caixas offline |

### Leitura: pull incremental
O PDV baixa mudanças por cursor (`updated_since` por tabela) para catálogo, preços, promoções, regras fiscais e permissões.

### Rede local (food service, Fase 5)
O PDV Tauri pode atuar como **nó de sincronização da loja** para garçom/KDS na LAN, com o mesmo protocolo.

## Alternativas
- **CRDT genérico (Automerge/Yjs):** poderoso, mas complexo e desnecessário: nossos dados são em maioria append-only.
- **Replicação pronta (PowerSync/ElectricSQL):** reduz trabalho, mas adiciona dependência paga/serviço externo e controla mal o domínio fiscal. Reavaliar se o custo de manter o protocolo próprio crescer.

## Consequências
- Teste E2E obrigatório: rede desligada → N vendas → reconectar → servidor com exatamente N vendas, estoque correto, notas transmitidas.
- Toda regra de negócio usada offline (preço, promoção, imposto) precisa existir em pacote puro que roda no PDV.
