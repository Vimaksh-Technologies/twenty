import { pathToFileURL } from 'node:url';

import {
  type CliIo,
  hashCanonical,
  parseStrictCliArguments,
  readPrivateJson,
  writeCliFailure,
  writePrivateJsonAtomic,
} from './types.js';

const EXPORT_SCHEMA_VERSION = 'paryatechos-commercial-export/v1' as const;
const RESOLUTION_SCHEMA_VERSION = 'paryatech-commercial-resolution/v1' as const;
const PREPARED_SCHEMA_VERSION =
  'paryatech-commercial-cutover-prepared/v1' as const;
const FREEZE_SCHEMA_VERSION = 'paryatechos-commercial-freeze/v1' as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const PROHIBITED_SOURCE_KEY_PATTERN =
  /password|secret|token|api.?key|passport|pnr|booking|travell?er|passenger|entitlement|provision/iu;

export type CommercialTerm = 'Quarterly' | 'Half-yearly' | 'Yearly';
export type CommercialPaymentState =
  | 'Pending'
  | 'Part-paid'
  | 'Paid'
  | 'Overdue'
  | 'Waived'
  | 'Refunded'
  | 'Reversed';
export type CommercialEvidenceState = 'Current' | 'Stale' | 'Conflict';
export type CommercialRenewalState =
  | 'Renewing'
  | 'Renewed'
  | 'Changed'
  | 'Not Renewing'
  | 'Lapsed';

export type CommercialExportRow = {
  active: boolean;
  agencyExternalKey: string;
  agreementReference: string;
  commercialException?: string | null;
  currency: string;
  endsAt: string;
  grossBooked: number;
  payment: {
    amountCollected: number;
    evidenceObservedAt: string;
    evidenceRecordedAt: string;
    evidenceSource: string;
    evidenceState: CommercialEvidenceState;
    evidenceType: string;
    netCollected: number;
    refundedOrReversedAmount: number;
    state: CommercialPaymentState;
    waivedAmount: number;
  };
  productExternalKeys: string[];
  renewal: {
    nextAction: string;
    nextActionAt: string;
    ownerExternalKey: string;
    renewalAt: string;
    state: CommercialRenewalState;
  };
  sourceCommercialId: string;
  sourceCreatedAt: string;
  sourceUpdatedAt: string;
  startsAt: string;
  term: CommercialTerm;
  verifierExternalKey: string;
};

export type CommercialExport = {
  activeInventoryIds: string[];
  approval: {
    approvedAt: string;
    approvedBy: string;
    evidenceHash: string;
  };
  contractId: string;
  exportHash: string;
  exportedAt: string;
  immutable: true;
  rows: CommercialExportRow[];
  schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  sourceSystem: 'ParyatechOS';
};

export type CommercialResolutionSnapshot = {
  agencies: ResolutionEntry[];
  capturedAt: string;
  workspaceMembers: ResolutionEntry[];
  products: ResolutionEntry[];
  resolutionHash: string;
  schemaVersion: typeof RESOLUTION_SCHEMA_VERSION;
  workspaceId: string;
};

type ResolutionEntry = {
  externalKey: string;
  recordId: string;
};

export type CommercialAgreementTarget = {
  activationConfirmedAt: null;
  activationConfirmer: null;
  activationState: 'Pending';
  adoptionEvidence: null;
  adoptionObservedAt: null;
  adoptionState: 'Not Assessed';
  agency: string;
  agreementReference: string;
  amountCollected: number;
  commercialException: string | null;
  currency: string;
  endsAt: string;
  evidenceObservedAt: string;
  evidenceRecordedAt: string;
  evidenceSource: string;
  evidenceState: CommercialEvidenceState;
  evidenceType: string;
  evidenceVerifier: string;
  grossBooked: number;
  netCollected: number;
  paryatechOsCommercialReference: string;
  paymentState: CommercialPaymentState;
  products: string[];
  refundedOrReversedAmount: number;
  renewalAt: string;
  renewalNextAction: string;
  renewalNextActionAt: string;
  renewalOwner: string;
  renewalState: CommercialRenewalState;
  restrictedNotes: null;
  sourceOpportunity: null;
  startsAt: string;
  term: CommercialTerm;
  waivedAmount: number;
};

export type PreparedCommercialCutoverRow = {
  agencyRecordId: string | null;
  disposition: 'resolved' | 'inactive-quarantine';
  productRecordIds: string[];
  source: CommercialExportRow;
  sourceRowHash: string;
  target: CommercialAgreementTarget;
  targetHash: string;
};

export type PreparedCommercialCutover = {
  activeInventoryHash: string;
  preparedHash: string;
  resolutionHash: string;
  review: {
    evidenceHash: string;
    reviewedAt: string;
    reviewedBy: string;
  };
  rows: PreparedCommercialCutoverRow[];
  schemaVersion: typeof PREPARED_SCHEMA_VERSION;
  sourceContractId: string;
  sourceExportHash: string;
  sourceExportedAt: string;
  workspaceId: string;
};

