# Banca R5 — SRE / VPS, infraestrutura e desempenho

- **Revisor:** R5 (SRE). **Modo:** AUDITORIA (somente leitura; nenhuma alteração no projeto nem na VPS).
- **Commit analisado (repositório):** `728df79` (27/10/2026). **Atenção:** a produção **não** roda esse commit. `origin/main` está em `07bfa9a` (25/10/2026) e há **36 commits locais não enviados**; o contêiner da API em produção foi iniciado em 25/10/2026 03:37 UTC. A análise estática vale para `728df79`; as medições valem para a versão no ar.
- **Ambiente medido:** VPS Hostinger compartilhada (Ubuntu 22.04.5, kernel 5.15.0-198, Docker 28.3.3), acesso `ssh bipae-vps`, em 27/10/2026 entre 16:14 e 16:20 UTC.
- **Limites:** sem teste de carga (proibido); sem restauração de backup (seria escrita); sem `pg_stat_statements` (não instalado); teste de TLS 1.0/1.1 feito com o curl do Windows, que pode não suportar essas versões (inconclusivo).

## 1. Escopo

Inspecionado: `deploy/docker-compose.vps.yml`, `deploy/deploy.sh`, `deploy/nginx/bipae.com.br.conf`, `.github/workflows/deploy.yml`, `apps/api/Dockerfile`, `apps/web/Dockerfile`, `apps/web/docker/nginx.conf`, `apps/web/docker/security-headers.conf`, `.dockerignore`, `apps/api/src/main.ts`, `app.ts`, `db/client.ts`, `db/migrate.ts`, `common/queue.ts`, `docs/deploy.md`, `docs/desempenho.md`. Na VPS: recursos do host, consumo de todos os contêineres, inspeção dos 4 contêineres do Bipaê, banco (somente `SELECT` dentro de `begin transaction read only`), Redis (`INFO`, contagens), nginx do host, certbot, cron, backups, logs (sanitizados). Externo: `curl` no `/v1/health` público.

Não testado: carga/concorrência, restauração real de backup, failover, consumo de I/O de disco (`iostat` indisponível no roteiro), comportamento com Redis fora do ar.

## 2. Medições

