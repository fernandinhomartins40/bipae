#!/usr/bin/env bash
# Deploy do Bipaê na VPS. Chamado pelo GitHub Actions (nunca à mão em produção).
#
# Entradas (ambiente): BIPAE_API_IMAGE e BIPAE_WEB_IMAGE, sempre por digest (imagem@sha256:...).
# Só toca no projeto compose "bipae" e em /root/bipae: a VPS é compartilhada.
#
# Passos: segredos (1ª vez) -> backup do banco -> pull -> up -> saúde -> verificação.
# Se a nova versão não ficar saudável, volta sozinho para as imagens anteriores.
set -euo pipefail

APP_DIR=/root/bipae
COMPOSE=(docker compose -p bipae -f "$APP_DIR/deploy/docker-compose.vps.yml" --env-file "$APP_DIR/.env")
STATE="$APP_DIR/.deploy-state"
BACKUPS="$APP_DIR/backups"

: "${BIPAE_API_IMAGE:?BIPAE_API_IMAGE não definido}"
: "${BIPAE_WEB_IMAGE:?BIPAE_WEB_IMAGE não definido}"

cd "$APP_DIR"
umask 077

# ---------------------------------------------------------------- segredos (só na 1ª vez)
if [ ! -f .env ]; then
  echo "==> Criando .env com segredos novos (fica só nesta VPS)"
  {
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
    echo "JWT_SECRET=$(openssl rand -hex 48)"
  } > .env
fi
# Chave própria para segredos guardados (sementes do 2FA da equipe Bipaê), criada uma vez.
if ! grep -q '^SECRETS_KEY=' .env; then
  echo "==> Adicionando SECRETS_KEY ao .env"
  echo "SECRETS_KEY=$(openssl rand -hex 32)" >> .env
fi

set_image_vars() {
  # As imagens ficam fora do .env para que os segredos nunca sejam reescritos.
  export BIPAE_API_IMAGE="$1" BIPAE_WEB_IMAGE="$2"
}

healthy() {
  local service="$1" id status
  id=$("${COMPOSE[@]}" ps -q "$service")
  [ -n "$id" ] || return 1
  status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")
  [ "$status" = "healthy" ]
}

wait_healthy() {
  for _ in $(seq 1 40); do
    if healthy api && healthy web; then return 0; fi
    sleep 5
  done
  return 1
}

# ---------------------------------------------------------------- backup antes de mudar
PREVIOUS_API="" PREVIOUS_WEB=""
if [ -f "$STATE" ]; then
  # shellcheck disable=SC1090
  . "$STATE"
  PREVIOUS_API="${DEPLOYED_API:-}" PREVIOUS_WEB="${DEPLOYED_WEB:-}"
fi

mkdir -p "$BACKUPS"
if [ -n "$("${COMPOSE[@]}" ps -q postgres 2>/dev/null)" ]; then
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  echo "==> Backup do banco: $BACKUPS/bipae-$stamp.sql.gz"
  "${COMPOSE[@]}" exec -T postgres pg_dump -U bipae -d bipae | gzip > "$BACKUPS/bipae-$stamp.sql.gz"
  # Mantém os 14 backups mais recentes.
  ls -1t "$BACKUPS"/bipae-*.sql.gz | tail -n +15 | xargs -r rm -f
fi

# ---------------------------------------------------------------- nova versão
echo "==> Baixando imagens"
set_image_vars "$BIPAE_API_IMAGE" "$BIPAE_WEB_IMAGE"
"${COMPOSE[@]}" pull --quiet

echo "==> Subindo"
# O `up` devolve erro quando um serviço não fica saudável. Isso não pode encerrar o script aqui
# (set -e), senão a volta para a versão anterior, logo abaixo, nunca roda.
UP_OK=1
"${COMPOSE[@]}" up -d --remove-orphans || UP_OK=0

if [ "$UP_OK" = 1 ] && wait_healthy; then
  printf 'DEPLOYED_API=%q\nDEPLOYED_WEB=%q\n' "$BIPAE_API_IMAGE" "$BIPAE_WEB_IMAGE" > "$STATE"
  echo "==> Nova versão saudável."
else
  echo "ERRO: a nova versão não ficou saudável em 200 s." >&2
  "${COMPOSE[@]}" logs --tail 60 api web >&2 || true
  if [ -n "$PREVIOUS_API" ] && [ -n "$PREVIOUS_WEB" ]; then
    echo "==> Voltando para a versão anterior" >&2
    set_image_vars "$PREVIOUS_API" "$PREVIOUS_WEB"
    "${COMPOSE[@]}" up -d --remove-orphans || true
    wait_healthy && echo "==> Versão anterior restaurada." >&2 || echo "ERRO: a versão anterior também não subiu." >&2
  fi
  exit 1
fi

# ---------------------------------------------------------------- verificação local
curl -fsS http://127.0.0.1:3400/v1/health
echo
curl -fsS -o /dev/null -w "landing: %{http_code}\n" http://127.0.0.1:3400/
curl -fsS -o /dev/null -w "app: %{http_code}\n" http://127.0.0.1:3400/app/
