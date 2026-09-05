import { configTransformers } from 'src/engine/core-modules/twenty-config/utils/config-transformers.util';

export type ClickHouseClientRole =
  | 'ingest'
  | 'read'
  | 'migration'
  | 'retention';

const CLICKHOUSE_URL_KEY_BY_ROLE: Record<
  ClickHouseClientRole,
  keyof NodeJS.ProcessEnv
> = {
  ingest: 'CLICKHOUSE_INGEST_URL',
  read: 'CLICKHOUSE_READ_URL',
  migration: 'CLICKHOUSE_MIGRATION_URL',
  retention: 'CLICKHOUSE_RETENTION_URL',
};

export const resolveClickHouseUrl = (
  environment: NodeJS.ProcessEnv,
  role: ClickHouseClientRole,
): string => {
  const auditLogsEnabled = configTransformers.boolean(
    environment.AUDIT_LOGS_ENABLED,
  );

  if (
    environment.AUDIT_LOGS_ENABLED !== undefined &&
    auditLogsEnabled === undefined
  ) {
    throw new Error('AUDIT_LOGS_ENABLED must be a boolean');
  }

  const key = auditLogsEnabled
    ? CLICKHOUSE_URL_KEY_BY_ROLE[role]
    : 'CLICKHOUSE_URL';
  const url = environment[key];

  if (!url) {
    throw new Error(`${key} is required`);
  }

  return url;
};
