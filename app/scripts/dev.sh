#!/usr/bin/env bash
# Gestia — démarrage local en une commande
# Lance Docker (si nécessaire), la base de données Wasp, applique les migrations,
# puis démarre l'application. Ctrl+C arrête tout proprement.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

WASP_BIN="${WASP_BIN:-$(command -v wasp || true)}"
if [ -z "$WASP_BIN" ] && [ -x "$HOME/.local/bin/wasp" ]; then
  WASP_BIN="$HOME/.local/bin/wasp"
fi
if [ -z "$WASP_BIN" ]; then
  echo "❌ La CLI Wasp est introuvable. Installez-la : curl -sSL https://get.wasp.sh/installer.sh | sh"
  exit 1
fi

DB_LOG="$APP_DIR/.gestia-db.log"
DB_PID_FILE="$APP_DIR/.gestia-db.pid"

color() { printf "\033[%sm%s\033[0m\n" "$1" "$2"; }
info()  { color "1;36" "▸ $1"; }
ok()    { color "1;32" "✓ $1"; }
warn()  { color "1;33" "! $1"; }
fail()  { color "1;31" "✗ $1"; }

cleanup() {
  echo
  info "Arrêt des processus..."
  if [ -f "$DB_PID_FILE" ]; then
    local pid
    pid="$(cat "$DB_PID_FILE" 2>/dev/null || true)"
    if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$DB_PID_FILE"
  fi
  # Arrête le conteneur Postgres laissé par `wasp start db` si nécessaire
  if command -v docker >/dev/null 2>&1; then
    docker ps --format '{{.Names}}' 2>/dev/null | grep '^wasp-dev-db-' | xargs -r docker stop >/dev/null 2>&1 || true
  fi
  ok "Terminé."
}
trap cleanup EXIT INT TERM

# 1. .env.server
if [ ! -f "$APP_DIR/.env.server" ]; then
  if [ -f "$APP_DIR/.env.server.example" ]; then
    cp "$APP_DIR/.env.server.example" "$APP_DIR/.env.server"
    ok "Fichier .env.server créé à partir de l'exemple."
  fi
fi

# 2. Docker
info "Vérification de Docker..."
if ! command -v docker >/dev/null 2>&1; then
  fail "Docker n'est pas installé. Installez Docker Desktop : https://www.docker.com/products/docker-desktop"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  warn "Docker n'est pas lancé. Tentative de démarrage..."
  if [ "$(uname)" = "Darwin" ]; then
    open -ga Docker || true
    printf "  En attente de Docker"
    for _ in $(seq 1 60); do
      if docker info >/dev/null 2>&1; then echo; break; fi
      printf "."
      sleep 2
    done
    if ! docker info >/dev/null 2>&1; then
      fail "Docker ne répond toujours pas. Démarrez Docker Desktop manuellement puis réessayez."
      exit 1
    fi
  else
    fail "Démarrez Docker manuellement puis réessayez."
    exit 1
  fi
fi
ok "Docker prêt."

# 3. Base de données Wasp en arrière-plan
info "Démarrage de la base de données PostgreSQL..."
: > "$DB_LOG"
("$WASP_BIN" start db >>"$DB_LOG" 2>&1) &
echo $! > "$DB_PID_FILE"

# Attendre que Postgres accepte les connexions
printf "  En attente de la base de données"
for _ in $(seq 1 60); do
  if (echo > /dev/tcp/127.0.0.1/5432) >/dev/null 2>&1; then echo; ok "Base de données prête."; break; fi
  printf "."
  sleep 1
done
if ! (echo > /dev/tcp/127.0.0.1/5432) >/dev/null 2>&1; then
  fail "La base de données n'a pas démarré. Voir $DB_LOG"
  tail -40 "$DB_LOG" || true
  exit 1
fi

# 4. Migrations
info "Application des migrations Prisma..."
if ! "$WASP_BIN" db migrate-dev --name auto >/dev/null 2>&1; then
  # Replay en mode interactif si nécessaire
  "$WASP_BIN" db migrate-dev
fi
ok "Migrations à jour."

# 5. Lancement de l'application
info "Démarrage de Gestia sur http://localhost:3000 ..."
"$WASP_BIN" start
