import {
  resolveRetentionConfiguration,
  runRetention,
} from 'src/database/clickHouse/retention/run-retention';

const CONFIGURATION = {
  clickHouseUrl: 'http://retention:secret@clickhouse:8123/twenty',
  postgresUrl: 'postgres://twenty_retention:secret@db:5432/twenty',
  postgresUser: 'twenty_retention',
  successHeartbeatUrl: 'https://heartbeat.invalid/success',
  failureHeartbeatUrl: 'https://heartbeat.invalid/failure',
};

const createDependencies = () => {
  const postgresClient = {
    connect: jest.fn().mockResolvedValue(undefined),
    end: jest.fn().mockResolvedValue(undefined),
    query: jest
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            currentUser: 'twenty_retention',
            hasElevatedRoleAttributes: false,
            hasWritePrivileges: false,
            isTransactionReadOnly: true,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'f3b26df8-6d87-4e0a-8cdf-bcf9dd57cc15',
            retentionDays: 30,
          },
        ],
      }),
  };
  const clickHouseClient = {
    close: jest.fn().mockResolvedValue(undefined),
    command: jest.fn().mockResolvedValue({}),
    query: jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue([{ currentUser: 'twenty_retention' }]),
    }),
  };
  const fetchImplementation = jest
    .fn()
    .mockResolvedValue({ ok: true } as Response);
  const sleep = jest.fn().mockResolvedValue(undefined);

  return {
    dependencies: {
      postgresClient,
      clickHouseClient,
      fetch: fetchImplementation,
      sleep,
    },
    postgresClient,
    clickHouseClient,
    fetchImplementation,
    sleep,
  };
};

describe('isolated ClickHouse retention', () => {
  it('rejects normal application and migration credentials', () => {
    expect(() =>
      resolveRetentionConfiguration({
        AUDIT_LOGS_ENABLED: 'true',
        CLICKHOUSE_RETENTION_URL: CONFIGURATION.clickHouseUrl,
        CLICKHOUSE_MIGRATION_URL:
          'http://migration:secret@clickhouse:8123/twenty',
        RETENTION_PG_DATABASE_URL: CONFIGURATION.postgresUrl,
        RETENTION_PG_DATABASE_USER: CONFIGURATION.postgresUser,
        APP_PG_DATABASE_USER: 'twenty_app',
        RETENTION_HEALTHCHECK_URL: CONFIGURATION.successHeartbeatUrl,
        RETENTION_FAILURE_HEALTHCHECK_URL: CONFIGURATION.failureHeartbeatUrl,
      }),
    ).toThrow('CLICKHOUSE_MIGRATION_URL is prohibited in retention');
  });

  it('rejects an aliased application PostgreSQL identity', () => {
    expect(() =>
      resolveRetentionConfiguration({
        AUDIT_LOGS_ENABLED: 'true',
        CLICKHOUSE_RETENTION_URL: CONFIGURATION.clickHouseUrl,
        RETENTION_PG_DATABASE_URL: CONFIGURATION.postgresUrl,
        RETENTION_PG_DATABASE_USER: CONFIGURATION.postgresUser,
        APP_PG_DATABASE_USER: CONFIGURATION.postgresUser,
        RETENTION_HEALTHCHECK_URL: CONFIGURATION.successHeartbeatUrl,
        RETENTION_FAILURE_HEALTHCHECK_URL: CONFIGURATION.failureHeartbeatUrl,
      }),
    ).toThrow('Retention and application PostgreSQL identities must differ');
  });

  it('retries a bounded mutation before reporting success', async () => {
    const { dependencies, clickHouseClient, fetchImplementation, sleep } =
      createDependencies();

    clickHouseClient.command
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue({});

    await runRetention(CONFIGURATION, dependencies);

    expect(clickHouseClient.command).toHaveBeenCalledTimes(6);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(5_000);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(fetchImplementation).toHaveBeenCalledWith(
      CONFIGURATION.successHeartbeatUrl,
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('reports failure after bounded retries and suppresses success', async () => {
    const { dependencies, clickHouseClient, fetchImplementation } =
      createDependencies();

    clickHouseClient.command.mockRejectedValue(new Error('persistent failure'));

    await expect(runRetention(CONFIGURATION, dependencies)).rejects.toThrow(
      'Audit retention failed',
    );

    expect(clickHouseClient.command).toHaveBeenCalledTimes(3);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(fetchImplementation).toHaveBeenCalledWith(
      CONFIGURATION.failureHeartbeatUrl,
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(fetchImplementation).not.toHaveBeenCalledWith(
      CONFIGURATION.successHeartbeatUrl,
      expect.anything(),
    );
  });

  it('fails before mutation when the PostgreSQL identity is privileged', async () => {
    const {
      dependencies,
      postgresClient,
      clickHouseClient,
      fetchImplementation,
    } = createDependencies();

    postgresClient.query.mockReset().mockResolvedValueOnce({
      rows: [
        {
          currentUser: 'twenty_retention',
          hasElevatedRoleAttributes: true,
          hasWritePrivileges: false,
          isTransactionReadOnly: true,
        },
      ],
    });

    await expect(runRetention(CONFIGURATION, dependencies)).rejects.toThrow(
      'Audit retention failed',
    );

    expect(clickHouseClient.command).not.toHaveBeenCalled();
    expect(fetchImplementation).toHaveBeenCalledWith(
      CONFIGURATION.failureHeartbeatUrl,
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('fails before mutation when the PostgreSQL transaction is writable', async () => {
    const { dependencies, postgresClient, clickHouseClient } =
      createDependencies();

    postgresClient.query.mockReset().mockResolvedValueOnce({
      rows: [
        {
          currentUser: 'twenty_retention',
          hasElevatedRoleAttributes: false,
          hasWritePrivileges: false,
          isTransactionReadOnly: false,
        },
      ],
    });

    await expect(runRetention(CONFIGURATION, dependencies)).rejects.toThrow(
      'Audit retention failed',
    );

    expect(clickHouseClient.command).not.toHaveBeenCalled();
  });

  it('fails before mutation when the ClickHouse identity is aliased', async () => {
    const { dependencies, clickHouseClient, fetchImplementation } =
      createDependencies();

    clickHouseClient.query.mockResolvedValue({
      json: jest.fn().mockResolvedValue([{ currentUser: 'twenty_migration' }]),
    });

    await expect(runRetention(CONFIGURATION, dependencies)).rejects.toThrow(
      'Audit retention failed',
    );

    expect(clickHouseClient.command).not.toHaveBeenCalled();
    expect(fetchImplementation).toHaveBeenCalledWith(
      CONFIGURATION.failureHeartbeatUrl,
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
