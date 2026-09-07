import { plainToInstance } from 'class-transformer';

import {
  ConfigVariables,
  getMissingClickHouseAuditUrlKeys,
} from 'src/engine/core-modules/twenty-config/config-variables';

const CLICKHOUSE_RUNTIME_URLS = {
  CLICKHOUSE_INGEST_URL: 'http://ingest:secret@clickhouse:8123/twenty',
  CLICKHOUSE_READ_URL: 'http://reader:secret@clickhouse:8123/twenty',
} as const;

const clickHouseValidationErrors = (values: Record<string, unknown>) => {
  const config = plainToInstance(ConfigVariables, values);

  return getMissingClickHouseAuditUrlKeys(config);
};

describe('ClickHouse config validation', () => {
  it.each(Object.keys(CLICKHOUSE_RUNTIME_URLS))(
    'requires %s when hardened audit logs are enabled',
    (missingKey) => {
      const urls = Object.fromEntries(
        Object.entries(CLICKHOUSE_RUNTIME_URLS).filter(
          ([key]) => key !== missingKey,
        ),
      );

      expect(
        clickHouseValidationErrors({
          AUDIT_LOGS_ENABLED: true,
          ...urls,
        }),
      ).toContain(missingKey);
    },
  );

  it('accepts only runtime role URLs when hardened audit logs are enabled', () => {
    expect(
      clickHouseValidationErrors({
        AUDIT_LOGS_ENABLED: true,
        ...CLICKHOUSE_RUNTIME_URLS,
      }),
    ).toEqual([]);
  });

  it('preserves legacy single-URL configuration outside hardened mode', () => {
    expect(
      clickHouseValidationErrors({
        AUDIT_LOGS_ENABLED: false,
        CLICKHOUSE_URL: 'http://default:secret@clickhouse:8123/twenty',
      }),
    ).toEqual([]);
  });
});
