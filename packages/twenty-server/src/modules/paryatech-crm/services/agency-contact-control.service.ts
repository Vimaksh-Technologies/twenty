import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import {
  ParyatechCrmException,
  ParyatechCrmExceptionCode,
} from 'src/modules/paryatech-crm/exceptions/paryatech-crm.exception';
import { AgencyOutreachService } from 'src/modules/paryatech-crm/services/agency-outreach.service';
import { addBusinessMinutes } from 'src/modules/paryatech-crm/services/agency-contact-control-calendar';
import {
  AgencyContactControlStore,
  type AgencyActionResult,
  type AgencyContactControlTransaction,
  type RecordOutreachOutcomeParams,
  PARYATECH_CRM_ACTION,
  type ParyatechCrmAction,
} from 'src/modules/paryatech-crm/types/agency-contact-control.type';

@Injectable()
export class AgencyContactControlService {
  constructor(
    private readonly store: AgencyContactControlStore,
    private readonly agencyOutreachService: AgencyOutreachService,
  ) {}

  async getAvailableActions({
    workspaceId,
    userWorkspaceId,
    agencyId,
    actorWorkspaceMemberId,
    now = new Date(),
  }: {
    workspaceId: string;
    userWorkspaceId: string;
    agencyId: string;
    actorWorkspaceMemberId: string;
    now?: Date;
  }): Promise<ParyatechCrmAction[]> {
    const permission = await this.store.getPermission({
      workspaceId,
      userWorkspaceId,
    });

    return this.store.transact(
      { workspaceId, agencyId },
      async (transaction) => {
        const hasActiveClaim = this.hasActiveClaim(transaction, now);
        const ownsActiveClaim =
          hasActiveClaim &&
          transaction.agency.reservationClaimantId === actorWorkspaceMemberId;
        const pendingGate = this.hasUnresolvedPendingGate(transaction);
        const actions: ParyatechCrmAction[] = [];

        if (
          permission.canClaim &&
          !transaction.agency.isSuppressed &&
          !hasActiveClaim &&
          !pendingGate
        ) {
          actions.push(PARYATECH_CRM_ACTION.CLAIM_AGENCY);
        }
        if (permission.canRelease && ownsActiveClaim && !pendingGate) {
          actions.push(PARYATECH_CRM_ACTION.RELEASE_AGENCY);
        }
        if (
          permission.canRecordOutreach &&
          ownsActiveClaim &&
          !transaction.agency.isSuppressed
        ) {
          actions.push(PARYATECH_CRM_ACTION.RECORD_OUTREACH_OUTCOME);
        }

        return actions;
      },
    );
  }

  async claimAgency({
    workspaceId,
    userWorkspaceId,
    actorWorkspaceMemberId,
    agencyId,
    reason,
    evidence,
    now = new Date(),
  }: {
    workspaceId: string;
    userWorkspaceId: string;
    actorWorkspaceMemberId: string;
    agencyId: string;
    reason: string;
    evidence: string;
    now?: Date;
  }): Promise<AgencyActionResult> {
    this.assertEvidence(reason, evidence);
    const permission = await this.store.getPermission({
      workspaceId,
      userWorkspaceId,
    });

    if (!permission.canClaim) {
      this.throwPermissionDenied(PARYATECH_CRM_ACTION.CLAIM_AGENCY);
    }

    return this.store.transact(
      { workspaceId, agencyId },
      async (transaction) => {
        if (transaction.agency.isSuppressed) {
          throw new ParyatechCrmException(
            `Agency ${agencyId} is suppressed`,
            ParyatechCrmExceptionCode.SUPPRESSED_OUTREACH,
          );
        }
        if (this.hasUnresolvedPendingGate(transaction)) {
          throw new ParyatechCrmException(
            `Agency ${agencyId} has unresolved Pending / Unknown outreach`,
            ParyatechCrmExceptionCode.CLAIM_NOT_ACTIVE,
          );
        }
        if (this.hasActiveClaim(transaction, now)) {
          throw new ParyatechCrmException(
            `Agency ${agencyId} is claimed by ${transaction.agency.reservationClaimantId}`,
            ParyatechCrmExceptionCode.AGENCY_ALREADY_CLAIMED,
          );
        }
        this.assertReservationPolicy(transaction);

        await transaction.updateAgency({
          reservationStatus: 'Claimed',
          reservationClaimantId: actorWorkspaceMemberId,
          reservationClaimedAt: now,
          reservationExpiresAt: addBusinessMinutes(
            now,
            transaction.policy.reservationIntervalMinutes,
            transaction.policy.businessCalendar,
          ),
          reservationReleaseReason: null,
        });

        return this.toActionResult(transaction);
      },
    );
  }