| # | Métrica | Valor | Comando | Data/hora (UTC) |
|---|---|---|---|---|
| M1 | CPUs / load (1, 5, 15 min) | 2 vCPU / 1,00 1,14 1,17 (load ≈ 55% da capacidade, ocioso do Bipaê) | `nproc; cat /proc/loadavg` | 27/10 16:14:33 |
| M2 | Uptime do host | 10 dias 4 h | `uptime` | 27/10 16:14:33 |
| M3 | RAM | total 7.936 MiB, usada 3.515, livre 217, buff/cache 4.203, **disponível 3.530** | `free -m` | 27/10 16:14:33 |
| M4 | Swap | **0** (não existe) | `free -m; swapon --show` | 27/10 16:14:33 |
| M5 | Disco `/` (inclui `/var/lib/docker` e `/root`) | 97 G, usado 64 G (67%), livre 33 G | `df -h` | 27/10 16:14:33 / 16:17:15 |
| M6 | Docker | 35 imagens 11,03 GB (955 MB recuperáveis), 45 contêineres, 21 volumes 7,17 GB | `docker system df` | 27/10 16:14:33 |
| M7 | Consumo de RAM do Bipaê | api 186,9 MiB/512 (36,5%); postgres 42,8/512; redis 10,0/96; web 4,8/128 → **≈ 244 MiB** | `docker stats --no-stream` | 27/10 16:14:41 |
| M8 | Consumo dos demais (41 contêineres) | ≈ 4.690 MiB; destaques: `mercadoflow-postgres` 1,23 GiB/1,5 GiB (82%), `mercadoflow-cron` 598,7/640 MiB (**93,5%**), `mercadoflow-catalog-harvester` 316,7/384 MiB (82%, 12% CPU) | `docker stats --no-stream` + soma em awk | 27/10 16:14:41 |
| M9 | Soma dos limites de memória (contêineres com limite) | **≈ 12.944 MiB** para 7.936 MiB físicos; **12 contêineres sem limite** (palmital, metalgest, tagflow, fusesite) | idem, soma em awk | 27/10 16:14:41 |
| M10 | CPU do Bipaê | api 0,00%, postgres 2,76%, redis 0,79%, web 0,00%; nenhum contêiner do Bipaê tem limite de CPU (`NanoCpus=0`) nem de PIDs | `docker stats`; `docker inspect` | 27/10 16:14:41 / 16:14:54 |
| M11 | Reinícios / OOM | RestartCount=0 e OOMKilled=false nos 4; 0 ocorrências de OOM no kernel em 10 dias | `docker inspect -f '{{.RestartCount}} {{.State.OOMKilled}}'`; `journalctl -k --since -10days \| grep -ci oom` | 27/10 16:14:54 / 16:18:46 |
| M12 | Saúde | 4/4 `healthy`, FailingStreak=0. `fusesite` (outra aplicação) está `unhealthy` | `docker ps`; `docker inspect` | 27/10 16:14:33 |
| M13 | Logs do Docker | `json-file`, `max-size=10m`, `max-file=3` (padrão do daemon em `/etc/docker/daemon.json`, também aplicado aos 4 contêineres); há ainda `/etc/logrotate.d/docker-containers` no host | `docker inspect`; `cat /etc/docker/daemon.json` | 27/10 16:14:54 |
| M14 | Imagens | `bipae-api` **948 MB**; `bipae-web` 61 MB; `postgres:16-alpine` 294 MB; `redis:7-alpine` 39,1 MB | `docker images` | 27/10 16:14:54 |
| M15 | Banco | 12 MB; 96 tabelas (88 com RLS); maior tabela 96 kB; cache hit 99,99%; 0 deadlocks; 0 bytes de temp; idade de XID 453 | `psql` (SELECTs em transação somente leitura) | 27/10 16:18:04 |
| M16 | Conexões | 1 (a própria consulta); o pool da API não mantinha conexões ociosas | `pg_stat_activity` | 27/10 16:18:04 |
| M17 | Parâmetros do Postgres | padrão da imagem: `shared_buffers` 128 MB, `work_mem` 4 MB, `max_connections` 100, `statement_timeout` 0, `idle_in_transaction_session_timeout` 0, `log_min_duration_statement` -1, `archive_mode` off, sem `pg_stat_statements` | `pg_settings` | 27/10 16:18:04 |
| M18 | Migrações em produção | 81 aplicadas (última `0081_st_net_load_options`); o repositório tem 89 → **8 pendentes** para o próximo deploy | `select count(*), max(name) from schema_migrations`; `ls migrations` | 27/10 ~16:20 |
| M19 | Redis | usado 3,48 MB / máx. 48 MB, `noeviction`, fragmentação 2,62, AOF ligado (arquivo 22,9 MB), último `bgsave` ok, 119 chaves, 3 clientes; fila: 0 aguardando, 0 ativas, 6 atrasadas (agendadores), 0 falhas, 100 concluídas guardadas | `redis-cli info memory/persistence`; `dbsize`; contagem das chaves `bull:bipae:*` | 27/10 16:18:12 |
| M20 | Backups | 14 arquivos `bipae-*.sql.gz`, 46–49 kB cada, 700 kB no total, todos entre 23/10 04:43 e **25/10 03:36** UTC (o mais novo tem ≈ 2 dias e 12 h); mesmo disco `/dev/sda1`; nenhum cron do Bipaê | `ls -lh /root/bipae/backups; du -sh; crontab -l; ls /etc/cron.d` | 27/10 16:17:15 |
| M21 | `/v1/health` público (8 req. sequenciais, a partir da máquina do dono) | 1ª: 457 ms (conexão fria); demais: 108–165 ms total, dos quais TLS 80–135 ms; HTTP/1.1 | `curl -w '%{time_total} %{time_appconnect} %{http_version}'` | 27/10 16:18:32 |
| M22 | `/v1/health` local na VPS (5 req.) | 2,1–4,5 ms | `curl http://127.0.0.1:3400/v1/health` | 27/10 16:18:46 |
| M23 | Tráfego do web (24 h) | 5.775 requisições, todas 200 | `docker logs --since 24h bipae-web-1 \| awk '{print $9}' \| sort \| uniq -c` | 27/10 ~16:19 |
| M24 | Certificado | `bipae.com.br` válido até 10/01/2027 (75 dias); `certbot.timer` ativo, última execução 27/10 06:25 | `certbot certificates`; `systemctl list-timers certbot.timer` | 27/10 16:18 |
| M25 | Portas | só `127.0.0.1:3400` (docker-proxy) do Bipaê no host; Postgres, Redis e API sem porta publicada | `ss -tlnp` | 27/10 16:18:46 |
| M26 | Cabeçalhos públicos em `/app/` | HSTS, CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy presentes; `Content-Encoding: gzip`; **`Server: nginx/1.18.0 (Ubuntu)`** | `curl -sI` | 27/10 16:18:35 |
| M27 | Limpeza automática de imagens do host | `docker image prune -af --filter until=24h` diário às 00:04 e `builder prune` semanal (cron de outra origem, afeta todas as aplicações) | `cat /etc/cron.d/docker-image-prune` | 27/10 ~16:17 |

