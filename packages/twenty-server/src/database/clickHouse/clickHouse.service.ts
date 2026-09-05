import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import {
  type ClickHouseClient,
  ClickHouseLogLevel,
  createClient,
} from '@clickhouse/client';

import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type WorkspaceEventTable } from 'src/engine/core-modules/event-logs/types/workspace-event-envelope.type';

export type ClickHouseInsertOptions = {
  asyncInsertBusyTimeoutMaxMs?: number;
};

export type ClickHouseClientRole = 'ingest' | 'read' | 'maintenance';

const CLICKHOUSE_CLIENT_ROLES: ClickHouseClientRole[] = [
  'ingest',
  'read',
  'maintenance',
];

const EVENT_LOG_TABLES: Record<WorkspaceEventTable, true> = {
  workspaceEvent: true,
  pageview: true,
  objectEvent: true,
  usageEvent: true,
  applicationLog: true,
};

@Injectable()
export class ClickHouseService implements OnModuleInit, OnModuleDestroy {
  private readonly clients: Partial<
    Record<ClickHouseClientRole, ClickHouseClient>
  > = {};
  private readonly auditLogsEnabled: boolean;
  private readonly logger = new Logger(ClickHouseService.name);

  constructor(private readonly twentyConfigService: TwentyConfigService) {
    this.auditLogsEnabled = this.twentyConfigService.get('AUDIT_LOGS_ENABLED');

    if (this.auditLogsEnabled) {
      this.initializeRoleClient(
        'ingest',
        this.twentyConfigService.get('CLICKHOUSE_INGEST_URL'),
      );
      this.initializeRoleClient(
        'read',
        this.twentyConfigService.get('CLICKHOUSE_READ_URL'),
      );
      this.initializeRoleClient(
        'maintenance',
        this.twentyConfigService.get('CLICKHOUSE_MAINTENANCE_URL'),
      );

      return;
    }

    const legacyUrl = this.twentyConfigService.get('CLICKHOUSE_URL');

    if (!legacyUrl) {
      return;
    }

    const legacyClient = this.createClient(legacyUrl);

    for (const role of CLICKHOUSE_CLIENT_ROLES) {
      this.clients[role] = legacyClient;
    }
  }

  public isClientConfigured(role: ClickHouseClientRole): boolean {
    return this.clients[role] !== undefined;
  }

  public isAuditLogsConfigured(): boolean {
    return (
      this.auditLogsEnabled &&
      CLICKHOUSE_CLIENT_ROLES.every((role) => this.isClientConfigured(role))
    );
  }

  async onModuleInit(): Promise<void> {
    const pingedClients = new Set<ClickHouseClient>();

    for (const role of CLICKHOUSE_CLIENT_ROLES) {
      const client = this.clients[role];

      if (!client || pingedClients.has(client)) {
        continue;
      }

      pingedClients.add(client);

      try {
        await client.ping();
      } catch {
        const message = `ClickHouse ${role} client failed to connect`;

        this.logger.error(message);

        if (this.auditLogsEnabled) {
          throw new Error(message);
        }
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    const distinctClients = new Set(Object.values(this.clients));

    await Promise.all(
      [...distinctClients].map(async (client) => {
        await client.close();
      }),
    );
  }

  public async insert<T extends Record<string, unknown>>(
    table: string,
    values: T[],
    options: ClickHouseInsertOptions = {},
  ): Promise<{ success: boolean }> {
    const client = this.clients.ingest;

    if (!client) {
      return { success: false };
    }

    try {
      await this.insertInChunks(client, table, values, {
        chunkSize: 1000,
        maxMemoryMB: 4,
        asyncInsertBusyTimeoutMaxMs: options.asyncInsertBusyTimeoutMaxMs,
      });

      return { success: true };
    } catch {
      this.logger.error('Error inserting data into ClickHouse');

      return { success: false };
    }
  }

  public async select<T>(
    query: string,
    params?: Record<string, unknown>,
  ): Promise<T[]> {
    try {
      return await this.selectOrThrow<T>(query, params);
    } catch {
      this.logger.error('Error executing select query in ClickHouse');

      return [];
    }
  }

  public async selectOrThrow<T>(
    query: string,
    params?: Record<string, unknown>,
  ): Promise<T[]> {
    const client = this.clients.read;

    if (!client) {
      throw new Error('ClickHouse read failed');
    }

    try {
      const resultSet = await client.query({
        query,
        format: 'JSONEachRow',
        query_params: params,
      });
      const result = await resultSet.json<T>();

      return Array.isArray(result) ? result : [];
    } catch {
      throw new Error('ClickHouse read failed');
    }
  }

  public async deleteExpiredWorkspaceEvents(
    table: WorkspaceEventTable,
    workspaceId: string,
    cutoffDate: string,
  ): Promise<void> {
    if (EVENT_LOG_TABLES[table] !== true) {
      throw new Error(`Unsupported ClickHouse event table: ${table}`);
    }

    const client = this.clients.maintenance;

    if (!client) {
      throw new Error('ClickHouse maintenance failed');
    }

    try {
      await client.command({
        query: `ALTER TABLE ${table} DELETE WHERE "workspaceId" = {workspaceId:String} AND "timestamp" < {cutoffDate:DateTime64(3)}`,
        query_params: { workspaceId, cutoffDate },
      });
    } catch {
      throw new Error('ClickHouse maintenance failed');
    }
  }

  private initializeRoleClient(
    role: ClickHouseClientRole,
    url: string | undefined,
  ): void {
    if (url) {
      this.clients[role] = this.createClient(url);
    }
  }

  private createClient(url: string): ClickHouseClient {
    return createClient({
      url,
      compression: {
        response: true,
        request: true,
      },
      application: 'twenty',
      log: { level: ClickHouseLogLevel.OFF },
    });
  }

  private async insertInChunks<T extends Record<string, unknown>>(
    client: ClickHouseClient,
    table: string,
    values: T[],
    options: {
      chunkSize?: number;
      maxMemoryMB?: number;
      asyncInsertBusyTimeoutMaxMs?: number;
    } = {},
  ): Promise<void> {
    const chunkSize = options.chunkSize ?? 1000;
    const maxMemoryMB = options.maxMemoryMB;

    let chunk: T[] = [];
    let currentSizeBytes = 0;

    const flush = async () => {
      if (chunk.length === 0) return;

      await client.insert({
        table,
        values: chunk,
        format: 'JSONEachRow',
        clickhouse_settings: {
          async_insert: 1,
          ...(options.asyncInsertBusyTimeoutMaxMs !== undefined
            ? {
                async_insert_busy_timeout_max_ms:
                  options.asyncInsertBusyTimeoutMaxMs,
              }
            : {}),
          wait_for_async_insert: 1,
        },
      });
      chunk = [];
      currentSizeBytes = 0;
    };

    for (const row of values) {
      const rowSize = Buffer.byteLength(JSON.stringify(row));

      chunk.push(row);
      currentSizeBytes += rowSize;

      const currentSizeMB = currentSizeBytes / 1024 / 1024;

      if (
        chunk.length >= chunkSize ||
        (maxMemoryMB !== undefined && currentSizeMB >= maxMemoryMB)
      ) {
        await flush();
      }
    }

    await flush();
  }
}
