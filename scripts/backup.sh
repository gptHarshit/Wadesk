#!/bin/sh
# Daily Postgres backup for WaDesk. Keeps the last 14 dumps in ./backups.
# Run from the project folder. To schedule it every night at 2:30:
#   crontab -e   then add:   30 2 * * * cd /opt/wadesk && ./scripts/backup.sh >> backups/backup.log 2>&1
set -eu

cd "$(dirname "$0")/.."
mkdir -p backups

stamp=$(date +%Y-%m-%d_%H%M)
file="backups/wadesk_$stamp.sql.gz"

docker compose exec -T postgres pg_dump -U wadesk -d wadesk --no-owner | gzip > "$file"
echo "$(date) saved $file ($(du -h "$file" | cut -f1))"

# Drop dumps older than the newest 14.
ls -1t backups/wadesk_*.sql.gz | tail -n +15 | xargs -r rm --

# Restore one with:
#   gunzip -c backups/wadesk_YYYY-MM-DD_HHMM.sql.gz | docker compose exec -T postgres psql -U wadesk -d wadesk
