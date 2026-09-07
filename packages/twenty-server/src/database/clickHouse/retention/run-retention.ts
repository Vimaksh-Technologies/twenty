/* oxlint-disable no-console */
import { setTimeout as sleep } from 'node:timers/promises';

import {
  type ClickHouseClient,
  ClickHouseLogLevel,
  createClient,
} from '@clickhouse/client';
import { Client, type QueryResult } from 'pg';
import { EventLogTable } from 'twenty-shared/types';

import { resolveClickHouseUrl } from 'src/database/clickHouse/resolve-clickhouse-url';
import { getClickHouseTableName } from 'src/engine/core-modules/event-logs/registry/event-log-registry';

const RETENTION_MAX_ATTEMPTS = 3;
const RETENTION_RETRY_DELAY_MS = 5_000;
const RETENTION_HEARTBEAT_TIMEOUT_MS = 10_000;
const RETENTION_POSTGRES_CONNECTION_TIMEOUT_MS = 15_000;
const RETENTION_QUERY_TIMEOUT_MS = 60_000;

const RETENTION_TABLE_NAMES = Object.values(EventLogTable).map((table) =>
  getClickHouseTableName(table),
);

type RetentionConfiguration = {
  clickHouseUrl: string;
  postgresUrl: string;
  postgresUser: string;
  successHeartbeatUrl: string;
  failureHeartbeatUrl: string;
};

type PostgresIdentity = {
  currentUser: string;
  hasElevatedRoleAttributes: boolean;
  hasWritePrivileges: boolean;
  isTransactionReadOnly: boolean;
};

type RetentionWorkspace = {
  id: string;
  retentionDays: number;
};

type ClickHouseIdentity = {
  currentUser: string;
};

type RetentionPostgresClient = {
  connect: () => Promise<unknown>;
  end: () => Promise<void>;
  query: <TRow extends Record<string, unknown>>(
    query: string,
  ) => Promise<QueryResult<TRow>>;
};

type RetentionDependencies = {
  clickHouseClient: Pick<ClickHouseClient, 'close' | 'command' | 'query'>;
  postgresClient: RetentionPostgresClient;
  fetch: typeof fetch;
  sleep: (delayMs: number) => Promise<void>;
};

const requireEnvironmentValue = (
  environment: NodeJS.ProcessEnv,
  key: keyof NodeJS.ProcessEnv,
): string => {
  const value = environment[key];

  if (!value) {
    throw new Error(`${key} is required`);
  }

  return value;
};

const validateHttpsUrl = (name: string, value: string): void => {
  if (!value.startsWith('https://')) {
    throw new Error(`${name} must use HTTPS`);
  }
};

export const resolveRetentionConfiguration = (
  environment: NodeJS.ProcessEnv,
): RetentionConfiguration => {
  const successHeartbeatUrl = requireEnvironmentValue(
    environment,
    'RETENTION_HEALTHCHECK_URL',
  );
  const failureHeartbeatUrl = requireEnvironmentValue(
    environment,
    'RETENTION_FAILURE_HEALTHCHECK_URL',
  );

  validateHttpsUrl('RETENTION_HEALTHCHECK_URL', successHeartbeatUrl);
  validateHttpsUrl('RETENTION_FAILURE_HEALTHCHECK_URL', failureHeartbeatUrl);

  if (successHeartbeatUrl === failureHeartbeatUrl) {
    throw new Error('Retention heartbeat endpoints must be distinct');
  }

  for (const prohibitedKey of [
    'PG_DATABASE_URL',
    'CLICKHOUSE_INGEST_URL',
    'CLICKHOUSE_READ_URL',
    'CLICKHOUSE_MIGRATION_URL',
  ] as const) {
    if (environment[prohibitedKey] !== undefined) {
      throw new Error(`${prohibitedKey} is prohibited in retention`);
    }
  }

  const postgresUrl = requireEnvironmentValue(
    environment,
    'RETENTION_PG_DATABASE_URL',
  );
  const postgresUser = requireEnvironmentValue(
    environment,
    'RETENTION_PG_DATABASE_USER',
  );
  const appPostgresUser = requireEnvironmentValue(
    environment,
    'APP_PG_DATABASE_USER',
  );

  if (postgresUser === appPostgresUser) {
    throw new Error(
      'Retention and application PostgreSQL identities must differ',
    );
  }

  return {
    clickHouseUrl: resolveClickHouseUrl(environment, 'retention'),
    postgresUrl,
    postgresUser,
    successHeartbeatUrl,
    failureHeartbeatUrl,
  };
};

const assertClickHouseIdentity = async (
  clickHouseClient: Pick<ClickHouseClient, 'query'>,
): Promise<void> => {
  const result = await clickHouseClient.query({
    query: 'SELECT currentUser() AS currentUser',
    format: 'JSONEachRow',
  });
  const identities = await result.json<ClickHouseIdentity>();

  if (
    identities.length !== 1 ||
    identities[0].currentUser !== 'twenty_retention'
  ) {
    throw new Error('Retention ClickHouse identity is not delete-only');
  }
};

