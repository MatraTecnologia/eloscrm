#!/usr/bin/env bash
# Sobe API (3333) e web (3000) juntos; Ctrl-C derruba os dois.
set -euo pipefail
cd "$(dirname "$0")/.."

# job control: cada job em background vira líder do próprio process group, então o trap
# consegue matar a árvore inteira (kill -PGID). Sem isso só o wrapper do pnpm morre e o
# node do tsx/next fica órfão segurando a porta.
set -m

pnpm --dir eloscrm-api dev &
api=$!
pnpm --dir eloscrm-web dev &
web=$!

trap 'kill -- -"$api" -"$web" 2>/dev/null || true' EXIT INT TERM
wait
