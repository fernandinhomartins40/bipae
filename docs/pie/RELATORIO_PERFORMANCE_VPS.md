# Relatório de desempenho e VPS

> Medições somente leitura feitas pelo R5 em 27/10/2026, 16:14–16:20 UTC, na VPS compartilhada,
> que roda a versão `07bfa9a` (não o commit auditado). Comandos e tabela completa em `BANCA_R5_SRE.md`.
> Nenhuma escrita foi feita na VPS. Não houve teste de carga, de restauração nem com o Redis parado.

## Medido

| Métrica | Valor |
|---|---|
| Host | 2 vCPU, carga média 1,00–1,17; 7.936 MiB de RAM, 3.530 MiB disponíveis; **sem swap**; disco 67 % (33 GB livres); 45 contêineres |
| Bipaê (memória) | ~244 MiB no total: API 187/512, Postgres 43/512, Redis 10/96, web 5/128 |
| Estabilidade | 0 reinícios e 0 OOM nos 10 dias de uptime; 4 contêineres saudáveis |
| Vizinhos | ~4,7 GiB em uso; soma dos limites ≈ 12,9 GiB para 7,75 GiB físicos; 12 contêineres sem limite; `mercadoflow-cron` a 93,5 % do limite |
| Banco | 12 MB, 96 tabelas (88 com RLS), cache 99,99 %, 0 deadlocks; sem `statement_timeout`, sem log de consulta lenta, sem `pg_stat_statements` |
| Redis | 3,5 MB de 48 MB, `noeviction`, AOF ligado, nenhuma tarefa com falha |
| Backups | 14 arquivos de 46–49 kB, o mais novo de 25/10 03:36; mesmo disco; sem cron; sem teste de restauração |
| Imagens | API 948 MB; web 61 MB |
| `/v1/health` | de fora 108–165 ms (a frio 457 ms), HTTP/1.1; dentro da VPS 2–4 ms |
| TLS | certificado válido por 75 dias, renovação automática ativa |

## Conclusão

Não há gargalo de desempenho medido no uso atual. O risco está em **recuperar dados** (backup) e na
**vizinhança** (memória supercomprometida sem swap). As hipóteses de gargalo (fila em série, pool de
10 conexões com chamadas ao PSP dentro da transação, Redis indisponível) não foram medidas.

## Antes e depois

Nenhuma mudança de infraestrutura foi feita nesta rodada, então não há medição "depois". A única
mudança que afeta a borda é a do IP do cliente (`TRUST_PROXY_HOPS=2`), que vale a partir do próximo
deploy e não muda o consumo.

## Ações recomendadas

| Onde | Ação | Quem decide |
|---|---|---|
| VPS | Backup diário por cron, cópia fora da VPS e um teste de restauração por mês | Dono (custo do armazenamento externo) |
| VPS | Swap de 2–4 GB; limites de memória nos contêineres das outras aplicações | Dono (infra compartilhada) |
| VPS | Usuário de deploy sem root, com `sudo` restrito ao `docker compose` do Bipaê | Dono |
| VPS | nginx do host: esconder a versão, HTTP/2 e limite de requisições na borda | Dono |
| Repositório | `/v1/health/ready` checando banco e Redis (sem usar no healthcheck de reinício) | Próxima rodada |
| Repositório | Imagem da API com `pnpm deploy --prod` (só dependências de produção) | Próxima rodada |
| Repositório | Pool com tempo máximo de conexão e de transação ociosa; logs JSON com uma linha por requisição | Próxima rodada |
| Repositório | Migrações compatíveis com a versão anterior, para o rollback automático ser seguro | Próxima rodada |
