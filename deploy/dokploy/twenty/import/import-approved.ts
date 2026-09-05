import { pathToFileURL } from 'node:url';

import {
  APPLY_SCHEMA_VERSION,
  APPROVED_SCHEMA_VERSION,
  CHECKPOINT_SCHEMA_VERSION,
  IMPORT_RUN_SCHEMA_VERSION,
  REVOCATION_ATTESTATION_SCHEMA_VERSION,
  REVIEW_DECISIONS,
  ROLLBACK_SCHEMA_VERSION,
  canonicalJson,
  hashCanonical,
  parseStrictCliArguments,
  readPrivateJson,
  sha256,
  writeCliFailure,
  writePrivateJsonAtomic,
  type AcquisitionSourcePayload,
  type ApiEntityResult,
  type ApiOperationContext,
  type ApplyImportResult,
  type ApprovedImportPlan,
  type ApprovedImportRow,
  type ApprovedRowPayload,
  type CheckpointOperation,
  type CheckpointStore,
  type CliIo,
  type CompanySourceRelationPayload,
  type CompanyPayload,
  type ImportCheckpoint,
  type ImportPhase,
  type ImportRunArtifact,
  type PersonPayload,
  type RelationPayload,
  type ReviewDecision,
  type ReviewDecisionRecord,
  type RevocationAttestation,
  type RollbackManifest,
  type StructuredLogger,
  type TwentyApiAdapter,
} from './types.js';

export class ApplyImportError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'CHECKPOINT_MISMATCH'
      | 'INVALID_DECISION'
      | 'INVALID_PLAN'
      | 'INVALID_STATE'
      | 'REVOCATION_FAILED',
  ) {
    super(message);
    this.name = 'ApplyImportError';
  }
}

export class RetryableImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableImportError';
  }
}

type DecisionInput = {
  candidateId?: string | undefined;
  decision: ReviewDecision;
  reason?: string | undefined;
  reviewerId: string;
};

type ReopenInput = {
  reason: string;
  reviewerId: string;
};

type CreatePlanInput = Omit<ApprovedImportPlan, 'planHash' | 'schemaVersion'>;

type ApplyOptions = {
  adapter: TwentyApiAdapter;
  checkpointStore: CheckpointStore;
  logger?: StructuredLogger;
  maxAttempts?: number;
  revokeTemporaryKey: () => Promise<void>;
};

type PlannedOperation =
  | {
      externalKey: string;
      input: AcquisitionSourcePayload;
      phase: 'source';
    }
  | {
      existingRecordId?: string;
      externalKey: string;
      input: CompanyPayload;
      phase: 'company';
    }
  | {
      externalKey: string;
      input: PersonPayload;
      phase: 'person';
    }
  | {
      externalKey: string;
      input: CompanySourceRelationPayload;
      phase: 'company-source-relation';
    }
  | {
      externalKey: string;
      input: RelationPayload;
      phase: 'relation';
    };

const allowedApplyDecisions: ReviewDecision[] = [
  'Confirm Existing Agency',
  'Create New Agency',
  'Keep Separate Contacts',
];

const exactKeys = (
  value: Record<string, unknown>,
  allowedKeys: string[],
  label: string,
): void => {
  const unexpectedKeys = Object.keys(value).filter(
    (key) => !allowedKeys.includes(key),
  );

  if (unexpectedKeys.length > 0) {
    throw new ApplyImportError(
      `${label} contains unsupported fields`,
      'INVALID_PLAN',
    );
  }
};

const assertRecord = (
  value: unknown,
  label: string,
): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApplyImportError(`${label} must be an object`, 'INVALID_PLAN');
  }

  return value as Record<string, unknown>;
};

const assertNonEmptyString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApplyImportError(
      `${label} must be a non-empty string`,
      'INVALID_PLAN',
    );
  }

  return value;
};

const hashReviewer = (reviewerId: string): string =>
  sha256(`reviewer:${reviewerId}`);

const decisionRequiresCandidate = (decision: ReviewDecision): boolean =>
  decision === 'Confirm Existing Agency' ||
  decision === 'Reject Match' ||
  decision === 'Keep Separate Contacts';

export const createOpenDecision = (rowHash: string): ReviewDecisionRecord => ({
  history: [],
  revision: 0,
  rowHash: assertNonEmptyString(rowHash, 'rowHash'),
  state: 'open',
});

export const recordDecision = (
  record: ReviewDecisionRecord,
  input: DecisionInput,
): ReviewDecisionRecord => {
  if (record.state !== 'open' && record.state !== 'reopened') {
    throw new ApplyImportError(
      'Only an open or reopened review can be decided',
      'INVALID_STATE',
    );
  }

  if (!REVIEW_DECISIONS.includes(input.decision)) {
    throw new ApplyImportError('Decision is not approved', 'INVALID_DECISION');
  }

  const reason = input.reason?.trim();
  const candidateId = input.candidateId?.trim();

  if (reason === undefined || reason.length === 0) {
    throw new ApplyImportError(
      'Every decision requires evidence or a reason',
      'INVALID_DECISION',
    );
  }

  if (
    decisionRequiresCandidate(input.decision) &&
    (candidateId === undefined || candidateId.length === 0)
  ) {
    throw new ApplyImportError(
      'This decision requires an explicit candidate',
      'INVALID_DECISION',
    );
  }

  if (!decisionRequiresCandidate(input.decision) && candidateId !== undefined) {
    throw new ApplyImportError(
      'This decision must not select a candidate',
      'INVALID_DECISION',
    );
  }

  const revision = record.revision + 1;
  const historyEntry = {
    action: 'decide' as const,
    ...(candidateId === undefined
      ? {}
      : { candidateIdHash: sha256(`candidate:${candidateId}`) }),
    decision: input.decision,
    evidenceHash: sha256(reason),
    reviewerIdHash: hashReviewer(input.reviewerId),
    revision,
  };

  return {
    ...(candidateId === undefined ? {} : { candidateId }),
    decision: input.decision,
    history: [...record.history, historyEntry],
    reason,
    revision,
    rowHash: record.rowHash,
    state:
      input.decision === 'Quarantine with Reason' ? 'quarantined' : 'decided',
  };
};

export const reopenDecision = (
  record: ReviewDecisionRecord,
  input: ReopenInput,
): ReviewDecisionRecord => {
  if (record.state !== 'decided' && record.state !== 'quarantined') {
    throw new ApplyImportError(
      'Only a decided or quarantined review can reopen before apply',
      'INVALID_STATE',
    );
  }

  const reason = input.reason.trim();

  if (reason.length === 0) {
    throw new ApplyImportError(
      'Reopening requires a reason',
      'INVALID_DECISION',
    );
  }

  const revision = record.revision + 1;

  return {
    history: [
      ...record.history,
      {
        action: 'reopen',
        evidenceHash: sha256(reason),
        reviewerIdHash: hashReviewer(input.reviewerId),
        revision,
      },
    ],
    revision,
    rowHash: record.rowHash,
    state: 'reopened',
  };
};

