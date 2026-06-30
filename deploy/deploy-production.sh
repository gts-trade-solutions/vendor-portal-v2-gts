#!/usr/bin/env bash
# =============================================================================
# Safe production deploy — MadeNKorea Vendor Portal (vendor.madenkorea.com)
# Mirrors the madenkorea VPS flow: backup -> pull -> install -> schema -> build
# -> pm2 -> health check. Idempotent + safe to re-run.
#
# Run ON THE VPS, from the app root:
#     bash deploy/deploy-production.sh
#
# Prereqs: Node >= 20, npm, pm2, mysql + mysqldump client, nginx, and a populated
# .env (see deploy/DEPLOY_RUNBOOK.md §1). The app SHARES madenkorea's production
# MySQL `madenkorea` DB — that is why step 2 takes a full backup first.
# =============================================================================
set -euo pipefail

### ---- CONFIG (override via env, e.g. PORT=3002 bash deploy/deploy-production.sh) ----
APP_DIR="${APP_DIR:-$(pwd)}"
PORT="${PORT:-3008}"                        # vendor portal port (behind nginx); 3008 = live
PM2_NAME="${PM2_NAME:-madenkorea-vendor}"   # matches the live pm2 process
DOMAIN="${DOMAIN:-vendor.madenkorea.com}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/db-backups}"
BRANCH="${BRANCH:-main}"
### ----------------------------------------------------------------------------------

cd "$APP_DIR"
echo "==> Deploy vendor portal | dir=$APP_DIR port=$PORT pm2=$PM2_NAME domain=$DOMAIN"

# 0) sanity
[ -f .env ] || { echo "FATAL: .env missing in $APP_DIR (see deploy/DEPLOY_RUNBOOK.md §1)"; exit 1; }
command -v mysqldump >/dev/null || { echo "FATAL: mysqldump not found"; exit 1; }
command -v pm2 >/dev/null || { echo "FATAL: pm2 not found (npm i -g pm2)"; exit 1; }

# 1) parse DATABASE_URL  (mysql://user:pass@host:port/dbname)
DB_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//')"
p="${DB_URL#mysql://}"; creds="${p%@*}"; hp="${p#*@}"
DB_USER="${creds%%:*}"; DB_PASS_ENC="${creds#*:}"
DB_HOST="${hp%%:*}"; r="${hp#*:}"; DB_PORT="${r%%/*}"; DB_NAME="${r#*/}"; DB_NAME="${DB_NAME%%\?*}"
DB_PASS="$(printf '%b' "${DB_PASS_ENC//%/\\x}")"   # URL-decode (%40 -> @)
export MYSQL_PWD="$DB_PASS"                          # avoids password in process list
MY="-h $DB_HOST -P $DB_PORT -u $DB_USER"

# 2) BACKUP the shared production DB BEFORE any schema change  (CRITICAL)
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}-$(date +%Y%m%d-%H%M%S).sql.gz"
echo "==> Backing up '$DB_NAME' -> $BACKUP_FILE"
mysqldump $MY --single-transaction --quick --routines --triggers "$DB_NAME" | gzip > "$BACKUP_FILE"
echo "    backup ok ($(du -h "$BACKUP_FILE" | cut -f1)). Restore: gunzip < $BACKUP_FILE | mysql $MY $DB_NAME"

# 3) pull latest
git fetch --all --prune
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

# 4) deps
npm ci

# 5) schema (idempotent). MUST use mysql CLI — Prisma can't create the stock triggers.
#    NOTE: this also runs the stock_qty backfill, which makes products with 0
#    IN-STOCK units show OUT OF STOCK on the LIVE storefront. Review the optional
#    "bundle protection" block at the bottom of schema_changes.sql BEFORE running
#    in production if bundles/made-to-order items must stay sellable.
echo "==> Applying deploy/schema_changes.sql"
mysql $MY "$DB_NAME" < deploy/schema_changes.sql

# 6) prisma client + build
npx prisma generate
npm run build

# 7) (re)start under pm2
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 reload "$PM2_NAME" --update-env
else
  PORT="$PORT" pm2 start npm --name "$PM2_NAME" -- start
fi
pm2 save

# 8) health check
sleep 3
code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/vendor/login" || true)"
echo "==> Health: GET /vendor/login -> $code"
[ "$code" = "200" ] || echo "    WARN: expected 200 — inspect 'pm2 logs $PM2_NAME'"

unset MYSQL_PWD
cat <<NEXT

==> App live on http://localhost:$PORT  (pm2: $PM2_NAME)
    One-time, if not already done:
      1. nginx:  sudo cp deploy/nginx-vendor.madenkorea.com.conf /etc/nginx/sites-available/$DOMAIN
                 sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/
                 sudo nginx -t && sudo systemctl reload nginx
      2. TLS:    sudo certbot --nginx -d $DOMAIN
      3. DNS:    point $DOMAIN  A-record -> this server's public IP
    Then smoke per deploy/DEPLOY_RUNBOOK.md §7.
NEXT
