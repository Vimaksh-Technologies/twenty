import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import {
  ParyatechCrmException,
  ParyatechCrmExceptionCode,
} from 'src/modules/paryatech-crm/exceptions/paryatech-crm.exception';
import { addBusinessDays } from 'src/modules/paryatech-crm/services/agency-contact-control-calendar';
import {
  buildEventReference,
  buildEvidenceSummary,
  buildExceptionReference,
  isEngagedOutcome,
  isFailureOutcome,
  isQualifyingContactOutcome,
  OUTREACH_CHANNELS,
  requiresContactReference,
  requiresProviderEvidenceKey,
  toPersistedOutreachOutcome,
} from 'src/modules/paryatech-crm/services/agency-contact-control.helpers';
import {
  AgencyContactControlStore,
  type AgencyActionResult,
  type AgencyContactControlTransaction,
  OUTREACH_OUTCOME,
  type PersistedOutreachOutcome,
  type RecordOutreachOutcomeParams,
} from 'src/modules/paryatech-crm/types/agency-contact-control.type';

@Injectable()
export class AgencyOutreachService {
  constructor(private readonly store: AgencyContactControlStore) {}

  async recordOutreachOutcome(
    params: RecordOutreachOutcomeParams,
  ): Promise<AgencyActionResult> {
    this.assertInput(params);
    const now = params.now ?? new Date();
    const permission = await this.store.getPermission({
      workspaceId: params.workspaceId,
      userWorkspaceId: params.userWorkspaceId,
    });

    if (!permission.canRecordOutreach) {
      throw new ParyatechCrmException(
        'Actor is not authorized for RECORD_OUTREACH_OUTCOME',
        ParyatechCrmExceptionCode.PERMISSION_DENIED,
      );
    }

    return this.store.transact(
      {
        workspaceId: params.workspaceId,
        agencyId: params.agencyId,
        contactId: params.contactId,
        providerEvidenceKey: params.providerEvidenceKey,
      },
      async (transaction) => {
        this.assertAllowed(transaction, params, now);
        await this.resumeExpiredPendingGate(transaction, params, now);
        const outreachEvent = await this.persistEvent(transaction, params);

        if (params.outcome === OUTREACH_OUTCOME.PENDING_UNKNOWN) {
          return this.applyPendingOutcome(
            transaction,
            outreachEvent.id,
            outreachEvent.eventReference,
            params,
          );
        }

        await transaction.resolvePendingException(
          outreachEvent.id,
          params.evidence,
          params.occurredAt,
        );
        const updatedAgency = await this.applyAgencyOutcome(
          transaction,
          params,
        );

        return this.toActionResult(updatedAgency, null);
      },
    );
  }

  private assertAllowed(
    transaction: AgencyContactControlTransaction,
    params: RecordOutreachOutcomeParams,
    now: Date,
  ) {
    if (transaction.agency.isSuppressed || transaction.contact?.isSuppressed) {
      throw new ParyatechCrmException(
        `Outreach is suppressed for Agency ${params.agencyId}`,
        ParyatechCrmExceptionCode.SUPPRESSED_OUTREACH,
      );
    }
    if (!this.hasActiveClaim(transaction, now)) {
      throw new ParyatechCrmException(
        `Agency ${params.agencyId} has no active reservation`,
        ParyatechCrmExceptionCode.CLAIM_NOT_ACTIVE,
      );
    }
    if (
      transaction.agency.reservationClaimantId !== params.actorWorkspaceMemberId
    ) {
      throw new ParyatechCrmException(
        `Agency ${params.agencyId} is reserved by another operator`,
        ParyatechCrmExceptionCode.CLAIM_OWNED_BY_ANOTHER_OPERATOR,
      );
    }

    const pendingEvent = transaction.unresolvedPendingOutreach;
    const pendingException = transaction.unresolvedPendingException;
    const hasPartialPendingGate =
      isDefined(pendingEvent) !== isDefined(pendingException);
    const isReconcilingPending =
      isDefined(pendingEvent) &&
      isDefined(pendingException) &&
      transaction.existingOutreach?.id === pendingEvent.id;

    if (
      hasPartialPendingGate ||
      (isDefined(pendingEvent) &&
        isDefined(pendingException) &&
        !isReconcilingPending &&
        (!isDefined(pendingEvent.pendingExpiresAt) ||
          pendingEvent.pendingExpiresAt > now))
    ) {
      throw new ParyatechCrmException(
        `Agency ${params.agencyId} has unresolved Pending / Unknown outreach`,
        ParyatechCrmExceptionCode.CLAIM_NOT_ACTIVE,
      );
    }
  }