export type CommercialFreezeProof = {
  commercialMutationDisabled: true;
  entitlementMutationEnabled: true;
  evidenceHash: string;
  freezeHash: string;
  freezeId: string;
  frozenAt: string;
  frozenBy: string;
  initialExportHash: string;
  schemaVersion: typeof FREEZE_SCHEMA_VERSION;
  sourceSystem: 'ParyatechOS';
};

export class CommercialCutoverContractError extends Error {
  readonly code: string;

  constructor(message: string, code = 'INVALID_COMMERCIAL_CUTOVER') {
    super(message);
    this.name = 'CommercialCutoverContractError';
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const assertRecord = (
  value: unknown,
  label: string,
): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new CommercialCutoverContractError(`${label} must be an object`);
  }
  return value;
};

const assertExactKeys = (
  value: Record<string, unknown>,
  allowed: string[],
  required: string[],
  label: string,
) => {
  const unknownKey = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknownKey !== undefined) {
    throw new CommercialCutoverContractError(
      `${label} contains unknown field ${unknownKey}`,
    );
  }
  const missingKey = required.find((key) => !(key in value));
  if (missingKey !== undefined) {
    throw new CommercialCutoverContractError(
      `${label} is missing required field ${missingKey}`,
    );
  }
};

const assertNoProhibitedSourceKeys = (value: unknown, path = 'export') => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoProhibitedSourceKeys(entry, `${path}[${index}]`),
    );
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (PROHIBITED_SOURCE_KEY_PATTERN.test(key)) {
      throw new CommercialCutoverContractError(
        `${path}.${key} is a prohibited travel, entitlement, provisioning, or credential field`,
        'PROHIBITED_SOURCE_DATA',
      );
    }
    assertNoProhibitedSourceKeys(entry, `${path}.${key}`);
  }
};

const assertString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CommercialCutoverContractError(
      `${label} must be a non-empty string`,
    );
  }
  return value;
};

const assertBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== 'boolean') {
    throw new CommercialCutoverContractError(`${label} must be boolean`);
  }
  return value;
};

const assertNumber = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new CommercialCutoverContractError(
      `${label} must be a non-negative finite number`,
    );
  }
  return value;
};

const assertTimestamp = (value: unknown, label: string): string => {
  const timestamp = assertString(value, label);
  if (new Date(timestamp).toISOString() !== timestamp) {
    throw new CommercialCutoverContractError(
      `${label} must be an exact UTC ISO timestamp`,
    );
  }
  return timestamp;
};

const assertDate = (value: unknown, label: string): string => {
  const date = assertString(value, label);
  if (!DATE_PATTERN.test(date)) {
    throw new CommercialCutoverContractError(`${label} must be YYYY-MM-DD`);
  }
  return date;
};

const assertHash = (value: unknown, label: string): string => {
  const hash = assertString(value, label);
  if (!SHA256_PATTERN.test(hash)) {
    throw new CommercialCutoverContractError(`${label} must be a SHA-256 hash`);
  }
  return hash;
};

const assertLiteral = <TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
  label: string,
): TValue => {
  if (typeof value !== 'string' || !allowed.includes(value as TValue)) {
    throw new CommercialCutoverContractError(
      `${label} must be one of ${allowed.join(', ')}`,
    );
  }
  return value as TValue;
};

const assertStringArray = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value)) {
    throw new CommercialCutoverContractError(`${label} must be an array`);
  }
  const strings = value.map((entry, index) =>
    assertString(entry, `${label}[${index}]`),
  );
  if (new Set(strings).size !== strings.length) {
    throw new CommercialCutoverContractError(`${label} contains duplicates`);
  }
  return strings;
};

