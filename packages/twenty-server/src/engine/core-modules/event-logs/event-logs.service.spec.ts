import { EventLogTable } from 'twenty-shared/types';

import { ClickHouseService } from 'src/database/clickHouse/clickHouse.service';
import { BillingEntitlementKey } from 'src/engine/core-modules/billing/enums/billing-entitlement-key.enum';
import { BillingService } from 'src/engine/core-modules/billing/services/billing.service';
import { EnterprisePlanService } from 'src/engine/core-modules/enterprise/services/enterprise-plan.service';
import { EventLogsExceptionCode } from 'src/engine/core-modules/event-logs/event-logs.exception';
import { EventLogsService } from 'src/engine/core-modules/event-logs/event-logs.service';

describe('EventLogsService.validateAccess', () => {
  let service: EventLogsService;
  let isAuditLogsConfigured: jest.Mock;
  let hasEntitlement: jest.Mock;
  let isValid: jest.Mock;

  beforeEach(() => {
    isAuditLogsConfigured = jest.fn().mockReturnValue(true);
    hasEntitlement = jest.fn().mockResolvedValue(true);
    isValid = jest.fn().mockReturnValue(true);

    service = new EventLogsService(
      { isAuditLogsConfigured } as unknown as ClickHouseService,
      { hasEntitlement } as unknown as BillingService,
      { isValid } as unknown as EnterprisePlanService,
      {} as never,
    );
  });

  const validateAccessError = async (table: EventLogTable) =>
    service.validateAccess('ws-1', table).then(
      () => undefined,
      (error) => error,
    );

  it('throws CLICKHOUSE_NOT_CONFIGURED when ClickHouse is unavailable', async () => {
    isAuditLogsConfigured.mockReturnValue(false);

    const error = await validateAccessError(EventLogTable.WORKSPACE_EVENT);

    expect(error?.code).toBe(EventLogsExceptionCode.CLICKHOUSE_NOT_CONFIGURED);
  });

  it('allows application logs with no entitlement (free on every plan)', async () => {
    isValid.mockReturnValue(false);
    hasEntitlement.mockResolvedValue(false);

    await expect(
      service.validateAccess('ws-1', EventLogTable.APPLICATION_LOG),
    ).resolves.toBeUndefined();
    expect(hasEntitlement).not.toHaveBeenCalled();
  });

  it('throws NO_ENTITLEMENT for a gated table when the Enterprise plan is invalid (skips the billing call)', async () => {
    isValid.mockReturnValue(false);

    const error = await validateAccessError(EventLogTable.WORKSPACE_EVENT);

    expect(error?.code).toBe(EventLogsExceptionCode.NO_ENTITLEMENT);
    expect(hasEntitlement).not.toHaveBeenCalled();
  });

  it('throws NO_ENTITLEMENT for a gated table when the AUDIT_LOGS entitlement is missing', async () => {
    hasEntitlement.mockResolvedValue(false);

    const error = await validateAccessError(EventLogTable.USAGE_EVENT);

    expect(error?.code).toBe(EventLogsExceptionCode.NO_ENTITLEMENT);
    expect(hasEntitlement).toHaveBeenCalledWith(
      'ws-1',
      BillingEntitlementKey.AUDIT_LOGS,
    );
  });

  it('allows a gated table when the plan is valid and the entitlement is held', async () => {
    await expect(
      service.validateAccess('ws-1', EventLogTable.OBJECT_EVENT),
    ).resolves.toBeUndefined();
  });
});

describe('EventLogsService.queryEventLogs', () => {
  it('uses strict ClickHouse reads so unavailable audit storage is not reported as empty', async () => {
    const selectOrThrow = jest
      .fn()
      .mockRejectedValue(new Error('ClickHouse read failed'));
    const service = new EventLogsService(
      {
        isAuditLogsConfigured: () => true,
        selectOrThrow,
      } as unknown as ClickHouseService,
      {
        hasEntitlement: jest.fn().mockResolvedValue(true),
      } as unknown as BillingService,
      {
        isValid: jest.fn().mockReturnValue(true),
      } as unknown as EnterprisePlanService,
      {} as never,
    );

    await expect(
      service.queryEventLogs('ws-1', {
        table: EventLogTable.WORKSPACE_EVENT,
        first: 10,
      } as never),
    ).rejects.toThrow('ClickHouse read failed');
    expect(selectOrThrow).toHaveBeenCalledTimes(2);
  });
});