export const markDecisionApplied = (
  record: ReviewDecisionRecord,
  applyHash: string,
): ReviewDecisionRecord => {
  if (
    record.state !== 'decided' ||
    record.decision === undefined ||
    !allowedApplyDecisions.includes(record.decision)
  ) {
    throw new ApplyImportError(
      'Only an approved apply decision can become applied',
      'INVALID_STATE',
    );
  }

  const revision = record.revision + 1;

  return {
    ...record,
    applyHash,
    history: [
      ...record.history,
      {
        action: 'apply',
        decision: record.decision,
        evidenceHash: sha256(applyHash),
        reviewerIdHash: sha256('system:approved-import'),
        revision,
      },
    ],
    revision,
    state: 'applied',
  };
};

const validateDecisionRecord = (value: unknown): ReviewDecisionRecord => {
  const record = assertRecord(value, 'decision');

  exactKeys(
    record,
    [
      'applyHash',
      'candidateId',
      'decision',
      'history',
      'reason',
      'revision',
      'rowHash',
      'state',
    ],
    'decision',
  );
  assertNonEmptyString(record.rowHash, 'decision.rowHash');

  if (
    !['applied', 'decided', 'open', 'quarantined', 'reopened'].includes(
      String(record.state),
    ) ||
    typeof record.revision !== 'number' ||
    !Number.isInteger(record.revision) ||
    record.revision < 0 ||
    !Array.isArray(record.history)
  ) {
    throw new ApplyImportError('Decision state is invalid', 'INVALID_PLAN');
  }

  const decision =
    record.decision === undefined
      ? undefined
      : (record.decision as ReviewDecision);
  const state = record.state as ReviewDecisionRecord['state'];
  const candidateId =
    record.candidateId === undefined
      ? undefined
      : assertNonEmptyString(record.candidateId, 'decision.candidateId');

  if (decision !== undefined && !REVIEW_DECISIONS.includes(decision)) {
    throw new ApplyImportError('Decision value is invalid', 'INVALID_PLAN');
  }

  const isUndecidedState = state === 'open' || state === 'reopened';
  const isAppliedState = state === 'applied';
  const hasValidDecisionState =
    (isUndecidedState && decision === undefined) ||
    (state === 'quarantined' && decision === 'Quarantine with Reason') ||
    (state === 'decided' &&
      decision !== undefined &&
      decision !== 'Quarantine with Reason') ||
    (isAppliedState &&
      decision !== undefined &&
      allowedApplyDecisions.includes(decision));

  if (!hasValidDecisionState) {
    throw new ApplyImportError(
      'Decision and state contradict each other',
      'INVALID_PLAN',
    );
  }

  if (
    decision !== undefined &&
    ((decisionRequiresCandidate(decision) && candidateId === undefined) ||
      (!decisionRequiresCandidate(decision) && candidateId !== undefined))
  ) {
    throw new ApplyImportError(
      'Decision candidate does not match the decision',
      'INVALID_PLAN',
    );
  }

  if (
    decision !== undefined &&
    (typeof record.reason !== 'string' || record.reason.trim().length === 0)
  ) {
    throw new ApplyImportError('Decision reason is required', 'INVALID_PLAN');
  }

  if (
    (isAppliedState &&
      (typeof record.applyHash !== 'string' ||
        record.applyHash.trim().length === 0)) ||
    (!isAppliedState && record.applyHash !== undefined)
  ) {
    throw new ApplyImportError(
      'Decision apply hash does not match its state',
      'INVALID_PLAN',
    );
  }
  for (const entryValue of record.history) {
    const entry = assertRecord(entryValue, 'decision history entry');

    exactKeys(
      entry,
      [
        'action',
        'candidateIdHash',
        'decision',
        'evidenceHash',
        'reviewerIdHash',
        'revision',
      ],
      'decision history entry',
    );
  }

  return value as ReviewDecisionRecord;
};

const validateSource = (value: unknown): AcquisitionSourcePayload => {
  const source = assertRecord(value, 'source');

  exactKeys(
    source,
    ['externalKey', 'name', 'outreachBasis', 'sourceBatch', 'sourceType'],
    'source',
  );
  for (const key of [
    'externalKey',
    'name',
    'outreachBasis',
    'sourceBatch',
    'sourceType',
  ]) {
    assertNonEmptyString(source[key], `source.${key}`);
  }

  if (
    ![
      'Advertising',
      'Community',
      'Exhibition',
      'Inbound',
      'Other',
      'Partner',
      'Referral',
    ].includes(String(source.sourceType))
  ) {
    throw new ApplyImportError('Source type is invalid', 'INVALID_PLAN');
  }

  return value as AcquisitionSourcePayload;
};

const validateCompany = (value: unknown): CompanyPayload => {
  const company = assertRecord(value, 'company');

  exactKeys(
    company,
    [
      'externalKey',
      'name',
      'normalizedDomain',
      'normalizedPhone',
      'normalizedPostcode',
    ],
    'company',
  );
  assertNonEmptyString(company.externalKey, 'company.externalKey');
  assertNonEmptyString(company.name, 'company.name');

  return value as CompanyPayload;
};

const validatePerson = (value: unknown): PersonPayload => {
  const person = assertRecord(value, 'person');

  exactKeys(
    person,
    ['companyExternalKey', 'email', 'externalKey', 'name', 'phone'],
    'person',
  );
  for (const key of ['companyExternalKey', 'externalKey', 'name']) {
    assertNonEmptyString(person[key], `person.${key}`);
  }

  return value as PersonPayload;
};

const validatePayload = (value: unknown): ApprovedRowPayload => {
  const payload = assertRecord(value, 'payload');

  exactKeys(payload, ['company', 'person', 'source'], 'payload');
  validateSource(payload.source);
  validateCompany(payload.company);
  if (payload.person !== undefined) {
    validatePerson(payload.person);
  }

  return value as ApprovedRowPayload;
};