  async releaseAgency({
    workspaceId,
    userWorkspaceId,
    actorWorkspaceMemberId,
    agencyId,
    reason,
    evidence,
    transferToWorkspaceMemberId,
    now = new Date(),
  }: {
    workspaceId: string;
    userWorkspaceId: string;
    actorWorkspaceMemberId: string;
    agencyId: string;
    reason: string;
    evidence: string;
    transferToWorkspaceMemberId?: string;
    now?: Date;
  }): Promise<AgencyActionResult> {
    this.assertEvidence(reason, evidence);
    const permission = await this.store.getPermission({
      workspaceId,
      userWorkspaceId,
    });

    if (!permission.canRelease) {
      this.throwPermissionDenied(PARYATECH_CRM_ACTION.RELEASE_AGENCY);
    }
    if (isDefined(transferToWorkspaceMemberId) && !permission.canTransfer) {
      this.throwPermissionDenied(PARYATECH_CRM_ACTION.RELEASE_AGENCY);
    }

    return this.store.transact(
      { workspaceId, agencyId },
      async (transaction) => {
        if (!this.hasActiveClaim(transaction, now)) {
          throw new ParyatechCrmException(
            `Agency ${agencyId} has no active reservation`,
            ParyatechCrmExceptionCode.CLAIM_NOT_ACTIVE,
          );
        }
        if (
          transaction.agency.reservationClaimantId !== actorWorkspaceMemberId &&
          !permission.canTransfer
        ) {
          throw new ParyatechCrmException(
            `Agency ${agencyId} is reserved by another operator`,
            ParyatechCrmExceptionCode.CLAIM_OWNED_BY_ANOTHER_OPERATOR,
          );
        }
        if (this.hasUnresolvedPendingGate(transaction)) {
          throw new ParyatechCrmException(
            `Agency ${agencyId} has unresolved Pending / Unknown outreach`,
            ParyatechCrmExceptionCode.CLAIM_NOT_ACTIVE,
          );
        }
        this.assertReservationPolicy(transaction);

        await transaction.updateAgency(
          isDefined(transferToWorkspaceMemberId)
            ? {
                reservationStatus: 'Claimed',
                reservationClaimantId: transferToWorkspaceMemberId,
                reservationClaimedAt: now,
                reservationExpiresAt: addBusinessMinutes(
                  now,
                  transaction.policy.reservationIntervalMinutes,
                  transaction.policy.businessCalendar,
                ),
                reservationReleaseReason: reason,
              }
            : {
                reservationStatus: 'Released',
                reservationClaimantId: null,
                reservationExpiresAt: null,
                reservationReleaseReason: reason,
              },
        );

        return this.toActionResult(transaction);
      },
    );
  }

  async recordOutreachOutcome(
    params: RecordOutreachOutcomeParams,
  ): Promise<AgencyActionResult> {
    return this.agencyOutreachService.recordOutreachOutcome(params);
  }

  async expireReservations({
    workspaceId,
    now = new Date(),
    batchSize = 100,
  }: {
    workspaceId: string;
    now?: Date;
    batchSize?: number;
  }): Promise<number> {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
      throw new ParyatechCrmException(
        `Expiry batch size ${batchSize} is outside the supported range`,
        ParyatechCrmExceptionCode.INVALID_RESERVATION_POLICY,
      );
    }
    return this.store.expireReservations({ workspaceId, now, batchSize });
  }

  private assertEvidence(reason: string, evidence: string) {
    if (reason.trim().length === 0 || evidence.trim().length === 0) {
      throw new ParyatechCrmException(
        'Reason and evidence are required',
        ParyatechCrmExceptionCode.INVALID_OUTREACH_RECONCILIATION,
      );
    }
  }

  private assertReservationPolicy(
    transaction: AgencyContactControlTransaction,
  ) {
    if (
      !Number.isInteger(transaction.policy.reservationIntervalMinutes) ||
      transaction.policy.reservationIntervalMinutes <= 0
    ) {
      throw new ParyatechCrmException(
        'Reservation interval must be a positive integer',
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

  private hasUnresolvedPendingGate(
    transaction: AgencyContactControlTransaction,
  ) {
    return (
      isDefined(transaction.unresolvedPendingOutreach) ||
      isDefined(transaction.unresolvedPendingException)
    );
  }

  private throwPermissionDenied(action: ParyatechCrmAction): never {
    throw new ParyatechCrmException(
      `Actor is not authorized for ${action}`,
      ParyatechCrmExceptionCode.PERMISSION_DENIED,
    );
  }

  private toActionResult(
    transaction: AgencyContactControlTransaction,
  ): AgencyActionResult {
    const agency = transaction.agency;
    return {
      agencyId: agency.id,
      agencyLifecycle: agency.agencyLifecycle,
      reservationStatus: agency.reservationStatus,
      reservationClaimantId: agency.reservationClaimantId,
      reservationExpiresAt: agency.reservationExpiresAt,
      recordOwnerId: agency.recordOwnerId,
      pendingExpiresAt:
        transaction.unresolvedPendingOutreach?.pendingExpiresAt ?? null,
      firstAttemptedAt: agency.firstAttemptedAt,
      firstProviderAcceptedAt: agency.firstProviderAcceptedAt,
      firstPendingUnknownAt: agency.firstPendingUnknownAt,
      firstContactedAt: agency.firstContactedAt,
      firstEngagedAt: agency.firstEngagedAt,
    };
  }
}
