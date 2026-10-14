#!/usr/bin/env bash
# Roda um comando no CI e, se ele falhar, publica as linhas de erro como anotação do GitHub
# (legíveis pela API pública, sem abrir o log). Uso: bash scripts/ci-annotate.sh "título" cmd args...
set -uo pipefail
title="$1"
shift
log=$(mktemp)
if "$@" 2>&1 | tee "$log"; then
  exit 0
fi
sed -i 's/\x1b\[[0-9;]*m//g;s/\r//g' "$log"
found=$(grep -E -A8 '(^|[[:space:]])(error|Error|ERROR|failed|✘|×)' "$log" | head -80)
[ -n "$found" ] || found=$(tail -40 "$log")
msg=$(printf '%s' "$found" | sed ':a;N;$!ba;s/%/%25/g;s/\n/%0A/g')
echo "::error title=${title}::${msg}"
exit 1