export const validateApprovedImportPlan = (
  value: unknown,
): ApprovedImportPlan => {
  const plan = assertRecord(value, 'approved plan');

  exactKeys(
    plan,
    ['batchId', 'planHash', 'preparedDatasetHash', 'rows', 'schemaVersion'],
    'approved plan',
  );

  if (plan.schemaVersion !== APPROVED_SCHEMA_VERSION) {
    throw new ApplyImportError(
      'Approved plan schema version is invalid',
      'INVALID_PLAN',
    );
  }

  const batchId = assertNonEmptyString(plan.batchId, 'batchId');
  const preparedDatasetHash = assertNonEmptyString(
    plan.preparedDatasetHash,
    'preparedDatasetHash',
  );
  const planHash = assertNonEmptyString(plan.planHash, 'planHash');

  if (
    !/^[a-f0-9]{64}$/u.test(preparedDatasetHash) ||
    !/^[a-f0-9]{64}$/u.test(planHash) ||
    !Array.isArray(plan.rows)
  ) {
    throw new ApplyImportError(
      'Approved plan hashes are invalid',
      'INVALID_PLAN',
    );
  }

  const rows = plan.rows.map((rowValue) => {
    const row = assertRecord(rowValue, 'approved row');

    exactKeys(row, ['decision', 'payload', 'rowHash'], 'approved row');
    const rowHash = assertNonEmptyString(row.rowHash, 'approved rowHash');
    const decision = validateDecisionRecord(row.decision);

    if (decision.rowHash !== rowHash) {
      throw new ApplyImportError(
        'Decision row hash does not match its payload row',
        'INVALID_PLAN',
      );
    }

    return {
      decision,
      payload: validatePayload(row.payload),
      rowHash,
    };
  });
  const expectedHash = hashCanonical({
    batchId,
    preparedDatasetHash,
    rows,
    schemaVersion: APPROVED_SCHEMA_VERSION,
  });

  if (expectedHash !== planHash) {
    throw new ApplyImportError(
      'Approved plan hash does not match its content',
      'INVALID_PLAN',
    );
  }

  return value as ApprovedImportPlan;
};

export const createApprovedImportPlan = (
  input: CreatePlanInput,
): ApprovedImportPlan => {
  const withoutHash = {
    batchId: input.batchId,
    preparedDatasetHash: input.preparedDatasetHash,
    rows: input.rows,
    schemaVersion: APPROVED_SCHEMA_VERSION,
  };
  const plan = {
    ...withoutHash,
    planHash: hashCanonical(withoutHash),
  };

  return validateApprovedImportPlan(plan);
};

export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly checkpoints: Record<string, ImportCheckpoint> = {};

  async load(planHash: string): Promise<ImportCheckpoint | undefined> {
    return this.checkpoints[planHash] === undefined
      ? undefined
      : structuredClone(this.checkpoints[planHash]);
  }

  async save(checkpoint: ImportCheckpoint): Promise<void> {
    this.checkpoints[checkpoint.planHash] = structuredClone(checkpoint);
  }
}

export class FileCheckpointStore implements CheckpointStore {
  constructor(private readonly filePath: string) {}

  async load(planHash: string): Promise<ImportCheckpoint | undefined> {
    let value: unknown;

    try {
      value = await readPrivateJson(this.filePath);
    } catch (error) {
      if (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return undefined;
      }
      throw error;
    }

    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new ApplyImportError(
        'Checkpoint must be an object',
        'CHECKPOINT_MISMATCH',
      );
    }
    const checkpoint = value as ImportCheckpoint;

    if (
      checkpoint.schemaVersion !== CHECKPOINT_SCHEMA_VERSION ||
      checkpoint.planHash !== planHash
    ) {
      throw new ApplyImportError(
        'Checkpoint does not belong to this plan',
        'CHECKPOINT_MISMATCH',
      );
    }

    return checkpoint;
  }

  async save(checkpoint: ImportCheckpoint): Promise<void> {
    await writePrivateJsonAtomic(this.filePath, checkpoint);
  }
}

const deduplicateByExternalKey = <Payload extends { externalKey: string }>(
  payloads: Payload[],
): Payload[] => {
  const payloadByExternalKey: Record<string, Payload> = {};

  for (const payload of payloads) {
    const existing = payloadByExternalKey[payload.externalKey];

    if (
      existing !== undefined &&
      canonicalJson(existing) !== canonicalJson(payload)
    ) {
      throw new ApplyImportError(
        'The same external key has conflicting approved payloads',
        'INVALID_PLAN',
      );
    }
    payloadByExternalKey[payload.externalKey] = payload;
  }

  return Object.values(payloadByExternalKey).sort((left, right) =>
    left.externalKey.localeCompare(right.externalKey),
  );
};

const buildOperations = (rows: ApprovedImportRow[]): PlannedOperation[] => {
  const eligibleRows = rows.filter(
    (row) =>
      row.decision.state === 'decided' &&
      row.decision.decision !== undefined &&
      allowedApplyDecisions.includes(row.decision.decision),
  );
  const existingRecordIdByCompanyExternalKey: Record<string, string> = {};

  for (const row of eligibleRows) {
    const decision = row.decision.decision;

    if (
      decision !== 'Confirm Existing Agency' &&
      decision !== 'Keep Separate Contacts'
    ) {
      continue;
    }

    const candidateId = row.decision.candidateId;

    if (candidateId === undefined) {
      throw new ApplyImportError(
        'Reviewed existing agency decision has no candidate',
        'INVALID_PLAN',
      );
    }

    const externalKey = row.payload.company.externalKey;
    const existingRecordId = existingRecordIdByCompanyExternalKey[externalKey];

    if (existingRecordId !== undefined && existingRecordId !== candidateId) {
      throw new ApplyImportError(
        'The same company external key targets conflicting candidates',
        'INVALID_PLAN',
      );
    }
    existingRecordIdByCompanyExternalKey[externalKey] = candidateId;
  }
  const sources = deduplicateByExternalKey(
    eligibleRows.map((row) => row.payload.source),
  );
  const companies = deduplicateByExternalKey(
    eligibleRows.map((row) => row.payload.company),
  );
  const people = deduplicateByExternalKey(
    eligibleRows
      .map((row) => row.payload.person)
      .filter((person): person is PersonPayload => person !== undefined),
  );
  const sourceExternalKeyByCompanyExternalKey: Record<string, string> = {};

  for (const row of eligibleRows) {
    const companyExternalKey = row.payload.company.externalKey;
    const sourceExternalKey = row.payload.source.externalKey;
    const existingSourceExternalKey =
      sourceExternalKeyByCompanyExternalKey[companyExternalKey];

    if (
      existingSourceExternalKey !== undefined &&
      existingSourceExternalKey !== sourceExternalKey
    ) {
      throw new ApplyImportError(
        'The same Company has conflicting original Acquisition Sources',
        'INVALID_PLAN',
      );
    }
    sourceExternalKeyByCompanyExternalKey[companyExternalKey] =
      sourceExternalKey;
  }
  const companySourceRelations = Object.entries(
    sourceExternalKeyByCompanyExternalKey,
  )
    .map<CompanySourceRelationPayload>(
      ([companyExternalKey, sourceExternalKey]) => ({
        companyExternalKey,
        sourceExternalKey,
      }),
    )
    .sort((left, right) =>
      left.companyExternalKey.localeCompare(right.companyExternalKey),
    );
  const relations = people
    .map<RelationPayload>((person) => ({
      companyExternalKey: person.companyExternalKey,
      personExternalKey: person.externalKey,
    }))
    .sort((left, right) =>
      left.personExternalKey.localeCompare(right.personExternalKey),
    );

  return [
    ...sources.map((input) => ({
      externalKey: input.externalKey,
      input,
      phase: 'source' as const,
    })),
    ...companies.map((input) => {
      const existingRecordId =
        existingRecordIdByCompanyExternalKey[input.externalKey];

      return {
        externalKey: input.externalKey,
        ...(existingRecordId === undefined ? {} : { existingRecordId }),
        input,
        phase: 'company' as const,
      };
    }),
    ...people.map((input) => ({
      externalKey: input.externalKey,
      input,
      phase: 'person' as const,
    })),
    ...companySourceRelations.map((input) => ({
      externalKey: `${input.companyExternalKey}:${input.sourceExternalKey}`,
      input,
      phase: 'company-source-relation' as const,
    })),
    ...relations.map((input) => ({
      externalKey: `${input.companyExternalKey}:${input.personExternalKey}`,
      input,
      phase: 'relation' as const,
    })),
  ];
};