  private async resumeExpiredPendingGate(
    transaction: AgencyContactControlTransaction,
    params: RecordOutreachOutcomeParams,
    now: Date,
  ) {
    const pendingEvent = transaction.unresolvedPendingOutreach;

    if (
      !isDefined(pendingEvent) ||
      !isDefined(transaction.unresolvedPendingException) ||
      transaction.existingOutreach?.id === pendingEvent.id ||
      !isDefined(pendingEvent.pendingExpiresAt) ||
      pendingEvent.pendingExpiresAt > now
    ) {
      return;
    }

    await transaction.updateOutreachEvent(pendingEvent.id, {
      reasonedRetry: params.reason,
    });
    await transaction.resolvePendingException(
      pendingEvent.id,
      params.evidence,
      params.occurredAt,
    );
  }

  private async persistEvent(
    transaction: AgencyContactControlTransaction,
    params: RecordOutreachOutcomeParams,
  ) {
    const persistedOutcome = toPersistedOutreachOutcome(params.outcome);
    const providerObservedAt = isDefined(params.providerEvidenceKey)
      ? params.occurredAt
      : null;

    if (!isDefined(transaction.existingOutreach)) {
      return transaction.createOutreachEvent({
        eventReference: buildEventReference(params.providerEvidenceKey),
        agencyId: params.agencyId,
        contactId: params.contactId ?? null,
        operatorId: params.actorWorkspaceMemberId,
        channel: params.channel,
        initiatedAt: params.occurredAt,
        outcome: persistedOutcome,
        providerEvidenceKey: params.providerEvidenceKey ?? null,
        providerObservedAt,
        evidenceSummary: buildEvidenceSummary(params),
        nextAction: params.nextAction.trim() || null,
        nextActionAt: params.nextActionAt ?? null,
        pendingExpiresAt: null,
        reasonedRetry: this.reasonedRetry(transaction, params),
        reservationSnapshot: this.reservationSnapshot(transaction),
      });
    }

    if (!this.canReconcileOutcome(transaction, persistedOutcome)) {
      throw new ParyatechCrmException(
        `Provider evidence ${params.providerEvidenceKey} already has outcome ${transaction.existingOutreach.outcome}`,
        transaction.existingOutreach.outcome === persistedOutcome
          ? ParyatechCrmExceptionCode.DUPLICATE_OUTREACH
          : ParyatechCrmExceptionCode.INVALID_OUTREACH_RECONCILIATION,
      );
    }

    return transaction.updateOutreachEvent(transaction.existingOutreach.id, {
      contactId: params.contactId ?? transaction.existingOutreach.contactId,
      operatorId: params.actorWorkspaceMemberId,
      channel: params.channel,
      outcome: persistedOutcome,
      providerObservedAt,
      evidenceSummary: buildEvidenceSummary(params),
      nextAction: params.nextAction.trim() || null,
      nextActionAt: params.nextActionAt ?? null,
      pendingExpiresAt: null,
      reasonedRetry: this.reasonedRetry(transaction, params),
    });
  }

