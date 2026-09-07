import { Injectable } from '@nestjs/common';
import { validate as isUuid } from 'uuid';

import {
  ParyatechCrmException,
  ParyatechCrmExceptionCode,
} from 'src/modules/paryatech-crm/exceptions/paryatech-crm.exception';
import {
  type ApplyCommercialCutoverAgreementParams,
  type CommercialCutoverAgreement,
  type CommercialCutoverApplyResult,
  type CommercialCutoverStoredAgreement,
  type CommercialCutoverReceipt,
  ParyatechCommercialCutoverStore,
} from 'src/modules/paryatech-crm/types/commercial-cutover.type';
import { PARYATECH_ROLE } from 'src/modules/paryatech-crm/types/paryatech-transition.type';
import { hashCommercialCutoverValue } from 'src/modules/paryatech-crm/utils/hash-commercial-cutover-value.util';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TARGET_KEYS = [
  'activationConfirmedAt',
  'activationConfirmer',
  'activationState',
  'adoptionEvidence',
  'adoptionObservedAt',
  'adoptionState',
  'agency',
  'agreementReference',
  'amountCollected',
  'commercialException',
  'currency',
  'endsAt',
  'evidenceObservedAt',
  'evidenceRecordedAt',
  'evidenceSource',
  'evidenceState',
  'evidenceType',
  'evidenceVerifier',
  'grossBooked',
  'netCollected',
  'paryatechOsCommercialReference',
  'paymentState',
  'products',
  'refundedOrReversedAmount',
  'renewalAt',
  'renewalNextAction',
  'renewalNextActionAt',
  'renewalOwner',
  'renewalState',
  'restrictedNotes',
  'sourceOpportunity',
  'startsAt',
  'term',
  'waivedAmount',
] as const;

const contractError = (message: string) =>
  new ParyatechCrmException(
    message,
    ParyatechCrmExceptionCode.COMMERCIAL_EVIDENCE_INVALID,
  );

const assertObject = (
  value: unknown,
  label: string,
): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

const stringValue = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw contractError(`${label} must be a non-empty string`);
  }
  return value;
};

const uuidValue = (value: unknown, label: string): string => {
  const parsed = stringValue(value, label);
  if (!isUuid(parsed)) {
    throw contractError(`${label} must be a UUID`);
  }
  return parsed;
};

const hashValue = (value: unknown, label: string): string => {
  const parsed = stringValue(value, label);
  if (!SHA256_PATTERN.test(parsed)) {
    throw contractError(`${label} must be a SHA-256 hash`);
  }
  return parsed;
};

const timestampValue = (value: unknown, label: string): string => {
  const parsed = stringValue(value, label);
  if (new Date(parsed).toISOString() !== parsed) {
    throw contractError(`${label} must be an exact UTC ISO timestamp`);
  }
  return parsed;
};

const dateValue = (value: unknown, label: string): string => {
  const parsed = stringValue(value, label);
  if (!DATE_PATTERN.test(parsed)) {
    throw contractError(`${label} must be YYYY-MM-DD`);
  }
  return parsed;
};

const numberValue = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw contractError(`${label} must be a non-negative finite number`);
  }
  return value;
};

const literalValue = <TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
  label: string,
): TValue => {
  if (typeof value !== 'string' || !allowed.includes(value as TValue)) {
    throw contractError(`${label} has an unsupported value`);
  }
  return value as TValue;
};

const nullValue = (value: unknown, label: string): null => {
  if (value !== null) {
    throw contractError(`${label} must remain null during cutover`);
  }
  return null;
};

const nullableStringValue = (value: unknown, label: string): string | null => {
  if (value === null) {
    return null;
  }
  return stringValue(value, label);
};

const uuidArrayValue = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw contractError(`${label} must contain at least one UUID`);
  }
  const parsed = value.map((entry, index) =>
    uuidValue(entry, `${label}[${index}]`),
  );
  if (new Set(parsed).size !== parsed.length) {
    throw contractError(`${label} cannot contain duplicate IDs`);
  }
  return parsed;
};

