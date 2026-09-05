import { Injectable } from '@nestjs/common';

import {
  ParyatechCrmException,
  ParyatechCrmExceptionCode,
} from 'src/modules/paryatech-crm/exceptions/paryatech-crm.exception';
import {
  assertActorRole,
  assertExpectedState,
  assertReasonAndEvidence,
  assertRecord,
  isNonEmptyText,
  requireDate,
  requireIds,
  requireText,
  toTransitionResult,
} from 'src/modules/paryatech-crm/services/guarded-transition.helpers';
import {
  type OpportunityStage,
  PARYATECH_ROLE,
  type ParyatechRecord,
  ParyatechTransitionStore,
  type ParyatechTransitionTransaction,
  type TransitionOpportunityParams,
} from 'src/modules/paryatech-crm/types/paryatech-transition.type';

const COMMERCIAL_STAGES: OpportunityStage[] = [
  'Negotiation',
  'Awaiting Payment',
  'Paid / Won',
];
const ACTIVE_TRIAL_STATES = ['Approved', 'Active'] as const;
const LOSS_SOURCE_STAGES: OpportunityStage[] = [
  'Qualified',
  'Demo Scheduled',
  'Demo Completed',
  'Proposal / Commercial Decision',
  'Negotiation',
  'Awaiting Payment',
];

const TRANSITION_CORRECTIONS: Partial<Record<OpportunityStage, string>> = {
  'Demo Scheduled':
    'Add participating Contact, demo date, owner, and dated next action.',
  'Demo Completed':
    'Record occurred-at, attendees, Product, outcome, and dated next action.',
  'Proposal / Commercial Decision':
    'Record demo or trial outcome and commercial decision evidence.',
  Negotiation:
    'Record delivered proposal, open commercial issue, owner, and dated next action.',
  'Awaiting Payment':
    'Correct Agreement, accepted terms, payment obligation, and dated next action.',
  'Paid / Won':
    'Reconcile current Paid evidence or an authorized Waived Agreement.',
  Lost: 'Record loss reason, decision date, evidence, and revisit date when relevant.',
};

@Injectable()
export class OpportunityTransitionService {
  constructor(private readonly store: ParyatechTransitionStore) {}

  async transition(params: TransitionOpportunityParams) {
    assertReasonAndEvidence(params);

    return this.store.transact(
      {
        workspaceId: params.workspaceId,
        objectName: 'opportunity',
        recordId: params.opportunityId,
      },
      async (transaction) => {
        const opportunity = assertRecord(
          transaction.record,
          'opportunity',
          params.opportunityId,
        );
        const roleLabel = await this.store.getActorRoleLabel(params);
        const needsCommercialRole =
          COMMERCIAL_STAGES.includes(params.targetStage) ||
          params.targetTrialState != null ||
          ACTIVE_TRIAL_STATES.includes(
            opportunity.trialState as (typeof ACTIVE_TRIAL_STATES)[number],
          );
        assertActorRole(
          roleLabel,
          needsCommercialRole
            ? [PARYATECH_ROLE.COMMERCIAL_SENSITIVE]
            : [PARYATECH_ROLE.OPERATOR, PARYATECH_ROLE.COMMERCIAL_SENSITIVE],
        );
        assertExpectedState(opportunity.stage, params.expectedStage);
        this.assertOwner(
          opportunity,
          params.actorWorkspaceMemberId,
          params.targetStage,
        );

        const patch = await this.buildPatch(transaction, opportunity, params);
        await transaction.update('opportunity', params.opportunityId, patch);
        await this.applyAgencyEffect(transaction, opportunity, params);

        return toTransitionResult(
          params.opportunityId,
          'opportunity',
          params.targetStage,
          TRANSITION_CORRECTIONS[params.targetStage] ?? null,
        );
      },
    );
  }

  private assertOwner(
    opportunity: ParyatechRecord,
    actorWorkspaceMemberId: string,
    targetStage: OpportunityStage,
  ) {
    if (
      targetStage !== 'Paid / Won' &&
      opportunity.ownerId !== actorWorkspaceMemberId
    ) {
      throw new ParyatechCrmException(
        'Only the accountable Opportunity owner may perform this transition',
        ParyatechCrmExceptionCode.PERMISSION_DENIED,
      );
    }
  }

