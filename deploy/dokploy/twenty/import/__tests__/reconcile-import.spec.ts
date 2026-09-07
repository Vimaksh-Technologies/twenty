import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createApprovedImportPlan,
  createOpenDecision,
  recordDecision,
} from '../import-approved.js';
import { reconcileImport, runReconcileImportCli } from '../reconcile-import.js';
import type {
  ApplyImportResult,
  ApprovedImportRow,
  StructuredLogEvent,
} from '../types.js';

const createRow = (
  suffix: string,
  decision: ApprovedImportRow['decision']['decision'] = 'Create New Agency',
): ApprovedImportRow => ({
  decision: recordDecision(createOpenDecision(`row-${suffix}`), {
    decision,
    reason:
      decision === 'Quarantine with Reason'
        ? 'unresolved identity'
        : 'approved',
    reviewerId: 'reviewer-id',
  }),
  payload: {
    company: {
      externalKey: `agency-${suffix}`,
      name: `Private Agency ${suffix}`,
      normalizedDomain: `${suffix}.invalid`,
    },
    person: {
      companyExternalKey: `agency-${suffix}`,
      email: `private-${suffix}@example.invalid`,
      externalKey: `person-${suffix}`,
      name: `Private Person ${suffix}`,
    },
    source: {
      externalKey: 'source-one',
      name: 'Private Source',
      outreachBasis: 'approval-reference',
      sourceBatch: 'batch-one',
      sourceType: 'Community',
    },
  },
  rowHash: `row-${suffix}`,
});

const createApplyResult = (): ApplyImportResult => ({
  applyHash: 'b'.repeat(64),
  batchId: 'batch-one',
  checkpointHash: 'c'.repeat(64),
  counts: {
    appliedRows: 2,
    companySourceRelations: 2,
    companies: 2,
    people: 2,
    quarantinedRows: 1,
    rejectedRows: 0,
    relations: 2,
    skippedCheckpointOperations: 0,
    sources: 1,
  },
  planHash: 'plan-hash-placeholder',
  rollbackManifest: {
    batchId: 'batch-one',
    operations: [],
    planHash: 'plan-hash-placeholder',
    schemaVersion: 'paryatech-import-rollback/v1',
  },
  rollbackManifestHash: 'd'.repeat(64),
  schemaVersion: 'paryatech-import-apply/v1',
});

const temporaryDirectories: string[] = [];

const createCliPath = async (name: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'paryatech-reconcile-'));

  temporaryDirectories.push(directory);

  return join(directory, name);
};

