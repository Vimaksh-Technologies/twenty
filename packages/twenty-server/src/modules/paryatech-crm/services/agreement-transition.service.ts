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
  requireText,
  toTransitionResult,
} from 'src/modules/paryatech-crm/services/guarded-transition.helpers';
import {
  type ActivationState,
  type AdoptionState,
  PARYATECH_ROLE,
  type PaymentState,
  ParyatechTransitionStore,
  type ParyatechTransitionTransaction,
  type RenewalState,
  type TransitionAgreementParams,
} from 'src/modules/paryatech-crm/types/paryatech-transition.type';

const PAYMENT_TRANSITIONS: Record<PaymentState, readonly PaymentState[]> = {
  Pending: ['Part-paid', 'Paid', 'Overdue', 'Waived'],
  'Part-paid': ['Paid', 'Overdue', 'Waived'],
  Paid: ['Refunded', 'Reversed'],
  Overdue: ['Part-paid', 'Paid', 'Waived'],
  Waived: [],
  Refunded: [],
  Reversed: [],
};
const RENEWAL_TRANSITIONS: Record<RenewalState, readonly RenewalState[]> = {
  Renewing: ['Renewed', 'Changed', 'Not Renewing', 'Lapsed'],
  Renewed: ['Renewing'],
  Changed: ['Renewing'],
  'Not Renewing': [],
  Lapsed: ['Renewing'],
};
const ACTIVATION_TRANSITIONS: Record<
  ActivationState,
  readonly ActivationState[]
> = {
  Pending: ['Confirmed', 'Review Required'],
  Confirmed: ['Review Required'],
  'Review Required': ['Confirmed'],
};
const ADOPTION_TRANSITIONS: Record<AdoptionState, readonly AdoptionState[]> = {
  'Not Assessed': ['Evidence Tracking'],
  'Evidence Tracking': ['Milestone Recorded'],
  'Milestone Recorded': [],
};

@Injectable()
export class AgreementTransitionService {
  constructor(private readonly store: ParyatechTransitionStore) {}

  async transition(params: TransitionAgreementParams) {
    assertReasonAndEvidence(params);
    this.assertCommonEvidence(params);

    return this.store.transact(
      {
        workspaceId: params.workspaceId,
        objectName: 'commercialAgreement',
        recordId: params.agreementId,
      },
      async (transaction) => {
        const agreement = assertRecord(
          transaction.record,
          'commercialAgreement',
          params.agreementId,
        );
        assertActorRole(await this.store.getActorRoleLabel(params), [
          PARYATECH_ROLE.COMMERCIAL_SENSITIVE,
        ]);
        const stateField = this.stateField(params.transition);
        assertExpectedState(agreement[stateField], params.expectedState);
        if (
          params.evidenceState === 'Conflict' &&
          !(
            params.transition === 'ACTIVATION' &&
            params.targetState === 'Review Required'
          )
        ) {
          return this.recordAuthorityConflict(transaction, agreement, params);
        }
        const patch = await this.buildPatch(transaction, agreement, params);
        await transaction.update('commercialAgreement', params.agreementId, {
          ...patch,
          evidenceSource: params.evidenceSource.trim(),
          evidenceType: params.evidenceType.trim(),
          evidenceVerifierId: params.evidenceVerifierId,
          evidenceObservedAt: params.evidenceObservedAt,
          evidenceRecordedAt: params.now ?? new Date(),
          evidenceState: params.evidenceState,
        });

        return toTransitionResult(
          params.agreementId,
          'commercialAgreement',
          params.targetState,
        );
      },
    );
  }

  private assertCommonEvidence(params: TransitionAgreementParams) {
    requireText(params.evidenceSource, 'evidenceSource');
    requireText(params.evidenceType, 'evidenceType');
    requireDate(params.evidenceObservedAt, 'evidenceObservedAt');
    if (params.evidenceVerifierId !== params.actorWorkspaceMemberId) {
      throw new ParyatechCrmException(
        'The acting commercial verifier must own this evidence change',
        ParyatechCrmExceptionCode.PERMISSION_DENIED,
      );
    }
  }

  private stateField(transition: TransitionAgreementParams['transition']) {
    switch (transition) {
      case 'PAYMENT':
        return 'paymentState';
      case 'RENEWAL':
        return 'renewalState';
      case 'ACTIVATION':
        return 'activationState';
      case 'ADOPTION':
        return 'adoptionState';
    }
  }