  private async buildPatch(
    transaction: ParyatechTransitionTransaction,
    opportunity: ParyatechRecord,
    params: TransitionOpportunityParams,
  ): Promise<Record<string, unknown>> {
    if (params.targetTrialState === 'Approved') {
      return this.buildTrialApprovalPatch(opportunity, params);
    }

    if (
      opportunity.stage === 'Demo Completed' &&
      opportunity.trialState === 'Approved' &&
      params.expectedStage === params.targetStage &&
      params.targetTrialState === 'Active'
    ) {
      return { trialState: 'Active' };
    }

    if (
      ACTIVE_TRIAL_STATES.includes(
        opportunity.trialState as (typeof ACTIVE_TRIAL_STATES)[number],
      )
    ) {
      return this.buildTrialExitPatch(transaction, opportunity, params);
    }

    const key = `${params.expectedStage}->${params.targetStage}`;
    switch (key) {
      case 'Qualified->Demo Scheduled':
        return this.buildDemoScheduledPatch(params);
      case 'Demo Scheduled->Demo Completed':
        return this.buildDemoCompletedPatch(params);
      case 'Demo Completed->Proposal / Commercial Decision':
        return this.buildProposalPatch(params);
      case 'Proposal / Commercial Decision->Negotiation':
        return this.buildNegotiationPatch(params);
      case 'Negotiation->Proposal / Commercial Decision':
        return this.buildNegotiationReturnPatch(params);
      case 'Proposal / Commercial Decision->Awaiting Payment':
      case 'Negotiation->Awaiting Payment':
        return this.buildAwaitingPaymentPatch(transaction, opportunity, params);
      case 'Awaiting Payment->Paid / Won':
        return this.buildWonPatch(transaction, opportunity, params);
      default:
        if (
          LOSS_SOURCE_STAGES.includes(params.expectedStage) &&
          params.targetStage === 'Lost'
        ) {
          return this.buildLostPatch(params);
        }
        if (
          params.expectedStage === 'Lost' &&
          LOSS_SOURCE_STAGES.includes(params.targetStage)
        ) {
          return {
            stage: params.targetStage,
            nextAction: requireText(params.nextAction, 'nextAction'),
            nextActionAt: requireDate(params.nextActionAt, 'nextActionAt'),
          };
        }
        throw this.notAllowed(params);
    }
  }

  private buildDemoScheduledPatch(params: TransitionOpportunityParams) {
    return {
      stage: params.targetStage,
      contacts: requireIds(params.participatingContactIds, 'contacts').map(
        (id) => ({ id }),
      ),
      demoScheduledAt: requireDate(params.demoScheduledAt, 'demoScheduledAt'),
      nextAction: requireText(params.nextAction, 'nextAction'),
      nextActionAt: requireDate(params.nextActionAt, 'nextActionAt'),
    };
  }

  private buildDemoCompletedPatch(params: TransitionOpportunityParams) {
    return {
      stage: params.targetStage,
      demoOccurredAt: requireDate(params.demoOccurredAt, 'demoOccurredAt'),
      demoAttendees: requireIds(params.demoAttendeeIds, 'demoAttendees').map(
        (id) => ({ id }),
      ),
      products: requireIds(params.productIds, 'products').map((id) => ({ id })),
      demoOutcome: requireText(params.demoOutcome, 'demoOutcome'),
      nextAction: requireText(params.nextAction, 'nextAction'),
      nextActionAt: requireDate(params.nextActionAt, 'nextActionAt'),
    };
  }

  private buildProposalPatch(params: TransitionOpportunityParams) {
    return {
      stage: params.targetStage,
      contacts: requireIds(params.participatingContactIds, 'contacts').map(
        (id) => ({ id }),
      ),
      products: requireIds(params.productIds, 'products').map((id) => ({ id })),
      demoOutcome: requireText(params.demoOutcome, 'demoOutcome'),
      commercialDecisionContext: requireText(
        params.commercialDecisionContext,
        'commercialDecisionContext',
      ),
      nextAction: requireText(params.nextAction, 'nextAction'),
      nextActionAt: requireDate(params.nextActionAt, 'nextActionAt'),
    };
  }

