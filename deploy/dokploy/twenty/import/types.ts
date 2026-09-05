import {
  chmod,
  lstat,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { createHash } from 'node:crypto';

export const PREPARED_SCHEMA_VERSION = 'paryatech-import-prepared/v1' as const;
export const APPROVED_SCHEMA_VERSION = 'paryatech-import-approved/v1' as const;
export const CHECKPOINT_SCHEMA_VERSION =
  'paryatech-import-checkpoint/v1' as const;
export const APPLY_SCHEMA_VERSION = 'paryatech-import-apply/v1' as const;
export const ROLLBACK_SCHEMA_VERSION = 'paryatech-import-rollback/v1' as const;
export const RECONCILIATION_SCHEMA_VERSION =
  'paryatech-import-reconciliation/v1' as const;
export const REVIEW_SCHEMA_VERSION = 'paryatech-import-review/v1' as const;
export const IMPORT_RUN_SCHEMA_VERSION = 'paryatech-import-run/v1' as const;
export const REVOCATION_ATTESTATION_SCHEMA_VERSION =
  'paryatech-import-revocation-attestation/v1' as const;

export type StructuredLogEvent = {
  event: string;
  fields: Record<string, boolean | number | string | null>;
};

export type StructuredLogger = (event: StructuredLogEvent) => void;

export type ImportLimits = {
  maxBytes: number;
  maxCellBytes: number;
  maxCells: number;
  maxRows: number;
  maxSheets: number;
  maxZipEntries: number;
  maxZipExpandedBytes: number;
};

export type PreparedCellOriginalType =
  | 'blank'
  | 'boolean'
  | 'date'
  | 'formula'
  | 'number'
  | 'string';

export type PreparedCell = {
  columnIndex: number;
  originalHash: string;
  originalType: PreparedCellOriginalType;
  safeDisplayValue: string;
};

export type PreparedRow = {
  batchId: string;
  cells: Record<string, PreparedCell>;
  rowHash: string;
  rowNumber: number;
  sheetName: string;
};

export type PreparedSheet = {
  headers: string[];
  name: string;
  rows: PreparedRow[];
};

export type PreparedDataset = {
  batchId: string;
  datasetHash: string;
  format: 'csv' | 'xlsx';
  limits: ImportLimits;
  schemaVersion: typeof PREPARED_SCHEMA_VERSION;
  sheets: PreparedSheet[];
  sourceFileHash: string;
};

export type NormalizedAgencyInput = {
  normalizedDomain?: string;
  normalizedEmail?: string;
  normalizedName?: string;
  normalizedPhone?: string;
  normalizedPostcode?: string;
};

export type ExistingAgencyCandidate = NormalizedAgencyInput & {
  id: string;
};

export type CandidateSignal =
  | 'domain'
  | 'email'
  | 'name'
  | 'phone'
  | 'postcode';

export type AgencyCandidate = {
  candidateId: string;
  score: number;
  signals: CandidateSignal[];
};
export type PreparedReviewRow = {
  input: NormalizedAgencyInput;
  match: CandidateMatchResult;
  rowHash: string;
  rowNumber: number;
  sheetName: string;
};

export type PreparedReviewArtifact = {
  artifactHash: string;
  preparedDataset: PreparedDataset;
  reviewRows: PreparedReviewRow[];
  schemaVersion: typeof REVIEW_SCHEMA_VERSION;
};

export type CandidateMatchResult = {
  candidates: AgencyCandidate[];
  requiredDecision: true;
  status: 'ambiguous' | 'no-candidate' | 'review';
};

export const REVIEW_DECISIONS = [
  'Confirm Existing Agency',
  'Create New Agency',
  'Reject Match',
  'Keep Separate Contacts',
  'Quarantine with Reason',
] as const;

export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export type ReviewDecisionState =
  | 'applied'
  | 'decided'
  | 'open'
  | 'quarantined'
  | 'reopened';

export type DecisionHistoryEntry = {
  action: 'apply' | 'decide' | 'reopen';
  candidateIdHash?: string;
  decision?: ReviewDecision;
  evidenceHash: string;
  reviewerIdHash: string;
  revision: number;
};

export type ReviewDecisionRecord = {
  applyHash?: string;
  candidateId?: string;
  decision?: ReviewDecision;
  history: DecisionHistoryEntry[];
  reason?: string;
  revision: number;
  rowHash: string;
  state: ReviewDecisionState;
};

export type AcquisitionSourcePayload = {
  externalKey: string;
  name: string;
  outreachBasis: string;
  sourceBatch: string;
  sourceType:
    | 'Advertising'
    | 'Community'
    | 'Exhibition'
    | 'Inbound'
    | 'Other'
    | 'Partner'
    | 'Referral';
};

export type CompanyPayload = {
  externalKey: string;
  name: string;
  normalizedDomain?: string;
  normalizedPhone?: string;
  normalizedPostcode?: string;
};

export type PersonPayload = {
  companyExternalKey: string;
  email?: string;
  externalKey: string;
  name: string;
  phone?: string;
};

export type ApprovedRowPayload = {
  company: CompanyPayload;
  person?: PersonPayload;
  source: AcquisitionSourcePayload;
};

export type ApprovedImportRow = {
  decision: ReviewDecisionRecord;
  payload: ApprovedRowPayload;
  rowHash: string;
};

export type ApprovedImportPlan = {
  batchId: string;
  planHash: string;
  preparedDatasetHash: string;
  rows: ApprovedImportRow[];
  schemaVersion: typeof APPROVED_SCHEMA_VERSION;
};

export type ApiOperationContext = {
  companyRecordId?: string;
  existingRecordId?: string;
  idempotencyKey: string;
  personRecordId?: string;
  sourceRecordId?: string;
};

export type ApiEntityResult = {
  created: boolean;
  id: string;
};

export type CompanySourceRelationPayload = {
  companyExternalKey: string;
  sourceExternalKey: string;
};

export type RelationPayload = {
  companyExternalKey: string;
  personExternalKey: string;
};

export type TwentyApiAdapter = {
  linkCompanyToSource: (
    input: CompanySourceRelationPayload,
    context: ApiOperationContext,
  ) => Promise<ApiEntityResult>;
  linkPersonToCompany: (
    input: RelationPayload,
    context: ApiOperationContext,
  ) => Promise<ApiEntityResult>;
  upsertCompany: (
    input: CompanyPayload,
    context: ApiOperationContext,
  ) => Promise<ApiEntityResult>;
  upsertPerson: (
    input: PersonPayload,
    context: ApiOperationContext,
  ) => Promise<ApiEntityResult>;
  upsertSource: (
    input: AcquisitionSourcePayload,
    context: ApiOperationContext,
  ) => Promise<ApiEntityResult>;
};

export type CheckpointOperation = {
  created: boolean;
  entityId: string;
  externalKeyHash: string;
  idempotencyKey: string;
  phase: ImportPhase;
};

export type ImportCheckpoint = {
  batchId: string;
  completedOperations: Record<string, CheckpointOperation>;
  planHash: string;
  schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
};

export type CheckpointStore = {
  load: (planHash: string) => Promise<ImportCheckpoint | undefined>;
  save: (checkpoint: ImportCheckpoint) => Promise<void>;
};

export type ImportPhase =
  | 'company'
  | 'company-source-relation'
  | 'person'
  | 'relation'
  | 'source';

export type RollbackOperation = {
  created: boolean;
  entityId: string;
  externalKeyHash: string;
  phase: ImportPhase;
  rollbackAction: 'delete-if-created' | 'restore-reviewed-snapshot';
};

export type RollbackManifest = {
  batchId: string;
  operations: RollbackOperation[];
  planHash: string;
  schemaVersion: typeof ROLLBACK_SCHEMA_VERSION;
};

export type ApplyImportCounts = {
  appliedRows: number;
  companySourceRelations: number;
  companies: number;
  people: number;
  quarantinedRows: number;
  rejectedRows: number;
  relations: number;
  skippedCheckpointOperations: number;
  sources: number;
};

export type ApplyImportResult = {
  applyHash: string;
  batchId: string;
  checkpointHash: string;
  counts: ApplyImportCounts;
  planHash: string;
  rollbackManifest: RollbackManifest;
  rollbackManifestHash: string;
  schemaVersion: typeof APPLY_SCHEMA_VERSION;
};
export type ImportRunArtifact = {
  administratorEvidenceHash?: string;
  apiKeyFingerprint: string;
  applyResult: ApplyImportResult;
  planHash: string;
  revocationStatus: 'pending' | 'verified';
  revokedAt?: string;
  schemaVersion: typeof IMPORT_RUN_SCHEMA_VERSION;
};

export type RevocationAttestation = {
  administratorEvidenceHash: string;
  apiKeyFingerprint: string;
  planHash: string;
  revokedAt: string;
  schemaVersion: typeof REVOCATION_ATTESTATION_SCHEMA_VERSION;
};

export type AppliedWorkspaceSnapshot = {
  batchId: string;
  companySourceRelations: CompanySourceRelationPayload[];
  companyExternalKeys: string[];
  datasetHash: string;
  peopleExternalKeys: string[];
  planHash: string;
  relations: RelationPayload[];
  sourceExternalKeys: string[];
};

export type ReconciliationDiscrepancyKind =
  | 'batch'
  | 'company-count'
  | 'company-key'
  | 'dataset-hash'
  | 'people-count'
  | 'people-key'
  | 'plan-hash'
  | 'company-source-relation-count'
  | 'company-source-relation-key'
  | 'relation-count'
  | 'relation-key'
  | 'source-count'
  | 'source-key';

export type ReconciliationDiscrepancy = {
  expectedHash: string;
  kind: ReconciliationDiscrepancyKind;
  observedHash: string;
};

export type ReconciliationSample = {
  entity:
    | 'company'
    | 'company-source-relation'
    | 'person'
    | 'relation'
    | 'source';
  externalKeyHash: string;
};

export type ReconciliationReport = {
  batchId: string;
  counts: {
    appliedRows: number;
    companySourceRelations: number;
    companies: number;
    decisions: Partial<Record<ReviewDecision, number>>;
    people: number;
    relations: number;
    sources: number;
  };
  discrepancies: ReconciliationDiscrepancy[];
  reportHash: string;
  samples: ReconciliationSample[];
  schemaVersion: typeof RECONCILIATION_SCHEMA_VERSION;
  status: 'mismatch' | 'reconciled';
};

export class CliContractError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INSECURE_FILE'
      | 'INVALID_CLI'
      | 'INVALID_ENV'
      | 'INVALID_JSON'
      | 'PATH_IN_GIT',
  ) {
    super(message);
    this.name = 'CliContractError';
  }
}

