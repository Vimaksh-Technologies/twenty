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
  assertFinalCommercialSnapshot,
  type CommercialAgreementSnapshot,
  type CommercialCutoverApplyResult,
  type CommercialRollbackManifest,
} from './import-commercial-cutover.js';
import {
  CommercialCutoverContractError,
  type CommercialExport,
  type CommercialFreezeProof,
  type PreparedCommercialCutover,
} from './prepare-commercial-cutover.js';

const RECONCILIATION_SCHEMA_VERSION =
  'paryatech-commercial-cutover-reconciliation/v1' as const;

export type CommercialCutoverReconciliationReport = {
  activeConflictCount: 0;
  applyHash: string;
  authority: {
    commercial: 'Twenty';
    entitlement: 'ParyatechOS';
  };
  entitlementSmoke: {
    evidenceHash: string;
    mutationEnabled: true;
    sourceSystem: 'ParyatechOS';
  };
  finalExportHash: string;
  freezeEvidence: {
    commercialMutationDisabled: true;
    evidenceHash: string;
    freezeHash: string;
    freezeId: string;
  };
  reconciliationHash: string;
  rollbackManifest: CommercialRollbackManifest;
  schemaVersion: typeof RECONCILIATION_SCHEMA_VERSION;
  status: 'switched';
  switch: {
    actorReference: string;
    switchedAt: string;
  };
  verifiedAgreementCount: number;
};

export type CommercialRollbackDecision =
  | {
      mode: 'restore-and-lift-freeze';
      requestedAt: string;
      rollbackManifestHash: string;
    }
  | {
      firstPostSwitchTwentyWriteAt: string;
      mode: 'forward-only';
      requestedAt: string;
      sharedExceptionReference: string;
    };

export class CommercialCutoverReconciliationError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'CommercialCutoverReconciliationError';
    this.code = code;
  }
}

const assertTimestamp = (value: string, label: string) => {
  if (new Date(value).toISOString() !== value) {
    throw new CommercialCutoverReconciliationError(
      `${label} must be an exact UTC ISO timestamp`,
      'INVALID_RECONCILIATION_INPUT',
    );
  }
};

const assertNonEmptyString = (value: string, label: string) => {
  if (value.trim().length === 0) {
    throw new CommercialCutoverReconciliationError(
      `${label} must be non-empty`,
      'INVALID_RECONCILIATION_INPUT',
    );
  }
};

const comparableSnapshot = (snapshot: CommercialAgreementSnapshot) => {
  const { recordId: _recordId, ...data } = snapshot;
  return data;
};

const validateApplyResult = (
  value: CommercialCutoverApplyResult,
  prepared: PreparedCommercialCutover,
  finalExport: CommercialExport,
  freezeProof: CommercialFreezeProof,
) => {
  const { applyHash, ...resultWithoutHash } = value;
  if (
    applyHash !== hashCanonical(resultWithoutHash) ||
    value.preparedHash !== prepared.preparedHash ||
    value.finalExportHash !== finalExport.exportHash ||
    value.freezeHash !== freezeProof.freezeHash
  ) {
    throw new CommercialCutoverReconciliationError(
      'Apply result hashes do not match the immutable cutover artifacts',
      'APPLY_EVIDENCE_MISMATCH',
    );
  }
  const { manifestHash, ...manifestWithoutHash } = value.rollbackManifest;
  if (manifestHash !== hashCanonical(manifestWithoutHash)) {
    throw new CommercialCutoverReconciliationError(
      'Rollback manifest hash does not match its content',
      'ROLLBACK_MANIFEST_MISMATCH',
    );
  }
};

