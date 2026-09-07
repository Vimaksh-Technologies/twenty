import { AgencyOutreachService } from 'src/modules/paryatech-crm/services/agency-outreach.service';
import {
  ParyatechCrmException,
  ParyatechCrmExceptionCode,
} from 'src/modules/paryatech-crm/exceptions/paryatech-crm.exception';
import { AgencyContactControlService } from 'src/modules/paryatech-crm/services/agency-contact-control.service';
import {
  type AgencyContactControlPermission,
  AgencyContactControlStore,
  type AgencyContactControlTransaction,
  type AgencyContactControlTransactionOptions,
  type AgencyRecord,
  type ContactRecord,
  OUTREACH_OUTCOME,
  type OutreachEventRecord,
  type RecordOutreachOutcomeParams,
  type SharedExceptionRecord,
} from 'src/modules/paryatech-crm/types/agency-contact-control.type';
import { buildGuardedActionReceipt } from 'src/modules/paryatech-crm/services/guarded-action-receipt.service';
import {
  type GuardedActionIdentity,
  type GuardedActionReceipt,
} from 'src/modules/paryatech-crm/types/guarded-action-receipt.type';

const NOW = new Date('2026-09-04T10:00:00.000Z');
type HumanRecordOutreachOutcomeParams = Extract<
  RecordOutreachOutcomeParams,
  { apiKeyId?: never }
>;
const UNRESOLVED_STATUSES = ['New', 'Investigating', 'Blocked', 'Reopened'];

class InMemoryAgencyContactControlStore extends AgencyContactControlStore {
  agency: AgencyRecord = {
    id: 'agency-1',
    agencyLifecycle: 'Imported / Uncontacted',
    recordOwnerId: null,
    isSuppressed: false,
    reservationStatus: null,
    reservationClaimantId: null,
    reservationClaimedAt: null,
    reservationExpiresAt: null,
    reservationReleaseReason: null,
    firstAttemptedAt: null,
    firstProviderAcceptedAt: null,
    firstPendingUnknownAt: null,
    firstContactedAt: null,
    firstEngagedAt: null,
  };
  contacts: ContactRecord[] = [
    { id: 'contact-1', companyId: 'agency-1', isSuppressed: false },
  ];
  outreachEvents: OutreachEventRecord[] = [];
  exceptions: SharedExceptionRecord[] = [];
  guardedActionReceipts: GuardedActionReceipt[] = [];
  apiKeyRoles = new Map([
    ['communication-key', 'Paryatech Communication Intake'],
    ['unrelated-key', 'Paryatech Operator'],
  ]);
  permission: AgencyContactControlPermission = {
    canClaim: true,
    canRecordOutreach: true,
    canRelease: true,
    canTransfer: false,
  };
  private transactionTail = Promise.resolve();

  async getPermission(params: GuardedActionIdentity & { workspaceId: string }) {
    if (params.apiKeyId !== undefined) {
      return {
        canClaim: false,
        canRecordOutreach:
          this.apiKeyRoles.get(params.apiKeyId) ===
          'Paryatech Communication Intake',
        canRelease: false,
        canTransfer: false,
      };
    }

    return this.permission;
  }