const validateTarget = (value: unknown): CommercialCutoverAgreement => {
  const target = assertObject(value, 'target');
  const keys = Object.keys(target);
  const unexpected = keys.find(
    (key) => !TARGET_KEYS.includes(key as (typeof TARGET_KEYS)[number]),
  );
  const missing = TARGET_KEYS.find((key) => !(key in target));
  if (unexpected !== undefined || missing !== undefined) {
    throw contractError(
      'target must contain only the exact U1 Agreement fields',
    );
  }

  const commercialException = nullableStringValue(
    target.commercialException,
    'commercialException',
  );
  const currency = stringValue(target.currency, 'currency');
  if (currency !== 'INR' && commercialException === null) {
    throw contractError('non-INR currency requires a commercial exception');
  }
  const amountCollected = numberValue(
    target.amountCollected,
    'amountCollected',
  );
  const refundedOrReversedAmount = numberValue(
    target.refundedOrReversedAmount,
    'refundedOrReversedAmount',
  );
  const netCollected = numberValue(target.netCollected, 'netCollected');
  if (
    refundedOrReversedAmount > amountCollected ||
    netCollected !== amountCollected - refundedOrReversedAmount
  ) {
    throw contractError('net collected does not match payment provenance');
  }
  const evidenceObservedAt = timestampValue(
    target.evidenceObservedAt,
    'evidenceObservedAt',
  );
  const evidenceRecordedAt = timestampValue(
    target.evidenceRecordedAt,
    'evidenceRecordedAt',
  );
  if (evidenceObservedAt > evidenceRecordedAt) {
    throw contractError('evidence timestamps are not monotonic');
  }

  return {
    activationConfirmedAt: nullValue(
      target.activationConfirmedAt,
      'activationConfirmedAt',
    ),
    activationConfirmer: nullValue(
      target.activationConfirmer,
      'activationConfirmer',
    ),
    activationState: literalValue(
      target.activationState,
      ['Pending'],
      'activationState',
    ),
    adoptionEvidence: nullValue(target.adoptionEvidence, 'adoptionEvidence'),
    adoptionObservedAt: nullValue(
      target.adoptionObservedAt,
      'adoptionObservedAt',
    ),
    adoptionState: literalValue(
      target.adoptionState,
      ['Not Assessed'],
      'adoptionState',
    ),
    agency: uuidValue(target.agency, 'agency'),
    agreementReference: stringValue(
      target.agreementReference,
      'agreementReference',
    ),
    amountCollected,
    commercialException,
    currency,
    endsAt: dateValue(target.endsAt, 'endsAt'),
    evidenceObservedAt,
    evidenceRecordedAt,
    evidenceSource: stringValue(target.evidenceSource, 'evidenceSource'),
    evidenceState: literalValue(
      target.evidenceState,
      ['Current', 'Stale', 'Conflict'],
      'evidenceState',
    ),
    evidenceType: stringValue(target.evidenceType, 'evidenceType'),
    evidenceVerifier: uuidValue(target.evidenceVerifier, 'evidenceVerifier'),
    grossBooked: numberValue(target.grossBooked, 'grossBooked'),
    netCollected,
    paryatechOsCommercialReference: stringValue(
      target.paryatechOsCommercialReference,
      'paryatechOsCommercialReference',
    ),
    paymentState: literalValue(
      target.paymentState,
      [
        'Pending',
        'Part-paid',
        'Paid',
        'Overdue',
        'Waived',
        'Refunded',
        'Reversed',
      ],
      'paymentState',
    ),
    products: uuidArrayValue(target.products, 'products').sort(),
    refundedOrReversedAmount,
    renewalAt: dateValue(target.renewalAt, 'renewalAt'),
    renewalNextAction: stringValue(
      target.renewalNextAction,
      'renewalNextAction',
    ),
    renewalNextActionAt: timestampValue(
      target.renewalNextActionAt,
      'renewalNextActionAt',
    ),
    renewalOwner: uuidValue(target.renewalOwner, 'renewalOwner'),
    renewalState: literalValue(
      target.renewalState,
      ['Renewing', 'Renewed', 'Changed', 'Not Renewing', 'Lapsed'],
      'renewalState',
    ),
    restrictedNotes: nullValue(target.restrictedNotes, 'restrictedNotes'),
    sourceOpportunity: nullValue(target.sourceOpportunity, 'sourceOpportunity'),
    startsAt: dateValue(target.startsAt, 'startsAt'),
    term: literalValue(
      target.term,
      ['Quarterly', 'Half-yearly', 'Yearly'],
      'term',
    ),
    waivedAmount: numberValue(target.waivedAmount, 'waivedAmount'),
  };
};

