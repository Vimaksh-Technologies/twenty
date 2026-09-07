import { pathToFileURL } from 'node:url';

import {
  type CliIo,
  hashCanonical,
  parseStrictCliArguments,
  readPrivateJson,
  writeCliFailure,
  writePrivateJsonAtomic,
} from './types.js';
import {
  CommercialCutoverContractError,
  type CommercialAgreementTarget,
  type CommercialExport,
  type CommercialFreezeProof,
  type PreparedCommercialCutover,
  validateCommercialExport,
  validateCommercialFreezeProof,
  validatePreparedCommercialCutover,
} from './prepare-commercial-cutover.js';

const APPLY_SCHEMA_VERSION = 'paryatech-commercial-cutover-apply/v1' as const;
const DRY_RUN_SCHEMA_VERSION =
  'paryatech-commercial-cutover-dry-run/v1' as const;
const CHECKPOINT_SCHEMA_VERSION =
  'paryatech-commercial-cutover-checkpoint/v1' as const;
const ROLLBACK_SCHEMA_VERSION =
  'paryatech-commercial-cutover-rollback/v1' as const;

export type CommercialAgreementSnapshot = CommercialAgreementTarget & {
  recordId?: string;
};

export type CommercialAgreementWriteResult = {
  created: boolean;
  previous: CommercialAgreementSnapshot | null;
  recordId: string;
  snapshot: CommercialAgreementSnapshot;
};

export type CommercialCutoverAdapter = {
  readAgreement: (
    sourceCommercialId: string,
  ) => Promise<CommercialAgreementSnapshot | null>;
  readWriteReceipt: (
    idempotencyKey: string,
    sourceCommercialId: string,
  ) => Promise<CommercialAgreementWriteResult | null>;
  writeAgreement: (
    input: CommercialAgreementSnapshot,
    context: {
      expectedSnapshotHash: string | null;
      idempotencyKey: string;
    },
  ) => Promise<CommercialAgreementWriteResult>;
};

export type CommercialCutoverOperation = {
  agreementReference: string;
  idempotencyKey: string;
  mutation: 'created' | 'updated' | 'unchanged';
  previous: CommercialAgreementSnapshot | null;
  recordId: string;
  snapshotHash: string;
  sourceCommercialId: string;
  targetHash: string;
};

export type CommercialCutoverCheckpoint = {
  checkpointHash: string;
  completed: Record<string, CommercialCutoverOperation>;
  planHash: string;
  schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
};

export type CommercialCutoverCheckpointStore = {
  load: () => Promise<CommercialCutoverCheckpoint | null>;
  save: (checkpoint: CommercialCutoverCheckpoint) => Promise<void>;
};

export type CommercialRollbackManifest = {
  freezeId: string;
  manifestHash: string;
  mode: 'restore-and-lift-freeze';
  operations: Array<{
    action: 'delete-created' | 'restore-previous' | 'none';
    agreementReference: string;
    previous: CommercialAgreementSnapshot | null;
    recordId: string;
    sourceCommercialId: string;
  }>;
  schemaVersion: typeof ROLLBACK_SCHEMA_VERSION;
};

type CommercialRollbackAction =
  CommercialRollbackManifest['operations'][number]['action'];

const ROLLBACK_ACTION_BY_MUTATION = {
  created: 'delete-created',
  unchanged: 'none',
  updated: 'restore-previous',
} satisfies Record<
  CommercialCutoverOperation['mutation'],
  CommercialRollbackAction
>;

export type CommercialCutoverApplyResult = {
  applyHash: string;
  counts: {
    applied: number;
    created: number;
    quarantinedInactive: number;
    unchanged: number;
    updated: number;
  };
  finalExportHash: string;
  freezeHash: string;
  operations: CommercialCutoverOperation[];
  preparedHash: string;
  rollbackManifest: CommercialRollbackManifest;
  schemaVersion: typeof APPLY_SCHEMA_VERSION;
};

export type CommercialCutoverDryRunResult = {
  counts: {
    checked: number;
    quarantinedInactive: number;
    unchanged: number;
    wouldCreate: number;
    wouldUpdate: number;
  };
  dryRunHash: string;
  finalExportHash: string;
  freezeHash: string;
  preparedHash: string;
  schemaVersion: typeof DRY_RUN_SCHEMA_VERSION;
};