export type CliIo = {
  writeStderr?: (line: string) => void;
  writeStdout?: (line: string) => void;
};

export const parseStrictCliArguments = (
  argv: string[],
  allowedArguments: string[],
  requiredArguments: string[],
): Record<string, string> => {
  const parsed: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    const value = argv[index + 1];

    if (
      argument === undefined ||
      !argument.startsWith('--') ||
      !allowedArguments.includes(argument) ||
      value === undefined ||
      value.startsWith('--') ||
      parsed[argument] !== undefined
    ) {
      throw new CliContractError(
        'Arguments must be unique approved flag/value pairs',
        'INVALID_CLI',
      );
    }
    parsed[argument] = value;
  }

  if (requiredArguments.some((argument) => parsed[argument] === undefined)) {
    throw new CliContractError(
      'A required CLI argument is missing',
      'INVALID_CLI',
    );
  }

  return parsed;
};

const locateGitRoot = async (
  startPath: string,
): Promise<string | undefined> => {
  let currentPath = resolve(startPath);

  while (true) {
    try {
      await lstat(resolve(currentPath, '.git'));

      return currentPath;
    } catch (error) {
      if (
        error === null ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw error;
      }
    }

    const parentPath = dirname(currentPath);

    if (parentPath === currentPath) {
      return undefined;
    }
    currentPath = parentPath;
  }
};

