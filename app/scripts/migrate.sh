#!/usr/bin/env bash
# Safe migration helper — wraps `wasp db migrate-dev` with a hard interlock.
#
# Usage:
#   npm run migrate -- --name add_my_feature
#
# This script exists so that `wasp db migrate-dev` is NEVER run unintentionally
# (e.g. from `npm run dev`). It requires an explicit --name argument and a
# manual confirmation that you understand a DB reset may be offered if Prisma
# detects a conflict.
#
# WARNING: If Prisma offers to reset the database, type "no" and resolve the
# conflict manually. A reset WILL permanently delete all data.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

WASP_BIN="${WASP_BIN:-$(command -v wasp || true)}"
if [ -z "$WASP_BIN" ] && [ -x "$HOME/.local/bin/wasp" ]; then
  WASP_BIN="$HOME/.local/bin/wasp"
fi

color() { printf "\033[%sm%s\033[0m\n" "$1" "$2"; }
warn()  { color "1;33" "! $1"; }
fail()  { color "1;31" "✗ $1"; }

# Require --name
NAME=""
for arg in "$@"; do
  case "$arg" in
    --name) shift; NAME="${1:-}" ;;
    --name=*) NAME="${arg#--name=}" ;;
  esac
done

if [ -z "${NAME:-}" ]; then
  fail "Migration name required. Usage: npm run migrate -- --name <description>"
  echo "  Example: npm run migrate -- --name add_user_preferences"
  exit 1
fi

echo
warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
warn "  ATTENTION — MIGRATION: $NAME"
warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo
echo "  This will run: wasp db migrate-dev --name \"$NAME\""
echo
echo "  ⚠️  If Prisma offers to RESET the database, type 'no' and exit."
echo "      A reset will permanently delete ALL data."
echo
printf "  Type YES (uppercase) to continue, or anything else to cancel: "
read -r CONFIRM </dev/tty

if [ "$CONFIRM" != "YES" ]; then
  fail "Migration cancelled."
  exit 1
fi

echo
"$WASP_BIN" db migrate-dev --name "$NAME"
