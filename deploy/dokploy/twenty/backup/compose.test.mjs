import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const backupDirectory = dirname(fileURLToPath(import.meta.url));
const deploymentDirectory = dirname(backupDirectory);
const composeFile = join(deploymentDirectory, 'docker-compose.core-only.yml');
const envFile = join(deploymentDirectory, 'core-only.env.example');

test('explicit core-only compose profile excludes ClickHouse and fixes backup policy', () => {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--env-file',
      envFile,
      '-f',
      composeFile,
      '--profile',
      'core-only',
      'config',
      '--format',
      'json',
    ],
    { cwd: deploymentDirectory, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  const configuration = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(configuration.services).sort(), [
    'backup',
    'db',
    'redis',
    'server',
    'worker',
  ]);

  for (const serviceName of ['server', 'worker']) {
    const environment = configuration.services[serviceName].environment;
    assert.equal(environment.AUDIT_LOGS_ENABLED, 'false');
    assert.equal(
      Object.keys(environment).some((name) => name.startsWith('CLICKHOUSE_')),
      false,
    );
  }

  const backup = configuration.services.backup;
  assert.equal(backup.environment.BACKUP_MODE, 'core-only');
  assert.equal(backup.environment.AUDIT_LOGS_ENABLED, 'false');
  assert.equal(backup.environment.BACKUP_RETENTION_DAYS, '30');
  assert.equal(backup.environment.DELETION_PROPAGATION_DAYS, '30');
  assert.equal(
    Object.keys(backup.environment).some((name) =>
      name.startsWith('CLICKHOUSE_'),
    ),
    false,
  );
  assert.deepEqual(Object.keys(backup.depends_on), ['db']);
  assert.equal(
    (backup.volumes ?? []).some((volume) =>
      String(volume.source ?? volume).includes('clickhouse'),
    ),
    false,
  );
});