  private async applyPendingOutcome(
    transaction: AgencyContactControlTransaction,
    outreachEventId: string,
    eventReference: string,
    params: RecordOutreachOutcomeParams,
  ) {
    this.assertPolicy(transaction);
    const dueAt = addBusinessDays(
      params.occurredAt,
      transaction.policy.pendingUnknownMaxBusinessDays,
      transaction.policy.businessCalendar,
    );
    await transaction.updateOutreachEvent(outreachEventId, {
      pendingExpiresAt: dueAt,
    });
    await transaction.createPendingException({
      exceptionReference: buildExceptionReference(eventReference),
      capability: 'Outreach',
      affectedObject: 'outreachEvent',
      affectedRecordId: outreachEventId,
      status: 'New',
      lastTrustedState: this.reservationSnapshot(transaction),
      ownerId: params.actorWorkspaceMemberId,
      dueAt,
      escalation: null,
      evidence: params.evidence,
      resolvedAt: null,
      resumeReason: null,
      resumedAt: null,
    });
    const updatedAgency = await transaction.updateAgency({
      firstAttemptedAt:
        transaction.agency.firstAttemptedAt ?? params.occurredAt,
      firstPendingUnknownAt:
        transaction.agency.firstPendingUnknownAt ?? params.occurredAt,
      reservationExpiresAt:
        transaction.agency.reservationExpiresAt !== null &&
        transaction.agency.reservationExpiresAt > dueAt
          ? transaction.agency.reservationExpiresAt
          : dueAt,
    });

    return this.toActionResult(updatedAgency, dueAt);
  }

  private async applyAgencyOutcome(
    transaction: AgencyContactControlTransaction,
    params: RecordOutreachOutcomeParams,
  ) {
    const qualifyingContact = isQualifyingContactOutcome(params.outcome);
    const engaged = isEngagedOutcome(params.outcome);
    const releaseReservation =
      qualifyingContact || isFailureOutcome(params.outcome);

    return transaction.updateAgency({
      firstAttemptedAt:
        transaction.agency.firstAttemptedAt ?? params.occurredAt,
      firstProviderAcceptedAt:
        params.outcome === OUTREACH_OUTCOME.PROVIDER_ACCEPTED
          ? (transaction.agency.firstProviderAcceptedAt ?? params.occurredAt)
          : transaction.agency.firstProviderAcceptedAt,
      firstContactedAt: qualifyingContact
        ? (transaction.agency.firstContactedAt ?? params.occurredAt)
        : transaction.agency.firstContactedAt,
      firstEngagedAt: engaged
        ? (transaction.agency.firstEngagedAt ?? params.occurredAt)
        : transaction.agency.firstEngagedAt,
      recordOwnerId:
        qualifyingContact && transaction.agency.recordOwnerId === null
          ? params.actorWorkspaceMemberId
          : transaction.agency.recordOwnerId,
      agencyLifecycle:
        qualifyingContact &&
        transaction.agency.agencyLifecycle === 'Imported / Uncontacted'
          ? 'Active Prospect'
          : transaction.agency.agencyLifecycle,
      reservationStatus: releaseReservation
        ? 'Released'
        : transaction.agency.reservationStatus,
      reservationClaimantId: releaseReservation
        ? null
        : transaction.agency.reservationClaimantId,
      reservationExpiresAt: releaseReservation
        ? null
        : transaction.agency.reservationExpiresAt,
      reservationReleaseReason: releaseReservation
        ? params.reason
        : transaction.agency.reservationReleaseReason,
    });
  }