const assertPostgresIdentity = async (
  postgresClient: RetentionPostgresClient,
  expectedUser: string,
): Promise<void> => {
  const result = await postgresClient.query<PostgresIdentity>(`
    SELECT
      current_user AS "currentUser",
      role.rolsuper OR role.rolcreatedb OR role.rolcreaterole
        OR role.rolreplication OR role.rolbypassrls AS "hasElevatedRoleAttributes",
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS class
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = class.relnamespace
        WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
          AND namespace.nspname NOT LIKE 'pg_toast%'
          AND class.relkind IN ('r', 'p')
          AND (
            has_table_privilege(current_user, class.oid, 'INSERT')
            OR has_table_privilege(current_user, class.oid, 'UPDATE')
            OR has_table_privilege(current_user, class.oid, 'DELETE')
            OR has_table_privilege(current_user, class.oid, 'TRUNCATE')
            OR has_table_privilege(current_user, class.oid, 'TRIGGER')
          )
      ) AS "hasWritePrivileges",
      current_setting('transaction_read_only')::boolean
        AS "isTransactionReadOnly"
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = current_user
  `);
  const identity = result.rows[0];

  if (
    !identity ||
    identity.currentUser !== expectedUser ||
    identity.hasElevatedRoleAttributes ||
    identity.hasWritePrivileges ||
    identity.isTransactionReadOnly !== true
  ) {
    throw new Error('Retention PostgreSQL identity is not bounded read-only');
  }
};

const listRetentionWorkspaces = async (
  postgresClient: RetentionPostgresClient,
): Promise<RetentionWorkspace[]> => {
  const result = await postgresClient.query<RetentionWorkspace>(`
    SELECT id, "eventLogRetentionDays" AS "retentionDays"
    FROM core.workspace
    WHERE "activationStatus" = 'ACTIVE'
    ORDER BY id
  `);

  for (const workspace of result.rows) {
    if (
      !Number.isInteger(workspace.retentionDays) ||
      workspace.retentionDays < 1
    ) {
      throw new Error('Workspace audit retention is invalid');
    }
  }

  return result.rows;
};

const sendHeartbeat = async (
  fetchImplementation: typeof fetch,
  url: string,
): Promise<void> => {
  const response = await fetchImplementation(url, {
    method: 'POST',
    signal: AbortSignal.timeout(RETENTION_HEARTBEAT_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error('Retention heartbeat failed');
  }
};

const deleteExpiredEventsWithRetry = async (
  clickHouseClient: Pick<ClickHouseClient, 'command'>,
  tableName: string,
  workspace: RetentionWorkspace,
  sleep: RetentionDependencies['sleep'],
): Promise<void> => {
  for (let attempt = 1; attempt <= RETENTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      await clickHouseClient.command({
        query: `ALTER TABLE ${tableName} DELETE WHERE "workspaceId" = {workspaceId:String} AND "timestamp" < now64(3) - toIntervalDay({retentionDays:UInt32})`,
        query_params: {
          workspaceId: workspace.id,
          retentionDays: workspace.retentionDays,
        },
        clickhouse_settings: {
          mutations_sync: '1',
        },
      });

      return;
    } catch {
      if (attempt === RETENTION_MAX_ATTEMPTS) {
        throw new Error('Audit retention mutation failed');
      }

      await sleep(RETENTION_RETRY_DELAY_MS);
    }
  }
};

export const runRetention = async (
  configuration: RetentionConfiguration,
  dependencies: RetentionDependencies,
): Promise<void> => {
  const { clickHouseClient, postgresClient } = dependencies;

  try {
    await assertClickHouseIdentity(clickHouseClient);
    await postgresClient.connect();
    await assertPostgresIdentity(postgresClient, configuration.postgresUser);
    const workspaces = await listRetentionWorkspaces(postgresClient);

    for (const workspace of workspaces) {
      for (const tableName of RETENTION_TABLE_NAMES) {
        await deleteExpiredEventsWithRetry(
          clickHouseClient,
          tableName,
          workspace,
          dependencies.sleep,
        );
      }
    }

    await sendHeartbeat(dependencies.fetch, configuration.successHeartbeatUrl);
  } catch {
    await sendHeartbeat(
      dependencies.fetch,
      configuration.failureHeartbeatUrl,
    ).catch(() => undefined);
    throw new Error('Audit retention failed');
  } finally {
    await Promise.allSettled([postgresClient.end(), clickHouseClient.close()]);
  }
};

const sendPreflightFailureHeartbeat = async (): Promise<void> => {
  const successUrl = process.env.RETENTION_HEALTHCHECK_URL;
  const failureUrl = process.env.RETENTION_FAILURE_HEALTHCHECK_URL;

  if (
    typeof failureUrl !== 'string' ||
    !failureUrl.startsWith('https://') ||
    failureUrl === successUrl
  ) {
    return;
  }

  await sendHeartbeat(fetch, failureUrl).catch(() => undefined);
};

const main = async (): Promise<void> => {
  let failureHandledByRunner = false;

  try {
    const configuration = resolveRetentionConfiguration(process.env);
    const postgresClient = new Client({
      connectionString: configuration.postgresUrl,
      connectionTimeoutMillis: RETENTION_POSTGRES_CONNECTION_TIMEOUT_MS,
      query_timeout: RETENTION_QUERY_TIMEOUT_MS,
      statement_timeout: RETENTION_QUERY_TIMEOUT_MS,
    });
    const clickHouseClient = createClient({
      url: configuration.clickHouseUrl,
      request_timeout: RETENTION_QUERY_TIMEOUT_MS,
      log: { level: ClickHouseLogLevel.OFF },
    });

    failureHandledByRunner = true;
    await runRetention(configuration, {
      postgresClient,
      clickHouseClient,
      fetch,
      sleep,
    });
  } catch {
    if (!failureHandledByRunner) {
      await sendPreflightFailureHeartbeat();
    }

    throw new Error('Audit retention failed');
  }
};

if (require.main === module) {
  main()
    .then(() => {
      console.log('Audit retention completed');
    })
    .catch(() => {
      console.error('Audit retention failed');
      process.exitCode = 1;
    });
}
