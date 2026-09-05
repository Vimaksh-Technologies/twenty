import { REQUIRED_FIELDS_BY_OBJECT } from 'src/modules/paryatech-crm/services/agency-contact-control.schema';

describe('Paryatech CRM contact-control schema contract', () => {
  it('should require the canonical U1 field names', () => {
    expect(REQUIRED_FIELDS_BY_OBJECT).toEqual({
      company: [
        'agencyLifecycle',
        'recordOwner',
        'isSuppressed',
        'reservationStatus',
        'reservationClaimant',
        'reservationClaimedAt',
        'reservationExpiresAt',
        'reservationReleaseReason',
        'firstAttemptedAt',
        'firstProviderAcceptedAt',
        'firstPendingUnknownAt',
        'firstContactedAt',
        'firstEngagedAt',
      ],
      person: ['isSuppressed'],
      outreachEvent: [
        'eventReference',
        'agency',
        'contact',
        'operator',
        'channel',
        'initiatedAt',
        'outcome',
        'providerEvidenceKey',
        'providerObservedAt',
        'evidenceSummary',
        'nextAction',
        'nextActionAt',
        'pendingExpiresAt',
        'reasonedRetry',
        'reservationSnapshot',
      ],
      sharedException: [
        'exceptionReference',
        'capability',
        'affectedObject',
        'affectedRecordId',
        'status',
        'lastTrustedState',
        'owner',
        'dueAt',
        'escalation',
        'evidence',
        'resolvedAt',
        'resumeReason',
        'resumedAt',
      ],
      crmOperatingPolicy: [
        'active',
        'businessCalendar',
        'pendingUnknownMaxBusinessDays',
        'reservationIntervalMinutes',
      ],
    });
  });
});
