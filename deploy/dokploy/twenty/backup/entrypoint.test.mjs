import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const entrypoint = join(testDirectory, 'entrypoint.sh');
const mockCli = join(testDirectory, 'mock-cli.fixture.mjs');
const timestamp = '2026-09-04T12-34-56Z';
const digest = 'a'.repeat(64);

const writeProtectedFile = (path, contents) => {
  writeFileSync(path, contents);
  chmodSync(path, 0o600);
};

const createHarness = (overrides = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'twenty-core-backup-'));
  const bin = join(root, 'bin');
  const primaryRemote = join(root, 'primary-remote');
  const backupRemote = join(root, 'backup-remote');
  const primaryBucket = 'general-files';
  const backupBucket = 'recovery';
  const secretFile = join(root, 'twenty-backup.env');
  const heartbeatLog = join(root, 'heartbeats.log');
  const restoreMarker = join(root, 'pg-restore.called');
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(primaryRemote, primaryBucket, 'customer'), {
    recursive: true,
  });
  mkdirSync(join(backupRemote, backupBucket), { recursive: true });
  writeFileSync(
    join(primaryRemote, primaryBucket, 'customer', 'alice-passport.pdf'),
    'general-file-bytes',
  );
  writeProtectedFile(
    secretFile,
    [
      'PRIMARY_R2_ENDPOINT=https://primary.example.test',
      'PRIMARY_R2_ACCESS_KEY_ID=primary-access-key',
      'PRIMARY_R2_SECRET_ACCESS_KEY=primary-secret-value',
      `PRIMARY_R2_BUCKET=${primaryBucket}`,
      'BACKUP_R2_ENDPOINT=https://backup.example.test',
      'BACKUP_R2_ACCESS_KEY_ID=backup-access-key',
      'BACKUP_R2_SECRET_ACCESS_KEY=backup-secret-value',
      `BACKUP_R2_BUCKET=${backupBucket}`,
      '',
    ].join('\n'),
  );

  for (const tool of [
    'clickhouse',
    'curl',
    'date',
    'pg_dump',
    'pg_restore',
    'psql',
    'rclone',
    'stat',
  ]) {
    const wrapper = join(bin, tool);
    writeFileSync(
      wrapper,
      `#!/bin/sh\nexec "${process.execPath}" "${mockCli}" "${tool}" "$@"\n`,
    );
    chmodSync(wrapper, 0o755);
  }

  const environment = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    BACKUP_MODE: 'core-only',
    AUDIT_LOGS_ENABLED: 'false',
    BACKUP_PG_DATABASE_URL: 'postgres://backup-reader@db/twenty',
    BACKUP_PG_DATABASE_USER: 'twenty_backup',
    APP_PG_DATABASE_USER: 'twenty_app',
    BACKUP_HEALTHCHECK_URL: 'https://heartbeat.example.test/success',
    BACKUP_FAILURE_HEALTHCHECK_URL: 'https://heartbeat.example.test/failure',
    BACKUP_SECRETS_FILE: secretFile,
    BACKUP_INTERVAL_SECONDS: '3600',
    BACKUP_RETENTION_DAYS: '30',
    DELETION_PROPAGATION_DAYS: '30',
    RECOVERY_RPO_MINUTES: '60',
    RECOVERY_RTO_MINUTES: '120',
    TWENTY_IMAGE_REF: `ghcr.io/example/twenty@sha256:${digest}`,
    TWENTY_APP_RELEASE: 'crm-core-release-a',
    BACKUP_IMAGE_REF: `ghcr.io/example/twenty-backup@sha256:${digest}`,
    MOCK_PRIMARY_REMOTE: primaryRemote,
    MOCK_BACKUP_REMOTE: backupRemote,
    MOCK_HEARTBEAT_LOG: heartbeatLog,
    MOCK_PG_RESTORE_MARKER: restoreMarker,
    MOCK_FIXED_TIMESTAMP: timestamp,
    ...overrides,
  };

  const run = (args, environmentOverrides = {}) =>
    spawnSync('/bin/sh', [entrypoint, ...args], {
      encoding: 'utf8',
      env: { ...environment, ...environmentOverrides },
    });

  return {
    backupRemote,
    backupBucket,
    environment,
    heartbeatLog,
    primaryRemote,
    primaryBucket,
    restoreMarker,
    root,
    run,
    secretFile,
  };
};

const readHeartbeats = (path) => {
  try {
    return readFileSync(path, 'utf8').trim().split('\n');
  } catch {
    return [];
  }
};

test('core-only backup stores and downloads PostgreSQL, complete general files, index, and scrubbed manifest', () => {
  const harness = createHarness();

  const result = harness.run(['backup-once']);

  assert.equal(result.status, 0, result.stderr);
  const manifestPath = join(
    harness.backupRemote,
    harness.backupBucket,
    'status',
    `${timestamp}.json`,
  );
  const manifestText = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.schema_version, 2);
  assert.equal(manifest.mode, 'core-only');
  assert.equal(manifest.completed_at, timestamp);
  assert.equal(manifest.app_image, harness.environment.TWENTY_IMAGE_REF);
  assert.equal(manifest.app_release, harness.environment.TWENTY_APP_RELEASE);
  assert.equal(manifest.backup_image, harness.environment.BACKUP_IMAGE_REF);
  assert.match(manifest.database_sha256, /^[0-9a-f]{64}$/);
  assert.match(manifest.general_files_sha256, /^[0-9a-f]{64}$/);
  assert.equal(manifest.general_files_object_count, 1);
  assert.equal(manifest.general_files_bytes, 18);
  assert.equal(manifest.policy.retention_days, 30);
  assert.equal(manifest.policy.deletion_propagation_days, 30);
  assert.equal('audit_backup' in manifest, false);
  assert.equal('audit_sha256' in manifest, false);
  for (const forbidden of [
    'alice-passport.pdf',
    'primary-secret-value',
    'backup-secret-value',
    'postgres://',
  ]) {
    assert.equal(manifestText.includes(forbidden), false);
  }
  assert.deepEqual(readHeartbeats(harness.heartbeatLog), [
    harness.environment.BACKUP_HEALTHCHECK_URL,
  ]);
});

