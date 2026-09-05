import { resolveClickHouseUrl } from 'src/database/clickHouse/resolve-clickhouse-url';

describe('resolveClickHouseUrl', () => {
  it('uses the requested role URL in hardened mode', () => {
    expect(
      resolveClickHouseUrl(
        {
          AUDIT_LOGS_ENABLED: 'true',
          CLICKHOUSE_URL: 'http://legacy:secret@clickhouse/twenty',
          CLICKHOUSE_MAINTENANCE_URL:
            'http://maintenance:secret@clickhouse/twenty',
        },
        'maintenance',
      ),
    ).toBe('http://maintenance:secret@clickhouse/twenty');
  });

  it('uses hardened mode for every supported true value', () => {
    for (const value of ['TRUE', 'on', 'yes', '1']) {
      expect(
        resolveClickHouseUrl(
          {
            AUDIT_LOGS_ENABLED: value,
            CLICKHOUSE_URL: 'http://legacy:secret@clickhouse/twenty',
            CLICKHOUSE_READ_URL: 'http://reader:secret@clickhouse/twenty',
          },
          'read',
        ),
      ).toBe('http://reader:secret@clickhouse/twenty');
    }
  });

  it('rejects an invalid audit mode instead of falling back to legacy', () => {
    expect(() =>
      resolveClickHouseUrl(
        {
          AUDIT_LOGS_ENABLED: 'enabled',
          CLICKHOUSE_URL: 'http://legacy:canary-secret@clickhouse/twenty',
        },
        'maintenance',
      ),
    ).toThrow('AUDIT_LOGS_ENABLED must be a boolean');
  });

  it('never falls back to the legacy URL in hardened mode', () => {
    expect(() =>
      resolveClickHouseUrl(
        {
          AUDIT_LOGS_ENABLED: 'true',
          CLICKHOUSE_URL: 'http://legacy:canary-secret@clickhouse/twenty',
        },
        'ingest',
      ),
    ).toThrow('CLICKHOUSE_INGEST_URL is required');
  });

  it('preserves the legacy URL outside hardened mode', () => {
    expect(
      resolveClickHouseUrl(
        { CLICKHOUSE_URL: 'http://legacy:secret@clickhouse/twenty' },
        'read',
      ),
    ).toBe('http://legacy:secret@clickhouse/twenty');
  });
});
