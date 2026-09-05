/* @license Enterprise */

import { Injectable, Logger } from '@nestjs/common';

import { EventLogTable } from 'twenty-shared/types';

import { ClickHouseService } from 'src/database/clickHouse/clickHouse.service';
import { formatDateTimeForClickHouse } from 'src/database/clickHouse/clickHouse.util';
import { getClickHouseTableName } from 'src/engine/core-modules/event-logs/registry/event-log-registry';

export type EventLogCleanupParams = {
  workspaceId: string;
  retentionDays: number;
};

@Injectable()
export class EventLogCleanupService {
  private readonly logger = new Logger(EventLogCleanupService.name);

  constructor(private readonly clickHouseService: ClickHouseService) {}

  async cleanupWorkspaceEventLogs({
    workspaceId,
    retentionDays,
  }: EventLogCleanupParams): Promise<void> {
    if (!this.clickHouseService.isClientConfigured('maintenance')) {
      throw new Error('ClickHouse maintenance client is not configured');
    }

    const cutoffDate = new Date();

    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const failedTableNames: string[] = [];

    for (const table of Object.values(EventLogTable)) {
      const tableName = getClickHouseTableName(table);

      try {
        await this.clickHouseService.deleteExpiredWorkspaceEvents(
          tableName,
          workspaceId,
          formatDateTimeForClickHouse(cutoffDate),
        );
        this.logger.log(
          `Scheduled deletion of old ${tableName} events for workspace ${workspaceId} (retention: ${retentionDays} days)`,
        );
      } catch {
        failedTableNames.push(tableName);
        this.logger.error(
          `Failed to schedule deletion for ${tableName} in workspace ${workspaceId}`,
        );
      }
    }

    if (failedTableNames.length > 0) {
      throw new Error(
        `Failed to clean up ${failedTableNames.length} ClickHouse event table${
          failedTableNames.length === 1 ? '' : 's'
        }`,
      );
    }
  }
}