  private buildTrialApprovalPatch(
    opportunity: ParyatechRecord,
    params: TransitionOpportunityParams,
  ) {
    if (
      opportunity.stage !== 'Demo Completed' ||
      opportunity.trialState != null
    ) {
      throw this.notAllowed(params);
    }
    requireText(params.trialApprovalEvidence, 'trialApprovalEvidence');
    const trialOwnerId = requireText(params.trialOwnerId, 'trialOwner');
    if (trialOwnerId !== params.actorWorkspaceMemberId) {
      throw new ParyatechCrmException(
        'Trial owner must be the accountable actor',
        ParyatechCrmExceptionCode.PERMISSION_DENIED,
      );
    }
    const startsAt = requireDate(params.trialStartsAt, 'trialStartsAt');
    const endsAt = requireDate(params.trialEndsAt, 'trialEndsAt');
    if (endsAt <= startsAt) {
      throw new ParyatechCrmException(
        'Trial end must be after its start',
        ParyatechCrmExceptionCode.EVIDENCE_REQUIRED,
      );
    }

    return {
      trialState: 'Approved',
      trialReason: requireText(params.trialReason, 'trialReason'),
      trialOwnerId,
      trialStartsAt: startsAt,
      trialEndsAt: endsAt,
      trialSuccessCriteria: requireText(
        params.trialSuccessCriteria,
        'trialSuccessCriteria',
      ),
      trialExpectedDecision: requireText(
        params.trialExpectedDecision,
        'trialExpectedDecision',
      ),
      products: requireIds(params.productIds, 'products').map((id) => ({ id })),
    };
  }

  private async buildTrialExitPatch(
    transaction: ParyatechTransitionTransaction,
    opportunity: ParyatechRecord,
    params: TransitionOpportunityParams,
  ) {
    const targetTrialState = params.targetTrialState;
    if (
      targetTrialState !== 'Completed' &&
      targetTrialState !== 'Expired' &&
      targetTrialState !== 'Cancelled'
    ) {
      throw this.notAllowed(params);
    }
    const trialOutcome = requireText(params.trialOutcome, 'trialOutcome');
    if (params.targetStage === 'Proposal / Commercial Decision') {
      return {
        stage: params.targetStage,
        trialState: targetTrialState,
        trialOutcome,
      };
    }
    if (params.targetStage === 'Awaiting Payment') {
      return {
        ...(await this.buildAwaitingPaymentPatch(
          transaction,
          opportunity,
          params,
        )),
        trialState: targetTrialState,
        trialOutcome,
      };
    }
    if (params.targetStage === 'Lost') {
      return {
        ...this.buildLostPatch(params),
        trialState: targetTrialState,
        trialOutcome,
      };
    }
    throw this.notAllowed(params);
  }

  private buildNegotiationPatch(params: TransitionOpportunityParams) {
    if (
      !params.proposalDeliveredAt &&
      !isNonEmptyText(params.commercialDecisionContext)
    ) {
      requireText(
        undefined,
        'proposalDeliveredAt or commercialDecisionContext',
      );
    }
    return {
      stage: params.targetStage,
      proposalDeliveredAt: params.proposalDeliveredAt,
      commercialDecisionContext: params.commercialDecisionContext,
      nextAction: requireText(params.nextAction, 'nextAction'),
      nextActionAt: requireDate(params.nextActionAt, 'nextActionAt'),
    };
  }

  private buildNegotiationReturnPatch(params: TransitionOpportunityParams) {
    return {
      stage: params.targetStage,
      commercialDecisionContext: requireText(
        params.commercialDecisionContext,
        'commercialDecisionContext',
      ),
      nextAction: requireText(params.nextAction, 'nextAction'),
      nextActionAt: requireDate(params.nextActionAt, 'nextActionAt'),
    };
  }