  async transact<TData>(
    options: AgencyContactControlTransactionOptions,
    operation: (transaction: AgencyContactControlTransaction) => Promise<TData>,
  ) {
    const previous = this.transactionTail;
    let release: () => void = () => undefined;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      const existingOutreach =
        this.outreachEvents.find(
          (event) => event.providerEvidenceKey === options.providerEvidenceKey,
        ) ?? null;
      const unresolvedPendingOutreach =
        this.outreachEvents.find((event) => {
          if (
            event.agencyId !== options.agencyId ||
            event.outcome !== 'Pending / Unknown'
          ) {
            return false;
          }

          const relatedExceptions = this.exceptions.filter(
            (exception) =>
              exception.affectedObject === 'outreachEvent' &&
              exception.affectedRecordId === event.id,
          );

          return (
            relatedExceptions.length === 0 ||
            relatedExceptions.some((exception) =>
              UNRESOLVED_STATUSES.includes(exception.status),
            )
          );
        }) ?? null;
      const unresolvedPendingException =
        this.exceptions.find(
          (exception) =>
            UNRESOLVED_STATUSES.includes(exception.status) &&
            ((exception.affectedObject === 'outreachEvent' &&
              exception.affectedRecordId === unresolvedPendingOutreach?.id) ||
              (exception.affectedObject === 'company' &&
                exception.affectedRecordId === options.agencyId)),
        ) ?? null;
      const contact =
        this.contacts.find((item) => item.id === options.contactId) ?? null;

      if (options.contactId !== undefined && contact === null) {
        throw new ParyatechCrmException(
          `Contact ${options.contactId} was not found`,
          ParyatechCrmExceptionCode.CONTACT_NOT_FOUND,
        );
      }
      const transaction: AgencyContactControlTransaction = {
        agency: this.agency,
        contact,
        existingOutreach,
        unresolvedPendingOutreach,
        unresolvedPendingException,
        policy: {
          reservationIntervalMinutes: 30,
          pendingUnknownMaxBusinessDays: 2,
          businessCalendar: {
            timezone: 'UTC',
            workdays: [1, 2, 3, 4, 5],
            holidays: [],
            startTimeMinutes: 9 * 60,
            endTimeMinutes: 17 * 60,
          },
        },
        createOutreachEvent: async (event) => {
          const created = {
            ...event,
            id: `event-${this.outreachEvents.length + 1}`,
          };
          this.outreachEvents.push(created);
          return created;
        },
        updateOutreachEvent: async (id, patch) => {
          const event = this.outreachEvents.find((item) => item.id === id)!;
          Object.assign(event, patch);
          return event;
        },
        updateAgency: async (patch) => {
          Object.assign(this.agency, patch);
          return this.agency;
        },
        createPendingException: async (pendingException) => {
          this.exceptions.push({
            ...pendingException,
            id: `exception-${this.exceptions.length + 1}`,
          });
        },
        resolvePendingException: async (
          outreachEventId,
          evidence,
          resolvedAt,
        ) => {
          this.exceptions
            .filter(
              (exception) =>
                exception.affectedObject === 'outreachEvent' &&
                exception.affectedRecordId === outreachEventId &&
                UNRESOLVED_STATUSES.includes(exception.status),
            )
            .forEach((exception) => {
              Object.assign(exception, {
                status: 'Resolved',
                evidence,
                resolvedAt,
                resumeReason: 'Provider evidence reconciled',
                resumedAt: resolvedAt,
              });
            });
        },
        appendGuardedActionReceipt: async (receipt) => {
          this.guardedActionReceipts.push(
            buildGuardedActionReceipt(options.workspaceId, receipt),
          );
        },
      };

      return await operation(transaction);
    } finally {
      release();
    }
  }

  async expireReservations({
    now,
    batchSize,
  }: {
    now: Date;
    batchSize: number;
  }) {
    const hasUnresolvedPending = this.exceptions.some((exception) =>
      UNRESOLVED_STATUSES.includes(exception.status),
    );

    if (
      this.agency.reservationStatus === 'Claimed' &&
      this.agency.reservationExpiresAt !== null &&
      this.agency.reservationExpiresAt <= now &&
      !hasUnresolvedPending &&
      batchSize > 0
    ) {
      Object.assign(this.agency, {
        reservationStatus: 'Expired',
        reservationClaimantId: null,
        reservationExpiresAt: null,
        reservationReleaseReason: 'Approved reservation interval elapsed',
      });
      return 1;
    }
    return 0;
  }
}

const claim = (
  service: AgencyContactControlService,
  actorWorkspaceMemberId = 'member-1',
) =>
  service.claimAgency({
    workspaceId: 'workspace-1',
    userWorkspaceId: `user-${actorWorkspaceMemberId}`,
    actorWorkspaceMemberId,
    agencyId: 'agency-1',
    reason: 'Shared pool prospecting',
    evidence: 'Reviewed source batch 12',
    now: NOW,
  });

const recordOutcome = (
  service: AgencyContactControlService,
  outcome: RecordOutreachOutcomeParams['outcome'],
  overrides: Partial<HumanRecordOutreachOutcomeParams> = {},
) =>
  service.recordOutreachOutcome({
    workspaceId: 'workspace-1',
    userWorkspaceId: 'user-member-1',
    actorWorkspaceMemberId: 'member-1',
    agencyId: 'agency-1',
    contactId: 'contact-1',
    channel: 'Phone',
    outcome,
    occurredAt: NOW,
    providerEvidenceKey: 'provider-1',
    evidence: 'Provider event evidence',
    reason: 'Record reconciled channel outcome',
    nextAction: 'Review tomorrow',
    now: NOW,
    ...overrides,
  });