const withoutId = (
  agreement: CommercialCutoverAgreement & { id: string },
): CommercialCutoverAgreement => {
  const { id: _id, ...snapshot } = agreement;
  return snapshot;
};

@Injectable()
export class CommercialCutoverService {
  constructor(private readonly store: ParyatechCommercialCutoverStore) {}
  private async assertAuthorized(params: {
    apiKeyId: string;
    workspaceId: string;
  }): Promise<void> {
    if (
      (await this.store.getApiKeyRoleLabel(params)) !==
      PARYATECH_ROLE.COMMERCIAL_CUTOVER
    ) {
      throw new ParyatechCrmException(
        'Commercial cutover requires its dedicated API-key role',
        ParyatechCrmExceptionCode.PERMISSION_DENIED,
      );
    }
  }

  async inspectAgreement(params: {
    apiKeyId: string;
    sourceCommercialId: string;
    workspaceId: string;
  }): Promise<CommercialCutoverStoredAgreement | null> {
    await this.assertAuthorized(params);
    const sourceCommercialId = stringValue(
      params.sourceCommercialId,
      'sourceCommercialId',
    );
    return this.store.transact(
      {
        apiKeyId: params.apiKeyId,
        idempotencyKey: `inspect:${sourceCommercialId}`,
        sourceCommercialId,
        workspaceId: params.workspaceId,
      },
      async (transaction) => {
        const record =
          await transaction.findAgreementForUpdate(sourceCommercialId);
        return record;
      },
    );
  }

  async inspectReceipt(params: {
    apiKeyId: string;
    idempotencyKey: string;
    sourceCommercialId: string;
    workspaceId: string;
  }): Promise<CommercialCutoverReceipt | null> {
    await this.assertAuthorized(params);
    const sourceCommercialId = stringValue(
      params.sourceCommercialId,
      'sourceCommercialId',
    );
    const idempotencyKey = hashValue(params.idempotencyKey, 'idempotencyKey');
    return this.store.transact(
      {
        apiKeyId: params.apiKeyId,
        idempotencyKey,
        sourceCommercialId,
        workspaceId: params.workspaceId,
      },
      async (transaction) => {
        const receipt = await transaction.findReceiptForUpdate(idempotencyKey);
        if (receipt === null) {
          return null;
        }
        const { receiptHash, ...receiptEvidence } = receipt;
        if (hashCommercialCutoverValue(receiptEvidence) !== receiptHash) {
          throw new ParyatechCrmException(
            'Stored commercial cutover receipt failed integrity verification',
            ParyatechCrmExceptionCode.RECEIPT_CONFLICT,
          );
        }
        return receipt;
      },
    );
  }

