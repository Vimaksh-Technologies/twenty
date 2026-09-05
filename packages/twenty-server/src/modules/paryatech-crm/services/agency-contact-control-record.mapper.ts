import { isDefined } from 'twenty-shared/utils';
import { type ObjectLiteral } from 'typeorm';

import {
  ParyatechCrmException,
  ParyatechCrmExceptionCode,
} from 'src/modules/paryatech-crm/exceptions/paryatech-crm.exception';
import {
  type AgencyRecord,
  type ContactRecord,
  type OutreachEventRecord,
  type SharedExceptionRecord,
} from 'src/modules/paryatech-crm/types/agency-contact-control.type';

export type WorkspaceRecord = ObjectLiteral & Record<string, unknown>;

const throwInvalidField = (fieldName: string): never => {
  throw new ParyatechCrmException(
    `Required field ${fieldName} has an invalid value`,
    ParyatechCrmExceptionCode.SCHEMA_NOT_CONFIGURED,
  );
};

const requiredString = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throwInvalidField(fieldName);
  }
  return value as string;
};

const nullableString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const nullableDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
};

const requiredDate = (value: unknown, fieldName: string): Date => {
  const date = nullableDate(value);
  if (!isDefined(date)) {
    throwInvalidField(fieldName);
  }
  return date as Date;
};

export const requiredNumber = (value: unknown, fieldName: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throwInvalidField(fieldName);
  }
  return value as number;
};

export const toAgencyRecord = (record: WorkspaceRecord): AgencyRecord => ({
  id: requiredString(record.id, 'company.id'),
  agencyLifecycle: requiredString(
    record.agencyLifecycle,
    'company.agencyLifecycle',
  ),
  recordOwnerId: nullableString(record.recordOwnerId),
  isSuppressed: record.isSuppressed === true,
  reservationStatus: nullableString(record.reservationStatus),
  reservationClaimantId: nullableString(record.reservationClaimantId),
  reservationClaimedAt: nullableDate(record.reservationClaimedAt),
  reservationExpiresAt: nullableDate(record.reservationExpiresAt),
  reservationReleaseReason: nullableString(record.reservationReleaseReason),
  firstAttemptedAt: nullableDate(record.firstAttemptedAt),
  firstProviderAcceptedAt: nullableDate(record.firstProviderAcceptedAt),
  firstPendingUnknownAt: nullableDate(record.firstPendingUnknownAt),
  firstContactedAt: nullableDate(record.firstContactedAt),
  firstEngagedAt: nullableDate(record.firstEngagedAt),
});

export const toContactRecord = (record: WorkspaceRecord): ContactRecord => ({
  id: requiredString(record.id, 'person.id'),
  companyId: nullableString(record.companyId),
  isSuppressed: record.isSuppressed === true,
});

export const toOutreachEventRecord = (
  record: WorkspaceRecord,
): OutreachEventRecord => ({
  id: requiredString(record.id, 'outreachEvent.id'),
  eventReference: requiredString(
    record.eventReference,
    'outreachEvent.eventReference',
  ),
  agencyId: requiredString(record.agencyId, 'outreachEvent.agencyId'),
  contactId: nullableString(record.contactId),
  operatorId: requiredString(record.operatorId, 'outreachEvent.operatorId'),
  channel: requiredString(record.channel, 'outreachEvent.channel'),
  initiatedAt: requiredDate(record.initiatedAt, 'outreachEvent.initiatedAt'),
  outcome: requiredString(
    record.outcome,
    'outreachEvent.outcome',
  ) as OutreachEventRecord['outcome'],
  providerEvidenceKey: nullableString(record.providerEvidenceKey),
  providerObservedAt: nullableDate(record.providerObservedAt),
  evidenceSummary: requiredString(
    record.evidenceSummary,
    'outreachEvent.evidenceSummary',
  ),
  nextAction: nullableString(record.nextAction),
  nextActionAt: nullableDate(record.nextActionAt),
  pendingExpiresAt: nullableDate(record.pendingExpiresAt),
  reasonedRetry: nullableString(record.reasonedRetry),
  reservationSnapshot: requiredString(
    record.reservationSnapshot,
    'outreachEvent.reservationSnapshot',
  ),
});

export const toSharedExceptionRecord = (
  record: WorkspaceRecord,
): SharedExceptionRecord => ({
  id: requiredString(record.id, 'sharedException.id'),
  exceptionReference: requiredString(
    record.exceptionReference,
    'sharedException.exceptionReference',
  ),
  capability: requiredString(record.capability, 'sharedException.capability'),
  affectedObject: requiredString(
    record.affectedObject,
    'sharedException.affectedObject',
  ),
  affectedRecordId: requiredString(
    record.affectedRecordId,
    'sharedException.affectedRecordId',
  ),
  status: requiredString(record.status, 'sharedException.status'),
  lastTrustedState: requiredString(
    record.lastTrustedState,
    'sharedException.lastTrustedState',
  ),
  ownerId: requiredString(record.ownerId, 'sharedException.ownerId'),
  dueAt: nullableDate(record.dueAt),
  escalation: nullableString(record.escalation),
  evidence: requiredString(record.evidence, 'sharedException.evidence'),
  resolvedAt: nullableDate(record.resolvedAt),
  resumeReason: nullableString(record.resumeReason),
  resumedAt: nullableDate(record.resumedAt),
});