const executeOperation = async (
  adapter: TwentyApiAdapter,
  operation: PlannedOperation,
  context: ApiOperationContext,
): Promise<ApiEntityResult> => {
  switch (operation.phase) {
    case 'source':
      return adapter.upsertSource(operation.input, context);
    case 'company':
      return adapter.upsertCompany(operation.input, context);
    case 'person':
      return adapter.upsertPerson(operation.input, context);
    case 'company-source-relation':
      return adapter.linkCompanyToSource(operation.input, context);
    case 'relation':
      return adapter.linkPersonToCompany(operation.input, context);
  }
};

const executeWithRetry = async (
  operation: () => Promise<ApiEntityResult>,
  maxAttempts: number,
): Promise<ApiEntityResult> => {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof RetryableImportError) || attempt === maxAttempts) {
        throw error;
      }
    }
  }

  throw new ApplyImportError('Retry loop exhausted', 'INVALID_STATE');
};

const createCheckpoint = (plan: ApprovedImportPlan): ImportCheckpoint => ({
  batchId: plan.batchId,
  completedOperations: {},
  planHash: plan.planHash,
  schemaVersion: CHECKPOINT_SCHEMA_VERSION,
});

const countDecisions = (
  plan: ApprovedImportPlan,
  decision: ReviewDecision,
): number =>
  plan.rows.filter((row) => row.decision.decision === decision).length;

const createRollbackManifest = (
  checkpoint: ImportCheckpoint,
): RollbackManifest => ({
  batchId: checkpoint.batchId,
  operations: Object.values(checkpoint.completedOperations)
    .sort((left, right) =>
      left.idempotencyKey.localeCompare(right.idempotencyKey),
    )
    .map((operation) => ({
      created: operation.created,
      entityId: operation.entityId,
      externalKeyHash: operation.externalKeyHash,
      phase: operation.phase,
      rollbackAction: operation.created
        ? ('delete-if-created' as const)
        : ('restore-reviewed-snapshot' as const),
    })),
  planHash: checkpoint.planHash,
  schemaVersion: ROLLBACK_SCHEMA_VERSION,
});