test('core-only restore verifies PostgreSQL and general files without ClickHouse inputs', () => {
  const harness = createHarness();
  const backupResult = harness.run(['backup-once']);
  assert.equal(backupResult.status, 0, backupResult.stderr);

  const restoreSecretsFile = join(harness.root, 'restore.env');
  const pgVerifyFile = join(harness.root, 'verify-postgres.sql');
  const generalFileSpec = join(harness.root, 'general-file.spec');
  const generalFile = join(
    harness.primaryRemote,
    harness.primaryBucket,
    'customer',
    'alice-passport.pdf',
  );
  const generalFileChecksum = createHash('sha256')
    .update(readFileSync(generalFile))
    .digest('hex');
  writeProtectedFile(
    restoreSecretsFile,
    'RESTORE_PG_DATABASE_URL=postgres://restore@db/twenty_restore_validation\n',
  );
  writeProtectedFile(pgVerifyFile, 'SELECT 1;\n');
  writeProtectedFile(
    generalFileSpec,
    `customer/alice-passport.pdf\n${generalFileChecksum}\n`,
  );

  const result = harness.run(['verify-core-restore', timestamp], {
    ALLOW_ISOLATED_RESTORE: 'YES',
    RESTORE_SECRETS_FILE: restoreSecretsFile,
    RESTORE_PG_VERIFY_SQL_FILE: pgVerifyFile,
    RESTORE_GENERAL_FILE_SPEC: generalFileSpec,
    RESTORE_CLICKHOUSE_VERIFY_SQL_FILE: undefined,
    RESTORE_CLICKHOUSE_HOST: undefined,
    RESTORE_CLICKHOUSE_USER: undefined,
    RESTORE_CLICKHOUSE_PASSWORD: undefined,
    RESTORE_CLICKHOUSE_DATABASE: undefined,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Core-only restore verification passed/);
  assert.match(readFileSync(harness.restoreMarker, 'utf8'), /twenty\.dump/);
});

test('core-only mode requires audit logs to be explicitly disabled', () => {
  const harness = createHarness({ AUDIT_LOGS_ENABLED: 'true' });

  const result = harness.run(['backup-once']);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AUDIT_LOGS_ENABLED=false/);
  assert.deepEqual(readHeartbeats(harness.heartbeatLog), [
    harness.environment.BACKUP_FAILURE_HEALTHCHECK_URL,
  ]);
});

test('core-only mode rejects ClickHouse connection or credential settings', () => {
  const harness = createHarness({
    CLICKHOUSE_READ_URL: 'https://clickhouse.example.test',
  });

  const result = harness.run(['backup-once']);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ClickHouse configuration is prohibited/);
  assert.deepEqual(readHeartbeats(harness.heartbeatLog), [
    harness.environment.BACKUP_FAILURE_HEALTHCHECK_URL,
  ]);
});

test('core-only mode fixes retention and deletion propagation at 30 days', () => {
  const harness = createHarness({ BACKUP_RETENTION_DAYS: '31' });

  const result = harness.run(['backup-once']);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exactly 30 days/);
  assert.deepEqual(readHeartbeats(harness.heartbeatLog), [
    harness.environment.BACKUP_FAILURE_HEALTHCHECK_URL,
  ]);
});

test('an immutable object collision fails closed without a second success heartbeat', () => {
  const harness = createHarness();
  const first = harness.run(['backup-once']);
  assert.equal(first.status, 0, first.stderr);

  const second = harness.run(['backup-once']);

  assert.notEqual(second.status, 0);
  assert.deepEqual(readHeartbeats(harness.heartbeatLog), [
    harness.environment.BACKUP_HEALTHCHECK_URL,
    harness.environment.BACKUP_FAILURE_HEALTHCHECK_URL,
  ]);
});

test('a manifest download mismatch sends failure and suppresses success', () => {
  const harness = createHarness({
    MOCK_RCLONE_TAMPER_DOWNLOAD_MATCH: 'status/',
  });

  const result = harness.run(['backup-once']);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /manifest verification failed/i);
  assert.deepEqual(readHeartbeats(harness.heartbeatLog), [
    harness.environment.BACKUP_FAILURE_HEALTHCHECK_URL,
  ]);
});

test('an upload failure sends failure and suppresses success', () => {
  const harness = createHarness({ MOCK_RCLONE_FAIL_MATCH: 'postgres/' });

  const result = harness.run(['backup-once']);

  assert.notEqual(result.status, 0);
  assert.deepEqual(readHeartbeats(harness.heartbeatLog), [
    harness.environment.BACKUP_FAILURE_HEALTHCHECK_URL,
  ]);
});

test('the existing default mode still requires ClickHouse backup configuration', () => {
  const harness = createHarness({
    BACKUP_MODE: undefined,
    AUDIT_LOGS_ENABLED: undefined,
  });

  const result = harness.run(['backup-once']);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CLICKHOUSE_BACKUP_HOST/);
});