## 3. Achados

Severidade: Crítica / Alta / Média / Baixa. Estado: CONFIRMADO, FORTE INDÍCIO, HIPÓTESE.

### R5-01 — Backup só acontece em deploy, fica no mesmo disco e nunca é testado
- **Categoria:** backups / recuperação. **Severidade: Alta** — hoje o banco tem 12 MB e 1 cliente, mas o produto guarda vendas e dados fiscais (guarda legal de 5 anos); uma falha do disco ou da VPS perde tudo, e entre deploys a perda pode ser de dias. Não é Crítica porque ainda há pouco dado real e há 14 cópias locais.
- **Estado:** CONFIRMADO.
- **Evidência:** `deploy/deploy.sh:65-72` (backup só dentro do deploy, `pg_dump | gzip` em `/root/bipae/backups`); M20 (último backup 25/10 03:36, ≈ 2,5 dias; todos os 14 em `/dev/sda1`; nenhum cron do Bipaê, ao contrário do MercadoFlow, que tem `/etc/cron.d/mercadoflow-backup`); M17 (`archive_mode off`, sem PITR). Não há no repositório nenhum teste de restauração (busca por `restore` em `.github/workflows` e `deploy/` sem resultado). A retenção "14 últimos" contou só ≈ 2 dias de histórico porque os deploys são frequentes: um dado corrompido percebido 3 dias depois não tem mais cópia boa.
- **Impacto:** perda de dados (RPO = tempo desde o último deploy, sem limite); RTO desconhecido; perda total se o disco ou a VPS forem perdidos.
- **Correção — repositório (segura, entra pelo deploy):**
  1. `deploy/backup.sh` com `pg_dump -Fc` (formato custom, restaurável por tabela), nome com data, verificação de integridade (`pg_restore --list` no arquivo gerado) e retenção por **tempo** (ex.: 7 diários + 4 semanais + 6 mensais), não por quantidade.
  2. Etapa de **teste de restauração**: restaurar o último arquivo num contêiner `postgres:16-alpine` descartável (`--rm`, sem volume, `--memory 256m`) e conferir contagem de `schema_migrations` e de tabelas; falha gera saída não zero.
  3. Envio para fora da VPS (bucket S3 compatível, ex.: Backblaze/R2, cifrado com `age`/GPG antes do envio); credencial só no `.env`.
  4. `deploy.sh` instala o cron (`/etc/cron.d/bipae-backup`) apontando para o script versionado.
- **Ação manual na VPS (com aprovação do dono):** criar o bucket e colocar a credencial no `.env`; aprovar o cron diário (sugestão: 03:30 BRT, fora do backup do MercadoFlow às 06:00 UTC).
- **Teste de aceite:** `ls -lh backups/` mostra arquivo com menos de 24 h; o log do teste de restauração diz "restaurado: N migrações"; o objeto aparece no bucket remoto; simular a perda do volume num ambiente de teste e restaurar a partir do bucket.

