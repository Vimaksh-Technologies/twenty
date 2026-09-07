import { selectPendingGateRows } from 'src/modules/paryatech-crm/services/agency-pending-gate.selector';

const pendingEvent = (id: string, dueAt: string) => ({
  id,
  agencyId: 'agency-1',
  outcome: 'Pending / Unknown',
  pendingExpiresAt: new Date(dueAt),
});

const pendingException = (
  id: string,
  eventId: string,
  status: string,
  dueAt: string,
) => ({
  id,
  capability: 'Outreach',
  affectedObject: 'outreachEvent',
  affectedRecordId: eventId,
  status,
  dueAt: new Date(dueAt),
  lastTrustedState: JSON.stringify({ agencyId: 'agency-1' }),
});

describe('selectPendingGateRows', () => {
  it('should choose the earliest active gate instead of the latest Pending Event', () => {
    const olderEvent = pendingEvent('event-older', '2026-09-08T10:00:00.000Z');
    const latestEvent = pendingEvent(
      'event-latest',
      '2026-09-09T10:00:00.000Z',
    );
    const olderException = pendingException(
      'exception-older',
      'event-older',
      'New',
      '2026-09-08T10:00:00.000Z',
    );
    const resolvedLatestException = pendingException(
      'exception-latest',
      'event-latest',
      'Resolved',
      '2026-09-09T10:00:00.000Z',
    );

    expect(
      selectPendingGateRows({
        agencyId: 'agency-1',
        pendingOutreachRows: [latestEvent, olderEvent],
        exceptionsForPendingRows: [resolvedLatestException, olderException],
        activeOutreachExceptions: [olderException],
        referencedOutreachRows: [olderEvent],
      }),
    ).toEqual({
      pendingOutreachRow: olderEvent,
      pendingExceptionRow: olderException,
    });
  });

  it('should fail closed when an active exception references a missing Event', () => {
    const orphanException = pendingException(
      'exception-orphan',
      'event-missing',
      'Blocked',
      '2026-09-08T10:00:00.000Z',
    );

    expect(
      selectPendingGateRows({
        agencyId: 'agency-1',
        pendingOutreachRows: [],
        exceptionsForPendingRows: [],
        activeOutreachExceptions: [orphanException],
        referencedOutreachRows: [],
      }),
    ).toEqual({
      pendingOutreachRow: null,
      pendingExceptionRow: orphanException,
    });
  });

  it('should not keep a resolved Pending Event gated', () => {
    const event = pendingEvent('event-1', '2026-09-08T10:00:00.000Z');
    const resolvedException = pendingException(
      'exception-1',
      'event-1',
      'Resolved',
      '2026-09-08T10:00:00.000Z',
    );

    expect(
      selectPendingGateRows({
        agencyId: 'agency-1',
        pendingOutreachRows: [event],
        exceptionsForPendingRows: [resolvedException],
        activeOutreachExceptions: [],
        referencedOutreachRows: [],
      }),
    ).toEqual({
      pendingOutreachRow: null,
      pendingExceptionRow: null,
    });
  });
});
