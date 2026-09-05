#!/bin/sh
set -eu

umask 077

: "${BACKUP_PG_DATABASE_URL:?BACKUP_PG_DATABASE_URL is required}"
: "${BACKUP_PG_DATABASE_USER:?BACKUP_PG_DATABASE_USER is required}"
: "${APP_PG_DATABASE_USER:?APP_PG_DATABASE_USER is required}"
: "${BACKUP_HEALTHCHECK_URL:?BACKUP_HEALTHCHECK_URL is required}"
: "${BACKUP_FAILURE_HEALTHCHECK_URL:?BACKUP_FAILURE_HEALTHCHECK_URL is required}"
: "${BACKUP_SECRETS_FILE:?BACKUP_SECRETS_FILE is required}"
: "${BACKUP_INTERVAL_SECONDS:?BACKUP_INTERVAL_SECONDS is required}"
: "${BACKUP_RETENTION_DAYS:?BACKUP_RETENTION_DAYS is required}"
: "${DELETION_PROPAGATION_DAYS:?DELETION_PROPAGATION_DAYS is required}"
: "${RECOVERY_RPO_MINUTES:?RECOVERY_RPO_MINUTES is required}"
: "${RECOVERY_RTO_MINUTES:?RECOVERY_RTO_MINUTES is required}"
: "${TWENTY_IMAGE_REF:?TWENTY_IMAGE_REF is required}"
: "${TWENTY_APP_RELEASE:?TWENTY_APP_RELEASE is required}"
: "${BACKUP_IMAGE_REF:?BACKUP_IMAGE_REF is required}"
: "${CLICKHOUSE_BACKUP_STAGING_PATH:=/var/lib/clickhouse/backups}"
case "$BACKUP_FAILURE_HEALTHCHECK_URL" in
  https://*) ;;
  *)
    echo "Backup failure heartbeat endpoint must use HTTPS" >&2
    exit 1
    ;;
esac
if [ "$BACKUP_HEALTHCHECK_URL" = "$BACKUP_FAILURE_HEALTHCHECK_URL" ]; then
  echo "Backup success and failure heartbeat endpoints must be distinct" >&2
  exit 1
fi

verify_root_secret_file() {
  protected_file=$1

  if [ ! -f "$protected_file" ] || [ ! -r "$protected_file" ]; then
    echo "Protected recovery input is unavailable" >&2
    return 1
  fi

  protected_file_mode=$(stat -c '%u:%g:%a' "$protected_file" 2>/dev/null) || {
    echo "Protected recovery input ownership cannot be verified" >&2
    return 1
  }

  if [ "$protected_file_mode" != '0:0:600' ]; then
    echo "Protected recovery input must be owned by root:root with mode 0600" >&2
    return 1
  fi
}

validate_positive_integer() {
  integer_name=$1
  integer_value=$2

  case "$integer_value" in
    '' | *[!0-9]*)
      echo "$integer_name must be a positive integer" >&2
      return 1
      ;;
  esac

  if [ "$integer_value" -lt 1 ]; then
    echo "$integer_name must be greater than zero" >&2
    return 1
  fi
}

validate_identifier() {
  identifier_name=$1
  identifier_value=$2

  case "$identifier_value" in
    '' | [0-9]* | *[!A-Za-z0-9_]*)
      echo "$identifier_name must be a database identifier" >&2
      return 1
      ;;
  esac
}

validate_release_value() {
  release_name=$1
  release_value=$2

  case "$release_value" in
    '' | *[!A-Za-z0-9._:/@+-]*)
      echo "$release_name contains unsupported characters" >&2
      return 1
      ;;
  esac
}

validate_app_release() {
  case "$TWENTY_APP_RELEASE" in
    '' | *[!A-Za-z0-9._+-]*)
      echo "TWENTY_APP_RELEASE contains unsupported characters" >&2
      return 1
      ;;
  esac
}