const assertCommercialExportRow = (
  value: unknown,
  index: number,
): CommercialExportRow => {
  const label = `export.rows[${index}]`;
  const row = assertRecord(value, label);
  assertExactKeys(
    row,
    [
      'active',
      'agencyExternalKey',
      'agreementReference',
      'commercialException',
      'currency',
      'endsAt',
      'grossBooked',
      'payment',
      'productExternalKeys',
      'renewal',
      'sourceCommercialId',
      'sourceCreatedAt',
      'sourceUpdatedAt',
      'startsAt',
      'term',
      'verifierExternalKey',
    ],
    [
      'active',
      'agencyExternalKey',
      'agreementReference',
      'currency',
      'endsAt',
      'grossBooked',
      'payment',
      'productExternalKeys',
      'renewal',
      'sourceCommercialId',
      'sourceCreatedAt',
      'sourceUpdatedAt',
      'startsAt',
      'term',
      'verifierExternalKey',
    ],
    label,
  );
  const payment = assertRecord(row.payment, `${label}.payment`);
  assertExactKeys(
    payment,
    [
      'amountCollected',
      'evidenceObservedAt',
      'evidenceRecordedAt',
      'evidenceSource',
      'evidenceState',
      'evidenceType',
      'netCollected',
      'refundedOrReversedAmount',
      'state',
      'waivedAmount',
    ],
    [
      'amountCollected',
      'evidenceObservedAt',
      'evidenceRecordedAt',
      'evidenceSource',
      'evidenceState',
      'evidenceType',
      'netCollected',
      'refundedOrReversedAmount',
      'state',
      'waivedAmount',
    ],
    `${label}.payment`,
  );
  const renewal = assertRecord(row.renewal, `${label}.renewal`);
  assertExactKeys(
    renewal,
    ['nextAction', 'nextActionAt', 'ownerExternalKey', 'renewalAt', 'state'],
    ['nextAction', 'nextActionAt', 'ownerExternalKey', 'renewalAt', 'state'],
    `${label}.renewal`,
  );

  const commercialException = row.commercialException;
  if (
    commercialException !== undefined &&
    commercialException !== null &&
    typeof commercialException !== 'string'
  ) {
    throw new CommercialCutoverContractError(
      `${label}.commercialException must be a string or null`,
    );
  }

  return {
    active: assertBoolean(row.active, `${label}.active`),
    agencyExternalKey: assertString(
      row.agencyExternalKey,
      `${label}.agencyExternalKey`,
    ),
    agreementReference: assertString(
      row.agreementReference,
      `${label}.agreementReference`,
    ),
    ...(commercialException === undefined ? {} : { commercialException }),
    currency: assertString(row.currency, `${label}.currency`),
    endsAt: assertDate(row.endsAt, `${label}.endsAt`),
    grossBooked: assertNumber(row.grossBooked, `${label}.grossBooked`),
    payment: {
      amountCollected: assertNumber(
        payment.amountCollected,
        `${label}.payment.amountCollected`,
      ),
      evidenceObservedAt: assertTimestamp(
        payment.evidenceObservedAt,
        `${label}.payment.evidenceObservedAt`,
      ),
      evidenceRecordedAt: assertTimestamp(
        payment.evidenceRecordedAt,
        `${label}.payment.evidenceRecordedAt`,
      ),
      evidenceSource: assertString(
        payment.evidenceSource,
        `${label}.payment.evidenceSource`,
      ),
      evidenceState: assertLiteral(
        payment.evidenceState,
        ['Current', 'Stale', 'Conflict'],
        `${label}.payment.evidenceState`,
      ),
      evidenceType: assertString(
        payment.evidenceType,
        `${label}.payment.evidenceType`,
      ),
      netCollected: assertNumber(
        payment.netCollected,
        `${label}.payment.netCollected`,
      ),
      refundedOrReversedAmount: assertNumber(
        payment.refundedOrReversedAmount,
        `${label}.payment.refundedOrReversedAmount`,
      ),
      state: assertLiteral(
        payment.state,
        [
          'Pending',
          'Part-paid',
          'Paid',
          'Overdue',
          'Waived',
          'Refunded',
          'Reversed',
        ],
        `${label}.payment.state`,
      ),
      waivedAmount: assertNumber(
        payment.waivedAmount,
        `${label}.payment.waivedAmount`,
      ),
    },
    productExternalKeys: assertStringArray(
      row.productExternalKeys,
      `${label}.productExternalKeys`,
    ),
    renewal: {
      nextAction: assertString(
        renewal.nextAction,
        `${label}.renewal.nextAction`,
      ),
      nextActionAt: assertTimestamp(
        renewal.nextActionAt,
        `${label}.renewal.nextActionAt`,
      ),
      ownerExternalKey: assertString(
        renewal.ownerExternalKey,
        `${label}.renewal.ownerExternalKey`,
      ),
      renewalAt: assertDate(renewal.renewalAt, `${label}.renewal.renewalAt`),
      state: assertLiteral(
        renewal.state,
        ['Renewing', 'Renewed', 'Changed', 'Not Renewing', 'Lapsed'],
        `${label}.renewal.state`,
      ),
    },
    sourceCommercialId: assertString(
      row.sourceCommercialId,
      `${label}.sourceCommercialId`,
    ),
    sourceCreatedAt: assertTimestamp(
      row.sourceCreatedAt,
      `${label}.sourceCreatedAt`,
    ),
    sourceUpdatedAt: assertTimestamp(
      row.sourceUpdatedAt,
      `${label}.sourceUpdatedAt`,
    ),
    startsAt: assertDate(row.startsAt, `${label}.startsAt`),
    term: assertLiteral(
      row.term,
      ['Quarterly', 'Half-yearly', 'Yearly'],
      `${label}.term`,
    ),
    verifierExternalKey: assertString(
      row.verifierExternalKey,
      `${label}.verifierExternalKey`,
    ),
  };
};

const withoutHash = <TValue extends Record<string, unknown>>(
  value: TValue,
  hashKey: keyof TValue,
): Omit<TValue, keyof TValue> => {
  const copy = { ...value };
  delete copy[hashKey];
  return copy;
};

export const createCommercialExport = (
  input: Omit<CommercialExport, 'exportHash' | 'schemaVersion'>,
): CommercialExport => {
  const exportWithoutHash = {
    ...input,
    schemaVersion: EXPORT_SCHEMA_VERSION,
  };
  return {
    ...exportWithoutHash,
    exportHash: hashCanonical(exportWithoutHash),
  };
};

