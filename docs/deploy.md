# Produção: www.bipae.com.br

> Publicado em 12/10/2026. VPS compartilhada 72.60.10.112 (junto com Rebania, MercadoFlow e outras).

## Endereços

| URL | O que é |
|---|---|
| https://www.bipae.com.br | Landing page de vendas (`apps/site`) |
| https://www.bipae.com.br/app/ | Aplicação: retaguarda e caixa (`apps/web`, PWA) |
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
- Limites de memória: postgres 512 MB, api 512 MB, web 128 MB (a VPS não tem swap).
- Segredos (`POSTGRES_PASSWORD`, `JWT_SECRET`) em `/root/bipae/.env`, gerados no primeiro deploy, permissão 600. **Nunca estão no repositório.**
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
ls -lh backups/            # backups do banco
```

Restaurar um backup (apaga os dados atuais; só com aprovação):

```bash
gunzip -c backups/bipae-AAAAMMDDTHHMMSSZ.sql.gz | $C exec -T postgres psql -U bipae -d bipae
```

## Configuração única já feita

- `deploy/setup-host.sh`: site `/etc/nginx/sites-available/bipae.com.br` + certificado. Não precisa rodar de novo.
- Chave de host da VPS fixada em `.github/vps_known_hosts` (SHA256:6ZU1oyYcSKKrodyE2uYKme3ciSkCWFxfniTKCGn7NW8).