  private async buildAwaitingPaymentPatch(
    transaction: ParyatechTransitionTransaction,
    opportunity: ParyatechRecord,
    params: TransitionOpportunityParams,
  ) {
    const agreement = await this.requireMatchingAgreement(
      transaction,
      opportunity,
      params.agreementId,
    );
    if (
      !['Pending', 'Part-paid', 'Overdue'].includes(
        String(agreement.paymentState),
      )
    ) {
      throw new ParyatechCrmException(
        'Agreement is not in an awaiting-payment state',
        ParyatechCrmExceptionCode.COMMERCIAL_EVIDENCE_INVALID,
      );
    }
    return {
      stage: params.targetStage,
      agreementId: agreement.id,
      commercialDecisionContext: requireText(
        params.acceptedTermsEvidence,
        'acceptedTermsEvidence',
      ),
      nextAction: requireText(params.nextAction, 'nextAction'),
      nextActionAt: requireDate(params.nextActionAt, 'nextActionAt'),
    };
  }

  private async buildWonPatch(
    transaction: ParyatechTransitionTransaction,
    opportunity: ParyatechRecord,
    params: TransitionOpportunityParams,
  ) {
    const agreement = await this.requireMatchingAgreement(
      transaction,
      opportunity,
      params.agreementId,
    );
    const paymentState = String(agreement.paymentState);
    const verifiedPaid =
      paymentState === 'Paid' && agreement.evidenceState === 'Current';
    const authorizedWaiver =
      paymentState === 'Waived' &&
      agreement.evidenceState === 'Current' &&
      isNonEmptyText(agreement.commercialException);
    if (!verifiedPaid && !authorizedWaiver) {
      throw new ParyatechCrmException(
        `Agreement payment ${paymentState} cannot support Paid / Won`,
        ParyatechCrmExceptionCode.COMMERCIAL_EVIDENCE_INVALID,
      );
    }
    return { stage: params.targetStage, agreementId: agreement.id };
  }

  private buildLostPatch(params: TransitionOpportunityParams) {
    if (params.futureFollowUp && !params.revisitAt) {
      requireDate(undefined, 'revisitAt');
    }
    return {
      stage: 'Lost',
      lossReason: requireText(params.lossReason, 'lossReason'),
      lossDecisionAt: requireDate(params.lossDecisionAt, 'lossDecisionAt'),
      revisitAt: params.revisitAt ?? null,
    };
  }

  private async requireMatchingAgreement(
    transaction: ParyatechTransitionTransaction,
    opportunity: ParyatechRecord,
    agreementId: string | undefined,
  ) {
    requireText(opportunity.primarySourceId, 'primarySource');
    const id = requireText(agreementId, 'agreement');
    const agreement = await transaction.getRequired('commercialAgreement', id);
    if (
      agreement.sourceOpportunityId !== opportunity.id ||
      agreement.agencyId !== opportunity.companyId
    ) {
      throw new ParyatechCrmException(
        'Agreement does not belong to this Opportunity and Agency',
        ParyatechCrmExceptionCode.COMMERCIAL_EVIDENCE_INVALID,
      );
    }
    return agreement;
  }

  private async applyAgencyEffect(
    transaction: ParyatechTransitionTransaction,
    opportunity: ParyatechRecord,
    params: TransitionOpportunityParams,
  ) {
    if (!isNonEmptyText(opportunity.companyId)) {
      return;
    }
    if (params.targetStage === 'Paid / Won') {
      await transaction.update('company', opportunity.companyId, {
        agencyLifecycle: 'Customer',
      });
    }
    if (params.targetStage === 'Lost' && params.futureFollowUp === true) {
      await transaction.update('company', opportunity.companyId, {
        agencyDisposition: 'Nurture',
      });
    }
  }

  private notAllowed(params: TransitionOpportunityParams) {
    return new ParyatechCrmException(
      `Transition ${params.expectedStage} -> ${params.targetStage} is not listed`,
      ParyatechCrmExceptionCode.TRANSITION_NOT_ALLOWED,
    );
  }
}