export class CommercialCutoverApplyError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'CommercialCutoverApplyError';
    this.code = code;
  }
}

type CommercialGraphqlResponse = {
  data?: Record<string, unknown> | null;
  errors?: Array<{ extensions?: { code?: unknown } }>;
};

type CommercialGraphqlAdapterOptions = {
  baseUrl: string;
  dryRun: boolean;
  evidenceHash: string;
  fetchImplementation?: typeof fetch;
  getApiKey: () => string | undefined;
};

const assertCommercialGraphqlEndpoint = (value: string): URL => {
  let baseUrl: URL;
  try {
    baseUrl = new URL(value);
  } catch {
    throw new CommercialCutoverApplyError(
      'TWENTY_BASE_URL is invalid',
      'INVALID_CONFIGURATION',
    );
  }
  if (
    baseUrl.protocol !== 'https:' ||
    baseUrl.username.length > 0 ||
    baseUrl.password.length > 0 ||
    baseUrl.search.length > 0 ||
    baseUrl.hash.length > 0
  ) {
    throw new CommercialCutoverApplyError(
      'TWENTY_BASE_URL must be an HTTPS origin without credentials',
      'INVALID_CONFIGURATION',
    );
  }
  return new URL('/graphql', baseUrl);
};

const graphqlObject = (
  value: unknown,
  operationName: string,
): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CommercialCutoverApplyError(
      `Twenty GraphQL returned an invalid ${operationName} result`,
      'INVALID_TWENTY_RESPONSE',
    );
  }
  return value as Record<string, unknown>;
};

const snapshotFromGraphql = (
  value: unknown,
  operationName: string,
): CommercialAgreementSnapshot => {
  const record = graphqlObject(value, operationName);
  const { id, ...snapshot } = record;
  if (typeof id !== 'string') {
    throw new CommercialCutoverApplyError(
      `Twenty GraphQL returned an invalid ${operationName} record identity`,
      'INVALID_TWENTY_RESPONSE',
    );
  }
  return { ...(snapshot as CommercialAgreementTarget), recordId: id };
};

const writeResultFromGraphql = (
  value: unknown,
  operationName: string,
  fallbackRecordId: string,
): CommercialAgreementWriteResult => {
  const result = graphqlObject(value, operationName);
  if (
    typeof result.created !== 'boolean' ||
    (result.recordId !== null && typeof result.recordId !== 'string')
  ) {
    throw new CommercialCutoverApplyError(
      `Twenty GraphQL returned an invalid ${operationName} receipt`,
      'INVALID_TWENTY_RESPONSE',
    );
  }
  const snapshot = graphqlObject(result.snapshot, operationName);
  const previous =
    result.previous === null
      ? null
      : graphqlObject(result.previous, operationName);
  return {
    created: result.created,
    previous: previous as CommercialAgreementSnapshot | null,
    recordId:
      typeof result.recordId === 'string' ? result.recordId : fallbackRecordId,
    snapshot: snapshot as CommercialAgreementSnapshot,
  };
};