export const applyApprovedImport = async (
  unvalidatedPlan: ApprovedImportPlan,
  options: ApplyOptions,
): Promise<ApplyImportResult> => {
  const plan = validateApprovedImportPlan(unvalidatedPlan);
  const maxAttempts = options.maxAttempts ?? 3;

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new ApplyImportError(
      'Retry attempts must be between one and five',
      'INVALID_PLAN',
    );
  }

  let checkpoint =
    (await options.checkpointStore.load(plan.planHash)) ??
    createCheckpoint(plan);

  if (
    checkpoint.planHash !== plan.planHash ||
    checkpoint.batchId !== plan.batchId ||
    checkpoint.schemaVersion !== CHECKPOINT_SCHEMA_VERSION
  ) {
    throw new ApplyImportError(
      'Checkpoint does not match the approved plan',
      'CHECKPOINT_MISMATCH',
    );
  }

  const operations = buildOperations(plan.rows);
  let skippedCheckpointOperations = 0;
  let applyError: unknown;
  let result: ApplyImportResult | undefined;

  options.logger?.({
    event: 'apply.started',
    fields: {
      batchIdHash: sha256(plan.batchId),
      operations: operations.length,
      planHash: plan.planHash,
    },
  });

  try {
    for (const operation of operations) {
      const idempotencyKey = sha256(
        `${plan.planHash}:${operation.phase}:${operation.externalKey}`,
      );

      if (checkpoint.completedOperations[idempotencyKey] !== undefined) {
        skippedCheckpointOperations += 1;
        continue;
      }

      const context: ApiOperationContext = { idempotencyKey };
      if (
        operation.phase === 'company' &&
        operation.existingRecordId !== undefined
      ) {
        context.existingRecordId = operation.existingRecordId;
      }

      if (operation.phase === 'company-source-relation') {
        const relation = operation.input;
        const companyIdempotencyKey = sha256(
          `${plan.planHash}:company:${relation.companyExternalKey}`,
        );
        const sourceIdempotencyKey = sha256(
          `${plan.planHash}:source:${relation.sourceExternalKey}`,
        );
        const companyRecordId =
          checkpoint.completedOperations[companyIdempotencyKey]?.entityId;
        const sourceRecordId =
          checkpoint.completedOperations[sourceIdempotencyKey]?.entityId;

        if (companyRecordId === undefined || sourceRecordId === undefined) {
          throw new ApplyImportError(
            'Company-source dependencies are missing from the checkpoint',
            'CHECKPOINT_MISMATCH',
          );
        }
        context.companyRecordId = companyRecordId;
        context.sourceRecordId = sourceRecordId;
      }

      if (operation.phase === 'relation') {
        const relation = operation.input;
        const companyIdempotencyKey = sha256(
          `${plan.planHash}:company:${relation.companyExternalKey}`,
        );
        const personIdempotencyKey = sha256(
          `${plan.planHash}:person:${relation.personExternalKey}`,
        );
        const companyRecordId =
          checkpoint.completedOperations[companyIdempotencyKey]?.entityId;
        const personRecordId =
          checkpoint.completedOperations[personIdempotencyKey]?.entityId;

        if (companyRecordId === undefined || personRecordId === undefined) {
          throw new ApplyImportError(
            'Relation dependencies are missing from the checkpoint',
            'CHECKPOINT_MISMATCH',
          );
        }
        context.companyRecordId = companyRecordId;
        context.personRecordId = personRecordId;
      }

      const operationResult = await executeWithRetry(
        () => executeOperation(options.adapter, operation, context),
        maxAttempts,
      );
      const completedOperation: CheckpointOperation = {
        created: operationResult.created,
        entityId: operationResult.id,
        externalKeyHash: sha256(operation.externalKey),
        idempotencyKey,
        phase: operation.phase,
      };

      checkpoint = {
        ...checkpoint,
        completedOperations: {
          ...checkpoint.completedOperations,
          [idempotencyKey]: completedOperation,
        },
      };
      await options.checkpointStore.save(checkpoint);
      options.logger?.({
        event: 'apply.operation.completed',
        fields: {
          created: operationResult.created,
          externalKeyHash: completedOperation.externalKeyHash,
          idempotencyKey,
          phase: operation.phase,
          planHash: plan.planHash,
        },
      });
    }

    const rollbackManifest = createRollbackManifest(checkpoint);
    const rollbackManifestHash = hashCanonical(rollbackManifest);
    const checkpointHash = hashCanonical(checkpoint);
    const completedByPhase = (phase: ImportPhase) =>
      Object.values(checkpoint.completedOperations).filter(
        (operation) => operation.phase === phase,
      ).length;
    const counts = {
      appliedRows: plan.rows.filter(
        (row) =>
          row.decision.state === 'decided' &&
          row.decision.decision !== undefined &&
          allowedApplyDecisions.includes(row.decision.decision),
      ).length,
      companySourceRelations: completedByPhase('company-source-relation'),
      companies: completedByPhase('company'),
      people: completedByPhase('person'),
      quarantinedRows: countDecisions(plan, 'Quarantine with Reason'),
      rejectedRows: countDecisions(plan, 'Reject Match'),
      relations: completedByPhase('relation'),
      skippedCheckpointOperations,
      sources: completedByPhase('source'),
    };
    const applyHash = hashCanonical({
      batchId: plan.batchId,
      checkpointHash,
      counts: { ...counts, skippedCheckpointOperations: 0 },
      planHash: plan.planHash,
      rollbackManifestHash,
      schemaVersion: APPLY_SCHEMA_VERSION,
    });

    result = {
      applyHash,
      batchId: plan.batchId,
      checkpointHash,
      counts,
      planHash: plan.planHash,
      rollbackManifest,
      rollbackManifestHash,
      schemaVersion: APPLY_SCHEMA_VERSION,
    };
    options.logger?.({
      event: 'apply.completed',
      fields: {
        applyHash,
        batchIdHash: sha256(plan.batchId),
        operations: operations.length,
        planHash: plan.planHash,
        rollbackManifestHash,
      },
    });
  } catch (error) {
    applyError = error;
    options.logger?.({
      event: 'apply.failed',
      fields: {
        batchIdHash: sha256(plan.batchId),
        errorType: error instanceof Error ? error.name : 'UnknownError',
        planHash: plan.planHash,
      },
    });
  }

  try {
    await options.revokeTemporaryKey();
    options.logger?.({
      event: 'apply.credential-released',
      fields: { batchIdHash: sha256(plan.batchId), planHash: plan.planHash },
    });
  } catch {
    throw new ApplyImportError(
      'Temporary import key revocation failed',
      'REVOCATION_FAILED',
    );
  }

  if (applyError !== undefined) {
    throw applyError;
  }

  if (result === undefined) {
    throw new ApplyImportError('Apply produced no result', 'INVALID_STATE');
  }

  return result;
};

type GraphqlAdapterOptions = {
  baseUrl: string;
  fetchImplementation?: typeof fetch;
  getApiKey: () => string | undefined;
};

type GraphqlObjectDescriptor = {
  createInputType: string;
  keyField: string;
  pluralName: string;
  singularName: string;
  updateInputType: string;
};

type GraphqlResponse = {
  data?: Record<string, unknown>;
  errors?: Array<{ extensions?: { code?: unknown } }>;
};

class TwentyGraphqlError extends Error {
  constructor(
    readonly code:
      | 'GRAPHQL_ERROR'
      | 'HTTP_ERROR'
      | 'INVALID_RESPONSE'
      | 'SOURCE_RELATION_CONFLICT',
    readonly operationName: string,
    readonly status?: number,
  ) {
    super(`Twenty GraphQL ${code.toLowerCase().replaceAll('_', ' ')}`);
    this.name = 'TwentyGraphqlError';
  }
}

class RetryableTwentyGraphqlError extends RetryableImportError {
  readonly code = 'RETRYABLE_API_ERROR';

  constructor(
    readonly operationName: string,
    readonly status?: number,
  ) {
    super('Twenty GraphQL request failed transiently');
    this.name = 'RetryableTwentyGraphqlError';
  }
}

const RETRYABLE_GRAPHQL_CODES = new Set([
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE',
  'TIMEOUT',
  'TOO_MANY_REQUESTS',
]);

const assertGraphqlBaseUrl = (value: string): URL => {
  let baseUrl: URL;

  try {
    baseUrl = new URL(value);
  } catch {
    throw new ApplyImportError('TWENTY_BASE_URL is invalid', 'INVALID_PLAN');
  }

  if (
    baseUrl.protocol !== 'https:' ||
    baseUrl.username.length > 0 ||
    baseUrl.password.length > 0 ||
    baseUrl.search.length > 0 ||
    baseUrl.hash.length > 0
  ) {
    throw new ApplyImportError(
      'TWENTY_BASE_URL must be an HTTPS origin without credentials',
      'INVALID_PLAN',
    );
  }

  return new URL('/graphql', baseUrl);
};

const capitalize = (value: string): string =>
  `${value[0]!.toUpperCase()}${value.slice(1)}`;

