import { type ClickHouseClient, createClient } from '@clickhouse/client';

import { ClickHouseService } from 'src/database/clickHouse/clickHouse.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

jest.mock('@clickhouse/client', () => ({
  createClient: jest.fn(),
  ClickHouseLogLevel: { OFF: 'OFF' },
}));

const createMockClient = (): jest.Mocked<ClickHouseClient> =>
  ({
    insert: jest.fn().mockResolvedValue({}),
    query: jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue([{ test: 'data' }]),
    }),
    command: jest.fn().mockResolvedValue({}),
    ping: jest.fn().mockResolvedValue({ success: true }),
    close: jest.fn().mockResolvedValue({}),
  }) as unknown as jest.Mocked<ClickHouseClient>;

const HARDENED_CONFIG = {
  AUDIT_LOGS_ENABLED: true,
  CLICKHOUSE_URL: 'http://legacy:legacy-secret@clickhouse:8123/twenty',
  CLICKHOUSE_INGEST_URL: 'http://ingest:ingest-secret@clickhouse:8123/twenty',
  CLICKHOUSE_READ_URL: 'http://reader:reader-secret@clickhouse:8123/twenty',
  CLICKHOUSE_MIGRATION_URL:
    'http://must-not-initialize:migration-secret@clickhouse:8123/twenty',
  CLICKHOUSE_RETENTION_URL:
    'http://must-not-initialize:retention-secret@clickhouse:8123/twenty',
} as const;

const createService = (
  config: Partial<Record<keyof typeof HARDENED_CONFIG, unknown>>,
  clients: ClickHouseClient[],
) => {
  jest.mocked(createClient).mockReset();

  for (const client of clients) {
    jest.mocked(createClient).mockReturnValueOnce(client);
  }

  const twentyConfigService = {
    get: jest.fn((key: keyof typeof HARDENED_CONFIG) => config[key]),
  } as unknown as TwentyConfigService;

  return new ClickHouseService(twentyConfigService);
};

describe('ClickHouseService role routing', () => {
  it('routes runtime insert and select to distinct hardened clients', async () => {
    const ingestClient = createMockClient();
    const readClient = createMockClient();
    const service = createService(HARDENED_CONFIG, [ingestClient, readClient]);

    await service.insert('workspaceEvent', [{ event: 'created' }]);
    await service.select('SELECT * FROM workspaceEvent');

    expect(ingestClient.insert).toHaveBeenCalledTimes(1);
    expect(ingestClient.query).not.toHaveBeenCalled();
    expect(readClient.query).toHaveBeenCalledTimes(1);
    expect(readClient.insert).not.toHaveBeenCalled();
    expect(createClient).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(jest.mocked(createClient).mock.calls)).not.toContain(
      'migration-secret',
    );
    expect(JSON.stringify(jest.mocked(createClient).mock.calls)).not.toContain(
      'retention-secret',
    );
  });

  it('does not fall back to CLICKHOUSE_URL in hardened mode', () => {
    const service = createService(
      {
        AUDIT_LOGS_ENABLED: true,
        CLICKHOUSE_URL: HARDENED_CONFIG.CLICKHOUSE_URL,
      },
      [],
    );

    expect(service.isClientConfigured('ingest')).toBe(false);
    expect(service.isClientConfigured('read')).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('uses one legacy client for both runtime roles outside hardened mode', async () => {
    const client = createMockClient();
    const service = createService(
      {
        AUDIT_LOGS_ENABLED: false,
        CLICKHOUSE_URL: HARDENED_CONFIG.CLICKHOUSE_URL,
      },
      [client],
    );

    expect(service.isClientConfigured('ingest')).toBe(true);
    expect(service.isClientConfigured('read')).toBe(true);

    await service.onModuleDestroy();

    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it('strict reads throw instead of returning an empty audit history', async () => {
    const ingestClient = createMockClient();
    const readClient = createMockClient();
    readClient.query.mockRejectedValue(new Error('reader unavailable'));
    const service = createService(HARDENED_CONFIG, [ingestClient, readClient]);

    await expect(
      service.selectOrThrow('SELECT * FROM workspaceEvent'),
    ).rejects.toThrow('ClickHouse read failed');
    await expect(
      service.select('SELECT * FROM workspaceEvent'),
    ).resolves.toEqual([]);
  });

  it('fails hardened startup without leaking connection details', async () => {
    const ingestClient = createMockClient();
    const readClient = createMockClient();

    readClient.ping.mockRejectedValue(
      new Error(HARDENED_CONFIG.CLICKHOUSE_READ_URL),
    );

    const service = createService(HARDENED_CONFIG, [ingestClient, readClient]);
    const loggerError = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation();

    await expect(service.onModuleInit()).rejects.toThrow(
      'ClickHouse read client failed to connect',
    );
    expect(JSON.stringify(loggerError.mock.calls)).not.toContain(
      'reader-secret',
    );
    expect(JSON.stringify(loggerError.mock.calls)).not.toContain(
      HARDENED_CONFIG.CLICKHOUSE_READ_URL,
    );
  });
});