  private async buildPatch(
    transaction: ParyatechTransitionTransaction,
    agreement: Record<string, unknown> & { id: string },
    params: TransitionAgreementParams,
  ) {
    switch (params.transition) {
      case 'PAYMENT':
        return this.buildPaymentPatch(transaction, agreement, params);
      case 'RENEWAL':
        return this.buildRenewalPatch(agreement, params);
      case 'ACTIVATION':
        return this.buildActivationPatch(agreement, params);
      case 'ADOPTION':
        return this.buildAdoptionPatch(params);
    }
  }

  private async buildPaymentPatch(
    transaction: ParyatechTransitionTransaction,
    agreement: Record<string, unknown> & { id: string },
    params: TransitionAgreementParams,
  ) {
    const current = params.expectedState as PaymentState;
    const target = params.targetState as PaymentState;
    this.assertListedTransition(PAYMENT_TRANSITIONS[current], target, params);
    if (params.evidenceState !== 'Current') {
      throw new ParyatechCrmException(
        'Payment evidence must be Current before changing payment state',
        ParyatechCrmExceptionCode.COMMERCIAL_EVIDENCE_INVALID,
      );
    }

    const grossBooked = this.money(agreement.grossBooked, 'grossBooked');
    const existingCollected = this.optionalMoney(agreement.amountCollected);
    const existingAdjustment = this.optionalMoney(
      agreement.refundedOrReversedAmount,
    );
    const patch: Record<string, unknown> = { paymentState: target };

    if (target === 'Part-paid' || target === 'Paid') {
      const collected = this.money(params.amountCollected, 'amountCollected');
      if (
        collected <= 0 ||
        collected > grossBooked ||
        (target === 'Paid' && collected !== grossBooked)
      ) {
        throw this.invalidCommercialEvidence(
          'Collected amount does not match the target state',
        );
      }
      Object.assign(patch, {
        amountCollected: collected,
        netCollected: collected - existingAdjustment,
      });
    }
    if (target === 'Waived') {
      const waived = this.money(params.waivedAmount, 'waivedAmount');
      if (
        waived <= 0 ||
        waived > grossBooked ||
        waived + existingCollected !== grossBooked ||
        !isNonEmptyText(params.authorizationEvidence)
      ) {
        throw this.invalidCommercialEvidence(
          'Waiver requires an authorized amount and evidence',
        );
      }
      Object.assign(patch, {
        waivedAmount: waived,
        commercialException: params.authorizationEvidence?.trim(),
        netCollected: existingCollected - existingAdjustment,
      });
    }
    if (target === 'Refunded' || target === 'Reversed') {
      const adjustment = this.money(
        params.refundedOrReversedAmount,
        'refundedOrReversedAmount',
      );
      if (adjustment <= 0 || adjustment > existingCollected) {
        throw this.invalidCommercialEvidence(
          'Refund or reversal exceeds collected value',
        );
      }
      Object.assign(patch, {
        refundedOrReversedAmount: adjustment,
        netCollected: existingCollected - adjustment,
        activationState: 'Review Required',
      });
      await this.createCommercialReview(transaction, agreement, params, target);
    }

    return patch;
  }

  private buildRenewalPatch(
    agreement: Record<string, unknown>,
    params: TransitionAgreementParams,
  ) {
    const current = params.expectedState as RenewalState;
    const target = params.targetState as RenewalState;
    this.assertListedTransition(RENEWAL_TRANSITIONS[current], target, params);
    if (agreement.renewalOwnerId !== params.actorWorkspaceMemberId) {
      throw new ParyatechCrmException(
        'Only the assigned renewal owner may perform this transition',
        ParyatechCrmExceptionCode.PERMISSION_DENIED,
      );
    }
    return {
      renewalState: target,
      renewalNextAction: requireText(
        params.renewalNextAction,
        'renewalNextAction',
      ),
      renewalNextActionAt: requireDate(
        params.renewalNextActionAt,
        'renewalNextActionAt',
      ),
    };
  }

  private buildActivationPatch(
    agreement: Record<string, unknown>,
    params: TransitionAgreementParams,
  ) {
    const current = params.expectedState as ActivationState;
    const target = params.targetState as ActivationState;
    this.assertListedTransition(
      ACTIVATION_TRANSITIONS[current],
      target,
      params,
    );
    if (target === 'Confirmed') {
      if (params.evidenceState !== 'Current') {
        throw this.invalidCommercialEvidence(
          'Activation confirmation requires Current evidence',
        );
      }
      if (params.activationConfirmerId !== params.actorWorkspaceMemberId) {
        throw new ParyatechCrmException(
          'The authenticated actor must confirm activation',
          ParyatechCrmExceptionCode.PERMISSION_DENIED,
        );
      }
      if (!['Paid', 'Waived'].includes(String(agreement.paymentState))) {
        throw this.invalidCommercialEvidence(
          'Activation confirmation requires settled commercial evidence',
        );
      }
      return {
        activationState: target,
        activationConfirmedAt: requireDate(
          params.activationConfirmedAt,
          'activationConfirmedAt',
        ),
        activationConfirmerId: requireText(
          params.activationConfirmerId,
          'activationConfirmer',
        ),
      };
    }
    if (
      target === 'Review Required' &&
      !['Refunded', 'Reversed'].includes(String(agreement.paymentState)) &&
      params.evidenceState !== 'Conflict'
    ) {
      throw this.invalidCommercialEvidence(
        'Activation review requires a refund, reversal, or conflict',
      );
    }
    return { activationState: target };
  }