const writePrivateJson = async (
  filePath: string,
  value: unknown,
): Promise<void> => {
  await writeFile(filePath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('reconcileImport', () => {
  it('reconciles counts, keys, relations, hashes, decisions, and deterministic samples', () => {
    const rows = [
      createRow('one'),
      createRow('two'),
      createRow('quarantine', 'Quarantine with Reason'),
    ];
    const plan = createApprovedImportPlan({
      batchId: 'batch-one',
      preparedDatasetHash: 'a'.repeat(64),
      rows,
    });
    const applyResult = {
      ...createApplyResult(),
      planHash: plan.planHash,
      rollbackManifest: {
        ...createApplyResult().rollbackManifest,
        planHash: plan.planHash,
      },
    };

    const report = reconcileImport({
      applyResult,
      plan,
      sampleSize: 2,
      snapshot: {
        batchId: 'batch-one',
        companySourceRelations: [
          {
            companyExternalKey: 'agency-one',
            sourceExternalKey: 'source-one',
          },
          {
            companyExternalKey: 'agency-two',
            sourceExternalKey: 'source-one',
          },
        ],
        companyExternalKeys: ['agency-two', 'agency-one'],
        datasetHash: 'a'.repeat(64),
        peopleExternalKeys: ['person-one', 'person-two'],
        planHash: plan.planHash,
        relations: [
          {
            companyExternalKey: 'agency-one',
            personExternalKey: 'person-one',
          },
          {
            companyExternalKey: 'agency-two',
            personExternalKey: 'person-two',
          },
        ],
        sourceExternalKeys: ['source-one'],
      },
    });

    expect(report.status).toBe('reconciled');
    expect(report.discrepancies).toEqual([]);
    expect(report.counts).toMatchObject({
      companySourceRelations: 2,
      appliedRows: 2,
      companies: 2,
      decisions: {
        'Create New Agency': 2,
        'Quarantine with Reason': 1,
      },
      people: 2,
      relations: 2,
      sources: 1,
    });
    expect(report.samples.map((sample) => sample.externalKeyHash)).toEqual(
      report.samples.map((sample) => sample.externalKeyHash).sort(),
    );
    expect(report.reportHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reports every count, key, relation, and hash mismatch without raw values', () => {
    const rawEmail = 'private-one@example.invalid';
    const events: StructuredLogEvent[] = [];
    const plan = createApprovedImportPlan({
      batchId: 'batch-one',
      preparedDatasetHash: 'a'.repeat(64),
      rows: [createRow('one')],
    });
    const applyResult = {
      ...createApplyResult(),
      planHash: plan.planHash,
    };

    const report = reconcileImport(
      {
        applyResult,
        plan,
        snapshot: {
          batchId: 'wrong-batch',
          companySourceRelations: [],
          companyExternalKeys: ['wrong-agency'],
          datasetHash: 'e'.repeat(64),
          peopleExternalKeys: [],
          planHash: 'f'.repeat(64),
          relations: [],
          sourceExternalKeys: [],
        },
      },
      (event) => events.push(event),
    );

    expect(report.status).toBe('mismatch');
    expect(report.discrepancies.map((item) => item.kind)).toEqual(
      expect.arrayContaining([
        'batch',
        'company-source-relation-count',
        'company-source-relation-key',
        'company-count',
        'company-key',
        'dataset-hash',
        'people-count',
        'plan-hash',
        'relation-count',
        'relation-key',
        'source-count',
        'source-key',
      ]),
    );
    expect(JSON.stringify(report)).not.toContain(rawEmail);
    expect(JSON.stringify(events)).not.toContain(rawEmail);
    expect(JSON.stringify(events)).not.toContain('Private Agency');
  });

  it('returns identical output and hashes for identical inputs', () => {
    const plan = createApprovedImportPlan({
      batchId: 'batch-one',
      preparedDatasetHash: 'a'.repeat(64),
      rows: [createRow('one'), createRow('two')],
    });
    const applyResult = {
      ...createApplyResult(),
      planHash: plan.planHash,
    };
    const input = {
      applyResult,
      plan,
      snapshot: {
        batchId: 'batch-one',
        companySourceRelations: [
          {
            companyExternalKey: 'agency-one',
            sourceExternalKey: 'source-one',
          },
          {
            companyExternalKey: 'agency-two',
            sourceExternalKey: 'source-one',
          },
        ],
        companyExternalKeys: ['agency-one', 'agency-two'],
        datasetHash: 'a'.repeat(64),
        peopleExternalKeys: ['person-one', 'person-two'],
        planHash: plan.planHash,
        relations: [
          {
            companyExternalKey: 'agency-one',
            personExternalKey: 'person-one',
          },
          {
            companyExternalKey: 'agency-two',
            personExternalKey: 'person-two',
          },
        ],
        sourceExternalKeys: ['source-one'],
      },
    };

    const first = reconcileImport(input);
    const second = reconcileImport({ ...input });

    expect(second).toEqual(first);
    expect(second.reportHash).toBe(first.reportHash);
  });
});

describe('reconcile import CLI', () => {
  it('rejects pending revocation and writes a private report only after attestation', async () => {
    const approvedPath = await createCliPath('approved.json');
    const applyResultPath = await createCliPath('apply-result.json');
    const snapshotPath = await createCliPath('snapshot.json');
    const outputPath = await createCliPath('reconciliation.json');
    const rows = [
      createRow('one'),
      createRow('two'),
      createRow('quarantine', 'Quarantine with Reason'),
    ];
    const plan = createApprovedImportPlan({
      batchId: 'batch-one',
      preparedDatasetHash: 'a'.repeat(64),
      rows,
    });
    const applyResult = {
      ...createApplyResult(),
      planHash: plan.planHash,
      rollbackManifest: {
        ...createApplyResult().rollbackManifest,
        planHash: plan.planHash,
      },
    };
    const snapshot = {
      batchId: 'batch-one',
      companySourceRelations: [
        {
          companyExternalKey: 'agency-one',
          sourceExternalKey: 'source-one',
        },
        {
          companyExternalKey: 'agency-two',
          sourceExternalKey: 'source-one',
        },
      ],
      companyExternalKeys: ['agency-one', 'agency-two'],
      datasetHash: 'a'.repeat(64),
      peopleExternalKeys: ['person-one', 'person-two'],
      planHash: plan.planHash,
      relations: [
        {
          companyExternalKey: 'agency-one',
          personExternalKey: 'person-one',
        },
        {
          companyExternalKey: 'agency-two',
          personExternalKey: 'person-two',
        },
      ],
      sourceExternalKeys: ['source-one'],
    };

    await writePrivateJson(approvedPath, plan);
    await writePrivateJson(snapshotPath, snapshot);
    await writePrivateJson(applyResultPath, {
      apiKeyFingerprint: 'f'.repeat(64),
      applyResult,
      planHash: plan.planHash,
      revocationStatus: 'pending',
      schemaVersion: 'paryatech-import-run/v1',
    });

    const pendingExitCode = await runReconcileImportCli({
      argv: [
        '--approved',
        approvedPath,
        '--apply-result',
        applyResultPath,
        '--snapshot',
        snapshotPath,
        '--output',
        outputPath,
      ],
      writeStderr: () => undefined,
      writeStdout: () => undefined,
    });

    expect(pendingExitCode).toBe(1);

    await writePrivateJson(applyResultPath, {
      administratorEvidenceHash: 'e'.repeat(64),
      apiKeyFingerprint: 'f'.repeat(64),
      applyResult,
      planHash: plan.planHash,
      revocationStatus: 'verified',
      revokedAt: '2026-08-06T12:00:00.000Z',
      schemaVersion: 'paryatech-import-run/v1',
    });
    const verifiedExitCode = await runReconcileImportCli({
      argv: [
        '--approved',
        approvedPath,
        '--apply-result',
        applyResultPath,
        '--snapshot',
        snapshotPath,
        '--output',
        outputPath,
      ],
      writeStderr: () => undefined,
      writeStdout: () => undefined,
    });
    const report = JSON.parse(await readFile(outputPath, 'utf8')) as {
      status: string;
    };

    expect(verifiedExitCode).toBe(0);
    expect(report.status).toBe('reconciled');
    expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
  });
});