### R5-02 — Memória da VPS supercomprometida e sem swap: o Bipaê pode ser morto por outra aplicação
- **Categoria:** capacidade / isolamento. **Severidade: Alta** — o OOM killer do kernel escolhe o processo pelo consumo, não pelo dono; o Postgres do Bipaê pode ser encerrado por pico do MercadoFlow, e sem swap não há folga.
- **Estado:** CONFIRMADO (supercomprometimento e ausência de swap); HIPÓTESE (o OOM em si: 0 ocorrências em 10 dias, M11).
- **Evidência:** M3, M4, M8, M9: soma dos limites ≈ 12,9 GiB para 7,75 GiB físicos, 12 contêineres sem limite, `mercadoflow-cron` a 93,5% do próprio limite e `mercadoflow-postgres` a 82%. O Bipaê está dentro do que declarou (≈ 244 MiB de 1.248 MiB de limite).
- **Impacto:** queda do caixa online/retaguarda e possível reinício do Postgres em pleno uso (o PDV continua offline, mas a sincronização e a retaguarda param).
- **Correção — repositório:** dar ao Postgres do Bipaê `oom_score_adj: -500` e `mem_reservation` (ex.: 256m) no compose; limitar CPU (`cpus: '1.0'` na API, `0.5` no web) e PIDs (`pids_limit: 256`) para não disputar as 2 vCPUs; ajustar o Postgres ao limite de 512 MB (`shared_buffers=128MB` já cabe; definir `effective_cache_size=256MB` para o planejador não supor 4 GB).
- **Ação manual na VPS (com aprovação do dono, afeta todas as aplicações):** criar swap de 2–4 GB com `vm.swappiness=10`; pôr limite de memória nos 12 contêineres sem limite; rever o `mercadoflow-cron`, que vive encostado no teto. Avaliar mudar de plano quando a soma dos *usos* passar de 70% da RAM.
- **Teste de aceite:** `swapon --show` lista o swap; `docker inspect -f '{{.HostConfig.OomScoreAdj}}' bipae-postgres-1` = -500; `docker stats` sem contêiner sem limite.

### R5-03 — Volta automática (rollback) roda código antigo sobre schema novo
- **Categoria:** deploy. **Severidade: Média** — o próximo deploy aplica **8 migrações** de uma vez (M18); se a nova versão não ficar saudável depois de migrar, o `deploy.sh` sobe a imagem antiga sobre o banco migrado e não restaura o backup.
- **Estado:** CONFIRMADO (mecanismo); HIPÓTESE (quebra real): as migrações 0082–0089 inspecionadas são em geral aditivas (`create table`, `add column ... default`), o que reduz o risco; `0083` remove `not null` e troca uma *constraint*, o que o código antigo tolera.
- **Evidência:** `apps/api/src/main.ts:7-9` (migra antes de escutar); `deploy/deploy.sh:107-116` (rollback só troca imagens).
- **Impacto:** rollback "verde" com a versão antiga falhando em gravações que dependam de colunas novas, ou o contrário; nenhum alerta.
- **Correção — repositório:** documentar e impor na CI a regra *expand/contract* (migração só aditiva no mesmo deploy em que o código passa a usá-la; remoção em deploy posterior). Ex.: a etapa `validate-migrations` recusa `drop column`, `rename` e `alter ... type` sem a marca `[migracao-contract]` no commit. No rollback, registrar no log as migrações aplicadas pela versão que falhou.
- **Ação manual:** nenhuma.
- **Teste de aceite:** commit com `alter table x drop column y` sem a marca falha na etapa de validação.

### R5-04 — Imagem da API com 948 MB: repositório inteiro e dependências de desenvolvimento
- **Categoria:** build / disco. **Severidade: Média** — cada deploy baixa ≈ 1 GB numa VPS compartilhada; o `deploy.sh` precisou de limpeza de imagens por causa disso (comentário em `deploy/deploy.sh:75-77`); aumenta superfície de ataque (compiladores, código de teste e fontes de todos os pacotes dentro da imagem).
- **Estado:** CONFIRMADO.
- **Evidência:** `apps/api/Dockerfile:5-11` (`COPY . .`, `pnpm install` com dev deps, `COPY --from=build /app /app`); M14.
- **Correção — repositório:** no estágio de build, `pnpm --filter @bipae/api deploy --prod /out` (ou copiar só `apps/api/dist` + `node_modules` de produção); estágio final só com `/out`; `USER node` mantido. Meta: < 250 MB. Conferir que o `build.mjs` copia as migrações para `dist`.
- **Teste de aceite:** `docker images` mostra `bipae-api` < 250 MB; `scripts/smoke-api.mjs` e o deploy passam.