export const validateCommercialExport = (value: unknown): CommercialExport => {
  assertNoProhibitedSourceKeys(value);
  const sourceExport = assertRecord(value, 'export');
  assertExactKeys(
    sourceExport,
    [
      'activeInventoryIds',
      'approval',
      'contractId',
      'exportHash',
      'exportedAt',
      'immutable',
      'rows',
      'schemaVersion',
      'sourceSystem',
    ],
    [
      'activeInventoryIds',
      'approval',
      'contractId',
      'exportHash',
      'exportedAt',
      'immutable',
      'rows',
      'schemaVersion',
      'sourceSystem',
    ],
    'export',
  );
  const approval = assertRecord(sourceExport.approval, 'export.approval');
  assertExactKeys(
    approval,
    ['approvedAt', 'approvedBy', 'evidenceHash'],
    ['approvedAt', 'approvedBy', 'evidenceHash'],
    'export.approval',
  );
  if (!Array.isArray(sourceExport.rows)) {
    throw new CommercialCutoverContractError('export.rows must be an array');
  }

  const parsed: CommercialExport = {
    activeInventoryIds: assertStringArray(
      sourceExport.activeInventoryIds,
      'export.activeInventoryIds',
    ),
    approval: {
      approvedAt: assertTimestamp(
        approval.approvedAt,
        'export.approval.approvedAt',
      ),
      approvedBy: assertString(
        approval.approvedBy,
        'export.approval.approvedBy',
      ),
      evidenceHash: assertHash(
        approval.evidenceHash,
        'export.approval.evidenceHash',
      ),
    },
    contractId: assertString(sourceExport.contractId, 'export.contractId'),
    exportHash: assertHash(sourceExport.exportHash, 'export.exportHash'),
    exportedAt: assertTimestamp(sourceExport.exportedAt, 'export.exportedAt'),
    immutable:
      sourceExport.immutable === true
        ? true
        : (() => {
            throw new CommercialCutoverContractError(
              'export must be approved and immutable',
            );
          })(),
    rows: sourceExport.rows.map(assertCommercialExportRow),
    schemaVersion: assertLiteral(
      sourceExport.schemaVersion,
      [EXPORT_SCHEMA_VERSION],
      'export.schemaVersion',
    ),
    sourceSystem: assertLiteral(
      sourceExport.sourceSystem,
      ['ParyatechOS'],
      'export.sourceSystem',
    ),
  };

  const sourceIds = parsed.rows.map(
    ({ sourceCommercialId }) => sourceCommercialId,
  );
  const agreementReferences = parsed.rows.map(
    ({ agreementReference }) => agreementReference,
  );
  if (
    new Set(sourceIds).size !== sourceIds.length ||
    new Set(agreementReferences).size !== agreementReferences.length
  ) {
    throw new CommercialCutoverContractError(
      'export rows must have unique immutable IDs and Agreement references',
    );
  }
  if (parsed.approval.approvedAt > parsed.exportedAt) {
    throw new CommercialCutoverContractError(
      'export approval cannot occur after export',
    );
  }
  for (const row of parsed.rows) {
    if (
      row.sourceCreatedAt > row.sourceUpdatedAt ||
      row.sourceUpdatedAt > parsed.exportedAt ||
      row.payment.evidenceObservedAt > row.payment.evidenceRecordedAt ||
      row.payment.evidenceRecordedAt > parsed.exportedAt
    ) {
      throw new CommercialCutoverContractError(
        `export row timestamps are not monotonic: ${row.sourceCommercialId}`,
      );
    }
    if (row.active && row.productExternalKeys.length === 0) {
      throw new CommercialCutoverContractError(
        `active Agreement must reference at least one Product: ${row.sourceCommercialId}`,
      );
    }
    if (
      row.currency !== 'INR' &&
      (row.commercialException === undefined ||
        row.commercialException === null ||
        row.commercialException.trim().length === 0)
    ) {
      throw new CommercialCutoverContractError(
        `non-INR Agreement requires an approved commercial exception: ${row.sourceCommercialId}`,
      );
    }
    if (
      row.payment.refundedOrReversedAmount > row.payment.amountCollected ||
      row.payment.netCollected !==
        row.payment.amountCollected - row.payment.refundedOrReversedAmount
    ) {
      throw new CommercialCutoverContractError(
        `payment amounts do not preserve net-collected provenance: ${row.sourceCommercialId}`,
      );
    }
  }
  const actualActiveIds = parsed.rows
    .filter(({ active }) => active)
    .map(({ sourceCommercialId }) => sourceCommercialId)
    .sort();
  const declaredActiveIds = [...parsed.activeInventoryIds].sort();
  if (hashCanonical(actualActiveIds) !== hashCanonical(declaredActiveIds)) {
    throw new CommercialCutoverContractError(
      'export active inventory does not match active rows',
    );
  }
  if (parsed.exportHash !== hashCanonical(withoutHash(parsed, 'exportHash'))) {
    throw new CommercialCutoverContractError(
      'export hash does not match content',
    );
  }
  return parsed;
};

const validateResolutionEntries = (
  value: unknown,
  label: string,
): ResolutionEntry[] => {
  if (!Array.isArray(value)) {
    throw new CommercialCutoverContractError(`${label} must be an array`);
  }
  const entries = value.map((entry, index) => {
    const record = assertRecord(entry, `${label}[${index}]`);
    assertExactKeys(
      record,
      ['externalKey', 'recordId'],
      ['externalKey', 'recordId'],
      `${label}[${index}]`,
    );
    return {
      externalKey: assertString(
        record.externalKey,
        `${label}[${index}].externalKey`,
      ),
      recordId: assertString(record.recordId, `${label}[${index}].recordId`),
    };
  });
  if (
    new Set(entries.map(({ externalKey }) => externalKey)).size !==
    entries.length
  ) {
    throw new CommercialCutoverContractError(
      `${label} contains duplicate keys`,
    );
  }
  return entries;
};

