#!/bin/sh
set -eu

umask 077

: "${PG_DATABASE_URL:?PG_DATABASE_URL is required}"
: "${BACKUP_HEALTHCHECK_URL:?BACKUP_HEALTHCHECK_URL is required}"
: "${BACKUP_SECRETS_FILE:?BACKUP_SECRETS_FILE is required}"
: "${BACKUP_INTERVAL_SECONDS:=86400}"

if [ ! -r "$BACKUP_SECRETS_FILE" ]; then
  echo "Backup secrets file is unavailable" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$BACKUP_SECRETS_FILE"
set +a

for required_var in \
  PRIMARY_R2_ENDPOINT \
  PRIMARY_R2_ACCESS_KEY_ID \
  PRIMARY_R2_SECRET_ACCESS_KEY \
  PRIMARY_R2_BUCKET \
  BACKUP_R2_ENDPOINT \
  BACKUP_R2_ACCESS_KEY_ID \
  BACKUP_R2_SECRET_ACCESS_KEY \
  BACKUP_R2_BUCKET; do
  eval "required_value=\${$required_var-}"
  if [ -z "$required_value" ]; then
    echo "Backup configuration is missing $required_var" >&2
    exit 1
  fi
done

case "$BACKUP_INTERVAL_SECONDS" in
  *[!0-9]* | '')
    echo "BACKUP_INTERVAL_SECONDS must be a positive integer" >&2
    exit 1
    ;;
esac

if [ "$BACKUP_INTERVAL_SECONDS" -lt 1 ]; then
  echo "BACKUP_INTERVAL_SECONDS must be greater than zero" >&2
  exit 1
fi

export RCLONE_CONFIG_PRIMARY_TYPE=s3
export RCLONE_CONFIG_PRIMARY_PROVIDER=Cloudflare
export RCLONE_CONFIG_PRIMARY_REGION=auto
export RCLONE_CONFIG_PRIMARY_ENDPOINT="$PRIMARY_R2_ENDPOINT"
export RCLONE_CONFIG_PRIMARY_ACCESS_KEY_ID="$PRIMARY_R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_PRIMARY_SECRET_ACCESS_KEY="$PRIMARY_R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_BACKUP_TYPE=s3
export RCLONE_CONFIG_BACKUP_PROVIDER=Cloudflare
export RCLONE_CONFIG_BACKUP_REGION=auto
export RCLONE_CONFIG_BACKUP_ENDPOINT="$BACKUP_R2_ENDPOINT"
export RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID="$BACKUP_R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY="$BACKUP_R2_SECRET_ACCESS_KEY"

backup_tmpdir=''

cleanup() {
  cleanup_status=$?
  trap - EXIT HUP INT TERM
  if [ -n "$backup_tmpdir" ]; then
    rm -rf "$backup_tmpdir" || :
  fi
  exit "$cleanup_status"
}

trap cleanup EXIT HUP INT TERM

backup_once() {
  backup_timestamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
  backup_tmpdir=$(mktemp -d)

  pg_dump --dbname="$PG_DATABASE_URL" --format=custom --no-acl --no-owner \
    --file="$backup_tmpdir/twenty.dump"

  rclone copyto --ignore-existing "$backup_tmpdir/twenty.dump" \
    "backup:${BACKUP_R2_BUCKET}/postgres/${backup_timestamp}/twenty.dump"
  rclone copy "primary:${PRIMARY_R2_BUCKET}" \
    "backup:${BACKUP_R2_BUCKET}/files/${backup_timestamp}"

  printf '{"completed_at":"%s","database_dump":"postgres/%s/twenty.dump","files_prefix":"files/%s"}\n' \
    "$backup_timestamp" "$backup_timestamp" "$backup_timestamp" \
    | rclone rcat "backup:${BACKUP_R2_BUCKET}/status/${backup_timestamp}.json"

  curl --fail --silent --show-error --output /dev/null "$BACKUP_HEALTHCHECK_URL"
  rm -rf "$backup_tmpdir"
  backup_tmpdir=''
}

while :; do
  backup_once
  sleep "$BACKUP_INTERVAL_SECONDS"
done