export const assertPathOutsideGit = async (
  filePath: string,
  workingDirectory = process.cwd(),
): Promise<void> => {
  const gitRoot = await locateGitRoot(workingDirectory);

  if (gitRoot === undefined) {
    return;
  }

  const relativePath = relative(gitRoot, resolve(filePath));

  if (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith('../') &&
      !relativePath.startsWith('..\\') &&
      !isAbsolute(relativePath))
  ) {
    throw new CliContractError(
      'Import inputs and outputs must remain outside Git',
      'PATH_IN_GIT',
    );
  }
};

export const readPrivateJson = async (
  filePath: string,
  workingDirectory = process.cwd(),
): Promise<unknown> => {
  await assertPathOutsideGit(filePath, workingDirectory);
  const fileStatus = await lstat(filePath);

  if (!fileStatus.isFile() || (fileStatus.mode & 0o777) !== 0o600) {
    throw new CliContractError(
      'JSON artifacts must be regular 0600 files',
      'INSECURE_FILE',
    );
  }

  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch {
    throw new CliContractError(
      'JSON artifact is not valid JSON',
      'INVALID_JSON',
    );
  }
};

export const writePrivateJsonAtomic = async (
  filePath: string,
  value: unknown,
  workingDirectory = process.cwd(),
): Promise<void> => {
  await assertPathOutsideGit(filePath, workingDirectory);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;

  try {
    await writeFile(temporaryPath, `${canonicalJson(value)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, filePath);
    await chmod(filePath, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
};

export const writeCliFailure = (
  error: unknown,
  writeStderr: ((line: string) => void) | undefined,
): void => {
  const fields: Record<string, string> = {
    code:
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : 'UNEXPECTED',
    errorClass: error instanceof Error ? error.name : 'UnknownError',
  };

  if (
    error !== null &&
    typeof error === 'object' &&
    'operationName' in error &&
    typeof error.operationName === 'string'
  ) {
    fields.operationName = error.operationName;
  }
  if (
    error !== null &&
    typeof error === 'object' &&
    'status' in error &&
    typeof error.status === 'number'
  ) {
    fields.status = String(error.status);
  }
  writeStderr?.(canonicalJson({ event: 'cli.failed', fields }));
};

const canonicalizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalizeValue);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, canonicalizeValue(entryValue)]),
    );
  }

  return value;
};

export const canonicalJson = (value: unknown): string =>
  JSON.stringify(canonicalizeValue(value));

export const sha256 = (value: Buffer | string): string =>
  createHash('sha256').update(value).digest('hex');

export const hashCanonical = (value: unknown): string =>
  sha256(canonicalJson(value));