export const createCommercialResolutionSnapshot = (
  input: Omit<CommercialResolutionSnapshot, 'resolutionHash' | 'schemaVersion'>,
): CommercialResolutionSnapshot => {
  const snapshotWithoutHash = {
    ...input,
    schemaVersion: RESOLUTION_SCHEMA_VERSION,
  };
  return {
    ...snapshotWithoutHash,
    resolutionHash: hashCanonical(snapshotWithoutHash),
  };
};

export const validateCommercialResolutionSnapshot = (
  value: unknown,
): CommercialResolutionSnapshot => {
  const snapshot = assertRecord(value, 'resolution');
  assertExactKeys(
    snapshot,
    [
      'agencies',
      'capturedAt',
      'workspaceMembers',
      'products',
      'resolutionHash',
      'schemaVersion',
      'workspaceId',
    ],
    [
      'agencies',
      'capturedAt',
      'workspaceMembers',
      'products',
      'resolutionHash',
      'schemaVersion',
      'workspaceId',
    ],
    'resolution',
  );
  const parsed: CommercialResolutionSnapshot = {
    agencies: validateResolutionEntries(
      snapshot.agencies,
      'resolution.agencies',
    ),
    capturedAt: assertTimestamp(snapshot.capturedAt, 'resolution.capturedAt'),
    workspaceMembers: validateResolutionEntries(
      snapshot.workspaceMembers,
      'resolution.workspaceMembers',
    ),
    products: validateResolutionEntries(
      snapshot.products,
      'resolution.products',
    ),
    resolutionHash: assertHash(
      snapshot.resolutionHash,
      'resolution.resolutionHash',
    ),
    schemaVersion: assertLiteral(
      snapshot.schemaVersion,
      [RESOLUTION_SCHEMA_VERSION],
      'resolution.schemaVersion',
    ),
    workspaceId: assertString(snapshot.workspaceId, 'resolution.workspaceId'),
  };
  if (
    parsed.resolutionHash !==
    hashCanonical(withoutHash(parsed, 'resolutionHash'))
  ) {
    throw new CommercialCutoverContractError(
      'resolution hash does not match content',
    );
  }
  return parsed;
};

const resolutionMap = (entries: ResolutionEntry[]) =>
  new Map(entries.map(({ externalKey, recordId }) => [externalKey, recordId]));

export const prepareCommercialCutover = (input: {
  resolutionSnapshot: unknown;
  review: {
    evidenceHash: string;
    reviewedAt: string;
    reviewedBy: string;
  };
  sourceExport: unknown;
}): PreparedCommercialCutover => {
  const sourceExport = validateCommercialExport(input.sourceExport);
  const resolution = validateCommercialResolutionSnapshot(
    input.resolutionSnapshot,
  );
  const review = {
    evidenceHash: assertHash(input.review.evidenceHash, 'review.evidenceHash'),
    reviewedAt: assertTimestamp(input.review.reviewedAt, 'review.reviewedAt'),
    reviewedBy: assertString(input.review.reviewedBy, 'review.reviewedBy'),
  };
  if (
    sourceExport.exportedAt > resolution.capturedAt ||
    resolution.capturedAt > review.reviewedAt
  ) {
    throw new CommercialCutoverContractError(
      'export, resolution, and review timestamps must be monotonic',
    );
  }

  const agencies = resolutionMap(resolution.agencies);
  const products = resolutionMap(resolution.products);
  const workspaceMembers = resolutionMap(resolution.workspaceMembers);
  const rows = sourceExport.rows.map((source): PreparedCommercialCutoverRow => {
    const agencyRecordId = agencies.get(source.agencyExternalKey) ?? null;
    const productRecordIds = source.productExternalKeys
      .map((key) => products.get(key))
      .filter((recordId): recordId is string => recordId !== undefined)
      .sort();
    const evidenceVerifierRecordId = workspaceMembers.get(
      source.verifierExternalKey,
    );
    const renewalOwnerRecordId = workspaceMembers.get(
      source.renewal.ownerExternalKey,
    );

    if (
      source.active &&
      (agencyRecordId === null ||
        productRecordIds.length !== source.productExternalKeys.length ||
        evidenceVerifierRecordId === undefined ||
        renewalOwnerRecordId === undefined)
    ) {
      throw new CommercialCutoverContractError(
        `Every active row must resolve its Agency, Products, verifier, and renewal owner: ${source.sourceCommercialId}`,
        'UNRESOLVED_ACTIVE_ROW',
      );
    }

    const target: CommercialAgreementTarget = {
      activationConfirmedAt: null,
      activationConfirmer: null,
      activationState: 'Pending',
      adoptionEvidence: null,
      adoptionObservedAt: null,
      adoptionState: 'Not Assessed',
      agency: source.active ? (agencyRecordId ?? '') : '',
      agreementReference: source.agreementReference,
      amountCollected: source.payment.amountCollected,
      commercialException: source.commercialException ?? null,
      currency: source.currency,
      endsAt: source.endsAt,
      evidenceObservedAt: source.payment.evidenceObservedAt,
      evidenceRecordedAt: source.payment.evidenceRecordedAt,
      evidenceSource: source.payment.evidenceSource,
      evidenceState: source.payment.evidenceState,
      evidenceType: source.payment.evidenceType,
      evidenceVerifier: source.active ? (evidenceVerifierRecordId ?? '') : '',
      grossBooked: source.grossBooked,
      netCollected: source.payment.netCollected,
      paryatechOsCommercialReference: source.sourceCommercialId,
      paymentState: source.payment.state,
      products: source.active ? productRecordIds : [],
      refundedOrReversedAmount: source.payment.refundedOrReversedAmount,
      renewalAt: source.renewal.renewalAt,
      renewalNextAction: source.renewal.nextAction,
      renewalNextActionAt: source.renewal.nextActionAt,
      renewalOwner: source.active ? (renewalOwnerRecordId ?? '') : '',
      renewalState: source.renewal.state,
      restrictedNotes: null,
      sourceOpportunity: null,
      startsAt: source.startsAt,
      term: source.term,
      waivedAmount: source.payment.waivedAmount,
    };
    const resolved = source.active;
    return {
      agencyRecordId: resolved ? agencyRecordId : null,
      disposition: resolved ? 'resolved' : 'inactive-quarantine',
      productRecordIds: resolved ? productRecordIds : [],
      source,
      sourceRowHash: hashCanonical(source),
      target,
      targetHash: hashCanonical(target),
    };
  });

  const withoutPreparedHash = {
    activeInventoryHash: hashCanonical(
      [...sourceExport.activeInventoryIds].sort(),
    ),
    resolutionHash: resolution.resolutionHash,
    review,
    rows,
    schemaVersion: PREPARED_SCHEMA_VERSION,
    sourceContractId: sourceExport.contractId,
    sourceExportHash: sourceExport.exportHash,
    sourceExportedAt: sourceExport.exportedAt,
    workspaceId: resolution.workspaceId,
  };
  return {
    ...withoutPreparedHash,
    preparedHash: hashCanonical(withoutPreparedHash),
  };
};