### R5-05 — `/v1/health` não verifica banco nem Redis
- **Categoria:** disponibilidade / observabilidade. **Severidade: Média** — o healthcheck do compose, a espera do `deploy.sh` e a verificação pública usam esse endereço; com o Postgres fora do ar ou o pool travado, tudo continua "healthy".
- **Estado:** CONFIRMADO (código); o comportamento com o banco fora do ar não foi testado (exigiria escrita).
- **Evidência:** `apps/api/src/app.ts` `HealthController.health()` devolve objeto fixo; `deploy/docker-compose.vps.yml:95-100` e `:115-116`.
- **Correção — repositório:** manter `/v1/health` leve (vivo) e criar `/v1/health/ready` que faz `select 1` (com tempo máximo de 1 s) e `PING` no Redis quando `REDIS_URL` existe, respondendo 503 se falhar; o healthcheck do compose e o `wait_healthy` passam a usar o `ready`. Expor também o tipo da fila (`redis`/`memory`), para pegar o caso do R5-07.
- **Teste de aceite:** teste de integração com banco desligado recebe 503 em `/v1/health/ready`; o deploy com `DATABASE_URL` errado volta sozinho.

### R5-06 — Sem observabilidade operacional: logs não estruturados, sem log de requisição, sem consulta lenta, sem alerta
- **Categoria:** observabilidade. **Severidade: Média** — hoje um erro 500, uma consulta lenta ou um disco cheio só são percebidos quando um cliente reclama.
- **Estado:** CONFIRMADO.
- **Evidência:** `app.ts` usa o logger padrão do Nest (texto com cores ANSI, observado no arquivo de log rotacionado do contêiner da API) e o Fastify sem logger (sem linha por requisição, sem tempo de resposta); M17 (`log_min_duration_statement=-1`, sem `pg_stat_statements`); nenhuma ferramenta de métrica ou alerta no repositório (busca por sentry/prometheus/opentelemetry/pino sem resultado em código); nenhum monitor externo de disponibilidade encontrado.
- **Correção — repositório:** logger JSON (pino, já embutido no Fastify) com `reqId`, rota, status e duração, sem corpo nem cabeçalho `authorization`; `NO_COLOR=1`; Postgres com `-c log_min_duration_statement=500 -c shared_preload_libraries=pg_stat_statements` no `command` do compose (exige reinício do Postgres no deploy — combinar janela) e `create extension if not exists pg_stat_statements` numa migração; job leve na fila `QUEUE` que registra no log disco livre, tamanho do banco e falhas da fila.
- **Ação manual (com aprovação do dono):** monitor externo gratuito (ex.: UptimeRobot) em `/v1/health/ready` com alerta por e-mail/WhatsApp; alerta de disco > 85%.
- **Teste de aceite:** `docker logs bipae-api-1 --tail 1` é JSON com `responseTime`; `select count(*) from pg_stat_statements` > 0; o monitor externo dispara ao parar a API num ambiente de teste.

### R5-07 — Redis cheio ou fora do ar: tarefas podem travar ou sumir sem aviso
- **Categoria:** fila. **Severidade: Baixa** hoje (3,5 MB de 48 MB, M19), **Média** com crescimento.
- **Estado:** HIPÓTESE (não testado com Redis parado).
- **Evidência:** `docker-compose.vps.yml:41` (`maxmemory 48mb` + `noeviction`: cheio, toda gravação é recusada); `common/queue.ts` (`maxRetriesPerRequest: null`: com o Redis fora, os comandos ficam em espera sem prazo, então um `queue.add` dentro de uma requisição pode pendurar a requisição; `createQueue` cai para fila em memória e só avisa no log). O AOF já tem 22,9 MB para 3,5 MB de dados.
- **Correção — repositório:** `queue.add` com tempo máximo (ex.: `Promise.race` de 2 s) e erro pt-BR; métrica/alerta de uso de memória do Redis no job do R5-06; `/v1/health/ready` informa `queue: memory` como degradado.
- **Teste de aceite:** teste com Redis inexistente: a rota que enfileira responde em < 3 s.

