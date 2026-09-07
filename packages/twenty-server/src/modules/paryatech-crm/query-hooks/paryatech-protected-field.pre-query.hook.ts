import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { type ResolverArgs } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import {
  ParyatechCrmException,
  ParyatechCrmExceptionCode,
} from 'src/modules/paryatech-crm/exceptions/paryatech-crm.exception';

const SUPPRESSION_FIELDS = [
  'isSuppressed',
  'suppressionReason',
  'suppressedAt',
  'suppressionClearedAt',
  'suppressionClearanceReason',
] as const;

const PROTECTED_COMPANY_FIELDS = [
  'agencyLifecycle',
  'agencyDisposition',
  'recordOwnerId',
  'reservationStatus',
  'reservationClaimantId',
  'reservationClaimedAt',
  'reservationExpiresAt',
  'reservationReleaseReason',
  'firstAttemptedAt',
  'firstProviderAcceptedAt',
  'firstPendingUnknownAt',
  'firstContactedAt',
  'firstEngagedAt',
  ...SUPPRESSION_FIELDS,
] as const;

const PROTECTED_PERSON_FIELDS = [...SUPPRESSION_FIELDS] as const;

const PROTECTED_OPPORTUNITY_FIELDS = [
  'stage',
  'amount',
  'contacts',
  'contactIds',
  'products',
  'productIds',
  'nextAction',
  'nextActionAt',
  'demoScheduledAt',
  'demoOccurredAt',
  'demoAttendees',
  'demoAttendeeIds',
  'demoOutcome',
  'proposalDeliveredAt',
  'commercialDecisionContext',
  'lossReason',
  'lossDecisionAt',
  'revisitAt',
  'primarySource',
  'primarySourceId',
  'influencedSources',
  'influencedSourceIds',
  'trialState',
  'trialReason',
  'trialOwner',
  'trialOwnerId',
  'trialStartsAt',
  'trialEndsAt',
  'trialSuccessCriteria',
  'trialExpectedDecision',
  'trialExtensionReason',
  'trialOutcome',
  'agreement',
  'agreementId',
] as const;

const PROTECTED_AGREEMENT_FIELDS = [
  'agreementReference',
  'agency',
  'agencyId',
  'sourceOpportunity',
  'sourceOpportunityId',
  'products',
  'productIds',
  'term',
  'startsAt',
  'endsAt',
  'grossBooked',
  'currency',
  'commercialException',
  'paymentState',
  'amountCollected',
  'waivedAmount',
  'refundedOrReversedAmount',
  'netCollected',
  'evidenceSource',
  'evidenceType',
  'evidenceVerifier',
  'evidenceVerifierId',
  'evidenceObservedAt',
  'evidenceRecordedAt',
  'evidenceState',
  'renewalState',
  'renewalAt',
  'renewalOwner',
  'renewalOwnerId',
  'renewalNextAction',
  'renewalNextActionAt',
  'activationState',
  'activationConfirmedAt',
  'activationConfirmer',
  'activationConfirmerId',
  'adoptionState',
  'adoptionEvidence',
  'adoptionObservedAt',
  'paryatechOsCommercialReference',
] as const;

const PROTECTED_SUPPORT_CASE_FIELDS = [
  'sourceReceivedAt',
  'responseTargetAt',
  'owner',
  'ownerId',
  'status',
  'disposition',
  'firstSubstantiveResponseAt',
  'resolution',
] as const;

const PROTECTED_SUPPORT_RECEIPT_FIELDS = [
  'receiptKey',
  'channel',
  'providerOrSourceId',
  'sourceReceivedAt',
  'payloadHash',
  'case',
  'caseId',
  'receiptDisposition',
] as const;

const PROTECTED_SHARED_EXCEPTION_FIELDS = [
  'status',
  'lastTrustedState',
  'evidence',
  'resolvedAt',
  'resumeReason',
  'resumedAt',
] as const;

type MutationData = Record<string, unknown> | Record<string, unknown>[];

