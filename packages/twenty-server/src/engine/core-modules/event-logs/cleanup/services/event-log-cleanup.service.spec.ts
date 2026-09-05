import { ClickHouseService } from 'src/database/clickHouse/clickHouse.service';
import { EventLogCleanupService } from 'src/engine/core-modules/event-logs/cleanup/services/event-log-cleanup.service';

const EVENT_TABLE_COUNT = 5;

describe('EventLogCleanupService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-05T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('routes retention through the fixed maintenance operation', async () => {
    const deleteExpiredWorkspaceEvents = jest.fn().mockResolvedValue(undefined);
    const service = new EventLogCleanupService({
      isClientConfigured: () => true,
      deleteExpiredWorkspaceEvents,
    } as unknown as ClickHouseService);

    await service.cleanupWorkspaceEventLogs({
      workspaceId: 'workspace-1',
      retentionDays: 30,
    });

    expect(deleteExpiredWorkspaceEvents).toHaveBeenCalledTimes(
      EVENT_TABLE_COUNT,
    );
    expect(deleteExpiredWorkspaceEvents).toHaveBeenCalledWith(
      'workspaceEvent',
      'workspace-1',
      '2026-08-06 12:00:00.000',
    );
  });

  it('attempts every table and throws when any retention operation fails', async () => {
    const deleteExpiredWorkspaceEvents = jest
      .fn()
      .mockResolvedValue(undefined)
      .mockRejectedValueOnce(new Error('retention failed'));
    const service = new EventLogCleanupService({
      isClientConfigured: () => true,
      deleteExpiredWorkspaceEvents,
    } as unknown as ClickHouseService);

    await expect(
      service.cleanupWorkspaceEventLogs({
        workspaceId: 'workspace-1',
        retentionDays: 30,
      }),
    ).rejects.toThrow('Failed to clean up 1 ClickHouse event table');
    expect(deleteExpiredWorkspaceEvents).toHaveBeenCalledTimes(
      EVENT_TABLE_COUNT,
    );
  });
});
