import { ClickHouseService } from 'src/database/clickHouse/clickHouse.service';
import { ClickHouseEventSink } from 'src/engine/core-modules/event-logs/ingest/clickhouse-event.sink';
import { type WorkspaceEventEnvelope } from 'src/engine/core-modules/event-logs/types/workspace-event-envelope.type';

const makePageview = (name: string): WorkspaceEventEnvelope => ({
  table: 'pageview',
  row: { type: 'page', name, properties: {}, timestamp: 't', version: '1' },
});

const applicationLog: WorkspaceEventEnvelope = {
  table: 'applicationLog',
  row: {
    timestamp: 't',
    workspaceId: 'w',
    applicationId: '',
    logicFunctionId: '',
    logicFunctionName: 'fn',
    executionId: 'e',
    level: 'INFO',
    message: 'm',
  },
};

describe('ClickHouseEventSink', () => {
  let sink: ClickHouseEventSink;
  let insert: jest.Mock;
  let isClientConfigured: jest.Mock;

  beforeEach(() => {
    insert = jest.fn().mockResolvedValue({ success: true });
    isClientConfigured = jest.fn().mockReturnValue(true);

    sink = new ClickHouseEventSink({
      insert,
      isClientConfigured,
    } as unknown as ClickHouseService);
  });

  it('groups envelopes by table and inserts each group once', async () => {
    const first = makePageview('a');
    const second = makePageview('b');

    await sink.write([first, second, applicationLog]);

    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenCalledWith('pageview', [first.row, second.row], {
      asyncInsertBusyTimeoutMaxMs: 100,
    });
    expect(insert).toHaveBeenCalledWith(
      'applicationLog',
      [applicationLog.row],
      undefined,
    );
  });

  it('sanitizes every event table immediately before insertion', async () => {
    const events: WorkspaceEventEnvelope[] = [
      {
        table: 'workspaceEvent',
        row: {
          type: 'track',
          event: 'workspace.member.updated',
          properties: {
            nested: { password: 'workspace-password-canary' },
            body: 'classified-workspace-content-canary',
          },
          timestamp: '2026-09-05T10:00:00.000Z',
          version: '1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
        },
      },
      {
        table: 'pageview',
        row: {
          type: 'page',
          name: '/settings/security',
          properties: {
            nested: { apiKey: 'pageview-api-key-canary' },
          },
          timestamp: '2026-09-05T10:01:00.000Z',
          version: '1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
        },
      },
      {
        table: 'objectEvent',
        row: {
          type: 'track',
          event: 'company.updated',
          properties: {
            updatedFields: ['name', 'apiToken'],
            before: { name: 'classified-before-canary' },
            nested: { apiToken: 'object-token-canary' },
          },
          timestamp: '2026-09-05T10:02:00.000Z',
          version: '1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          recordId: 'record-1',
          objectMetadataId: 'object-metadata-1',
        },
      },
      {
        table: 'usageEvent',
        row: {
          timestamp: '2026-09-05T10:03:00.000Z',
          workspaceId: 'workspace-1',
          userWorkspaceId: 'user-workspace-1',
          resourceType: 'workflow',
          operationType: 'execute',
          quantity: 1,
          unit: 'run',
          creditsUsedMicro: 100,
          resourceId: 'resource-1',
          resourceContext: 'workflow-run',
          metadata: {
            credentials: { clientSecret: 'usage-secret-canary' },
            content: 'classified-usage-content-canary',
          },
        },
      },
      {
        table: 'applicationLog',
        row: {
          timestamp: '2026-09-05T10:04:00.000Z',
          workspaceId: 'workspace-1',
          applicationId: 'application-1',
          logicFunctionId: 'logic-function-1',
          logicFunctionName: 'sendInvoice',
          executionId: 'execution-1',
          level: 'ERROR',
          message:
            'Request failed password=application-password-canary Authorization: Bearer application-bearer-canary url=https://user:application-url-password-canary@example.com',
        },
      },
    ];

    await sink.write(events);

    const insertedRowsByTable = Object.fromEntries(
      insert.mock.calls.map(([table, rows]) => [table, rows]),
    );
    const serializedRows = JSON.stringify(insertedRowsByTable);

    expect(serializedRows).not.toContain('workspace-password-canary');
    expect(serializedRows).not.toContain('classified-workspace-content-canary');
    expect(serializedRows).not.toContain('pageview-api-key-canary');
    expect(serializedRows).not.toContain('classified-before-canary');
    expect(serializedRows).not.toContain('object-token-canary');
    expect(serializedRows).not.toContain('usage-secret-canary');
    expect(serializedRows).not.toContain('classified-usage-content-canary');
    expect(serializedRows).not.toContain('application-password-canary');
    expect(serializedRows).not.toContain('application-bearer-canary');
    expect(serializedRows).not.toContain('application-url-password-canary');
    expect(insertedRowsByTable).toMatchObject({
      workspaceEvent: [
        {
          event: 'workspace.member.updated',
          timestamp: '2026-09-05T10:00:00.000Z',
          workspaceId: 'workspace-1',
          userId: 'user-1',
        },
      ],
      pageview: [
        {
          name: '/settings/security',
          timestamp: '2026-09-05T10:01:00.000Z',
          workspaceId: 'workspace-1',
          userId: 'user-1',
        },
      ],
      objectEvent: [
        {
          event: 'company.updated',
          properties: {
            updatedFields: ['name', 'apiToken'],
          },
          timestamp: '2026-09-05T10:02:00.000Z',
          recordId: 'record-1',
          objectMetadataId: 'object-metadata-1',
        },
      ],
      usageEvent: [
        {
          timestamp: '2026-09-05T10:03:00.000Z',
          workspaceId: 'workspace-1',
          userWorkspaceId: 'user-workspace-1',
          resourceType: 'workflow',
          operationType: 'execute',
          resourceId: 'resource-1',
        },
      ],
      applicationLog: [
        {
          timestamp: '2026-09-05T10:04:00.000Z',
          workspaceId: 'workspace-1',
          applicationId: 'application-1',
          logicFunctionId: 'logic-function-1',
          executionId: 'execution-1',
          level: 'ERROR',
          message:
            'Request failed password=[REDACTED] Authorization: Bearer [REDACTED] url=https://user:[REDACTED]@example.com',
        },
      ],
    });
  });

  it('no-ops when ClickHouse is not configured', async () => {
    isClientConfigured.mockReturnValue(false);

    await sink.write([makePageview('a')]);

    expect(insert).not.toHaveBeenCalled();
  });

  it('no-ops on an empty batch', async () => {
    await sink.write([]);

    expect(insert).not.toHaveBeenCalled();
  });

  it('throws when a ClickHouse insert fails so the consumer retries', async () => {
    insert.mockResolvedValue({ success: false });

    await expect(sink.write([makePageview('a')])).rejects.toThrow();
  });
});