validate_image_ref() {
  image_name=$1
  image_ref=$2

  validate_release_value "$image_name" "$image_ref"
  case "$image_ref" in
    *@sha256:*) ;;
    *)
      echo "$image_name must use an immutable sha256 digest" >&2
      return 1
      ;;
  esac
  image_name_prefix=${image_ref%@sha256:*}
  case "$image_name_prefix" in
    '' | *@*)
      echo "$image_name must contain one immutable sha256 digest" >&2
      return 1
      ;;
  esac

  image_digest=${image_ref##*@sha256:}
  case "$image_digest" in
    *[!0-9a-f]*)
      echo "$image_name has an invalid sha256 digest" >&2
      return 1
      ;;
  esac
  if [ "${#image_digest}" -ne 64 ]; then
    echo "$image_name has an invalid sha256 digest" >&2
    return 1
  fi
}

verify_sha256() {
  expected_checksum=$1
  checksum_file=$2
  actual_checksum=$(sha256sum "$checksum_file" | cut -d ' ' -f 1)

  if [ "$actual_checksum" != "$expected_checksum" ]; then
    echo "Recovery artifact checksum mismatch" >&2
    return 1
  fi
}

remote_size() {
  remote_size_json=$(rclone size "$1" --json)
  printf '%s' "$remote_size_json" | jq -er '
    if (.count | type) == "number" and (.bytes | type) == "number"
      and .count >= 0 and .bytes >= 0
      and (.count | floor) == .count and (.bytes | floor) == .bytes
    then "\(.count) \(.bytes)"
    else error("invalid rclone size response")
    end
  '
}

write_canonical_hashes() {
  hash_source=$1
  hash_destination=$2
  hash_unsorted="${hash_destination}.unsorted"

  rclone hashsum SHA-256 --download "$hash_source" --output-file "$hash_unsorted"
  LC_ALL=C sort "$hash_unsorted" > "$hash_destination"
  rm -f "$hash_unsorted"
}

verify_backup_pg_identity() {
  backup_pg_identity=$(
    psql "$BACKUP_PG_DATABASE_URL" \
      --no-psqlrc \
      --set ON_ERROR_STOP=1 \
      --tuples-only \
      --no-align \
      --command "SELECT concat_ws('|', current_user, (role.rolsuper OR role.rolcreatedb OR role.rolcreaterole OR role.rolreplication OR role.rolbypassrls)::integer, EXISTS (SELECT 1 FROM pg_catalog.pg_class AS class JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') AND namespace.nspname NOT LIKE 'pg_toast%' AND class.relkind IN ('r', 'p') AND (has_table_privilege(current_user, class.oid, 'INSERT') OR has_table_privilege(current_user, class.oid, 'UPDATE') OR has_table_privilege(current_user, class.oid, 'DELETE') OR has_table_privilege(current_user, class.oid, 'TRUNCATE') OR has_table_privilege(current_user, class.oid, 'TRIGGER')))::integer, current_setting('transaction_read_only')) FROM pg_catalog.pg_roles AS role WHERE role.rolname = current_user" \
      2>/dev/null
  ) || {
    echo "Backup PostgreSQL identity could not be verified" >&2
    return 1
  }

  if [ "$backup_pg_identity" != "$BACKUP_PG_DATABASE_USER|0|0|on" ]; then
    echo "Backup PostgreSQL identity is not bounded read-only" >&2
    return 1
  fi
}

send_failure_heartbeat() {
  curl --fail --silent --output /dev/null "$BACKUP_FAILURE_HEALTHCHECK_URL" || :
}

preflight_cleanup() {
  preflight_status=$?
  trap - EXIT HUP INT TERM
  if [ "$preflight_status" -ne 0 ]; then
    send_failure_heartbeat
  fi
  exit "$preflight_status"
}

trap preflight_cleanup EXIT HUP INT TERM

if [ "${PG_DATABASE_URL+x}" = 'x' ]; then
  echo "PG_DATABASE_URL is prohibited in backup" >&2
  exit 1
