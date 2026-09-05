import { CONFIG_VARIABLES_MASKING_CONFIG } from 'src/engine/core-modules/twenty-config/constants/config-variables-masking-config';
import { ConfigVariablesMaskingStrategies } from 'src/engine/core-modules/twenty-config/enums/config-variables-masking-strategies.enum';
import { configVariableMaskSensitiveData } from 'src/engine/core-modules/twenty-config/utils/config-variable-mask-sensitive-data.util';

const CLICKHOUSE_URL_KEYS = [
  'CLICKHOUSE_URL',
  'CLICKHOUSE_INGEST_URL',
  'CLICKHOUSE_READ_URL',
  'CLICKHOUSE_MIGRATION_URL',
  'CLICKHOUSE_RETENTION_URL',
] as const;

describe('ClickHouse config URL masking', () => {
  it.each(CLICKHOUSE_URL_KEYS)('hides credentials for %s', (key) => {
    const maskingConfig = CONFIG_VARIABLES_MASKING_CONFIG[key];
    const value = 'http://role:canary-secret@clickhouse:8123/twenty';

    expect(maskingConfig.strategy).toBe(
      ConfigVariablesMaskingStrategies.HIDE_PASSWORD,
    );
    expect(
      configVariableMaskSensitiveData(value, maskingConfig.strategy, {
        variableName: key,
      }),
    ).toBe('http://********:********@clickhouse:8123/twenty');
  });
});
