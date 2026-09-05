import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { type ResolverArgs } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';
import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
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

type MutationData = Record<string, unknown> | Record<string, unknown>[];

const assertNoProtectedFieldWrite = (
  authContext: WorkspaceAuthContext,
  payload: ResolverArgs,
  protectedFields: readonly string[],
) => {
  if (!isUserAuthContext(authContext)) {
    return;
  }

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
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: ResolverArgs,
  ): Promise<ResolverArgs> {
    assertNoProtectedFieldWrite(authContext, payload, PROTECTED_COMPANY_FIELDS);
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
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: ResolverArgs,
  ): Promise<ResolverArgs> {
    assertNoProtectedFieldWrite(authContext, payload, PROTECTED_PERSON_FIELDS);
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
