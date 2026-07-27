#!/usr/bin/env bash
# Onboarding: instala deps, cria os .env a partir dos exemplos e prepara os bancos local de dev e teste.
set -euo pipefail
cd "$(dirname "$0")/.."

copy_env() {
  if [ ! -f "$1" ]; then
    cp "$2" "$1"
    echo "criado $1"
  fi
}

copy_env eloscrm-api/.env eloscrm-api/.env.example
copy_env eloscrm-api/.env.test eloscrm-api/.env.test.example
copy_env eloscrm-web/.env eloscrm-web/.env.example

# BETTER_AUTH_SECRET vem vazio no exemplo e o env.ts exige >= 10 chars
if grep -q '^BETTER_AUTH_SECRET=$' eloscrm-api/.env; then
  secret=$(openssl rand -hex 24)
  tmp=$(mktemp)
  sed "s|^BETTER_AUTH_SECRET=$|BETTER_AUTH_SECRET=$secret|" eloscrm-api/.env > "$tmp"
  mv "$tmp" eloscrm-api/.env
  echo "gerado BETTER_AUTH_SECRET em eloscrm-api/.env"
fi

pnpm --dir eloscrm-api install
pnpm --dir eloscrm-web install

pnpm --dir eloscrm-api db:generate
pnpm --dir eloscrm-api db:push
pnpm --dir eloscrm-api db:push:test

echo
echo 'pronto. ./scripts/dev.sh sobe api (3333) e web (3000).'