export const createCommercialFreezeProof = (
  input: Omit<CommercialFreezeProof, 'freezeHash' | 'schemaVersion'>,
): CommercialFreezeProof => {
  const proofWithoutHash = {
    ...input,
    schemaVersion: FREEZE_SCHEMA_VERSION,
  };
  return {
    ...proofWithoutHash,
    freezeHash: hashCanonical(proofWithoutHash),
  };
};

export const validateCommercialFreezeProof = (
  value: unknown,
): CommercialFreezeProof => {
  const proof = assertRecord(value, 'freezeProof');
  assertExactKeys(
    proof,
    [
      'commercialMutationDisabled',
      'entitlementMutationEnabled',
      'evidenceHash',
      'freezeHash',
      'freezeId',
      'frozenAt',
      'frozenBy',
      'initialExportHash',
      'schemaVersion',
      'sourceSystem',
    ],
    [
      'commercialMutationDisabled',
      'entitlementMutationEnabled',
      'evidenceHash',
      'freezeHash',
      'freezeId',
      'frozenAt',
      'frozenBy',
      'initialExportHash',
      'schemaVersion',
      'sourceSystem',
    ],
    'freezeProof',
  );
  if (
    proof.commercialMutationDisabled !== true ||
    proof.entitlementMutationEnabled !== true
  ) {
    throw new CommercialCutoverContractError(
      'freeze proof must disable commercial mutation while keeping entitlement mutation enabled',
      'INVALID_FREEZE',
    );
  }
  const parsed: CommercialFreezeProof = {
    commercialMutationDisabled: true,
    entitlementMutationEnabled: true,
    evidenceHash: assertHash(proof.evidenceHash, 'freezeProof.evidenceHash'),
    freezeHash: assertHash(proof.freezeHash, 'freezeProof.freezeHash'),
    freezeId: assertString(proof.freezeId, 'freezeProof.freezeId'),
    frozenAt: assertTimestamp(proof.frozenAt, 'freezeProof.frozenAt'),
    frozenBy: assertString(proof.frozenBy, 'freezeProof.frozenBy'),
    initialExportHash: assertHash(
      proof.initialExportHash,
      'freezeProof.initialExportHash',
    ),
    schemaVersion: assertLiteral(
      proof.schemaVersion,
      [FREEZE_SCHEMA_VERSION],
      'freezeProof.schemaVersion',
    ),
    sourceSystem: assertLiteral(
      proof.sourceSystem,
      ['ParyatechOS'],
      'freezeProof.sourceSystem',
    ),
  };
  if (parsed.freezeHash !== hashCanonical(withoutHash(parsed, 'freezeHash'))) {
    throw new CommercialCutoverContractError(
      'freeze proof hash does not match content',
    );
  }
  return parsed;
};