const assertNoProtectedFieldWrite = (
  payload: ResolverArgs,
  protectedFields: readonly string[],
) => {
  const data =
    'data' in payload ? (payload.data as MutationData | undefined) : undefined;
  const records = Array.isArray(data) ? data : [data ?? {}];
  const protectedField = records
    .flatMap((record) => Object.keys(record))
    .find((fieldName) => protectedFields.includes(fieldName));

  if (protectedField) {
    throw new ParyatechCrmException(
      `Direct write to protected field ${protectedField}`,
      ParyatechCrmExceptionCode.PROTECTED_FIELD_WRITE,
    );
  }
};

abstract class CompanyProtectedFieldPreQueryHook implements WorkspacePreQueryHookInstance {
  async execute(
    _authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: ResolverArgs,
  ): Promise<ResolverArgs> {
    assertNoProtectedFieldWrite(payload, PROTECTED_COMPANY_FIELDS);
    return payload;
  }
}

@WorkspaceQueryHook('company.createOne')
export class ParyatechCompanyCreateOnePreQueryHook extends CompanyProtectedFieldPreQueryHook {}

@WorkspaceQueryHook('company.createMany')
export class ParyatechCompanyCreateManyPreQueryHook extends CompanyProtectedFieldPreQueryHook {}

@WorkspaceQueryHook('company.updateOne')
export class ParyatechCompanyUpdateOnePreQueryHook extends CompanyProtectedFieldPreQueryHook {}

@WorkspaceQueryHook('company.updateMany')
export class ParyatechCompanyUpdateManyPreQueryHook extends CompanyProtectedFieldPreQueryHook {}

abstract class PersonProtectedFieldPreQueryHook implements WorkspacePreQueryHookInstance {
  async execute(
    _authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: ResolverArgs,
  ): Promise<ResolverArgs> {
    assertNoProtectedFieldWrite(payload, PROTECTED_PERSON_FIELDS);
    return payload;
  }
}

@WorkspaceQueryHook('person.createOne')
export class ParyatechPersonCreateOnePreQueryHook extends PersonProtectedFieldPreQueryHook {}

@WorkspaceQueryHook('person.createMany')
export class ParyatechPersonCreateManyPreQueryHook extends PersonProtectedFieldPreQueryHook {}

@WorkspaceQueryHook('person.updateOne')
export class ParyatechPersonUpdateOnePreQueryHook extends PersonProtectedFieldPreQueryHook {}

@WorkspaceQueryHook('person.updateMany')
export class ParyatechPersonUpdateManyPreQueryHook extends PersonProtectedFieldPreQueryHook {}

abstract class OpportunityProtectedFieldPreQueryHook implements WorkspacePreQueryHookInstance {
  async execute(
    _authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: ResolverArgs,
  ): Promise<ResolverArgs> {
    assertNoProtectedFieldWrite(payload, PROTECTED_OPPORTUNITY_FIELDS);
    return payload;
  }
}

@WorkspaceQueryHook('opportunity.createOne')
export class ParyatechOpportunityCreateOnePreQueryHook extends OpportunityProtectedFieldPreQueryHook {}

@WorkspaceQueryHook('opportunity.createMany')
export class ParyatechOpportunityCreateManyPreQueryHook extends OpportunityProtectedFieldPreQueryHook {}

@WorkspaceQueryHook('opportunity.updateOne')
export class ParyatechOpportunityUpdateOnePreQueryHook extends OpportunityProtectedFieldPreQueryHook {}

@WorkspaceQueryHook('opportunity.updateMany')
export class ParyatechOpportunityUpdateManyPreQueryHook extends OpportunityProtectedFieldPreQueryHook {}

abstract class CommercialAgreementProtectedFieldPreQueryHook implements WorkspacePreQueryHookInstance {
  async execute(
    _authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: ResolverArgs,
  ): Promise<ResolverArgs> {
    assertNoProtectedFieldWrite(payload, PROTECTED_AGREEMENT_FIELDS);
    return payload;
  }
}

@WorkspaceQueryHook('commercialAgreement.createOne')
export class ParyatechCommercialAgreementCreateOnePreQueryHook extends CommercialAgreementProtectedFieldPreQueryHook {}