export const reconcileCommercialCutover = (input: {
  activeConflictReferences: string[];
  actorReference: string;
  agreements: CommercialAgreementSnapshot[];
  applyResult: CommercialCutoverApplyResult;
  entitlementAuthority: string;
  entitlementMutationEnabled: boolean;
  entitlementSmokeEvidenceHash: string;
  finalExport: unknown;
  freezeProof: unknown;
  prepared: unknown;
  switchedAt: string;
}): CommercialCutoverReconciliationReport => {
  const { finalExport, freezeProof, prepared } = assertFinalCommercialSnapshot(
    input.prepared,
    input.finalExport,
    input.freezeProof,
  );
  if (!/^[a-f0-9]{64}$/u.test(input.entitlementSmokeEvidenceHash)) {
    throw new CommercialCutoverReconciliationError(
      'Entitlement smoke evidence hash must be a SHA-256 hash',
      'INVALID_ENTITLEMENT_SMOKE_EVIDENCE',
    );
  }
  validateApplyResult(input.applyResult, prepared, finalExport, freezeProof);
  assertNonEmptyString(input.actorReference, 'actorReference');
  assertTimestamp(input.switchedAt, 'switchedAt');
  if (input.switchedAt < freezeProof.frozenAt) {
    throw new CommercialCutoverReconciliationError(
      'Authority cannot switch before the source commercial freeze',
      'SWITCH_BEFORE_FREEZE',
    );
  }
  if (
    input.entitlementAuthority !== 'ParyatechOS' ||
    input.entitlementMutationEnabled !== true
  ) {
    throw new CommercialCutoverReconciliationError(
      'Entitlement must remain writable under ParyatechOS authority',
      'ENTITLEMENT_AUTHORITY_CHANGED',
    );
  }
  if (input.activeConflictReferences.length !== 0) {
    throw new CommercialCutoverReconciliationError(
      'Commercial authority requires zero active conflicts before switch',
      'ACTIVE_CONFLICTS_REMAIN',
    );
  }

  const observedBySourceId = new Map(
    input.agreements.map((agreement) => [
      agreement.paryatechOsCommercialReference,
      agreement,
    ]),
  );
  if (observedBySourceId.size !== input.agreements.length) {
    throw new CommercialCutoverReconciliationError(
      'Twenty agreement snapshot contains duplicate source IDs',
      'DUPLICATE_TWENTY_AGREEMENT',
    );
  }
  const expectedRows = prepared.rows.filter(
    ({ disposition }) => disposition === 'resolved',
  );
  const expectedIds = expectedRows.map(
    ({ source }) => source.sourceCommercialId,
  );
  if (
    hashCanonical([...observedBySourceId.keys()].sort()) !==
    hashCanonical([...expectedIds].sort())
  ) {
    throw new CommercialCutoverReconciliationError(
      'Twenty agreement inventory does not exactly match active source inventory',
      'RECONCILIATION_INVENTORY_MISMATCH',
    );
  }
  for (const row of expectedRows) {
    const observed = observedBySourceId.get(row.source.sourceCommercialId);
    if (
      observed === undefined ||
      hashCanonical(comparableSnapshot(observed)) !== row.targetHash
    ) {
      throw new CommercialCutoverReconciliationError(
        `Twenty agreement does not exactly match reviewed target: ${row.source.agreementReference}`,
        'RECONCILIATION_HASH_MISMATCH',
      );
    }
  }

  const reportWithoutHash = {
    activeConflictCount: 0 as const,
    applyHash: input.applyResult.applyHash,
    authority: {
      commercial: 'Twenty' as const,
      entitlement: 'ParyatechOS' as const,
    },
    entitlementSmoke: {
      evidenceHash: input.entitlementSmokeEvidenceHash,
      mutationEnabled: true as const,
      sourceSystem: 'ParyatechOS' as const,
    },
    finalExportHash: finalExport.exportHash,
    freezeEvidence: {
      commercialMutationDisabled: true as const,
      evidenceHash: freezeProof.evidenceHash,
      freezeHash: freezeProof.freezeHash,
      freezeId: freezeProof.freezeId,
    },
    rollbackManifest: input.applyResult.rollbackManifest,
    schemaVersion: RECONCILIATION_SCHEMA_VERSION,
    status: 'switched' as const,
    switch: {
      actorReference: input.actorReference,
      switchedAt: input.switchedAt,
    },
    verifiedAgreementCount: expectedRows.length,
  };
  return {
    ...reportWithoutHash,
    reconciliationHash: hashCanonical(reportWithoutHash),
  };
};