fi
validate_identifier BACKUP_PG_DATABASE_USER "$BACKUP_PG_DATABASE_USER"
validate_identifier APP_PG_DATABASE_USER "$APP_PG_DATABASE_USER"
if [ "$BACKUP_PG_DATABASE_USER" = "$APP_PG_DATABASE_USER" ]; then
  echo "Backup and application PostgreSQL identities must differ" >&2
  exit 1
fi
verify_backup_pg_identity

verify_root_secret_file "$BACKUP_SECRETS_FILE"

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
  BACKUP_R2_BUCKET \
  CLICKHOUSE_BACKUP_HOST \
  CLICKHOUSE_BACKUP_USER \
  CLICKHOUSE_BACKUP_PASSWORD \
  CLICKHOUSE_BACKUP_DATABASE; do
  eval "required_value=\${$required_var-}"
  if [ -z "$required_value" ]; then
    echo "Backup configuration is missing $required_var" >&2
    exit 1
  fi
done

if [ "$CLICKHOUSE_BACKUP_USER" != 'twenty_backup' ]; then
  echo "Isolated ClickHouse backup user must be twenty_backup" >&2
  exit 1
fi

for encrypted_endpoint in \
  "$PRIMARY_R2_ENDPOINT" \
  "$BACKUP_R2_ENDPOINT" \
  "$BACKUP_HEALTHCHECK_URL"; do
  case "$encrypted_endpoint" in
    https://*) ;;
    *)
      echo "Backup endpoints must use HTTPS" >&2
      exit 1
      ;;
  esac
done

validate_positive_integer BACKUP_INTERVAL_SECONDS "$BACKUP_INTERVAL_SECONDS"
validate_positive_integer BACKUP_RETENTION_DAYS "$BACKUP_RETENTION_DAYS"
validate_positive_integer DELETION_PROPAGATION_DAYS "$DELETION_PROPAGATION_DAYS"
validate_positive_integer RECOVERY_RPO_MINUTES "$RECOVERY_RPO_MINUTES"
validate_positive_integer RECOVERY_RTO_MINUTES "$RECOVERY_RTO_MINUTES"
validate_identifier CLICKHOUSE_BACKUP_DATABASE "$CLICKHOUSE_BACKUP_DATABASE"
validate_app_release
validate_image_ref TWENTY_IMAGE_REF "$TWENTY_IMAGE_REF"
validate_image_ref BACKUP_IMAGE_REF "$BACKUP_IMAGE_REF"

if [ "$BACKUP_RETENTION_DAYS" -gt "$DELETION_PROPAGATION_DAYS" ]; then
  echo "BACKUP_RETENTION_DAYS cannot exceed DELETION_PROPAGATION_DAYS" >&2
  exit 1
fi

if [ "$BACKUP_INTERVAL_SECONDS" -gt "$((RECOVERY_RPO_MINUTES * 60))" ]; then
  echo "Backup cadence cannot satisfy RECOVERY_RPO_MINUTES" >&2
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

trap - EXIT HUP INT TERM

backup_tmpdir=''
clickhouse_backup_path=''
backup_in_progress=0

cleanup_artifacts() {
  if [ -n "$backup_tmpdir" ]; then
    rm -rf "$backup_tmpdir" || :
  fi
  if [ -n "$clickhouse_backup_path" ]; then
    rm -f "$clickhouse_backup_path" || :
  fi
  backup_tmpdir=''
  clickhouse_backup_path=''
}

cleanup() {
  cleanup_status=$?
  trap - EXIT HUP INT TERM
  if [ "$cleanup_status" -ne 0 ] && [ "$backup_in_progress" -eq 1 ]; then
    send_failure_heartbeat
  fi
  cleanup_artifacts
  exit "$cleanup_status"
}

trap cleanup EXIT HUP INT TERM

