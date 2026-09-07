import { type ObjectRecordEvent } from 'twenty-shared/database-events';

import { CreateEventLogFromInternalEvent } from 'src/engine/core-modules/event-logs/ingest/create-event-log-from-internal-event';
import { WorkspaceEventSinkService } from 'src/engine/core-modules/event-logs/ingest/workspace-event-sink.service';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';

describe('CreateEventLogFromInternalEvent', () => {
  it('ingests object events (persist + live fan-out) through the sink pipeline', async () => {
    const ingest = jest.fn().mockResolvedValue(undefined);

    const handler = new CreateEventLogFromInternalEvent({
      isEnabled: () => true,
      ingest,
    } as unknown as WorkspaceEventSinkService);

    const batch = {
      name: 'company.created',
      workspaceId: 'workspace-1',
      objectMetadata: { id: 'object-metadata-1' },
      events: [{ recordId: 'record-1', userId: 'user-1', properties: {} }],
    } as unknown as WorkspaceEventBatch<ObjectRecordEvent>;

    await handler.handle(batch);

    const ingestedEnvelopes = ingest.mock.calls[0]?.[0];

    expect(ingestedEnvelopes).toHaveLength(1);
    expect(ingestedEnvelopes[0].table).toBe('objectEvent');
  });

  it('excludes classified snapshots without erasing audit metadata', async () => {
    const ingest = jest.fn().mockResolvedValue(undefined);
    const handler = new CreateEventLogFromInternalEvent({
      isEnabled: () => true,
      ingest,
    } as unknown as WorkspaceEventSinkService);
    const batch = {
      name: 'company.updated',
      workspaceId: 'workspace-1',
      objectMetadata: { id: 'object-metadata-1' },
      events: [
        {
          recordId: 'record-1',
          userId: 'user-1',
          properties: {
            updatedFields: ['name', 'apiToken', 'classification'],
            before: {
              name: 'Agency',
              apiToken: 'before-canary-secret',
              classification: 'Restricted',
            },
            after: {
              name: 'Agency Updated',
              apiToken: 'after-canary-secret',
              classification: 'Restricted',
              nested: {
                authorization: 'Bearer authorization-canary-secret',
                harmless: 'kept',
              },
            },
          },
        },
      ],
    } as unknown as WorkspaceEventBatch<ObjectRecordEvent>;

    await handler.handle(batch);

    const envelope = ingest.mock.calls[0]?.[0]?.[0];
    const serializedEnvelope = JSON.stringify(envelope);

    expect(serializedEnvelope).not.toContain('before-canary-secret');
    expect(serializedEnvelope).not.toContain('after-canary-secret');
    expect(serializedEnvelope).not.toContain('authorization-canary-secret');
    expect(envelope).toMatchObject({
      table: 'objectEvent',
      row: {
        workspaceId: 'workspace-1',
        userId: 'user-1',
        recordId: 'record-1',
        objectMetadataId: 'object-metadata-1',
        properties: {
          updatedFields: ['name', 'apiToken', 'classification'],
          before: '[REDACTED]',
          after: '[REDACTED]',
        },
      },
    });
    expect(envelope.row.timestamp).toBeDefined();
  });
});
