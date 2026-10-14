# Produção: www.bipae.com.br

> Publicado em 12/10/2026. VPS compartilhada 72.60.10.112 (junto com Rebania, MercadoFlow e outras).

## Endereços

| URL | O que é |
|---|---|
| https://www.bipae.com.br | Landing page de vendas (`apps/site`) |
| https://www.bipae.com.br/app/ | Aplicação: retaguarda e caixa (`apps/web`, PWA) |
| https://www.bipae.com.br/app/admin | Painel super admin da equipe Bipaê (ADR-0013) |
| https://www.bipae.com.br/v1/health | API (`apps/api`) |
| https://bipae.com.br | Redireciona para o www |

## Como funciona

```
Internet ─HTTPS─► nginx do host (certbot) ─► 127.0.0.1:3400 ─► contêiner web (nginx)
                                                                  ├─ /        landing
                                                                  ├─ /app/    app (SPA/PWA)
                                                                  └─ /v1/  ─► contêiner api ─► contêiner postgres
```

- Projeto compose `bipae` em `/root/bipae` (`deploy/docker-compose.vps.yml`). Só o web escuta no host, e só em 127.0.0.1.
- Limites de memória: postgres 512 MB, api 512 MB, redis 96 MB, web 128 MB (a VPS não tem swap).
- **Redis** (fila de tarefas em segundo plano): contêiner `redis`, sem porta no host, dados no volume `redisdata`. A API usa `REDIS_URL=redis://redis:6379`.
- Segredos (`POSTGRES_PASSWORD`, `JWT_SECRET`, `SECRETS_KEY`) em `/root/bipae/.env`, gerados pelo `deploy.sh` quando faltam, permissão 600. `SECRETS_KEY` cifra as sementes do 2FA do painel: **não troque** sem antes zerar o 2FA da equipe. **Nunca estão no repositório.**
- Certificado Let's Encrypt `bipae.com.br` (bipae.com.br + www), renovado pelo `certbot.timer` da VPS.

## Deploy

Só pelo GitHub Actions: workflow **Deploy (www.bipae.com.br)** (`.github/workflows/deploy.yml`), a cada push em `main` (exceto mudanças só em documentação ou no app desktop) ou manualmente em *Actions → Run workflow*.

Etapas:
1. bloqueia edição de migração já versionada;
2. lint, typecheck e testes, incluindo a API contra PostgreSQL 16 real;
3. imagens `ghcr.io/fernandinhomartins40/bipae-api` e `bipae-web`, referenciadas por digest;
4. na VPS:
   - backup do banco (`/root/bipae/backups`, guarda os 14 últimos);
   - sobe a nova versão;
   - espera ficar saudável;
   - **volta sozinho para a versão anterior** se não ficar;
5. verifica `/`, `/app/` e `/v1/health` no domínio público.

Se o job falhar em "Primeiro contato com a VPS", é o filtro da Hostinger para alguns IPs de runner: use *Re-run all jobs*.

O acesso do deploy é a chave `github-actions bipae deploy` (secret `BIPAE_DEPLOY_SSH_KEY`). Para cortá-lo, apague essa linha de `/root/.ssh/authorized_keys` na VPS.

## Operação (comandos na VPS)

```bash
cd /root/bipae
C="docker compose -p bipae -f deploy/docker-compose.vps.yml --env-file .env"
. ./.deploy-state && export BIPAE_API_IMAGE=$DEPLOYED_API BIPAE_WEB_IMAGE=$DEPLOYED_WEB

$C ps                      # estado
$C logs --tail 100 api     # logs da API
$C exec redis redis-cli llen bull:bipae:wait   # tarefas aguardando na fila
ls -lh backups/            # backups do banco
```

Restaurar um backup (apaga os dados atuais; só com aprovação):

```bash
gunzip -c backups/bipae-AAAAMMDDTHHMMSSZ.sql.gz | $C exec -T postgres psql -U bipae -d bipae
```

## Painel super admin (equipe Bipaê)

Não existe cadastro de super admin pela tela. A pessoa primeiro cria uma conta comum em https://www.bipae.com.br/app/criar-conta. Depois, na VPS:

```bash
$C exec api node dist/admin-cli.js grant pessoa@exemplo.com.br owner     # owner | support | viewer
$C exec api node dist/admin-cli.js list
$C exec api node dist/admin-cli.js reset-totp pessoa@exemplo.com.br      # perdeu o celular do 2FA
$C exec api node dist/admin-cli.js revoke pessoa@exemplo.com.br
```

No primeiro acesso a https://www.bipae.com.br/app/admin, o painel pede para ativar a verificação em duas etapas (Google Authenticator, Microsoft Authenticator, 1Password etc.). Sem ela o painel não abre.

Os demais membros da equipe podem ser adicionados pelo próprio painel (Equipe Bipaê), por quem é Administrador.

## Integração com o MercadoFlow (ADR-0015)

A API do Bipaê entra também na rede `mercadoflow-web_default` (projeto compose do MercadoFlow, na mesma VPS) com o nome `bipae-api`. Nenhuma porta nova no host. Enquanto o `.env` não tiver as credenciais, a integração fica desligada e o Bipaê funciona como sempre.

Para ligar (uma vez):

1. O super admin do MercadoFlow gera as credenciais em Parceiros → Bipaê.
2. Na VPS, acrescente ao `/root/bipae/.env` (nunca no repositório):
   ```
   MERCADOFLOW_CLIENT_ID=...
   MERCADOFLOW_CLIENT_SECRET=...
   MERCADOFLOW_TERMS_URL=...      # opcional, quando a página de termos for publicada
   ```
3. Faça um novo deploy (Actions) e confira: `$C exec api node dist/admin-cli.js mercadoflow-status`.
4. Registre o aviso: `$C exec api node dist/admin-cli.js mercadoflow-webhook`. O segredo aparece só nessa resposta: copie para `MERCADOFLOW_WEBHOOK_SECRET=` no `.env` e faça outro deploy.

Se a rede do MercadoFlow sumir, a API do Bipaê não sobe; o deploy volta sozinho para a versão anterior.

## Configuração única já feita

- `deploy/setup-host.sh`: site `/etc/nginx/sites-available/bipae.com.br` + certificado. Não precisa rodar de novo.
- Chave de host da VPS fixada em `.github/vps_known_hosts` (SHA256:6ZU1oyYcSKKrodyE2uYKme3ciSkCWFxfniTKCGn7NW8).