export const createTwentyGraphqlAdapter = (
  options: GraphqlAdapterOptions,
): TwentyApiAdapter => {
  const endpoint = assertGraphqlBaseUrl(options.baseUrl);
  const fetchImplementation = options.fetchImplementation ?? fetch;

  const request = async (
    operationName: string,
    query: string,
    variables: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<Record<string, unknown>> => {
    const apiKey = options.getApiKey();

    if (apiKey === undefined || apiKey.length === 0) {
      throw new ApplyImportError(
        'Temporary API key is unavailable',
        'INVALID_STATE',
      );
    }

    let response: Response;

    try {
      response = await fetchImplementation(endpoint, {
        body: canonicalJson({ operationName, query, variables }),
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        method: 'POST',
        redirect: 'error',
      });
    } catch {
      throw new RetryableTwentyGraphqlError(operationName);
    }

    let payload: GraphqlResponse;

    try {
      payload = (await response.json()) as GraphqlResponse;
    } catch {
      if (
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500
      ) {
        throw new RetryableTwentyGraphqlError(operationName, response.status);
      }
      throw new TwentyGraphqlError(
        'INVALID_RESPONSE',
        operationName,
        response.status,
      );
    }

    if (!response.ok) {
      if (
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500
      ) {
        throw new RetryableTwentyGraphqlError(operationName, response.status);
      }
      throw new TwentyGraphqlError(
        'HTTP_ERROR',
        operationName,
        response.status,
      );
    }

    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      const retryable = payload.errors.some((error) => {
        const code = error.extensions?.code;

        return typeof code === 'string' && RETRYABLE_GRAPHQL_CODES.has(code);
      });

      if (retryable) {
        throw new RetryableTwentyGraphqlError(operationName, response.status);
      }
      throw new TwentyGraphqlError(
        'GRAPHQL_ERROR',
        operationName,
        response.status,
      );
    }

    if (
      payload.data === undefined ||
      payload.data === null ||
      typeof payload.data !== 'object'
    ) {
      throw new TwentyGraphqlError(
        'INVALID_RESPONSE',
        operationName,
        response.status,
      );
    }

    return payload.data;
  };

  const upsertObject = async (
    descriptor: GraphqlObjectDescriptor,
    externalKey: string,
    data: Record<string, unknown>,
    context: ApiOperationContext,
  ): Promise<ApiEntityResult> => {
    let existingRecordId = context.existingRecordId;

    if (existingRecordId === undefined) {
      const findOperationName = `Find${capitalize(descriptor.singularName)}ByExternalKey`;
      const findData = await request(
        findOperationName,
        `query ${findOperationName}($externalKey: String!) {
          ${descriptor.pluralName}(filter: { ${descriptor.keyField}: { eq: $externalKey } }, first: 2) {
            edges { node { id } }
          }
        }`,
        { externalKey },
        context.idempotencyKey,
      );
      const connection = findData[descriptor.pluralName] as
        | { edges?: Array<{ node?: { id?: unknown } }> }
        | undefined;
      const identifiers = (connection?.edges ?? [])
        .map((edge) => edge.node?.id)
        .filter(
          (identifier): identifier is string => typeof identifier === 'string',
        );

      if (identifiers.length > 1) {
        throw new TwentyGraphqlError('INVALID_RESPONSE', findOperationName);
      }
      existingRecordId = identifiers[0];
    }

    if (existingRecordId !== undefined) {
      const operationName = `Update${capitalize(descriptor.singularName)}`;
      const fieldName = `update${capitalize(descriptor.singularName)}`;
      const responseData = await request(
        operationName,
        `mutation ${operationName}($id: UUID!, $data: ${descriptor.updateInputType}!) {
          ${fieldName}(id: $id, data: $data) { id }
        }`,
        { data, id: existingRecordId },
        context.idempotencyKey,
      );
      const result = responseData[fieldName] as { id?: unknown } | undefined;

      if (typeof result?.id !== 'string') {
        throw new TwentyGraphqlError('INVALID_RESPONSE', operationName);
      }

      return { created: false, id: result.id };
    }

    const operationName = `Create${capitalize(descriptor.singularName)}`;
    const fieldName = `create${capitalize(descriptor.singularName)}`;
    const responseData = await request(
      operationName,
      `mutation ${operationName}($data: ${descriptor.createInputType}!) {
        ${fieldName}(data: $data) { id }
      }`,
      { data },
      context.idempotencyKey,
    );
    const result = responseData[fieldName] as { id?: unknown } | undefined;

    if (typeof result?.id !== 'string') {
      throw new TwentyGraphqlError('INVALID_RESPONSE', operationName);
    }

    return { created: true, id: result.id };
  };

  const sourceDescriptor: GraphqlObjectDescriptor = {
    createInputType: 'AcquisitionSourceCreateInput',
    keyField: 'sourceExternalKey',
    pluralName: 'acquisitionSources',
    singularName: 'acquisitionSource',
    updateInputType: 'AcquisitionSourceUpdateInput',
  };
  const companyDescriptor: GraphqlObjectDescriptor = {
    createInputType: 'CompanyCreateInput',
    keyField: 'agencyExternalKey',
    pluralName: 'companies',
    singularName: 'company',
    updateInputType: 'CompanyUpdateInput',
  };
  const personDescriptor: GraphqlObjectDescriptor = {
    createInputType: 'PersonCreateInput',
    keyField: 'personExternalKey',
    pluralName: 'people',
    singularName: 'person',
    updateInputType: 'PersonUpdateInput',
  };

  return {
    linkCompanyToSource: async (_input, context) => {
      if (
        context.companyRecordId === undefined ||
        context.sourceRecordId === undefined
      ) {
        throw new ApplyImportError(
          'Company-source operation requires resolved record IDs',
          'CHECKPOINT_MISMATCH',
        );
      }

      const inspectOperationName = 'GetCompanyOriginalAcquisitionSource';
      const inspectData = await request(
        inspectOperationName,
        `query ${inspectOperationName}($id: UUID!) {
          companies(filter: { id: { eq: $id } }, first: 1) {
            edges { node { id originalAcquisitionSource { id } } }
          }
        }`,
        { id: context.companyRecordId },
        context.idempotencyKey,
      );
      const connection = inspectData.companies as
        | {
            edges?: Array<{
              node?: {
                id?: unknown;
                originalAcquisitionSource?: { id?: unknown } | null;
              };
            }>;
          }
        | undefined;
      const company = connection?.edges?.[0]?.node;

      if (company?.id !== context.companyRecordId) {
        throw new TwentyGraphqlError('INVALID_RESPONSE', inspectOperationName);
      }

      const existingSourceId = company.originalAcquisitionSource?.id;

      if (
        typeof existingSourceId === 'string' &&
        existingSourceId !== context.sourceRecordId
      ) {
        throw new TwentyGraphqlError(
          'SOURCE_RELATION_CONFLICT',
          inspectOperationName,
        );
      }

      if (existingSourceId === context.sourceRecordId) {
        return { created: false, id: context.companyRecordId };
      }

      const operationName = 'LinkCompanyToSource';
      const responseData = await request(
        operationName,
        `mutation ${operationName}($id: UUID!, $data: CompanyUpdateInput!) {
          updateCompany(id: $id, data: $data) { id }
        }`,
        {
          data: { originalAcquisitionSourceId: context.sourceRecordId },
          id: context.companyRecordId,
        },
        context.idempotencyKey,
      );
      const result = responseData.updateCompany as { id?: unknown } | undefined;

      if (typeof result?.id !== 'string') {
        throw new TwentyGraphqlError('INVALID_RESPONSE', operationName);
      }

      return { created: false, id: result.id };
    },
    linkPersonToCompany: async (_input, context) => {
      if (
        context.companyRecordId === undefined ||
        context.personRecordId === undefined
      ) {
        throw new ApplyImportError(
          'Relation operation requires resolved record IDs',
          'CHECKPOINT_MISMATCH',
        );
      }

      const operationName = 'LinkPersonToCompany';
      const responseData = await request(
        operationName,
        `mutation ${operationName}($id: UUID!, $data: PersonUpdateInput!) {
          updatePerson(id: $id, data: $data) { id }
        }`,
        {
          data: { companyId: context.companyRecordId },
          id: context.personRecordId,
        },
        context.idempotencyKey,
      );
      const result = responseData.updatePerson as { id?: unknown } | undefined;

      if (typeof result?.id !== 'string') {
        throw new TwentyGraphqlError('INVALID_RESPONSE', operationName);
      }

      return { created: false, id: result.id };
    },
    upsertCompany: (input, context) => {
      if (context.existingRecordId !== undefined) {
        return Promise.resolve({
          created: false,
          id: context.existingRecordId,
        });
      }

      return upsertObject(
        companyDescriptor,
        input.externalKey,
        {
          agencyExternalKey: input.externalKey,
          name: input.name,
          ...(input.normalizedDomain === undefined
            ? {}
            : { primaryDomain: input.normalizedDomain }),
        },
        context,
      );
    },
    upsertPerson: (input, context) =>
      upsertObject(
        personDescriptor,
        input.externalKey,
        {
          personExternalKey: input.externalKey,
          name: { firstName: input.name, lastName: '' },
          ...(input.email === undefined
            ? {}
            : {
                emails: {
                  additionalEmails: [],
                  primaryEmail: input.email,
                },
              }),
          ...(input.phone === undefined
            ? {}
            : {
                phones: {
                  additionalPhones: [],
                  primaryPhoneCallingCode: '',
                  primaryPhoneNumber: input.phone,
                },
              }),
        },
        context,
      ),
    upsertSource: (input, context) =>
      upsertObject(
        sourceDescriptor,
        input.externalKey,
        {
          name: input.name,
          outreachBasis: input.outreachBasis,
          sourceBatch: input.sourceBatch,
          sourceExternalKey: input.externalKey,
          sourceType: input.sourceType,
        },
        context,
      ),
  };
};