export const createTwentyCommercialCutoverAdapter = (
  options: CommercialGraphqlAdapterOptions,
): CommercialCutoverAdapter => {
  const endpoint = assertCommercialGraphqlEndpoint(options.baseUrl);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const request = async (
    operationName: string,
    query: string,
    variables: Record<string, unknown>,
    idempotencyKey: string,
  ) => {
    const apiKey = options.getApiKey();
    if (apiKey === undefined || apiKey.length === 0) {
      throw new CommercialCutoverApplyError(
        'Temporary commercial cutover API key is unavailable',
        'INVALID_CONFIGURATION',
      );
    }
    let response: Response;
    try {
      response = await fetchImplementation(endpoint, {
        body: JSON.stringify({ operationName, query, variables }),
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
      throw new CommercialCutoverApplyError(
        `Twenty GraphQL request failed for ${operationName}`,
        'TWENTY_REQUEST_FAILED',
      );
    }
    let payload: CommercialGraphqlResponse;
    try {
      payload = (await response.json()) as CommercialGraphqlResponse;
    } catch {
      throw new CommercialCutoverApplyError(
        `Twenty GraphQL returned an invalid response for ${operationName}`,
        'INVALID_TWENTY_RESPONSE',
      );
    }
    if (
      !response.ok ||
      (Array.isArray(payload.errors) && payload.errors.length > 0) ||
      payload.data === null ||
      payload.data === undefined
    ) {
      throw new CommercialCutoverApplyError(
        `Twenty GraphQL rejected ${operationName}`,
        response.status >= 500
          ? 'TWENTY_REQUEST_FAILED'
          : 'TWENTY_GRAPHQL_REJECTED',
      );
    }
    return payload.data;
  };

  return {
    readAgreement: async (sourceCommercialId) => {
      const operationName = 'InspectCommercialCutoverAgreement';
      const data = await request(
        operationName,
        `query ${operationName}($sourceCommercialId: String!) {
          inspectCommercialCutoverAgreement(sourceCommercialId: $sourceCommercialId)
        }`,
        { sourceCommercialId },
        hashCanonical({ operationName, sourceCommercialId }),
      );
      const value = data.inspectCommercialCutoverAgreement;
      return value === null ? null : snapshotFromGraphql(value, operationName);
    },
    readWriteReceipt: async (idempotencyKey, sourceCommercialId) => {
      const operationName = 'InspectCommercialCutoverReceipt';
      const data = await request(
        operationName,
        `query ${operationName}(
          $idempotencyKey: String!
          $sourceCommercialId: String!
        ) {
          inspectCommercialCutoverReceipt(
            idempotencyKey: $idempotencyKey
            sourceCommercialId: $sourceCommercialId
          )
        }`,
        { idempotencyKey, sourceCommercialId },
        idempotencyKey,
      );
      const value = data.inspectCommercialCutoverReceipt;
      return value === null
        ? null
        : writeResultFromGraphql(value, operationName, sourceCommercialId);
    },
    writeAgreement: async (input, context) => {
      const operationName = 'ApplyCommercialCutoverAgreement';
      const data = await request(
        operationName,
        `mutation ${operationName}(
          $input: ApplyCommercialCutoverAgreementInput!
        ) {
          applyCommercialCutoverAgreement(input: $input) {
            created
            previous
            recordId
            snapshot
          }
        }`,
        {
          input: {
            dryRun: options.dryRun,
            evidenceHash: options.evidenceHash,
            expectedSnapshotHash: context.expectedSnapshotHash,
            idempotencyKey: context.idempotencyKey,
            target: input,
            targetHash: hashCanonical(input),
          },
        },
        context.idempotencyKey,
      );
      return writeResultFromGraphql(
        data.applyCommercialCutoverAgreement,
        operationName,
        input.paryatechOsCommercialReference,
      );
    },
  };
};
const activeRowsById = (sourceExport: CommercialExport) =>
  new Map(
    sourceExport.rows
      .filter(({ active }) => active)
      .map((row) => [row.sourceCommercialId, row]),
  );

export const assertFinalCommercialSnapshot = (
  preparedValue: unknown,
  finalExportValue: unknown,
  freezeProofValue: unknown,
): {
  finalExport: CommercialExport;
  freezeProof: CommercialFreezeProof;
  prepared: PreparedCommercialCutover;
} => {
  const prepared = validatePreparedCommercialCutover(preparedValue);
  const finalExport = validateCommercialExport(finalExportValue);
  const freezeProof = validateCommercialFreezeProof(freezeProofValue);
  if (freezeProof.initialExportHash !== prepared.sourceExportHash) {
    throw new CommercialCutoverApplyError(
      'Freeze proof does not identify the reviewed initial export',
      'FREEZE_EXPORT_MISMATCH',
    );
  }
  if (finalExport.contractId !== prepared.sourceContractId) {
    throw new CommercialCutoverApplyError(
      'Final export contract differs from the reviewed contract',
      'FINAL_CONTRACT_MISMATCH',
    );
  }
  if (freezeProof.frozenAt < prepared.sourceExportedAt) {
    throw new CommercialCutoverApplyError(
      'Commercial mutation freeze cannot precede the reviewed initial export',
      'FREEZE_BEFORE_INITIAL_EXPORT',
    );
  }
  if (finalExport.exportedAt < freezeProof.frozenAt) {
    throw new CommercialCutoverApplyError(
      'Final export must be captured after commercial mutation is frozen',
      'FINAL_BEFORE_FREEZE',
    );
  }

  const expectedActiveRows = new Map(
    prepared.rows
      .filter(({ disposition }) => disposition === 'resolved')
      .map(({ source, sourceRowHash }) => [
        source.sourceCommercialId,
        sourceRowHash,
      ]),
  );
  const finalActiveRows = activeRowsById(finalExport);
  const sameIds =
    hashCanonical([...expectedActiveRows.keys()].sort()) ===
    hashCanonical([...finalActiveRows.keys()].sort());
  const sameRows = [...expectedActiveRows].every(
    ([sourceCommercialId, expectedHash]) => {
      const finalRow = finalActiveRows.get(sourceCommercialId);
      return finalRow !== undefined && hashCanonical(finalRow) === expectedHash;
    },
  );
  if (!sameIds || !sameRows) {
    throw new CommercialCutoverApplyError(
      'Final active snapshot has added, changed, or missing active rows',
      'FINAL_ACTIVE_SNAPSHOT_CHANGED',
    );
  }
  return { finalExport, freezeProof, prepared };
};
const commercialSnapshotHash = (snapshot: CommercialAgreementSnapshot) => {
  const { recordId: _recordId, ...value } = snapshot;
  return hashCanonical(value);
};

const targetSnapshot = (
  target: CommercialAgreementTarget,
): CommercialAgreementSnapshot => ({ ...target });

const compareSnapshots = (
  left: CommercialAgreementSnapshot,
  right: CommercialAgreementSnapshot,
) => {
  const { recordId: _leftRecordId, ...leftData } = left;
  const { recordId: _rightRecordId, ...rightData } = right;
  return hashCanonical(leftData) === hashCanonical(rightData);
};

const assertSourceIsNotStale = (
  existing: CommercialAgreementSnapshot,
  target: CommercialAgreementSnapshot,
) => {
  if (
    existing.evidenceObservedAt > target.evidenceObservedAt ||
    existing.evidenceRecordedAt > target.evidenceRecordedAt
  ) {
    throw new CommercialCutoverApplyError(
      `Stale source snapshot cannot overwrite newer Twenty state for ${target.agreementReference}`,
      'STALE_TWENTY_STATE',
    );
  }
  if (
    (existing.evidenceObservedAt === target.evidenceObservedAt ||
      existing.evidenceRecordedAt === target.evidenceRecordedAt) &&
    !compareSnapshots(existing, target)
  ) {
    throw new CommercialCutoverApplyError(
      `Equal-version conflict requires a Shared Exception for ${target.agreementReference}`,
      'ACTIVE_COMMERCIAL_CONFLICT',
    );
  }
};

export class InMemoryCommercialCutoverCheckpointStore implements CommercialCutoverCheckpointStore {
  private checkpoint: CommercialCutoverCheckpoint | null = null;

  async load() {
    return this.checkpoint;
  }

  async save(checkpoint: CommercialCutoverCheckpoint) {
    this.checkpoint = structuredClone(checkpoint);
  }
}

export class FileCommercialCutoverCheckpointStore implements CommercialCutoverCheckpointStore {
  constructor(
    private readonly filePath: string,
    private readonly workingDirectory = process.cwd(),
  ) {}

  async load(): Promise<CommercialCutoverCheckpoint | null> {
    try {
      return (await readPrivateJson(
        this.filePath,
        this.workingDirectory,
      )) as CommercialCutoverCheckpoint;
    } catch (error) {
      if (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return null;
      }
      throw error;
    }
  }

  async save(checkpoint: CommercialCutoverCheckpoint) {
    await writePrivateJsonAtomic(
      this.filePath,
      checkpoint,
      this.workingDirectory,
    );
  }
}

const checkpointHash = (
  checkpoint: Omit<CommercialCutoverCheckpoint, 'checkpointHash'>,
) => hashCanonical(checkpoint);

const assertValidCheckpoint = (
  checkpoint: CommercialCutoverCheckpoint,
): CommercialCutoverCheckpoint => {
  const { checkpointHash: actualHash, ...checkpointWithoutHash } = checkpoint;
  if (
    checkpoint.schemaVersion !== CHECKPOINT_SCHEMA_VERSION ||
    actualHash !== checkpointHash(checkpointWithoutHash)
  ) {
    throw new CommercialCutoverApplyError(
      'Checkpoint hash does not match its content',
      'CHECKPOINT_HASH_MISMATCH',
    );
  }
  return checkpoint;
};

const operationFromWriteResult = (
  row: PreparedCommercialCutover['rows'][number],
  idempotencyKey: string,
  writeResult: CommercialAgreementWriteResult,
): CommercialCutoverOperation => {
  if (!compareSnapshots(writeResult.snapshot, row.target)) {
    throw new CommercialCutoverApplyError(
      'Server-authoritative write receipt does not match the reviewed target',
      'WRITE_RESULT_MISMATCH',
    );
  }
  return {
    agreementReference: row.source.agreementReference,
    idempotencyKey,
    mutation: writeResult.created ? 'created' : 'updated',
    previous: writeResult.previous,
    recordId: writeResult.recordId,
    snapshotHash: commercialSnapshotHash(writeResult.snapshot),
    sourceCommercialId: row.source.sourceCommercialId,
    targetHash: row.targetHash,
  };
};

const buildRollbackManifest = (
  freezeId: string,
  operations: CommercialCutoverOperation[],
): CommercialRollbackManifest => {
  const manifestWithoutHash = {
    freezeId,
    mode: 'restore-and-lift-freeze' as const,
    operations: operations.map((operation) => ({
      action: ROLLBACK_ACTION_BY_MUTATION[operation.mutation],
      agreementReference: operation.agreementReference,
      previous: operation.previous,
      recordId: operation.recordId,
      sourceCommercialId: operation.sourceCommercialId,
    })),
    schemaVersion: ROLLBACK_SCHEMA_VERSION,
  };
  return {
    ...manifestWithoutHash,
    manifestHash: hashCanonical(manifestWithoutHash),
  };
};

export const dryRunCommercialCutover = async (
  preparedValue: unknown,
  finalExportValue: unknown,
  freezeProofValue: unknown,
  adapter: CommercialCutoverAdapter,
): Promise<CommercialCutoverDryRunResult> => {
  const { finalExport, freezeProof, prepared } = assertFinalCommercialSnapshot(
    preparedValue,
    finalExportValue,
    freezeProofValue,
  );
  const activeRows = prepared.rows.filter(
    ({ disposition }) => disposition === 'resolved',
  );
  const planHash = hashCanonical({
    finalExportHash: finalExport.exportHash,
    freezeHash: freezeProof.freezeHash,
    preparedHash: prepared.preparedHash,
    targetHashes: activeRows.map(({ targetHash }) => targetHash),
  });
  let unchanged = 0;
  let wouldCreate = 0;
  let wouldUpdate = 0;
  for (const row of activeRows) {
    const target = targetSnapshot(row.target);
    const existing = await adapter.readAgreement(row.source.sourceCommercialId);
    if (existing === null) {
      wouldCreate += 1;
    } else if (compareSnapshots(existing, target)) {
      unchanged += 1;
    } else {
      assertSourceIsNotStale(existing, target);
      wouldUpdate += 1;
    }
    const idempotencyKey = hashCanonical({
      dryRun: true,
      planHash,
      sourceCommercialId: row.source.sourceCommercialId,
      targetHash: row.targetHash,
    });
    const result = await adapter.writeAgreement(target, {
      expectedSnapshotHash:
        existing === null ? null : commercialSnapshotHash(existing),
      idempotencyKey,
    });
    if (!compareSnapshots(result.snapshot, target)) {
      throw new CommercialCutoverApplyError(
        'Server dry-run result does not match the reviewed target',
        'WRITE_RESULT_MISMATCH',
      );
    }
  }
  const resultWithoutHash = {
    counts: {
      checked: activeRows.length,
      quarantinedInactive: prepared.rows.filter(
        ({ disposition }) => disposition === 'inactive-quarantine',
      ).length,
      unchanged,
      wouldCreate,
      wouldUpdate,
    },
    finalExportHash: finalExport.exportHash,
    freezeHash: freezeProof.freezeHash,
    preparedHash: prepared.preparedHash,
    schemaVersion: DRY_RUN_SCHEMA_VERSION,
  };
  return {
    ...resultWithoutHash,
    dryRunHash: hashCanonical(resultWithoutHash),
  };
};

export const applyCommercialCutover = async (
  preparedValue: unknown,
  finalExportValue: unknown,
  freezeProofValue: unknown,
  options: {
    adapter: CommercialCutoverAdapter;
    checkpointStore: CommercialCutoverCheckpointStore;
  },
): Promise<CommercialCutoverApplyResult> => {
  const { finalExport, freezeProof, prepared } = assertFinalCommercialSnapshot(
    preparedValue,
    finalExportValue,
    freezeProofValue,
  );
  const activeRows = prepared.rows.filter(
    ({ disposition }) => disposition === 'resolved',
  );
  const planHash = hashCanonical({
    finalExportHash: finalExport.exportHash,
    freezeHash: freezeProof.freezeHash,
    preparedHash: prepared.preparedHash,
    targetHashes: activeRows.map(({ targetHash }) => targetHash),
  });
  const savedCheckpointValue = await options.checkpointStore.load();
  const savedCheckpoint =
    savedCheckpointValue === null
      ? null
      : assertValidCheckpoint(savedCheckpointValue);
  if (savedCheckpoint !== null && savedCheckpoint.planHash !== planHash) {
    throw new CommercialCutoverApplyError(
      'Checkpoint belongs to a different immutable cutover plan',
      'CHECKPOINT_PLAN_MISMATCH',
    );
  }
  const checkpointWithoutHash = {
    completed: {},
    planHash,
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
  } satisfies Omit<CommercialCutoverCheckpoint, 'checkpointHash'>;
  const checkpoint: CommercialCutoverCheckpoint = savedCheckpoint ?? {
    ...checkpointWithoutHash,
    checkpointHash: checkpointHash(checkpointWithoutHash),
  };

  for (const row of activeRows) {
    const completed = checkpoint.completed[row.source.sourceCommercialId];
    if (completed !== undefined) {
      if (completed.targetHash !== row.targetHash) {
        throw new CommercialCutoverApplyError(
          'Checkpoint target differs from reviewed target',
          'CHECKPOINT_TARGET_MISMATCH',
        );
      }
      continue;
    }

    const target = targetSnapshot(row.target);
    const idempotencyKey = hashCanonical({
      planHash,
      sourceCommercialId: row.source.sourceCommercialId,
      targetHash: row.targetHash,
    });
    const writeReceipt = await options.adapter.readWriteReceipt(
      idempotencyKey,
      row.source.sourceCommercialId,
    );
    const existing =
      writeReceipt === null
        ? await options.adapter.readAgreement(row.source.sourceCommercialId)
        : null;
    let operation: CommercialCutoverOperation;

    if (writeReceipt !== null) {
      operation = operationFromWriteResult(row, idempotencyKey, writeReceipt);
    } else if (existing !== null && compareSnapshots(existing, target)) {
      operation = {
        agreementReference: row.source.agreementReference,
        idempotencyKey,
        mutation: 'unchanged',
        previous: existing,
        recordId: existing.recordId ?? row.source.sourceCommercialId,
        snapshotHash: commercialSnapshotHash(existing),
        sourceCommercialId: row.source.sourceCommercialId,
        targetHash: row.targetHash,
      };
    } else {
      if (existing !== null) {
        assertSourceIsNotStale(existing, target);
      }
      const writeResult = await options.adapter.writeAgreement(target, {
        expectedSnapshotHash:
          existing === null ? null : commercialSnapshotHash(existing),
        idempotencyKey,
      });
      operation = operationFromWriteResult(row, idempotencyKey, writeResult);
    }

    checkpoint.completed[row.source.sourceCommercialId] = operation;
    checkpoint.checkpointHash = checkpointHash({
      completed: checkpoint.completed,
      planHash: checkpoint.planHash,
      schemaVersion: checkpoint.schemaVersion,
    });
    await options.checkpointStore.save(checkpoint);
  }

  const operations = activeRows.map(
    ({ source }) => checkpoint.completed[source.sourceCommercialId]!,
  );
  const rollbackManifest = buildRollbackManifest(
    freezeProof.freezeId,
    operations,
  );
  const resultWithoutHash = {
    counts: {
      applied: operations.length,
      created: operations.filter(({ mutation }) => mutation === 'created')
        .length,
      quarantinedInactive: prepared.rows.filter(
        ({ disposition }) => disposition === 'inactive-quarantine',
      ).length,
      unchanged: operations.filter(({ mutation }) => mutation === 'unchanged')
        .length,
      updated: operations.filter(({ mutation }) => mutation === 'updated')
        .length,
    },
    finalExportHash: finalExport.exportHash,
    freezeHash: freezeProof.freezeHash,
    operations,
    preparedHash: prepared.preparedHash,
    rollbackManifest,
    schemaVersion: APPLY_SCHEMA_VERSION,
  };
  return {
    ...resultWithoutHash,
    applyHash: hashCanonical(resultWithoutHash),
  };
};

export const runImportCommercialCutoverCli = async ({
  argv,
  environment = process.env,
  fetchImplementation,
  workingDirectory = process.cwd(),
  writeStderr,
  writeStdout,
}: {
  argv: string[];
  environment?: NodeJS.ProcessEnv;
  fetchImplementation?: typeof fetch;
  workingDirectory?: string;
} & CliIo): Promise<number> => {
  let apiKey = environment.TWENTY_API_KEY;
  try {
    const argumentsByName = parseStrictCliArguments(
      argv,
      [
        '--checkpoint',
        '--final-export',
        '--freeze-proof',
        '--mode',
        '--output',
        '--prepared',
      ],
      [
        '--checkpoint',
        '--final-export',
        '--freeze-proof',
        '--mode',
        '--output',
        '--prepared',
      ],
    );
    const mode = argumentsByName['--mode'];
    if (mode !== 'dry-run' && mode !== 'apply') {
      throw new CommercialCutoverApplyError(
        '--mode must be dry-run or apply',
        'INVALID_CONFIGURATION',
      );
    }
    const baseUrl = environment.TWENTY_BASE_URL;
    if (
      typeof baseUrl !== 'string' ||
      baseUrl.length === 0 ||
      typeof apiKey !== 'string' ||
      apiKey.length === 0
    ) {
      throw new CommercialCutoverApplyError(
        'TWENTY_BASE_URL and TWENTY_API_KEY are required',
        'INVALID_CONFIGURATION',
      );
    }
    const [prepared, finalExport, freezeProofValue] = await Promise.all([
      readPrivateJson(argumentsByName['--prepared']!, workingDirectory),
      readPrivateJson(argumentsByName['--final-export']!, workingDirectory),
      readPrivateJson(argumentsByName['--freeze-proof']!, workingDirectory),
    ]);
    const freezeProof = validateCommercialFreezeProof(freezeProofValue);
    const adapter = createTwentyCommercialCutoverAdapter({
      baseUrl,
      dryRun: mode === 'dry-run',
      evidenceHash: freezeProof.evidenceHash,
      ...(fetchImplementation === undefined ? {} : { fetchImplementation }),
      getApiKey: () => apiKey,
    });
    const result =
      mode === 'dry-run'
        ? await dryRunCommercialCutover(
            prepared,
            finalExport,
            freezeProof,
            adapter,
          )
        : await applyCommercialCutover(prepared, finalExport, freezeProof, {
            adapter,
            checkpointStore: new FileCommercialCutoverCheckpointStore(
              argumentsByName['--checkpoint']!,
              workingDirectory,
            ),
          });
    await writePrivateJsonAtomic(
      argumentsByName['--output']!,
      result,
      workingDirectory,
    );
    writeStdout?.(
      JSON.stringify({
        counts: result.counts,
        event:
          mode === 'dry-run'
            ? 'commercial-cutover.dry-run'
            : 'commercial-cutover.applied',
        resultHash:
          'dryRunHash' in result ? result.dryRunHash : result.applyHash,
      }),
    );
    return 0;
  } catch (error) {
    writeCliFailure(error, writeStderr);
    return error instanceof CommercialCutoverContractError ? 2 : 1;
  } finally {
    apiKey = undefined;
  }
};

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await runImportCommercialCutoverCli({
    argv: process.argv.slice(2),
    writeStderr: (line) => console.error(line),
    writeStdout: (line) => console.log(line),
  });
}