  private buildAdoptionPatch(params: TransitionAgreementParams) {
    const current = params.expectedState as AdoptionState;
    const target = params.targetState as AdoptionState;
    this.assertListedTransition(ADOPTION_TRANSITIONS[current], target, params);
    return {
      adoptionState: target,
      adoptionEvidence: requireText(
        params.adoptionEvidence,
        'adoptionEvidence',
      ),
      adoptionObservedAt: requireDate(
        params.adoptionObservedAt,
        'adoptionObservedAt',
      ),
    };
  }

  private async createCommercialReview(
    transaction: ParyatechTransitionTransaction,
    agreement: Record<string, unknown> & { id: string },
    params: TransitionAgreementParams,
    target: 'Refunded' | 'Reversed',
  ) {
    const now = params.now ?? new Date();
    await transaction.create('sharedException', {
      exceptionReference: `commercial:${agreement.id}:${now.toISOString()}`,
      capability: 'Commercial',
      affectedObject: 'commercialAgreement',
      affectedRecordId: agreement.id,
      status: 'New',
      lastTrustedState: JSON.stringify({
        paymentState: params.expectedState,
        grossBooked: agreement.grossBooked,
        amountCollected: agreement.amountCollected,
        netCollected: agreement.netCollected,
      }),
      ownerId: params.actorWorkspaceMemberId,
      dueAt: null,
      escalation: `${target} evidence requires commercial and entitlement review.`,
      evidence: params.evidence.trim(),
      resolvedAt: null,
      resumeReason: null,
      resumedAt: null,
    });
  }

  private async recordAuthorityConflict(
    transaction: ParyatechTransitionTransaction,
    agreement: Record<string, unknown> & { id: string },
    params: TransitionAgreementParams,
  ) {
    const exceptionReference = [
      'commercial-conflict',
      agreement.id,
      params.transition,
      params.evidenceObservedAt.toISOString(),
    ].join(':');
    const existingException = await transaction.findOne('sharedException', {
      exceptionReference,
    });
    if (!existingException) {
      await transaction.create('sharedException', {
        exceptionReference,
        capability: 'Commercial',
        affectedObject: 'commercialAgreement',
        affectedRecordId: agreement.id,
        status: 'New',
        lastTrustedState: JSON.stringify({
          paymentState: agreement.paymentState,
          renewalState: agreement.renewalState,
          activationState: agreement.activationState,
          adoptionState: agreement.adoptionState,
          evidenceSource: agreement.evidenceSource,
          evidenceType: agreement.evidenceType,
          evidenceObservedAt: agreement.evidenceObservedAt,
          evidenceState: agreement.evidenceState,
        }),
        ownerId: params.actorWorkspaceMemberId,
        dueAt: null,
        escalation:
          'Conflicting authority facts block dependent commercial changes.',
        evidence: params.evidence.trim(),
        resolvedAt: null,
        resumeReason: null,
        resumedAt: null,
      });
    }

    return toTransitionResult(
      agreement.id,
      'commercialAgreement',
      params.expectedState,
      'Conflict preserved. Resolve the owned commercial exception before retrying.',
    );
  }

  private assertListedTransition(
    allowed: readonly string[] | undefined,
    target: string,
    params: TransitionAgreementParams,
  ) {
    if (!allowed?.includes(target)) {
      throw new ParyatechCrmException(
        `${params.transition} transition ${params.expectedState} -> ${target} is not listed`,
        ParyatechCrmExceptionCode.TRANSITION_NOT_ALLOWED,
      );
    }
  }

  private money(value: unknown, fieldName: string) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw this.invalidCommercialEvidence(
        `${fieldName} must be a finite amount`,
      );
    }
    return value;
  }

  private optionalMoney(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private invalidCommercialEvidence(message: string) {
    return new ParyatechCrmException(
      message,
      ParyatechCrmExceptionCode.COMMERCIAL_EVIDENCE_INVALID,
    );
  }
}