export const decideCommercialRollback = (
  report: CommercialCutoverReconciliationReport,
  input: {
    firstPostSwitchTwentyWriteAt: string | null;
    requestedAt: string;
    sharedExceptionReference?: string;
  },
): CommercialRollbackDecision => {
  assertTimestamp(input.requestedAt, 'requestedAt');
  if (input.firstPostSwitchTwentyWriteAt === null) {
    return {
      mode: 'restore-and-lift-freeze',
      requestedAt: input.requestedAt,
      rollbackManifestHash: report.rollbackManifest.manifestHash,
    };
  }

  assertTimestamp(
    input.firstPostSwitchTwentyWriteAt,
    'firstPostSwitchTwentyWriteAt',
  );
  if (input.firstPostSwitchTwentyWriteAt < report.switch.switchedAt) {
    throw new CommercialCutoverReconciliationError(
      'First post-switch write cannot precede the authority switch',
      'INVALID_POST_SWITCH_WRITE',
    );
  }
  if (
    input.sharedExceptionReference === undefined ||
    input.sharedExceptionReference.trim().length === 0
  ) {
    throw new CommercialCutoverReconciliationError(
      'After the first Twenty write, reconcile forward only via an owned Shared Exception',
      'SHARED_EXCEPTION_REQUIRED',
    );
  }
  return {
    firstPostSwitchTwentyWriteAt: input.firstPostSwitchTwentyWriteAt,
    mode: 'forward-only',
    requestedAt: input.requestedAt,
    sharedExceptionReference: input.sharedExceptionReference,
  };
};

type ReconciliationSnapshotFile = {
  activeConflictReferences: string[];
  agreements: CommercialAgreementSnapshot[];
  entitlementAuthority: string;
  entitlementSmokeEvidenceHash: string;
  entitlementMutationEnabled: boolean;
};

export const runReconcileCommercialCutoverCli = async ({
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
        '--actor',
        '--apply-result',
        '--final-export',
        '--freeze-proof',
        '--output',
        '--prepared',
        '--snapshot',
        '--switched-at',
      ],
      [
        '--actor',
        '--apply-result',
        '--final-export',
        '--freeze-proof',
        '--output',
        '--prepared',
        '--snapshot',
        '--switched-at',
      ],
    );
    const [prepared, finalExport, freezeProof, applyResult, snapshot] =
      await Promise.all([
        readPrivateJson(argumentsByName['--prepared']!, workingDirectory),
        readPrivateJson(argumentsByName['--final-export']!, workingDirectory),
        readPrivateJson(argumentsByName['--freeze-proof']!, workingDirectory),
        readPrivateJson(argumentsByName['--apply-result']!, workingDirectory),
        readPrivateJson(argumentsByName['--snapshot']!, workingDirectory),
      ]);
    const reconciliation = reconcileCommercialCutover({
      ...(snapshot as ReconciliationSnapshotFile),
      actorReference: argumentsByName['--actor']!,
      applyResult: applyResult as CommercialCutoverApplyResult,
      finalExport,
      freezeProof,
      prepared,
      switchedAt: argumentsByName['--switched-at']!,
    });
    await writePrivateJsonAtomic(
      argumentsByName['--output']!,
      reconciliation,
      workingDirectory,
    );
    writeStdout?.(
      JSON.stringify({
        activeConflictCount: reconciliation.activeConflictCount,
        event: 'commercial-cutover.reconciled',
        reconciliationHash: reconciliation.reconciliationHash,
        status: reconciliation.status,
      }),
    );
    return 0;
  } catch (error) {
    writeCliFailure(error, writeStderr);
    return error instanceof CommercialCutoverContractError ? 2 : 1;
  }
};

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await runReconcileCommercialCutoverCli({
    argv: process.argv.slice(2),
    writeStderr: (line) => console.error(line),
    writeStdout: (line) => console.log(line),
  });
}