  async applyAgreement(
    params: ApplyCommercialCutoverAgreementParams,
  ): Promise<CommercialCutoverApplyResult> {
    const actorApiKeyIdHash = hashCommercialCutoverValue({
      apiKeyId: params.apiKeyId,
      workspaceId: params.workspaceId,
    });
    await this.assertAuthorized(params);
    const idempotencyKey = hashValue(params.idempotencyKey, 'idempotencyKey');
    const evidenceHash = hashValue(params.evidenceHash, 'evidenceHash');
    const targetHash = hashValue(params.targetHash, 'targetHash');
    const expectedSnapshotHash =
      params.expectedSnapshotHash === null
        ? null
        : hashValue(params.expectedSnapshotHash, 'expectedSnapshotHash');
    const target = validateTarget(params.target);
    if (hashCommercialCutoverValue(target) !== targetHash) {
      throw contractError(
        'target hash does not match exact U1 Agreement fields',
      );
    }
    const requestHash = hashCommercialCutoverValue({
      dryRun: params.dryRun,
      evidenceHash,
      expectedSnapshotHash,
      idempotencyKey,
      targetHash,
      workspaceId: params.workspaceId,
    });

    return this.store.transact(
      {
        apiKeyId: params.apiKeyId,
        idempotencyKey,
        sourceCommercialId: target.paryatechOsCommercialReference,
        workspaceId: params.workspaceId,
      },
      async (transaction) => {
        const receipt = await transaction.findReceiptForUpdate(idempotencyKey);
        if (receipt !== null) {
          const { receiptHash, ...receiptEvidence } = receipt;
          if (hashCommercialCutoverValue(receiptEvidence) !== receiptHash) {
            throw new ParyatechCrmException(
              'Stored commercial cutover receipt failed integrity verification',
              ParyatechCrmExceptionCode.RECEIPT_CONFLICT,
            );
          }
          if (
            receipt.requestHash !== requestHash ||
            receipt.targetHash !== targetHash ||
            receipt.evidenceHash !== evidenceHash
          ) {
            throw new ParyatechCrmException(
              'Idempotency key is bound to different commercial evidence',
              ParyatechCrmExceptionCode.RECEIPT_CONFLICT,
            );
          }
          return {
            ...receipt,
            replayed: true,
            status: 'APPLIED' as const,
          };
        }

        const existing = await transaction.findAgreementForUpdate(
          target.paryatechOsCommercialReference,
        );
        const previous = existing === null ? null : withoutId(existing);
        const actualSnapshotHash =
          previous === null ? null : hashCommercialCutoverValue(previous);
        if (actualSnapshotHash !== expectedSnapshotHash) {
          throw new ParyatechCrmException(
            'Agreement changed after the cutover inspection',
            ParyatechCrmExceptionCode.COMMERCIAL_CUTOVER_CAS_MISMATCH,
          );
        }

        if (params.dryRun) {
          return {
            actorApiKeyIdHash,
            created: existing === null,
            evidenceHash,
            idempotencyKey,
            previous,
            receiptHash: null,
            recordId: existing?.id ?? null,
            replayed: false,
            requestHash,
            snapshot: target,
            status: 'DRY_RUN' as const,
            targetHash,
          };
        }

        const stored =
          existing === null
            ? await transaction.createAgreement(target)
            : await transaction.updateAgreement(existing.id, target);
        const snapshot = withoutId(stored);
        if (hashCommercialCutoverValue(snapshot) !== targetHash) {
          throw new ParyatechCrmException(
            'Stored Agreement does not match the reviewed target',
            ParyatechCrmExceptionCode.COMMERCIAL_CUTOVER_CAS_MISMATCH,
          );
        }
        const receiptWithoutHash = {
          actorApiKeyIdHash,
          created: existing === null,
          evidenceHash,
          idempotencyKey,
          previous,
          recordId: stored.id,
          requestHash,
          schemaVersion: 'paryatech-commercial-cutover-receipt/v1' as const,
          snapshot,
          targetHash,
        };
        const receiptToInsert: CommercialCutoverReceipt = {
          ...receiptWithoutHash,
          receiptHash: hashCommercialCutoverValue(receiptWithoutHash),
        };
        await transaction.insertReceipt(receiptToInsert);
        return {
          ...receiptToInsert,
          replayed: false,
          status: 'APPLIED' as const,
        };
      },
    );
  }
}
