#!/usr/bin/env bash
# Backup harian skema aplikasi dengan Data Pump (expdp). Jadwalkan via cron:
#   0 2 * * * /opt/absensi/deploy/backup-oracle.sh >> /var/log/absensi-backup.log 2>&1
# Salin hasil backup ke lokasi lain di luar VPS (mis. rclone ke Google Drive / S3).
set -euo pipefail
cd "$(dirname "$0")"
source .env
STAMP=$(date +%Y%m%d_%H%M)
DEST=/opt/absensi/backups
mkdir -p "$DEST"
docker compose exec -T oracle bash -c "mkdir -p /opt/oracle/oradata/dump && \
  sqlplus -s / as sysdba <<SQL
ALTER SESSION SET CONTAINER=FREEPDB1;
CREATE OR REPLACE DIRECTORY dump_dir AS '/opt/oracle/oradata/dump';
GRANT READ, WRITE ON DIRECTORY dump_dir TO ${DB_USER};
SQL
expdp ${DB_USER}/${DB_PASSWORD}@FREEPDB1 schemas=${DB_USER} directory=dump_dir \
  dumpfile=absensi_${STAMP}.dmp logfile=absensi_${STAMP}.log"
docker compose cp oracle:/opt/oracle/oradata/dump/absensi_${STAMP}.dmp "$DEST/"
docker compose exec -T oracle rm -f /opt/oracle/oradata/dump/absensi_${STAMP}.dmp
gzip "$DEST/absensi_${STAMP}.dmp"
# Foto laporan, logo & tanda tangan
docker compose exec -T api tar czf - -C /app uploads > "$DEST/uploads_${STAMP}.tar.gz"
find "$DEST" -name 'uploads_*.tar.gz' -mtime +14 -delete
find "$DEST" -name '*.dmp.gz' -mtime +14 -delete
echo "Backup selesai: $DEST/absensi_${STAMP}.dmp.gz"
