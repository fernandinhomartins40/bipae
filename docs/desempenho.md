# Desempenho do caixa (F7-01)

Metas do PRD para o caixa com **100 mil produtos no banco local**: busca em menos de 100 ms e venda em menos de 1 s, medidas no percentil 95 (p95). As duas medições rodam na CI e falham se a meta for passada.

## Medições de 16/10/2026

| Onde | Carga dos 100 mil produtos | Código de barras (p95) | Busca por nome (p95) | Venda com 20 itens (p95) |
|---|---|---|---|---|
| Node, SQLite nativo (`packages/pdv-core/src/load.test.ts`) | menos de 3 s | 0,1 ms | 10 ms | 5 ms |
| Navegador, SQLite WebAssembly no worker (`apps/web/e2e/load.spec.ts`) | 32 s | 3,4 ms | 18 ms | 90 ms |

- **Busca por nome:** termos comuns ("arroz"), com dois e três termos ("leite 1 l") e sem resultado.
- **Venda:** 20 itens bipados por código de barras, pagamento em dinheiro, impostos de cada item calculados e o evento gravado na fila de envio.
- A medição foi feita numa máquina de desenvolvimento com Windows. A meta do E2E dá folga para máquinas mais lentas.

## O que mudou por causa da medição

- **A primeira carga do catálogo no navegador não terminava em 9 minutos.** Cada produto custava três instruções SQL e, no navegador, cada instrução é uma mensagem para o worker do SQLite.
- **Correção:** `PdvService.applyCatalog` passou a gravar em blocos, com uma instrução para cada 200 produtos e para cada 400 códigos de barras.
- **Resultado:** a carga caiu para 32 s no navegador e para menos de 3 s no Node. O E2E falha se ela passar de 120 s.

## Como medir de novo

- **Node:** `pnpm --filter @bipae/pdv-core exec vitest run src/load.test.ts --silent=false`
- **Navegador:** `pnpm --filter @bipae/web exec playwright test --project=web load.spec.ts`. A página `carga.html?n=100000` só existe no servidor de desenvolvimento e não vai para o build.