export const validatePreparedCommercialCutover = (
  value: unknown,
): PreparedCommercialCutover => {
  const prepared = assertRecord(value, 'prepared');
  assertExactKeys(
    prepared,
    [
      'activeInventoryHash',
      'preparedHash',
      'resolutionHash',
      'review',
      'rows',
      'schemaVersion',
      'sourceContractId',
      'sourceExportHash',
      'sourceExportedAt',
      'workspaceId',
    ],
    [
      'activeInventoryHash',
      'preparedHash',
      'resolutionHash',
      'review',
      'rows',
      'schemaVersion',
      'sourceContractId',
      'sourceExportHash',
      'sourceExportedAt',
      'workspaceId',
    ],
    'prepared',
  );
  assertLiteral(
    prepared.schemaVersion,
    [PREPARED_SCHEMA_VERSION],
    'prepared.schemaVersion',
  );
  assertHash(prepared.activeInventoryHash, 'prepared.activeInventoryHash');
  assertHash(prepared.resolutionHash, 'prepared.resolutionHash');
  assertHash(prepared.sourceExportHash, 'prepared.sourceExportHash');
  const sourceExportedAt = assertTimestamp(
    prepared.sourceExportedAt,
    'prepared.sourceExportedAt',
  );
  assertString(prepared.sourceContractId, 'prepared.sourceContractId');
  assertString(prepared.workspaceId, 'prepared.workspaceId');
  const review = assertRecord(prepared.review, 'prepared.review');
  assertExactKeys(
    review,
    ['evidenceHash', 'reviewedAt', 'reviewedBy'],
    ['evidenceHash', 'reviewedAt', 'reviewedBy'],
    'prepared.review',
  );
  assertHash(review.evidenceHash, 'prepared.review.evidenceHash');
  const reviewedAt = assertTimestamp(
    review.reviewedAt,
    'prepared.review.reviewedAt',
  );
  assertString(review.reviewedBy, 'prepared.review.reviewedBy');
  if (sourceExportedAt > reviewedAt) {
    throw new CommercialCutoverContractError(
      'prepared review cannot precede its source export',
    );
  }
  if (!Array.isArray(prepared.rows)) {
    throw new CommercialCutoverContractError('prepared.rows must be an array');
  }

  const activeSourceIds: string[] = [];
  const agreementReferences: string[] = [];
  const sourceIds: string[] = [];
  prepared.rows.forEach((rowValue, index) => {
    const label = `prepared.rows[${index}]`;
    const row = assertRecord(rowValue, label);
    assertExactKeys(
      row,
      [
        'agencyRecordId',
        'disposition',
        'productRecordIds',
        'source',
        'sourceRowHash',
        'target',
        'targetHash',
      ],
      [
        'agencyRecordId',
        'disposition',
        'productRecordIds',
        'source',
        'sourceRowHash',
        'target',
        'targetHash',
      ],
      label,
    );
    const source = assertCommercialExportRow(row.source, index);
    agreementReferences.push(source.agreementReference);
    sourceIds.push(source.sourceCommercialId);
    const disposition = assertLiteral(
      row.disposition,
      ['resolved', 'inactive-quarantine'],
      `${label}.disposition`,
    );
    if (
      (source.active && disposition !== 'resolved') ||
      (!source.active && disposition !== 'inactive-quarantine')
    ) {
      throw new CommercialCutoverContractError(
        `${label} disposition does not match source activity`,
      );
    }
    const agencyRecordId =
      row.agencyRecordId === null
        ? null
        : assertString(row.agencyRecordId, `${label}.agencyRecordId`);
    const productRecordIds = assertStringArray(
      row.productRecordIds,
      `${label}.productRecordIds`,
    );
    if (
      (source.active && agencyRecordId === null) ||
      (!source.active && agencyRecordId !== null) ||
      (!source.active && productRecordIds.length !== 0)
    ) {
      throw new CommercialCutoverContractError(
        `${label} relation disposition is inconsistent`,
      );
    }
    const targetRecord = assertRecord(row.target, `${label}.target`);
    const targetKeys = [
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
    ];
    assertExactKeys(targetRecord, targetKeys, targetKeys, `${label}.target`);
    const targetAgencyRecordId =
      typeof targetRecord.agency === 'string' ? targetRecord.agency : null;
    const evidenceVerifierRecordId =
      typeof targetRecord.evidenceVerifier === 'string'
        ? targetRecord.evidenceVerifier
        : null;
    const renewalOwnerRecordId =
      typeof targetRecord.renewalOwner === 'string'
        ? targetRecord.renewalOwner
        : null;
    const targetProductRecordIds = assertStringArray(
      targetRecord.products,
      `${label}.target.products`,
    );
    if (
      targetAgencyRecordId === null ||
      evidenceVerifierRecordId === null ||
      renewalOwnerRecordId === null ||
      (source.active &&
        (targetAgencyRecordId.length === 0 ||
          evidenceVerifierRecordId.length === 0 ||
          renewalOwnerRecordId.length === 0)) ||
      (!source.active &&
        (targetAgencyRecordId.length !== 0 ||
          evidenceVerifierRecordId.length !== 0 ||
          renewalOwnerRecordId.length !== 0 ||
          targetProductRecordIds.length !== 0)) ||
      hashCanonical(targetProductRecordIds) !==
        hashCanonical(productRecordIds) ||
      targetAgencyRecordId !== (agencyRecordId ?? '')
    ) {
      throw new CommercialCutoverContractError(
        `${label} target relations are inconsistent`,
      );
    }
    const expectedTarget: CommercialAgreementTarget = {
      activationConfirmedAt: null,
      activationConfirmer: null,
      activationState: 'Pending',
      adoptionEvidence: null,
      adoptionObservedAt: null,
      adoptionState: 'Not Assessed',
      agency: agencyRecordId ?? '',
      agreementReference: source.agreementReference,
      amountCollected: source.payment.amountCollected,
      commercialException: source.commercialException ?? null,
      currency: source.currency,
      endsAt: source.endsAt,
      evidenceObservedAt: source.payment.evidenceObservedAt,
      evidenceRecordedAt: source.payment.evidenceRecordedAt,
      evidenceSource: source.payment.evidenceSource,
      evidenceState: source.payment.evidenceState,
      evidenceType: source.payment.evidenceType,
      evidenceVerifier: evidenceVerifierRecordId,
      grossBooked: source.grossBooked,
      netCollected: source.payment.netCollected,
      paryatechOsCommercialReference: source.sourceCommercialId,
      paymentState: source.payment.state,
      products: productRecordIds,
      refundedOrReversedAmount: source.payment.refundedOrReversedAmount,
      renewalAt: source.renewal.renewalAt,
      renewalNextAction: source.renewal.nextAction,
      renewalNextActionAt: source.renewal.nextActionAt,
      renewalOwner: renewalOwnerRecordId,
      renewalState: source.renewal.state,
      restrictedNotes: null,
      sourceOpportunity: null,
      startsAt: source.startsAt,
      term: source.term,
      waivedAmount: source.payment.waivedAmount,
    };
    if (
      assertHash(row.sourceRowHash, `${label}.sourceRowHash`) !==
        hashCanonical(source) ||
      assertHash(row.targetHash, `${label}.targetHash`) !==
        hashCanonical(expectedTarget) ||
      hashCanonical(targetRecord) !== hashCanonical(expectedTarget)
    ) {
      throw new CommercialCutoverContractError(
        `${label} hashes or exact U1 target fields do not match source`,
      );
    }
    if (source.active) {
      activeSourceIds.push(source.sourceCommercialId);
    }
  });
  if (
    new Set(sourceIds).size !== sourceIds.length ||
    new Set(agreementReferences).size !== agreementReferences.length
  ) {
    throw new CommercialCutoverContractError(
      'prepared rows must have unique source IDs and Agreement references',
    );
  }
  if (
    assertHash(prepared.activeInventoryHash, 'prepared.activeInventoryHash') !==
    hashCanonical(activeSourceIds.sort())
  ) {
    throw new CommercialCutoverContractError(
      'prepared active inventory hash does not match resolved rows',
    );
  }
  const preparedHash = assertHash(
    prepared.preparedHash,
    'prepared.preparedHash',
  );
  if (preparedHash !== hashCanonical(withoutHash(prepared, 'preparedHash'))) {
    throw new CommercialCutoverContractError(
      'prepared artifact hash does not match content',
    );
  }
  return value as PreparedCommercialCutover;
};