### R5-08 — IP do cliente falsificável: limites de tentativa (login) contornáveis
- **Categoria:** borda / rate limit (cruza com R1). **Severidade: Média** — o limite de login por IP é a defesa contra tentativa de senha.
- **Estado:** FORTE INDÍCIO (análise de configuração; não testado contra produção para não gerar tentativas de login).
- **Evidência:** `deploy/nginx/bipae.com.br.conf:26` usa `$proxy_add_x_forwarded_for` (acrescenta ao `X-Forwarded-For` enviado pelo cliente); `apps/web/docker/nginx.conf:23` repete; `app.ts` cria o Fastify com `trustProxy: true` (confia em todos os saltos, então `request.ip` vira o primeiro valor da lista, escrito pelo cliente); `@fastify/rate-limit` usa `request.ip` por padrão.
- **Correção — repositório:** no nginx do host, `proxy_set_header X-Forwarded-For $remote_addr;` (sobrescreve); no nginx do contêiner, repassar o valor recebido sem acrescentar; no Fastify, `trustProxy` com número de saltos (`2`) ou a sub-rede da rede `internal`. O arquivo do host só muda na VPS (ver ação manual).
- **Ação manual na VPS (com aprovação):** aplicar a mudança em `/etc/nginx/sites-available/bipae.com.br`, `nginx -t` e `systemctl reload nginx` (afeta só o site do Bipaê).
- **Teste de aceite:** teste de integração: 11 logins errados com `X-Forwarded-For` diferentes a cada vez recebem 429 a partir do 11º.

### R5-09 — Pool do Postgres sem tempos máximos e sem tratamento de erro
- **Categoria:** banco. **Severidade: Média.**
- **Estado:** CONFIRMADO (configuração); HIPÓTESE (efeito).
- **Evidência:** `apps/api/src/db/client.ts:42` (`new pg.Pool({ connectionString, max: 10 })`, sem `connectionTimeoutMillis`, `statement_timeout`, `idle_in_transaction_session_timeout` nem `pool.on('error')`); M17 (servidor também com 0). Uma consulta presa ou uma transação aberta segura uma das 10 conexões para sempre; com 10 presas, toda a API espera sem prazo. No `node-postgres`, erro de um cliente ocioso sem ouvinte de `error` derruba o processo.
- **Correção — repositório:** `max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 30000, idle_in_transaction_session_timeout: 60000` (relatórios e exportações longas podem subir o próprio limite com `set local statement_timeout`); `pool.on('error', ...)` com log.
- **Teste de aceite:** teste com `select pg_sleep(40)` recebe erro de tempo esgotado em ~30 s e a API continua respondendo.

### R5-10 — nginx do host: versão exposta, sem HTTP/2, sem limite de requisições na borda
- **Categoria:** borda. **Severidade: Baixa.**
- **Estado:** CONFIRMADO (M26, M21: `HTTP/1.1`; `listen 443 ssl` sem `http2` no arquivo do site).
- **Evidência:** `server_tokens` comentado em `/etc/nginx/nginx.conf:20` (arquivo comum a todas as aplicações); sem `limit_req` na VPS; o nginx do contêiner já tem `server_tokens off`, mas o cabeçalho público vem do host. Os protocolos TLS do site são 1.2/1.3 (`options-ssl-nginx.conf:11`), mas `nginx.conf:32` ainda lista TLSv1/1.1 no nível `http`; o teste externo com TLS 1.0/1.1 falhou, mas o curl do Windows pode não suportar essas versões (inconclusivo).
- **Correção — repositório:** atualizar `deploy/nginx/bipae.com.br.conf` como referência com `http2 on;` (ou `listen 443 ssl http2;` no 1.18), `server_tokens off;` no bloco do site e `limit_req_zone` para `/v1/` (ex.: 20 r/s por IP com `burst=40`).
- **Ação manual na VPS (com aprovação):** aplicar no arquivo do site do Bipaê, `nginx -t`, `reload`. Mudar `nginx.conf` global (TLS, `server_tokens`) afeta todas as aplicações: decidir com o dono.
- **Teste de aceite:** `curl -sI --http2 https://www.bipae.com.br/` mostra `HTTP/2` e `Server: nginx` sem versão.

### R5-11 — Deploy entra como root numa VPS compartilhada
- **Categoria:** segredos / raio de dano (cruza com R1). **Severidade: Média** — vazar o secret `BIPAE_DEPLOY_SSH_KEY` dá root em todas as aplicações da VPS (MercadoFlow, Rebania e outras).
- **Estado:** CONFIRMADO.
- **Evidência:** `.github/workflows/deploy.yml:163` (`User root`); `docs/deploy.md` (chave em `/root/.ssh/authorized_keys`). Pontos fortes: chave de host fixada, chave só do Bipaê, `environment: producao`.
- **Correção — repositório:** nenhuma imediata além de documentar.
- **Ação manual na VPS (com aprovação):** restringir a chave em `authorized_keys` com `command="/root/bipae/deploy/ssh-gate.sh",no-port-forwarding,no-pty,no-agent-forwarding` (o portão só aceita `mkdir`, `rsync` para `/root/bipae/deploy/` e o `deploy.sh`) ou, melhor, usuário `bipae-deploy` no grupo `docker` (ainda é equivalente a root via Docker, mas limita o resto). Exigir aprovação manual no environment `producao` do GitHub.
- **Teste de aceite:** `ssh -i chave_deploy root@vps id` é recusado; o deploy segue verde.

