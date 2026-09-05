import {
  ParyatechCrmException,
  ParyatechCrmExceptionCode,
} from 'src/modules/paryatech-crm/exceptions/paryatech-crm.exception';
import {
  type GuardedActionContext,
  type GuardedTransitionResult,
  type ParyatechRecord,
} from 'src/modules/paryatech-crm/types/paryatech-transition.type';

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