export const runPrepareCommercialCutoverCli = async ({
  argv,
  workingDirectory = process.cwd(),
  writeStderr,
  writeStdout,
}: {
  argv: string[];
  workingDirectory?: string;
} & CliIo): Promise<number> => {
  try {
    const argumentsByName = parseStrictCliArguments(
      argv,
      [
        '--evidence-hash',
        '--export',
        '--output',
        '--resolution',
        '--reviewed-at',
        '--reviewed-by',
      ],
      [
        '--evidence-hash',
        '--export',
        '--output',
        '--resolution',
        '--reviewed-at',
        '--reviewed-by',
      ],
    );
    const sourceExport = await readPrivateJson(
      argumentsByName['--export']!,
      workingDirectory,
    );
    const resolutionSnapshot = await readPrivateJson(
      argumentsByName['--resolution']!,
      workingDirectory,
    );
    const prepared = prepareCommercialCutover({
      resolutionSnapshot,
      review: {
        evidenceHash: argumentsByName['--evidence-hash']!,
        reviewedAt: argumentsByName['--reviewed-at']!,
        reviewedBy: argumentsByName['--reviewed-by']!,
      },
      sourceExport,
    });
    await writePrivateJsonAtomic(
      argumentsByName['--output']!,
      prepared,
      workingDirectory,
    );
    writeStdout?.(
      JSON.stringify({
        activeCount: prepared.rows.filter(
          ({ disposition }) => disposition === 'resolved',
        ).length,
        event: 'commercial-cutover.prepared',
        inactiveQuarantineCount: prepared.rows.filter(
          ({ disposition }) => disposition === 'inactive-quarantine',
        ).length,
        preparedHash: prepared.preparedHash,
      }),
    );
    return 0;
  } catch (error) {
    writeCliFailure(error, writeStderr);
    return 1;
  }
};

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await runPrepareCommercialCutoverCli({
    argv: process.argv.slice(2),
    writeStderr: (line) => console.error(line),
    writeStdout: (line) => console.log(line),
  });
}