### R5-12 — Limpeza diária de imagens do host (`prune -af`) é de todas as aplicações
- **Categoria:** operação compartilhada. **Severidade: Baixa** para o Bipaê.
- **Estado:** CONFIRMADO (M27); efeito sobre o rollback do Bipaê: não há (a imagem anterior está em uso durante o deploy, e o `deploy.sh` só guarda a versão no ar).
- **Impacto:** uma versão anterior à atual nunca fica no disco; voltar duas versões exige novo pull do GHCR (que tem as imagens por digest). Aceitável.
- **Correção:** nenhuma no repositório; registrar em `docs/deploy.md` que a volta manual além de uma versão é por digest do GHCR.

### R5-13 — Produção está 36 commits atrás do repositório
- **Categoria:** processo de release. **Severidade: Baixa** (informativa para o veredito).
- **Estado:** CONFIRMADO (`git rev-list --count origin/main..728df79` = 36; M18: 8 migrações pendentes).
- **Impacto:** o próximo push publica de uma vez 36 commits e 8 migrações, aumentando o raio de um problema e dificultando achar a causa; o que esta banca mediu na VPS não é o commit auditado.
- **Correção:** publicar em lotes menores; confirmar CI verde antes; ver R5-03.

## 4. Controles corretos (verificados)

- Só `127.0.0.1:3400` publicado no host; API, Postgres e Redis em rede interna (M25; `docker-compose.vps.yml:25,44,89-94`).
- Limites de memória explícitos nos 4 serviços e uso real bem abaixo deles (M7); 0 reinícios e 0 OOM (M11).
- Healthcheck nos 4 serviços e `depends_on: service_healthy` (compose).
- Rotação de logs do Docker configurada (10 MB × 3) no daemon e nos contêineres (M13).
- Imagens por digest, chave de host SSH fixada, `concurrency` sem cancelamento, backup antes do deploy, espera de saúde e volta automática, verificação pública ao final (`deploy.yml`, `deploy.sh`). O `pipefail` evita backup vazio silencioso.
- `.env` e backups com permissão 600/700 (`umask 077`, M20).
- API roda como `node` (não root) (`apps/api/Dockerfile:13`; `docker inspect` user=node).
- Imagem web pequena (61 MB), gzip ativo, cache imutável para `/assets/`, `no-cache` no `index.html` e no `sw.js`, cabeçalhos de segurança completos (M26).
- TLS Let's Encrypt válido por 75 dias com renovação automática ativa (M24); HSTS.
- Redis com AOF e política `noeviction` (correta para fila), tarefas idempotentes por agendador fixo (`queue.ts`), `removeOnComplete/Fail` evita crescimento.
- Desempenho atual folgado: API responde em 2–4 ms localmente; banco com 99,99% de cache e sem tabelas inchadas (M15, M22).

## 5. Parecer R5

**NÃO COMPROVADO para infraestrutura de produção com dados de clientes**, com recomendação de **aprovar com ressalvas** o funcionamento atual.

- Hoje o Bipaê usa ≈ 244 MiB e quase nada de CPU; não há gargalo medido de desempenho. O risco está em **recuperação** e **vizinhança**: backup sem agenda, sem cópia fora da VPS e sem teste de restauração (R5-01, Alta) e memória do host supercomprometida sem swap (R5-02, Alta).
- Antes de colocar clientes pagantes com dados fiscais reais, R5-01 deve estar resolvido e testado; R5-02 precisa ao menos do `oom_score_adj` e de swap aprovados pelo dono.
- R5-03, R5-05, R5-06, R5-08 e R5-09 são correções de repositório baratas que entram pelo deploy normal.
- Nenhuma escrita foi feita na VPS; uma tentativa de copiar um arquivo SQL para `/tmp` da VPS foi bloqueada pelo controle de permissões e substituída por envio do SQL pela entrada padrão do `psql`, dentro de `begin transaction read only`.