const pendingEvent = (): OutreachEventRecord => ({
  id: 'pending-event-1',
  eventReference: 'pending-event-reference-1',
  agencyId: 'agency-1',
  contactId: null,
  operatorId: 'member-1',
  channel: 'Email',
  initiatedAt: NOW,
  outcome: 'Pending / Unknown',
  providerEvidenceKey: 'pending-provider-1',
  providerObservedAt: NOW,
  evidenceSummary: 'Pending provider evidence',
  nextAction: 'Reconcile',
  nextActionAt: null,
  pendingExpiresAt: new Date('2026-09-08T10:00:00.000Z'),
  reasonedRetry: null,
  reservationSnapshot: '{}',
});

const pendingException = (): SharedExceptionRecord => ({
  id: 'pending-exception-1',
  exceptionReference: 'pending-exception-reference-1',
  capability: 'Outreach',
  affectedObject: 'company',
  affectedRecordId: 'agency-1',
  status: 'New',
  lastTrustedState: '{}',
  ownerId: 'member-1',
  dueAt: new Date('2026-09-08T10:00:00.000Z'),
  escalation: null,
  evidence: 'Pending provider evidence',
  resolvedAt: null,
  resumeReason: null,
  resumedAt: null,
});

describe('AgencyContactControlService', () => {
  let store: InMemoryAgencyContactControlStore;
  let service: AgencyContactControlService;

  beforeEach(() => {
    store = new InMemoryAgencyContactControlStore();
    const outreachService = new AgencyOutreachService(store);
    service = new AgencyContactControlService(store, outreachService);
  });

  it('should allow exactly one competing active claim', async () => {
    const results = await Promise.allSettled([
      claim(service, 'member-1'),
      claim(service, 'member-2'),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(store.agency.reservationClaimantId).toBe('member-1');
    expect(store.agency.reservationClaimedAt).toEqual(NOW);
  });

  it('should append an immutable receipt with reconstructable claim state', async () => {
    await claim(service);

    expect(store.guardedActionReceipts).toEqual([
      expect.objectContaining({
        action: 'CLAIM_AGENCY',
        actorId: 'member-1',
        actorType: 'HUMAN',
        evidenceReference: 'Reviewed source batch 12',
        occurredAt: NOW,
        priorState: expect.objectContaining({
          reservationStatus: null,
        }),
        reason: 'Shared pool prospecting',
        resultState: expect.objectContaining({
          reservationClaimantId: 'member-1',
          reservationStatus: 'Claimed',
        }),
      }),
    ]);
  });

  it('should support claimant release, administrator transfer, and bounded expiry', async () => {
    await claim(service);
    const released = await service.releaseAgency({
      workspaceId: 'workspace-1',
      userWorkspaceId: 'user-member-1',
      actorWorkspaceMemberId: 'member-1',
      agencyId: 'agency-1',
      reason: 'Finished review',
      evidence: 'No outreach made',
      now: NOW,
    });
    expect(released.reservationStatus).toBe('Released');
    expect(store.agency.reservationReleaseReason).toBe('Finished review');

    await claim(service);
    store.permission.canTransfer = true;
    const transferred = await service.releaseAgency({
      workspaceId: 'workspace-1',
      userWorkspaceId: 'admin',
      actorWorkspaceMemberId: 'admin-member',
      agencyId: 'agency-1',
      transferToWorkspaceMemberId: 'member-2',
      reason: 'Approved workload transfer',
      evidence: 'Administrator audit evidence',
      now: NOW,
    });
    expect(transferred.reservationClaimantId).toBe('member-2');
    expect(store.guardedActionReceipts.map(({ action }) => action)).toEqual([
      'CLAIM_AGENCY',
      'RELEASE_AGENCY',
      'CLAIM_AGENCY',
      'RELEASE_AGENCY',
    ]);

    store.agency.reservationExpiresAt = new Date(NOW.getTime() - 1);
    await expect(
      service.expireReservations({ workspaceId: 'workspace-1', now: NOW }),
    ).resolves.toBe(1);
    expect(store.agency.reservationStatus).toBe('Expired');
  });

  it('should reject outreach when the Agency or selected Contact is suppressed', async () => {
    await claim(service);
    store.agency.isSuppressed = true;
    await expect(
      recordOutcome(service, OUTREACH_OUTCOME.REACHED_CALL),
    ).rejects.toMatchObject({ code: 'SUPPRESSED_OUTREACH' });

    store.agency.isSuppressed = false;
    store.contacts[0].isSuppressed = true;
    await expect(
      recordOutcome(service, OUTREACH_OUTCOME.REACHED_CALL),
    ).rejects.toMatchObject({ code: 'SUPPRESSED_OUTREACH' });
    expect(store.outreachEvents).toHaveLength(0);
  });

  it('should persist exact select values while retaining observable distinctions', async () => {
    await claim(service);
    await recordOutcome(service, OUTREACH_OUTCOME.PROVIDER_ACCEPTED);

    expect(store.outreachEvents[0]).toMatchObject({
      channel: 'Phone',
      outcome: 'Provider Accepted / Completed Call',
      providerEvidenceKey: 'provider-1',
    });
    expect(store.outreachEvents[0].evidenceSummary).toContain(
      'Observed outcome: PROVIDER_ACCEPTED',
    );
    expect(store.agency.firstProviderAcceptedAt).toEqual(NOW);
    expect(store.agency.firstContactedAt).toBeNull();
    expect(store.guardedActionReceipts[1]).toMatchObject({
      action: 'RECORD_OUTREACH_OUTCOME',
      actorId: 'member-1',
      ownerId: 'member-1',
      resultState: expect.objectContaining({
        outreachEvent: expect.objectContaining({
          outcome: 'Provider Accepted / Completed Call',
        }),
      }),
    });
  });

  it('should create a two-business-day Pending gate on the Event and Shared Exception', async () => {
    await claim(service);
    const pending = await recordOutcome(
      service,
      OUTREACH_OUTCOME.PENDING_UNKNOWN,
    );

    expect(pending.pendingExpiresAt).toEqual(
      new Date('2026-09-08T10:00:00.000Z'),
    );
    expect(store.outreachEvents[0]).toMatchObject({
      outcome: 'Pending / Unknown',
      pendingExpiresAt: new Date('2026-09-08T10:00:00.000Z'),
    });
    expect(store.exceptions[0]).toMatchObject({
      capability: 'Outreach',
      affectedObject: 'outreachEvent',
      affectedRecordId: 'event-1',
      status: 'New',
    });
    expect(store.agency.firstPendingUnknownAt).toEqual(NOW);
    expect(
      await service.expireReservations({
        workspaceId: 'workspace-1',
        now: new Date('2026-09-09T10:00:00.000Z'),
      }),
    ).toBe(0);
  });

  it('should never write Converted for a qualifying Contacted outcome', async () => {
    await claim(service);
    await recordOutcome(service, OUTREACH_OUTCOME.REACHED_CALL);

    expect(store.agency.reservationStatus).toBe('Released');
    expect(store.agency.reservationStatus).not.toBe('Converted');
    expect(store.outreachEvents[0].outcome).toBe('Contacted');
    expect(store.agency.agencyLifecycle).toBe('Active Prospect');
  });

  it('should set unique-Agency milestones and durable owner only once', async () => {
    await claim(service);
    await recordOutcome(service, OUTREACH_OUTCOME.REACHED_CALL, {
      providerEvidenceKey: 'call-1',
    });
    const firstContactedAt = store.agency.firstContactedAt;

    store.agency.reservationStatus = 'Claimed';
    store.agency.reservationClaimantId = 'member-2';
    store.agency.reservationExpiresAt = new Date(NOW.getTime() + 60_000);
    await recordOutcome(service, OUTREACH_OUTCOME.TWO_WAY_CONVERSATION, {
      actorWorkspaceMemberId: 'member-2',
      userWorkspaceId: 'user-member-2',
      providerEvidenceKey: 'call-2',
      occurredAt: new Date(NOW.getTime() + 30_000),
      now: new Date(NOW.getTime() + 30_000),
    });

    expect(store.agency.recordOwnerId).toBe('member-1');
    expect(store.agency.firstContactedAt).toEqual(firstContactedAt);
    expect(store.agency.firstEngagedAt).toEqual(
      new Date(NOW.getTime() + 30_000),
    );
    expect(store.outreachEvents).toHaveLength(2);
  });

  it('should allow Agency-level Attempted evidence without a Contact', async () => {
    await claim(service);
    await recordOutcome(service, OUTREACH_OUTCOME.ATTEMPTED, {
      contactId: undefined,
      providerEvidenceKey: undefined,
      channel: 'Other',
    });

    expect(store.outreachEvents[0].contactId).toBeNull();
    expect(store.outreachEvents[0].outcome).toBe('Attempted');
  });

  it('should reject a supplied Contact reference that does not exist', async () => {
    await claim(service);

    await expect(
      recordOutcome(service, OUTREACH_OUTCOME.REACHED_CALL, {
        contactId: 'missing-contact',
      }),
    ).rejects.toMatchObject({ code: 'CONTACT_NOT_FOUND' });
    expect(store.outreachEvents).toHaveLength(0);
  });

  it('should resume an expired Pending gate on a reasoned retry with a new provider key', async () => {
    await claim(service);
    await recordOutcome(service, OUTREACH_OUTCOME.PENDING_UNKNOWN, {
      providerEvidenceKey: 'pending-provider',
    });

    const retryAt = new Date('2026-09-09T10:00:00.000Z');
    store.agency.reservationExpiresAt = new Date(
      retryAt.getTime() + 30 * 60_000,
    );
    await recordOutcome(service, OUTREACH_OUTCOME.REACHED_CALL, {
      providerEvidenceKey: 'definitive-provider',
      reason: 'Pending deadline elapsed; provider evidence now definitive',
      occurredAt: retryAt,
      now: retryAt,
    });

    expect(store.outreachEvents[0].reasonedRetry).toBe(
      'Pending deadline elapsed; provider evidence now definitive',
    );
    expect(store.exceptions[0].status).toBe('Resolved');
    expect(store.agency.reservationStatus).toBe('Released');
    await expect(
      service.getAvailableActions({
        workspaceId: 'workspace-1',
        userWorkspaceId: 'user-member-1',
        actorWorkspaceMemberId: 'member-1',
        agencyId: 'agency-1',
        now: retryAt,
      }),
    ).resolves.toContain('CLAIM_AGENCY');
  });

  it.each([
    ['Pending Event only', true, false],
    ['unresolved Shared Exception only', false, true],
  ])(
    'should fail closed when only the %s remains',
    async (_caseName, hasEvent, hasException) => {
      if (hasEvent) {
        store.outreachEvents.push(pendingEvent());
      }
      if (hasException) {
        store.exceptions.push(pendingException());
      }

      await expect(claim(service)).rejects.toMatchObject({
        code: 'CLAIM_NOT_ACTIVE',
      });
    },
  );

  it('should allow only the dedicated communication API key to record provider outreach', async () => {
    await claim(service);

    await service.recordOutreachOutcome({
      apiKeyId: 'communication-key',
      workspaceId: 'workspace-1',
      agencyId: 'agency-1',
      contactId: 'contact-1',
      channel: 'Phone',
      outcome: OUTREACH_OUTCOME.REACHED_CALL,
      occurredAt: NOW,
      providerEvidenceKey: 'provider-api-1',
      evidence: 'Provider callback signature and payload hash.',
      reason: 'Reconcile communication provider callback.',
      nextAction: 'Review outcome',
      now: NOW,
    });

    expect(store.outreachEvents[0].operatorId).toBe('member-1');
    expect(store.guardedActionReceipts[1]).toMatchObject({
      actorId: 'communication-key',
      actorType: 'API_KEY',
      ownerId: 'member-1',
    });
    await expect(
      service.recordOutreachOutcome({
        apiKeyId: 'unrelated-key',
        workspaceId: 'workspace-1',
        agencyId: 'agency-1',
        contactId: 'contact-1',
        channel: 'Phone',
        outcome: OUTREACH_OUTCOME.REACHED_CALL,
        occurredAt: NOW,
        providerEvidenceKey: 'provider-api-2',
        evidence: 'Unrelated key provider callback.',
        reason: 'Attempt unrelated API-key mutation.',
        nextAction: 'None',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('should deny forged unavailable actions before any state change', async () => {
    store.permission = {
      canClaim: false,
      canRecordOutreach: false,
      canRelease: false,
      canTransfer: false,
    };

    await expect(claim(service)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(store.agency.reservationStatus).toBeNull();
    await expect(
      service.getAvailableActions({
        workspaceId: 'workspace-1',
        userWorkspaceId: 'denied',
        actorWorkspaceMemberId: 'member-1',
        agencyId: 'agency-1',
        now: NOW,
      }),
    ).resolves.toEqual([]);
  });
});