backup_once() {
  backup_timestamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
  backup_tmpdir=$(mktemp -d)

  database_identity="postgres/${backup_timestamp}/twenty.dump"
  general_files_identity="files/${backup_timestamp}"
  general_files_checksum_identity="inventory/${backup_timestamp}/general-files.sha256"
  clickhouse_identity="clickhouse/${backup_timestamp}/twenty.zip"
  manifest_identity="status/${backup_timestamp}.json"

  pg_dump --dbname="$BACKUP_PG_DATABASE_URL" --format=custom --no-acl --no-owner \
    --file="$backup_tmpdir/twenty.dump"
  database_checksum=$(sha256sum "$backup_tmpdir/twenty.dump" | cut -d ' ' -f 1)

  source_size=$(remote_size "primary:${PRIMARY_R2_BUCKET}")
  source_object_count=${source_size%% *}
  source_object_bytes=${source_size##* }
  write_canonical_hashes \
    "primary:${PRIMARY_R2_BUCKET}" \
    "$backup_tmpdir/general-files.sha256"
  general_files_checksum=$(sha256sum "$backup_tmpdir/general-files.sha256" | cut -d ' ' -f 1)

  clickhouse_backup_path="$CLICKHOUSE_BACKUP_STAGING_PATH/audit/${backup_timestamp}.zip"
  mkdir -p "$CLICKHOUSE_BACKUP_STAGING_PATH/audit"
  CLICKHOUSE_PASSWORD="$CLICKHOUSE_BACKUP_PASSWORD" \
    clickhouse client \
      --host "$CLICKHOUSE_BACKUP_HOST" \
      --user "$CLICKHOUSE_BACKUP_USER" \
      --query "BACKUP DATABASE \`$CLICKHOUSE_BACKUP_DATABASE\` TO Disk('audit_backups', 'audit/${backup_timestamp}.zip')" \
      >/dev/null
  if [ ! -f "$clickhouse_backup_path" ]; then
    echo "ClickHouse backup artifact is unavailable" >&2
    return 1
  fi
  clickhouse_checksum=$(sha256sum "$clickhouse_backup_path" | cut -d ' ' -f 1)

  rclone copyto --immutable "$backup_tmpdir/twenty.dump" \
    "backup:${BACKUP_R2_BUCKET}/${database_identity}"
  rclone copyto "backup:${BACKUP_R2_BUCKET}/${database_identity}" \
    "$backup_tmpdir/verified-twenty.dump"
  verify_sha256 "$database_checksum" "$backup_tmpdir/verified-twenty.dump"

  rclone copy --immutable "primary:${PRIMARY_R2_BUCKET}" \
    "backup:${BACKUP_R2_BUCKET}/${general_files_identity}"
  rclone check --download --one-way \
    "primary:${PRIMARY_R2_BUCKET}" \
    "backup:${BACKUP_R2_BUCKET}/${general_files_identity}"
  destination_size=$(remote_size "backup:${BACKUP_R2_BUCKET}/${general_files_identity}")
  destination_object_count=${destination_size%% *}
  destination_object_bytes=${destination_size##* }
  if [ "$destination_object_count" != "$source_object_count" ] || \
    [ "$destination_object_bytes" != "$source_object_bytes" ]; then
    echo "General-file backup object count or byte count mismatch" >&2
    return 1
  fi
  write_canonical_hashes \
    "backup:${BACKUP_R2_BUCKET}/${general_files_identity}" \
    "$backup_tmpdir/verified-general-files.sha256"
  if ! cmp -s \
    "$backup_tmpdir/general-files.sha256" \
    "$backup_tmpdir/verified-general-files.sha256"; then
    echo "General-file backup checksum index mismatch" >&2
    return 1
  fi
  rclone copyto --immutable "$backup_tmpdir/general-files.sha256" \
    "backup:${BACKUP_R2_BUCKET}/${general_files_checksum_identity}"
  rclone copyto "backup:${BACKUP_R2_BUCKET}/${general_files_checksum_identity}" \
    "$backup_tmpdir/verified-general-files-index.sha256"
  verify_sha256 \
    "$general_files_checksum" \
    "$backup_tmpdir/verified-general-files-index.sha256"

  rclone copyto --immutable "$clickhouse_backup_path" \
    "backup:${BACKUP_R2_BUCKET}/${clickhouse_identity}"
  rclone copyto "backup:${BACKUP_R2_BUCKET}/${clickhouse_identity}" \
    "$backup_tmpdir/verified-clickhouse.zip"
  verify_sha256 "$clickhouse_checksum" "$backup_tmpdir/verified-clickhouse.zip"

  jq -n -c \
    --arg completed_at "$backup_timestamp" \
    --arg database_dump "$database_identity" \
    --arg database_sha256 "$database_checksum" \
    --arg general_files_prefix "$general_files_identity" \
    --arg general_files_checksum_index "$general_files_checksum_identity" \
    --arg general_files_sha256 "$general_files_checksum" \
    --argjson general_files_object_count "$destination_object_count" \
    --argjson general_files_bytes "$destination_object_bytes" \
    --arg audit_backup "$clickhouse_identity" \
    --arg audit_sha256 "$clickhouse_checksum" \
    --arg app_image "$TWENTY_IMAGE_REF" \
    --arg app_release "$TWENTY_APP_RELEASE" \
    --arg backup_image "$BACKUP_IMAGE_REF" \
    --argjson cadence_seconds "$BACKUP_INTERVAL_SECONDS" \
    --argjson retention_days "$BACKUP_RETENTION_DAYS" \
    --argjson deletion_propagation_days "$DELETION_PROPAGATION_DAYS" \
    --argjson rpo_minutes "$RECOVERY_RPO_MINUTES" \
    --argjson rto_minutes "$RECOVERY_RTO_MINUTES" \
    '{
      schema_version: 1,
      completed_at: $completed_at,
      database_dump: $database_dump,
      database_sha256: $database_sha256,
      general_files_prefix: $general_files_prefix,
      general_files_checksum_index: $general_files_checksum_index,
      general_files_sha256: $general_files_sha256,
      general_files_object_count: $general_files_object_count,
      general_files_bytes: $general_files_bytes,
      audit_backup: $audit_backup,
      audit_sha256: $audit_sha256,
      app_image: $app_image,
      app_release: $app_release,
      backup_image: $backup_image,
      policy: {
        cadence_seconds: $cadence_seconds,
        retention_days: $retention_days,
        deletion_propagation_days: $deletion_propagation_days,
        rpo_minutes: $rpo_minutes,
        rto_minutes: $rto_minutes
      }
    }' > "$backup_tmpdir/manifest.json"

  rclone copyto --immutable "$backup_tmpdir/manifest.json" \
    "backup:${BACKUP_R2_BUCKET}/${manifest_identity}"
  rclone copyto "backup:${BACKUP_R2_BUCKET}/${manifest_identity}" \
    "$backup_tmpdir/verified-manifest.json"
  if ! cmp -s "$backup_tmpdir/manifest.json" "$backup_tmpdir/verified-manifest.json"; then
    echo "Backup manifest verification failed" >&2
    return 1
  fi
}

run_backup_once() {
  backup_in_progress=1
  backup_once
  curl --fail --silent --output /dev/null "$BACKUP_HEALTHCHECK_URL"
  cleanup_artifacts
  backup_in_progress=0
}

verify_restore_manifest() {
  restore_manifest=$1
  restore_timestamp=$2

  jq -e \
    --arg timestamp "$restore_timestamp" \
    '.schema_version == 1
      and .completed_at == $timestamp
      and .database_dump == ("postgres/" + $timestamp + "/twenty.dump")
      and .general_files_prefix == ("files/" + $timestamp)
      and .general_files_checksum_index == ("inventory/" + $timestamp + "/general-files.sha256")
      and .audit_backup == ("clickhouse/" + $timestamp + "/twenty.zip")
      and (.database_sha256 | test("^[0-9a-f]{64}$"))
      and (.general_files_sha256 | test("^[0-9a-f]{64}$"))
      and (.audit_sha256 | test("^[0-9a-f]{64}$"))
      and (.general_files_object_count | type == "number" and . >= 0 and floor == .)
      and (.general_files_bytes | type == "number" and . >= 0 and floor == .)
      and (.app_image | type == "string" and test("^[A-Za-z0-9._:/+-]+@sha256:[0-9a-f]{64}$"))
      and (.app_release | type == "string" and test("^[A-Za-z0-9._+-]+$"))
      and (.backup_image | type == "string" and test("^[A-Za-z0-9._:/+-]+@sha256:[0-9a-f]{64}$"))
      and (.policy.cadence_seconds | type == "number" and . > 0 and floor == .)
      and (.policy.retention_days | type == "number" and . > 0 and floor == .)
      and (.policy.deletion_propagation_days | type == "number" and . > 0 and floor == .)
      and (.policy.rpo_minutes | type == "number" and . > 0 and floor == .)
      and (.policy.rto_minutes | type == "number" and . > 0 and floor == .)
      and (.policy | .cadence_seconds <= (.rpo_minutes * 60))
      and (.policy | .retention_days <= .deletion_propagation_days)' \
    "$restore_manifest" >/dev/null
}

verify_core_restore() {
  restore_timestamp=${1-}
  case "$restore_timestamp" in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]-[0-9][0-9]-[0-9][0-9]Z) ;;
    *)
      echo "A UTC backup timestamp is required for isolated restore" >&2
      return 1
      ;;
  esac

  if [ "${ALLOW_ISOLATED_RESTORE-}" != 'YES' ]; then
    echo "ALLOW_ISOLATED_RESTORE=YES is required" >&2
    return 1
  fi

  : "${RESTORE_SECRETS_FILE:?RESTORE_SECRETS_FILE is required}"
  : "${RESTORE_PG_VERIFY_SQL_FILE:?RESTORE_PG_VERIFY_SQL_FILE is required}"
  : "${RESTORE_CLICKHOUSE_VERIFY_SQL_FILE:?RESTORE_CLICKHOUSE_VERIFY_SQL_FILE is required}"
  : "${RESTORE_GENERAL_FILE_SPEC:?RESTORE_GENERAL_FILE_SPEC is required}"

  verify_root_secret_file "$RESTORE_SECRETS_FILE"
  verify_root_secret_file "$RESTORE_PG_VERIFY_SQL_FILE"
  verify_root_secret_file "$RESTORE_CLICKHOUSE_VERIFY_SQL_FILE"
  verify_root_secret_file "$RESTORE_GENERAL_FILE_SPEC"

  set -a
  # shellcheck disable=SC1090
  . "$RESTORE_SECRETS_FILE"
  set +a

  : "${RESTORE_PG_DATABASE_URL:?RESTORE_PG_DATABASE_URL is required}"
  : "${RESTORE_CLICKHOUSE_HOST:?RESTORE_CLICKHOUSE_HOST is required}"
  : "${RESTORE_CLICKHOUSE_USER:?RESTORE_CLICKHOUSE_USER is required}"
  : "${RESTORE_CLICKHOUSE_PASSWORD:?RESTORE_CLICKHOUSE_PASSWORD is required}"
  : "${RESTORE_CLICKHOUSE_DATABASE:?RESTORE_CLICKHOUSE_DATABASE is required}"

  if [ "$RESTORE_PG_DATABASE_URL" = "$BACKUP_PG_DATABASE_URL" ]; then
    echo "Isolated PostgreSQL restore target must differ from the source" >&2
    return 1
  fi
  restore_pg_database=$(
    psql "$RESTORE_PG_DATABASE_URL" \
      --no-psqlrc \
      --set ON_ERROR_STOP=1 \
      --tuples-only \
      --no-align \
      --command 'SELECT current_database()'
  )
  if [ "$restore_pg_database" != 'twenty_restore_validation' ]; then
    echo "Isolated PostgreSQL database must be twenty_restore_validation" >&2
    return 1
  fi
  restore_pg_relation_count=$(
    psql "$RESTORE_PG_DATABASE_URL" \
      --no-psqlrc \
      --set ON_ERROR_STOP=1 \
      --tuples-only \
      --no-align \
      --command "SELECT count(*) FROM pg_catalog.pg_class AS class JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') AND namespace.nspname NOT LIKE 'pg_toast%' AND class.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')"
  )
  if [ "$restore_pg_relation_count" != '0' ]; then
    echo "Isolated PostgreSQL restore target must be empty" >&2
    return 1
  fi
  validate_identifier RESTORE_CLICKHOUSE_DATABASE "$RESTORE_CLICKHOUSE_DATABASE"
  if [ "$RESTORE_CLICKHOUSE_USER" != 'twenty_restore' ]; then
    echo "Isolated ClickHouse restore user must be twenty_restore" >&2
    return 1
  fi
  if [ "$RESTORE_CLICKHOUSE_USER" = "$CLICKHOUSE_BACKUP_USER" ]; then
    echo "ClickHouse backup and restore identities must differ" >&2
    return 1
  fi
  if [ "$RESTORE_CLICKHOUSE_DATABASE" = "$CLICKHOUSE_BACKUP_DATABASE" ]; then
    echo "Isolated ClickHouse restore target must differ from the source" >&2
    return 1
  fi
  if [ "$RESTORE_CLICKHOUSE_DATABASE" != 'twenty_restore_validation' ]; then
    echo "Isolated ClickHouse database must be twenty_restore_validation" >&2
    return 1
  fi

  backup_tmpdir=$(mktemp -d)
  manifest_identity="status/${restore_timestamp}.json"
  rclone copyto "backup:${BACKUP_R2_BUCKET}/${manifest_identity}" \
    "$backup_tmpdir/manifest.json"
  verify_restore_manifest "$backup_tmpdir/manifest.json" "$restore_timestamp"

  database_checksum=$(jq -er '.database_sha256' "$backup_tmpdir/manifest.json")
  general_files_checksum=$(jq -er '.general_files_sha256' "$backup_tmpdir/manifest.json")
  expected_object_count=$(jq -er '.general_files_object_count' "$backup_tmpdir/manifest.json")
  expected_object_bytes=$(jq -er '.general_files_bytes' "$backup_tmpdir/manifest.json")
  clickhouse_checksum=$(jq -er '.audit_sha256' "$backup_tmpdir/manifest.json")

  rclone copyto \
    "backup:${BACKUP_R2_BUCKET}/postgres/${restore_timestamp}/twenty.dump" \
    "$backup_tmpdir/twenty.dump"
  verify_sha256 "$database_checksum" "$backup_tmpdir/twenty.dump"
  pg_restore --exit-on-error --single-transaction --no-acl --no-owner \
    --dbname="$RESTORE_PG_DATABASE_URL" "$backup_tmpdir/twenty.dump" >/dev/null
  psql "$RESTORE_PG_DATABASE_URL" --no-psqlrc --set ON_ERROR_STOP=1 \
    --file "$RESTORE_PG_VERIFY_SQL_FILE" >/dev/null

  rclone copy \
    "backup:${BACKUP_R2_BUCKET}/files/${restore_timestamp}" \
    "$backup_tmpdir/general-files"
  rclone copyto \
    "backup:${BACKUP_R2_BUCKET}/inventory/${restore_timestamp}/general-files.sha256" \
    "$backup_tmpdir/expected-general-files.sha256"
  verify_sha256 \
    "$general_files_checksum" \
    "$backup_tmpdir/expected-general-files.sha256"
  write_canonical_hashes \
    "$backup_tmpdir/general-files" \
    "$backup_tmpdir/restored-general-files.sha256"
  if ! cmp -s \
    "$backup_tmpdir/expected-general-files.sha256" \
    "$backup_tmpdir/restored-general-files.sha256"; then
    echo "Restored general-file checksum index mismatch" >&2
    return 1
  fi
  restored_size=$(remote_size "$backup_tmpdir/general-files")
  restored_object_count=${restored_size%% *}
  restored_object_bytes=${restored_size##* }
  if [ "$restored_object_count" != "$expected_object_count" ] || \
    [ "$restored_object_bytes" != "$expected_object_bytes" ]; then
    echo "Restored general-file count or byte total mismatch" >&2
    return 1
  fi

  if [ "$(wc -l < "$RESTORE_GENERAL_FILE_SPEC" | tr -d ' ')" != '2' ]; then
    echo "General-file verification spec must contain exactly two lines" >&2
    return 1
  fi
  representative_file_key=$(sed -n '1p' "$RESTORE_GENERAL_FILE_SPEC")
  representative_file_checksum=$(sed -n '2p' "$RESTORE_GENERAL_FILE_SPEC")
  case "$representative_file_key" in
    '' | /* | ../* | */../* | */..)
      echo "General-file verification path must be a safe relative key" >&2
      return 1
      ;;
  esac
  case "$representative_file_checksum" in
    *[!0-9a-f]* | '')
      echo "General-file verification checksum is invalid" >&2
      return 1
      ;;
  esac
  if [ "${#representative_file_checksum}" -ne 64 ]; then
    echo "General-file verification checksum is invalid" >&2
    return 1
  fi
  verify_sha256 \
    "$representative_file_checksum" \
    "$backup_tmpdir/general-files/$representative_file_key"

  clickhouse_backup_path="$CLICKHOUSE_BACKUP_STAGING_PATH/restore/${restore_timestamp}.zip"
  mkdir -p "$CLICKHOUSE_BACKUP_STAGING_PATH/restore"
  rclone copyto \
    "backup:${BACKUP_R2_BUCKET}/clickhouse/${restore_timestamp}/twenty.zip" \
    "$clickhouse_backup_path"
  verify_sha256 "$clickhouse_checksum" "$clickhouse_backup_path"

  restore_database_exists=$(
    CLICKHOUSE_PASSWORD="$RESTORE_CLICKHOUSE_PASSWORD" \
      clickhouse client \
        --host "$RESTORE_CLICKHOUSE_HOST" \
        --user "$RESTORE_CLICKHOUSE_USER" \
        --query "EXISTS DATABASE \`$RESTORE_CLICKHOUSE_DATABASE\`"
  )
  if [ "$restore_database_exists" != '0' ]; then
    echo "Isolated ClickHouse restore target already exists" >&2
    return 1
  fi

  CLICKHOUSE_PASSWORD="$RESTORE_CLICKHOUSE_PASSWORD" \
    clickhouse client \
      --host "$RESTORE_CLICKHOUSE_HOST" \
      --user "$RESTORE_CLICKHOUSE_USER" \
      --allow_experimental_json_type 1 \
      --query "RESTORE DATABASE \`$CLICKHOUSE_BACKUP_DATABASE\` AS \`$RESTORE_CLICKHOUSE_DATABASE\` FROM Disk('audit_backups', 'restore/${restore_timestamp}.zip')" \
      >/dev/null
  CLICKHOUSE_PASSWORD="$RESTORE_CLICKHOUSE_PASSWORD" \
    clickhouse client \
      --host "$RESTORE_CLICKHOUSE_HOST" \
      --user "$RESTORE_CLICKHOUSE_USER" \
      --multiquery < "$RESTORE_CLICKHOUSE_VERIFY_SQL_FILE" >/dev/null

  cleanup_artifacts
  echo "Core restore verification passed; isolated databases remain for approved review"
}

case "${1-daemon}" in
  daemon)
    while :; do
      run_backup_once
      sleep "$BACKUP_INTERVAL_SECONDS"
    done
    ;;
  backup-once)
    if [ "$#" -ne 1 ]; then
      echo "backup-once accepts no arguments" >&2
      exit 1
    fi
    run_backup_once
    ;;
  verify-core-restore)
    if [ "$#" -ne 2 ]; then
      echo "verify-core-restore requires one backup timestamp" >&2
      exit 1
    fi
    verify_core_restore "$2"
    ;;
  *)
    echo "Supported commands: daemon, backup-once, verify-core-restore" >&2
    exit 1
    ;;
esac