export const validateImportRunArtifact = (
  value: unknown,
): ImportRunArtifact => {
  const artifact = assertRecord(value, 'import run artifact');

  exactKeys(
    artifact,
    [
      'administratorEvidenceHash',
      'apiKeyFingerprint',
      'applyResult',
      'planHash',
      'revocationStatus',
      'revokedAt',
      'schemaVersion',
    ],
    'import run artifact',
  );

  if (
    artifact.schemaVersion !== IMPORT_RUN_SCHEMA_VERSION ||
    !/^[a-f0-9]{64}$/u.test(String(artifact.apiKeyFingerprint)) ||
    !/^[a-f0-9]{64}$/u.test(String(artifact.planHash)) ||
    (artifact.revocationStatus !== 'pending' &&
      artifact.revocationStatus !== 'verified')
  ) {
    throw new ApplyImportError(
      'Import run artifact is invalid',
      'INVALID_PLAN',
    );
  }

  const applyResult = assertRecord(artifact.applyResult, 'apply result');

  if (
    applyResult.schemaVersion !== APPLY_SCHEMA_VERSION ||
    applyResult.planHash !== artifact.planHash
  ) {
    throw new ApplyImportError(
      'Import run apply result is invalid',
      'INVALID_PLAN',
    );
  }

  if (
    artifact.revocationStatus === 'verified' &&
    (!/^[a-f0-9]{64}$/u.test(String(artifact.administratorEvidenceHash)) ||
      typeof artifact.revokedAt !== 'string' ||
      !Number.isFinite(Date.parse(artifact.revokedAt)))
  ) {
    throw new ApplyImportError(
      'Verified revocation evidence is invalid',
      'INVALID_PLAN',
    );
  }

  return value as ImportRunArtifact;
};

export const readVerifiedImportRunArtifact = async (
  filePath: string,
): Promise<ImportRunArtifact> => {
  const artifact = validateImportRunArtifact(await readPrivateJson(filePath));

  if (artifact.revocationStatus !== 'verified') {
    throw new ApplyImportError(
      'Administrator revocation attestation is required',
      'REVOCATION_FAILED',
    );
  }

  return artifact;
};

const validateRevocationAttestation = (
  value: unknown,
): RevocationAttestation => {
  const attestation = assertRecord(value, 'revocation attestation');

  exactKeys(
    attestation,
    [
      'administratorEvidenceHash',
      'apiKeyFingerprint',
      'planHash',
      'revokedAt',
      'schemaVersion',
    ],
    'revocation attestation',
  );

  if (
    attestation.schemaVersion !== REVOCATION_ATTESTATION_SCHEMA_VERSION ||
    !/^[a-f0-9]{64}$/u.test(String(attestation.administratorEvidenceHash)) ||
    !/^[a-f0-9]{64}$/u.test(String(attestation.apiKeyFingerprint)) ||
    !/^[a-f0-9]{64}$/u.test(String(attestation.planHash)) ||
    typeof attestation.revokedAt !== 'string' ||
    !Number.isFinite(Date.parse(attestation.revokedAt))
  ) {
    throw new ApplyImportError(
      'Revocation attestation is invalid',
      'REVOCATION_FAILED',
    );
  }

  return value as RevocationAttestation;
};

type ApprovedImportCliOptions = CliIo & {
  argv: string[];
  environment: NodeJS.ProcessEnv;
  fetchImplementation?: typeof fetch;
};

