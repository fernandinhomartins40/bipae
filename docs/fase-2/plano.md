# Fase 2 — PDV MVP offline-first: plano

> 12/10/2026 · Base: PRD §5, ADR-0004, ADR-0012, Adendo 01 §8. Entrega em etapas, cada uma com testes e commit.

## Arquitetura em uma frase

O PDV **sempre** lê e grava no SQLite local do terminal. Cada ação vira um **evento imutável** com ID gerado no próprio terminal. Uma fila envia esses eventos ao servidor, que aplica cada ID **uma única vez**. Um pull incremental traz catálogo e preços. Web e desktop usam o mesmo código; só o *driver* do SQLite muda.

```
pdv-ui (telas) ──► pdv-core (regras puras + serviço) ──► StoragePort ──► driver SQLite
                                   │                                     ├─ web: SQLite WASM (worker, OPFS)
                                   │                                     ├─ desktop: rusqlite (comando Tauri)
                                   ▼                                     └─ testes: node:sqlite
                              outbox de eventos ──► sync client ──► POST /v1/sync/events (idempotente)
                                                               ◄── GET /v1/sync/pull (cursor)
```

## Decisões desta fase

| Tema | Decisão | Por quê |
|---|---|---|
| Acesso ao SQLite | Um driver por plataforma, **uma conexão**, acesso serializado por *mutex* em JS. Transações = `BEGIN`/`COMMIT` dentro do mutex | Mesmo comportamento transacional nos três ambientes, sem depender de pool |
| SQLite no navegador | `@sqlite.org/sqlite-wasm` num *worker* com VFS `opfs-sahpool` (não exige cabeçalhos COOP/COEP). Sem OPFS: banco em memória e **aviso claro** de que vender sem internet não está disponível nesse navegador | O fallback IndexedDB do ADR-0004 fica como melhoria, registrada em TAREFAS |
| SQLite no desktop | `rusqlite` (SQLite embutido no binário) com comandos Tauri `db_exec`/`db_query`; arquivo na pasta de dados do app | Nativo, sem servidor, sobrevive a atualizações |
| Número da venda | Sequencial por terminal (`terminalSeq`). Na Fase 3 vira o `nNF` dentro da série exclusiva do terminal | Nunca colide entre terminais offline |
| Estoque | Livro de movimentações (deltas). Saldo = soma. Saldo negativo gera alerta, não bloqueia a venda | Dois terminais offline somam corretamente (ADR-0004) |
| Preço e promoção | Calculados no terminal, gravados no evento. O servidor **não recalcula** a venda | A venda é um fato; o cliente pagou aquele valor |
| Pagamentos | Dinheiro (com troco), Pix e cartão via **simuladores** (`PaymentProvider`, ADR-0009), vários na mesma venda | PSP/TEF reais na Fase 6 |
| Desconto | Limite por papel (padrão: 10%). Acima disso exige autorização de quem tem `pos.discount.above_limit`, registrada no evento | Prevenção de perdas |
| Fechamento de caixa | **Cego**: o operador informa o que contou, o sistema só mostra a diferença depois | Pedido do briefing |
| Periféricos | Protocolos em TS puro (ESC/POS, balança Toledo/Filizola por serial, etiqueta EAN-13 de peso); o Rust só faz E/S (serial e TCP 9100) | Lógica testável aqui; Rust mínimo |
| Bipaê Conector | Protocolo e pareamento definidos em `packages/platform` (TS, testável), servidor em Rust no app desktop (modo bandeja) e um **simulador em TS** com a mesma especificação | O simulador permite testar o PDV web com periféricos simulados |
| Auto-update | `tauri-plugin-updater` com assinatura própria; só instala com o caixa sem venda em andamento. Ativado na CI apenas quando existirem os segredos da chave | A chave privada é do dono do projeto, não da máquina de desenvolvimento |

## Etapas

1. **`packages/local-db`**: schema e migrações do terminal, `StoragePort` serializado, driver `node:sqlite`.
2. **`packages/pdv-core`**: carrinho, pesáveis, descontos com limite, pagamentos múltiplos e troco, caixa (abertura, sangria, suprimento, fechamento cego), troca/devolução por item, orçamento, CPF na nota, eventos.
3. **API, migração `0002`** e endpoints `/v1/sync/events` e `/v1/sync/pull`; vendas, caixa e estoque no servidor.
4. **`packages/sync`**: cliente de envio e recebimento com retentativa e cursores; **teste de dois terminais offline** contra a API real.
5. **`packages/pdv-ui`**: tela de caixa por teclado (F-keys) e toque, pagamento, abertura e fechamento, indicador "sincronizado há X min", som de bip; vínculo do aparelho a um caixa.
6. **Drivers**: SQLite WASM (web), comandos Rust (desktop), ESC/POS, balança, gaveta, impressão pelo navegador.
7. **Bipaê Conector**: protocolo, simulador TS, cliente no PDV web, servidor Rust.
8. **Auto-update** do desktop e canais estável/beta na CI.
9. **Testes do Adendo 01**: E2E de venda online e **offline** nos dois frontends; update com fila pendente; Conector com periféricos simulados.
10. `docs/plataformas.md`, CHANGELOG, TAREFAS.

## Limitações conhecidas antes de começar

- Rust e Docker não rodam nesta máquina. O código Rust (SQLite nativo, serial/TCP, Conector, updater) só é compilado pela CI, que ainda não tem repositório remoto.
- O E2E dentro do WebView real (`tauri-driver`) também só roda na CI.
