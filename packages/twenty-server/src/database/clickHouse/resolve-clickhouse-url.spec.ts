import { resolveClickHouseUrl } from 'src/database/clickHouse/resolve-clickhouse-url';

describe('resolveClickHouseUrl', () => {
  it('uses the one-shot migration URL in hardened mode', () => {
    expect(
      resolveClickHouseUrl(
        {
          AUDIT_LOGS_ENABLED: 'true',
          CLICKHOUSE_URL: 'http://legacy:secret@clickhouse/twenty',
          CLICKHOUSE_MIGRATION_URL: 'http://migration:secret@clickhouse/twenty',
        },
        'migration',
      ),
    ).toBe('http://migration:secret@clickhouse/twenty');
  });

  it('routes isolated retention without accepting the migration URL', () => {
    expect(
      resolveClickHouseUrl(
        {
          AUDIT_LOGS_ENABLED: 'true',
          CLICKHOUSE_MIGRATION_URL: 'http://migration:secret@clickhouse/twenty',
          CLICKHOUSE_RETENTION_URL: 'http://retention:secret@clickhouse/twenty',
        },
        'retention',
      ),
    ).toBe('http://retention:secret@clickhouse/twenty');
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
        'migration',
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