  private assertInput(params: RecordOutreachOutcomeParams) {
    if (
      params.reason.trim().length === 0 ||
      params.evidence.trim().length === 0
    ) {
      throw new ParyatechCrmException(
        'Reason and evidence are required',
        ParyatechCrmExceptionCode.INVALID_OUTREACH_RECONCILIATION,
      );
    }
    if (
      !OUTREACH_CHANNELS.includes(
        params.channel as (typeof OUTREACH_CHANNELS)[number],
      )
    ) {
      throw new ParyatechCrmException(
        'Channel must use the configured U1 vocabulary',
        ParyatechCrmExceptionCode.INVALID_OUTREACH_RECONCILIATION,
      );
    }
    if (
      requiresContactReference(params.outcome) &&
      !isDefined(params.contactId)
    ) {
      throw new ParyatechCrmException(
        'A Contact reference is required for this outcome',
        ParyatechCrmExceptionCode.INVALID_OUTREACH_RECONCILIATION,
      );
    }
    if (
      requiresProviderEvidenceKey(params.outcome) &&
      !isDefined(params.providerEvidenceKey)
    ) {
      throw new ParyatechCrmException(
        'A provider evidence key is required for this outcome',
        ParyatechCrmExceptionCode.INVALID_OUTREACH_RECONCILIATION,
      );
    }
    if (params.occurredAt.getTime() > (params.now ?? new Date()).getTime()) {
      throw new ParyatechCrmException(
        'Outreach occurrence time cannot be in the future',
        ParyatechCrmExceptionCode.INVALID_OUTREACH_RECONCILIATION,
      );
    }
  }

  private assertPolicy(transaction: AgencyContactControlTransaction) {
    if (transaction.policy.pendingUnknownMaxBusinessDays !== 2) {
      throw new ParyatechCrmException(
        'Pending / Unknown maximum must be exactly two business days',
        ParyatechCrmExceptionCode.INVALID_RESERVATION_POLICY,
      );
    }
  }

  private hasActiveClaim(
    transaction: AgencyContactControlTransaction,
    now: Date,
  ) {
    const agency = transaction.agency;
    return (
      agency.reservationStatus === 'Claimed' &&
      isDefined(agency.reservationClaimantId) &&
      isDefined(agency.reservationExpiresAt) &&
      agency.reservationExpiresAt > now
    );
  }

  private canReconcileOutcome(
    transaction: AgencyContactControlTransaction,
    nextOutcome: PersistedOutreachOutcome,
  ) {
    const existingOutcome = transaction.existingOutreach?.outcome;
    return (
      isDefined(existingOutcome) &&
      existingOutcome !== nextOutcome &&
      (existingOutcome === 'Pending / Unknown' ||
        existingOutcome === 'Provider Accepted / Completed Call')
    );
  }

  private reasonedRetry(
    transaction: AgencyContactControlTransaction,
    params: RecordOutreachOutcomeParams,
  ) {
    const pendingEvent = transaction.unresolvedPendingOutreach;
    const now = params.now ?? new Date();

    return transaction.existingOutreach?.id === pendingEvent?.id &&
      isDefined(pendingEvent?.pendingExpiresAt) &&
      pendingEvent.pendingExpiresAt <= now
      ? params.reason
      : null;
  }

  private reservationSnapshot(transaction: AgencyContactControlTransaction) {
    const agency = transaction.agency;
    return JSON.stringify({
      agencyId: agency.id,
      reservationStatus: agency.reservationStatus,
      reservationClaimantId: agency.reservationClaimantId,
      reservationClaimedAt: agency.reservationClaimedAt,
      reservationExpiresAt: agency.reservationExpiresAt,
    });
  }

  private toActionResult(
    agency: AgencyContactControlTransaction['agency'],
    pendingExpiresAt: Date | null,
  ): AgencyActionResult {
    return {
      agencyId: agency.id,
      agencyLifecycle: agency.agencyLifecycle,
      reservationStatus: agency.reservationStatus,
      reservationClaimantId: agency.reservationClaimantId,
      reservationExpiresAt: agency.reservationExpiresAt,
      recordOwnerId: agency.recordOwnerId,
      pendingExpiresAt,
      firstAttemptedAt: agency.firstAttemptedAt,
      firstProviderAcceptedAt: agency.firstProviderAcceptedAt,
      firstPendingUnknownAt: agency.firstPendingUnknownAt,
      firstContactedAt: agency.firstContactedAt,
      firstEngagedAt: agency.firstEngagedAt,
    };
  }
}