const runApplyCommand = async (
  options: ApprovedImportCliOptions,
  commandArguments: string[],
): Promise<number> => {
  const argumentsByName = parseStrictCliArguments(
    commandArguments,
    ['--approved', '--checkpoint', '--result', '--rollback'],
    ['--approved', '--checkpoint', '--result', '--rollback'],
  );
  const baseUrl = options.environment.TWENTY_BASE_URL;
  let apiKey = options.environment.TWENTY_API_KEY;

  try {
    if (
      typeof baseUrl !== 'string' ||
      baseUrl.length === 0 ||
      typeof apiKey !== 'string' ||
      apiKey.length === 0
    ) {
      throw new ApplyImportError(
        'TWENTY_BASE_URL and TWENTY_API_KEY are required',
        'INVALID_PLAN',
      );
    }

    const apiKeyFingerprint = sha256(`temporary-key:${apiKey}`);
    const logger: StructuredLogger = (event) =>
      options.writeStderr?.(canonicalJson(event));

    const plan = validateApprovedImportPlan(
      await readPrivateJson(argumentsByName['--approved']!),
    );
    const result = await applyApprovedImport(plan, {
      adapter: createTwentyGraphqlAdapter({
        baseUrl,
        ...(options.fetchImplementation === undefined
          ? {}
          : { fetchImplementation: options.fetchImplementation }),
        getApiKey: () => apiKey,
      }),
      checkpointStore: new FileCheckpointStore(
        argumentsByName['--checkpoint']!,
      ),
      logger,
      revokeTemporaryKey: async () => {
        apiKey = undefined;
        delete options.environment.TWENTY_API_KEY;
      },
    });
    const artifact: ImportRunArtifact = {
      apiKeyFingerprint,
      applyResult: result,
      planHash: plan.planHash,
      revocationStatus: 'pending',
      schemaVersion: IMPORT_RUN_SCHEMA_VERSION,
    };

    await writePrivateJsonAtomic(
      argumentsByName['--rollback']!,
      result.rollbackManifest,
    );
    await writePrivateJsonAtomic(argumentsByName['--result']!, artifact);
    options.writeStdout?.(
      canonicalJson({
        applyHash: result.applyHash,
        event: 'apply.awaiting-revocation-attestation',
        planHash: plan.planHash,
      }),
    );

    return 2;
  } finally {
    apiKey = undefined;
    delete options.environment.TWENTY_API_KEY;
  }
};

const runAttestCommand = async (
  options: ApprovedImportCliOptions,
  commandArguments: string[],
): Promise<number> => {
  const argumentsByName = parseStrictCliArguments(
    commandArguments,
    ['--attestation', '--result'],
    ['--attestation', '--result'],
  );
  const resultPath = argumentsByName['--result']!;
  const artifact = validateImportRunArtifact(await readPrivateJson(resultPath));
  const attestation = validateRevocationAttestation(
    await readPrivateJson(argumentsByName['--attestation']!),
  );

  if (
    artifact.planHash !== attestation.planHash ||
    artifact.apiKeyFingerprint !== attestation.apiKeyFingerprint
  ) {
    throw new ApplyImportError(
      'Revocation attestation does not match the import run',
      'REVOCATION_FAILED',
    );
  }

  const verifiedArtifact: ImportRunArtifact = {
    ...artifact,
    administratorEvidenceHash: attestation.administratorEvidenceHash,
    revocationStatus: 'verified',
    revokedAt: attestation.revokedAt,
  };

  await writePrivateJsonAtomic(resultPath, verifiedArtifact);
  options.writeStdout?.(
    canonicalJson({
      event: 'apply.revocation-attested',
      planHash: artifact.planHash,
    }),
  );

  return 0;
};

const runSealCommand = async (
  options: ApprovedImportCliOptions,
  commandArguments: string[],
): Promise<number> => {
  const argumentsByName = parseStrictCliArguments(
    commandArguments,
    ['--approved', '--decision-input'],
    ['--approved', '--decision-input'],
  );
  const value = await readPrivateJson(argumentsByName['--decision-input']!);
  const input = assertRecord(value, 'decision input');

  exactKeys(
    input,
    ['batchId', 'preparedDatasetHash', 'rows'],
    'decision input',
  );

  if (!Array.isArray(input.rows)) {
    throw new ApplyImportError(
      'Decision input rows must be an array',
      'INVALID_PLAN',
    );
  }

  const rows = input.rows.map((rowValue) => {
    const row = assertRecord(rowValue, 'decision input row');

    exactKeys(
      row,
      ['candidateId', 'decision', 'payload', 'reason', 'reviewerId', 'rowHash'],
      'decision input row',
    );
    const rowHash = assertNonEmptyString(row.rowHash, 'decision rowHash');
    const decision = row.decision;

    if (
      typeof decision !== 'string' ||
      !REVIEW_DECISIONS.includes(decision as ReviewDecision)
    ) {
      throw new ApplyImportError(
        'Decision input contains an invalid decision',
        'INVALID_DECISION',
      );
    }

    return {
      decision: recordDecision(createOpenDecision(rowHash), {
        ...(row.candidateId === undefined
          ? {}
          : {
              candidateId: assertNonEmptyString(
                row.candidateId,
                'decision candidateId',
              ),
            }),
        decision: decision as ReviewDecision,
        reason: assertNonEmptyString(row.reason, 'decision reason'),
        reviewerId: assertNonEmptyString(row.reviewerId, 'decision reviewerId'),
      }),
      payload: validatePayload(row.payload),
      rowHash,
    };
  });
  const plan = createApprovedImportPlan({
    batchId: assertNonEmptyString(input.batchId, 'decision batchId'),
    preparedDatasetHash: assertNonEmptyString(
      input.preparedDatasetHash,
      'decision preparedDatasetHash',
    ),
    rows,
  });

  await writePrivateJsonAtomic(argumentsByName['--approved']!, plan);
  options.writeStdout?.(
    canonicalJson({
      event: 'apply.plan-sealed',
      planHash: plan.planHash,
      rows: plan.rows.length,
    }),
  );

  return 0;
};

export const runApprovedImportCli = async (
  options: ApprovedImportCliOptions,
): Promise<number> => {
  const [command, ...commandArguments] = options.argv;

  try {
    if (command === 'seal') {
      return await runSealCommand(options, commandArguments);
    }
    if (command === 'apply') {
      return await runApplyCommand(options, commandArguments);
    }
    if (command === 'attest') {
      return await runAttestCommand(options, commandArguments);
    }
    throw new ApplyImportError(
      'Expected seal, apply, or attest command',
      'INVALID_PLAN',
    );
  } catch (error) {
    writeCliFailure(error, options.writeStderr);

    return 1;
  }
};

const isApprovedImportCliMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isApprovedImportCliMain) {
  process.exitCode = await runApprovedImportCli({
    argv: process.argv.slice(2),
    environment: process.env,
    writeStderr: (line) => process.stderr.write(`${line}\n`),
    writeStdout: (line) => process.stdout.write(`${line}\n`),
  });
}