@WorkspaceQueryHook('commercialAgreement.createMany')
export class ParyatechCommercialAgreementCreateManyPreQueryHook extends CommercialAgreementProtectedFieldPreQueryHook {}

@WorkspaceQueryHook('commercialAgreement.updateOne')
export class ParyatechCommercialAgreementUpdateOnePreQueryHook extends CommercialAgreementProtectedFieldPreQueryHook {}

@WorkspaceQueryHook('commercialAgreement.updateMany')
export class ParyatechCommercialAgreementUpdateManyPreQueryHook extends CommercialAgreementProtectedFieldPreQueryHook {}

abstract class SupportCaseProtectedFieldPreQueryHook implements WorkspacePreQueryHookInstance {
  async execute(
    _authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: ResolverArgs,
  ): Promise<ResolverArgs> {
    assertNoProtectedFieldWrite(payload, PROTECTED_SUPPORT_CASE_FIELDS);
    return payload;
  }
}

@WorkspaceQueryHook('supportCase.createOne')
export class ParyatechSupportCaseCreateOnePreQueryHook extends SupportCaseProtectedFieldPreQueryHook {}

@WorkspaceQueryHook('supportCase.createMany')
export class ParyatechSupportCaseCreateManyPreQueryHook extends SupportCaseProtectedFieldPreQueryHook {}

@WorkspaceQueryHook('supportCase.updateOne')
export class ParyatechSupportCaseUpdateOnePreQueryHook extends SupportCaseProtectedFieldPreQueryHook {}

@WorkspaceQueryHook('supportCase.updateMany')
export class ParyatechSupportCaseUpdateManyPreQueryHook extends SupportCaseProtectedFieldPreQueryHook {}

abstract class SupportReceiptProtectedFieldPreQueryHook implements WorkspacePreQueryHookInstance {
  async execute(
    _authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: ResolverArgs,
  ): Promise<ResolverArgs> {
    assertNoProtectedFieldWrite(payload, PROTECTED_SUPPORT_RECEIPT_FIELDS);
    return payload;
  }
}

@WorkspaceQueryHook('supportReceipt.createOne')
export class ParyatechSupportReceiptCreateOnePreQueryHook extends SupportReceiptProtectedFieldPreQueryHook {}

@WorkspaceQueryHook('supportReceipt.createMany')
export class ParyatechSupportReceiptCreateManyPreQueryHook extends SupportReceiptProtectedFieldPreQueryHook {}

@WorkspaceQueryHook('supportReceipt.updateOne')
export class ParyatechSupportReceiptUpdateOnePreQueryHook extends SupportReceiptProtectedFieldPreQueryHook {}

@WorkspaceQueryHook('supportReceipt.updateMany')
export class ParyatechSupportReceiptUpdateManyPreQueryHook extends SupportReceiptProtectedFieldPreQueryHook {}

abstract class SharedExceptionProtectedFieldPreQueryHook implements WorkspacePreQueryHookInstance {
  async execute(
    _authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: ResolverArgs,
  ): Promise<ResolverArgs> {
    assertNoProtectedFieldWrite(payload, PROTECTED_SHARED_EXCEPTION_FIELDS);
    return payload;
  }
}

@WorkspaceQueryHook('sharedException.createOne')
export class ParyatechSharedExceptionCreateOnePreQueryHook extends SharedExceptionProtectedFieldPreQueryHook {}

@WorkspaceQueryHook('sharedException.createMany')
export class ParyatechSharedExceptionCreateManyPreQueryHook extends SharedExceptionProtectedFieldPreQueryHook {}

@WorkspaceQueryHook('sharedException.updateOne')
export class ParyatechSharedExceptionUpdateOnePreQueryHook extends SharedExceptionProtectedFieldPreQueryHook {}

@WorkspaceQueryHook('sharedException.updateMany')
export class ParyatechSharedExceptionUpdateManyPreQueryHook extends SharedExceptionProtectedFieldPreQueryHook {}
