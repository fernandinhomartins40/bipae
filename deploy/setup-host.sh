#!/usr/bin/env bash
# Preparação ÚNICA da VPS para o Bipaê (rodar como root, uma vez, com aprovação do dono).
# Não mexe em nada das outras aplicações: só cria /root/bipae, o site nginx do Bipaê e o
# certificado de bipae.com.br + www.bipae.com.br.
#
# Uso: bash deploy/setup-host.sh [email-para-avisos-do-lets-encrypt]
set -euo pipefail

APP_DIR=/root/bipae
SITE=/etc/nginx/sites-available/bipae.com.br
EMAIL="${1:-}"

echo "==> Diretório da aplicação"
mkdir -p "$APP_DIR"

echo "==> Site nginx (HTTP; o certbot acrescenta o HTTPS)"
if [ -f "$SITE" ]; then
  echo "    $SITE já existe; não sobrescrevo (o certbot pode tê-lo alterado)."
else
  install -m 644 "$APP_DIR/deploy/nginx/bipae.com.br.conf" "$SITE"
fi
ln -sf "$SITE" /etc/nginx/sites-enabled/bipae.com.br
nginx -t
systemctl reload nginx

echo "==> Certificado Let's Encrypt"
if [ -d /etc/letsencrypt/live/bipae.com.br ]; then
  echo "    Certificado já existe; a renovação automática do certbot cuida dele."
else
  if [ -n "$EMAIL" ]; then
    certbot --nginx --non-interactive --agree-tos --redirect -m "$EMAIL" \
      --cert-name bipae.com.br -d bipae.com.br -d www.bipae.com.br
  else
    certbot --nginx --non-interactive --agree-tos --redirect --register-unsafely-without-email \
      --cert-name bipae.com.br -d bipae.com.br -d www.bipae.com.br
  fi
fi
nginx -t
systemctl reload nginx
echo "==> Pronto. https://www.bipae.com.br encaminha para 127.0.0.1:3400."
