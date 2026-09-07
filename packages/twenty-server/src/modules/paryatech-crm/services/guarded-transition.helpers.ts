import {
  ParyatechCrmException,
  ParyatechCrmExceptionCode,
} from 'src/modules/paryatech-crm/exceptions/paryatech-crm.exception';
import {
  PARYATECH_ROLE,
  type GuardedActionContext,
  type GuardedTransitionResult,
  type ParyatechActorRole,
  type ParyatechRecord,
} from 'src/modules/paryatech-crm/types/paryatech-transition.type';

const BUILT_IN_ADMIN_ROLE_LABEL = 'Admin';

const SHARED_EXCEPTION_ROLES_BY_CAPABILITY: Record<string, readonly string[]> =
  {
    Import: [PARYATECH_ROLE.OPERATOR],
    Outreach: [PARYATECH_ROLE.OPERATOR, PARYATECH_ROLE.COMMERCIAL_SENSITIVE],
    Mailbox: [PARYATECH_ROLE.OPERATOR],
    SMTP: [PARYATECH_ROLE.OPERATOR],
    Sales: [PARYATECH_ROLE.OPERATOR, PARYATECH_ROLE.COMMERCIAL_SENSITIVE],
    Commercial: [PARYATECH_ROLE.COMMERCIAL_SENSITIVE],
    Support: [PARYATECH_ROLE.OPERATOR, PARYATECH_ROLE.COMMERCIAL_SENSITIVE],
    Audit: [PARYATECH_ROLE.AUDIT_REVIEWER],
    Security: ['Administrator'],
    Recovery: [PARYATECH_ROLE.RECOVERY_ADMINISTRATOR],
    Integration: [PARYATECH_ROLE.OPERATOR, PARYATECH_ROLE.COMMERCIAL_SENSITIVE],
    Policy: [PARYATECH_ROLE.LEGAL_COMPLIANCE],
  };

export const isNonEmptyText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const assertReasonAndEvidence = ({
  reason,
  evidence,
}: Pick<GuardedActionContext, 'reason' | 'evidence'>) => {
  if (!isNonEmptyText(reason) || !isNonEmptyText(evidence)) {
    throw new ParyatechCrmException(
      'Guarded transition requires reason and evidence',
      ParyatechCrmExceptionCode.EVIDENCE_REQUIRED,
    );
  }
};

export const assertActorRole = (
  actualRole: string,
  allowedRoles: readonly string[],
) => {
  if (!allowedRoles.includes(actualRole)) {
    throw new ParyatechCrmException(
      `Role ${actualRole} cannot perform this guarded action`,
      ParyatechCrmExceptionCode.PERMISSION_DENIED,
    );
  }
};

export const canActorResumeSharedException = (
  actorRole: ParyatechActorRole,
  capability: unknown,
) =>
  (capability === 'Recovery' &&
    actorRole.label === BUILT_IN_ADMIN_ROLE_LABEL &&
    actorRole.isEditable === false) ||
  (SHARED_EXCEPTION_ROLES_BY_CAPABILITY[String(capability)] ?? []).includes(
    actorRole.label,
  );

export const assertActorCanResumeSharedException = (
  actorRole: ParyatechActorRole,
  capability: unknown,
) => {
  if (!canActorResumeSharedException(actorRole, capability)) {
    throw new ParyatechCrmException(
      `Role ${actorRole.label} cannot perform this guarded action`,
      ParyatechCrmExceptionCode.PERMISSION_DENIED,
    );
  }
};

export const assertRecord = (
  record: ParyatechRecord | null,
  objectName: string,
  recordId: string,
): ParyatechRecord => {
  if (record === null) {
    throw new ParyatechCrmException(
      `${objectName} ${recordId} was not found`,
      ParyatechCrmExceptionCode.RECORD_NOT_FOUND,
    );
  }
  return record;
};

export const assertExpectedState = (
  actualState: unknown,
  expectedState: string,
) => {
  if (actualState !== expectedState) {
    throw new ParyatechCrmException(
      `Expected ${expectedState}, found ${String(actualState)}`,
      ParyatechCrmExceptionCode.STATE_CHANGED,
    );
  }
};

export const requireText = (value: unknown, fieldName: string): string => {
  if (!isNonEmptyText(value)) {
    throw new ParyatechCrmException(
      `Required transition evidence ${fieldName} is missing`,
      ParyatechCrmExceptionCode.EVIDENCE_REQUIRED,
    );
  }
  return value.trim();
};

export const requireDate = (value: unknown, fieldName: string): Date => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ParyatechCrmException(
      `Required transition date ${fieldName} is missing`,
      ParyatechCrmExceptionCode.EVIDENCE_REQUIRED,
    );
  }
  return value;
};

export const requireIds = (
  value: string[] | undefined,
  fieldName: string,
): string[] => {
  if (!value || value.length === 0 || value.some((id) => !isNonEmptyText(id))) {
    throw new ParyatechCrmException(
      `Required transition relation ${fieldName} is missing`,
      ParyatechCrmExceptionCode.EVIDENCE_REQUIRED,
    );
  }
  return value;
};

export const toTransitionResult = (
  recordId: string,
  objectName: string,
  state: string,
  correction: string | null = null,
): GuardedTransitionResult => ({ recordId, objectName, state, correction });
