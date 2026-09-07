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
  InMemoryCommercialCutoverCheckpointStore,
  applyCommercialCutover,
  createTwentyCommercialCutoverAdapter,
  dryRunCommercialCutover,
  type CommercialAgreementSnapshot,
  type CommercialAgreementWriteResult,
  type CommercialCutoverAdapter,
} from '../import-commercial-cutover.js';
import {
  createCommercialExport,
  createCommercialFreezeProof,
  createCommercialResolutionSnapshot,
  prepareCommercialCutover,
  runPrepareCommercialCutoverCli,
  type CommercialExport,
  type CommercialExportRow,
} from '../prepare-commercial-cutover.js';
import {
  decideCommercialRollback,
  reconcileCommercialCutover,
} from '../reconcile-commercial-cutover.js';
import { hashCanonical } from '../types.js';

const HASH = 'a'.repeat(64);
const INITIAL_EXPORTED_AT = '2026-09-04T08:00:00.000Z';
const FROZEN_AT = '2026-09-04T09:00:00.000Z';
const FINAL_EXPORTED_AT = '2026-09-04T09:05:00.000Z';
const REVIEWED_AT = '2026-09-04T09:10:00.000Z';

const activeRow = (suffix = 'one'): CommercialExportRow => ({
  active: true,
  agencyExternalKey: `agency-${suffix}`,
  agreementReference: `AGR-${suffix}`,
  currency: 'INR',
  endsAt: '2027-09-04',
  grossBooked: 120_000,
  payment: {
    amountCollected: 120_000,
    evidenceObservedAt: '2026-09-04T07:55:00.000Z',
    evidenceRecordedAt: '2026-09-04T07:57:00.000Z',
    evidenceSource: `finance-export-${suffix}`,
    evidenceState: 'Current',
    evidenceType: 'Verified statement',
    netCollected: 120_000,
    state: 'Paid',
    refundedOrReversedAmount: 0,
    waivedAmount: 0,
  },
  productExternalKeys: [`product-${suffix}`],
  renewal: {
    nextAction: 'Review renewal evidence.',
    nextActionAt: '2027-08-04T10:00:00.000Z',
    ownerExternalKey: `renewal-owner-${suffix}`,
    renewalAt: '2027-09-04',
    state: 'Renewing',
  },
  sourceCommercialId: `commercial-${suffix}`,
  sourceCreatedAt: '2026-08-01T10:00:00.000Z',
  verifierExternalKey: `verifier-${suffix}`,
  sourceUpdatedAt: '2026-09-04T07:58:00.000Z',
  startsAt: '2026-09-04',
  term: 'Yearly',
});

const inactiveRow = (): CommercialExportRow => ({
  ...activeRow('inactive'),
  active: false,
});

const sourceExport = (
  rows: CommercialExportRow[] = [activeRow(), inactiveRow()],
  exportedAt = INITIAL_EXPORTED_AT,
): CommercialExport =>
  createCommercialExport({
    activeInventoryIds: rows
      .filter(({ active }) => active)
      .map(({ sourceCommercialId }) => sourceCommercialId),
    approval: {
      approvedAt: '2026-09-04T07:00:00.000Z',
      approvedBy: 'commercial-data-owner',
      evidenceHash: HASH,
    },
    contractId: 'paryatechos-commercial-export-2026-09-04',
    exportedAt,
    immutable: true,
    rows,
    sourceSystem: 'ParyatechOS',
  });

const resolutionSnapshot = (rows = [activeRow()]) =>
  createCommercialResolutionSnapshot({
    agencies: rows.map((row) => ({
      externalKey: row.agencyExternalKey,
      recordId: `11111111-1111-4111-8111-${row.sourceCommercialId.padEnd(12, '0').slice(-12)}`,
    })),
    capturedAt: '2026-09-04T08:30:00.000Z',
    products: rows.flatMap((row) =>
      row.productExternalKeys.map((externalKey) => ({
        externalKey,
        recordId: `22222222-2222-4222-8222-${externalKey.padEnd(12, '0').slice(-12)}`,
      })),
    ),
    workspaceMembers: rows.flatMap((row) => [
      {
        externalKey: row.verifierExternalKey,
        recordId: `33333333-3333-4333-8333-${row.verifierExternalKey.padEnd(12, '0').slice(-12)}`,
      },
      {
        externalKey: row.renewal.ownerExternalKey,
        recordId: `33333333-3333-4333-8333-${row.renewal.ownerExternalKey.padEnd(12, '0').slice(-12)}`,
      },
    ]),
    workspaceId: 'workspace-1',
  });

const preparedCutover = (rows = [activeRow(), inactiveRow()]) =>
  prepareCommercialCutover({
    resolutionSnapshot: resolutionSnapshot(rows.filter(({ active }) => active)),
    review: {
      evidenceHash: HASH,
      reviewedAt: REVIEWED_AT,
      reviewedBy: 'commercial-reviewer',
    },
    sourceExport: sourceExport(rows),
  });

const finalExportFor = (
  prepared = preparedCutover(),
  rows = prepared.rows.map(({ source }) => source),
) => sourceExport(rows, FINAL_EXPORTED_AT);

const freezeProofFor = (prepared = preparedCutover()) =>
  createCommercialFreezeProof({
    commercialMutationDisabled: true,
    entitlementMutationEnabled: true,
    evidenceHash: HASH,
    freezeId: 'freeze-2026-09-04',
    frozenAt: FROZEN_AT,
    frozenBy: 'paryatechos-owner',
    initialExportHash: prepared.sourceExportHash,
    sourceSystem: 'ParyatechOS',
  });

class MemoryAdapter implements CommercialCutoverAdapter {
  agreements = new Map<string, CommercialAgreementSnapshot>();
  receipts = new Map<string, CommercialAgreementWriteResult>();
  writeAttempts: string[] = [];
  failOnceFor: string | undefined;

  async readAgreement(sourceCommercialId: string) {
    return this.agreements.get(sourceCommercialId) ?? null;
  }

  async readWriteReceipt(idempotencyKey: string) {
    return this.receipts.get(idempotencyKey) ?? null;
  }

  async writeAgreement(
    input: CommercialAgreementSnapshot,
    context: { expectedSnapshotHash: string | null; idempotencyKey: string },
  ) {
    this.writeAttempts.push(input.paryatechOsCommercialReference);
    if (this.failOnceFor === input.paryatechOsCommercialReference) {
      this.failOnceFor = undefined;
      throw new Error('synthetic interruption');
    }

    const existing =
      this.agreements.get(input.paryatechOsCommercialReference) ?? null;
    expect(context.expectedSnapshotHash).toBe(
      existing === null ? null : hashCanonical(existing),
    );
    this.agreements.set(input.paryatechOsCommercialReference, input);
    const result = {
      created: existing === null,
      previous: existing,
      recordId:
        input.recordId ?? `agreement-${input.paryatechOsCommercialReference}`,
      snapshot: input,
    };
    this.receipts.set(context.idempotencyKey, result);
    return result;
  }
}

class InterruptingCheckpointStore extends InMemoryCommercialCutoverCheckpointStore {
  private interruptNextSave = true;

  override async save(
    checkpoint: Parameters<InMemoryCommercialCutoverCheckpointStore['save']>[0],
  ) {
    if (this.interruptNextSave) {
      this.interruptNextSave = false;
      throw new Error('checkpoint interruption');
    }
    await super.save(checkpoint);
  }
}

const temporaryDirectories: string[] = [];

const temporaryPath = async (name: string) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'paryatech-commercial-cutover-'),
  );
  temporaryDirectories.push(directory);
  return join(directory, name);
};

const writePrivateJson = async (filePath: string, value: unknown) => {
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

describe('prepareCommercialCutover', () => {
  it('creates an inert reviewed artifact only when every active Agency and Product resolves', () => {
    const prepared = preparedCutover();

    expect(prepared.schemaVersion).toBe(
      'paryatech-commercial-cutover-prepared/v1',
    );
    expect(prepared.rows[0]).toMatchObject({
      agencyRecordId: expect.stringMatching(/^1111/),
      disposition: 'resolved',
      productRecordIds: [expect.stringMatching(/^2222/)],
    });
    expect(prepared.rows[0]!.target).toMatchObject({
      activationState: 'Pending',
      adoptionState: 'Not Assessed',
      agency: expect.stringMatching(/^1111/),
      evidenceVerifier: expect.stringMatching(/^3333/),
      paryatechOsCommercialReference: 'commercial-one',
      products: [expect.stringMatching(/^2222/)],
      renewalOwner: expect.stringMatching(/^3333/),
      sourceOpportunity: null,
    });
    expect(prepared.rows[1]).toMatchObject({
      agencyRecordId: null,
      disposition: 'inactive-quarantine',
      productRecordIds: [],
    });
    expect(JSON.stringify(prepared)).not.toMatch(
      /password|token|entitlementSecret|travelBooking/iu,
    );
  });

  it('fails closed for unresolved active inventory', () => {
    expect(() =>
      prepareCommercialCutover({
        resolutionSnapshot: createCommercialResolutionSnapshot({
          agencies: [],
          capturedAt: '2026-09-04T08:30:00.000Z',
          workspaceMembers: [],
          products: [],
          workspaceId: 'workspace-1',
        }),
        review: {
          evidenceHash: HASH,
          reviewedAt: REVIEWED_AT,
          reviewedBy: 'commercial-reviewer',
        },
        sourceExport: sourceExport([activeRow()]),
      }),
    ).toThrowError(/active.*resolve/iu);
  });

  it('rejects travel, entitlement, credential, and unknown export fields', () => {
    const unsafe = {
      ...sourceExport([activeRow()]),
      entitlementSecret: 'do-not-admit',
      exportHash: undefined,
    };

    expect(() =>
      prepareCommercialCutover({
        resolutionSnapshot: resolutionSnapshot(),
        review: {
          evidenceHash: HASH,
          reviewedAt: REVIEWED_AT,
          reviewedBy: 'commercial-reviewer',
        },
        sourceExport: unsafe,
      }),
    ).toThrowError(/prohibited|unknown/iu);
  });

  it('writes the reviewed artifact atomically with mode 0600', async () => {
    const exportPath = await temporaryPath('export.json');
    const resolutionPath = await temporaryPath('resolution.json');
    const outputPath = await temporaryPath('prepared.json');
    await writePrivateJson(exportPath, sourceExport());
    await writePrivateJson(resolutionPath, resolutionSnapshot());

    const exitCode = await runPrepareCommercialCutoverCli({
      argv: [
        '--export',
        exportPath,
        '--resolution',
        resolutionPath,
        '--reviewed-by',
        'commercial-reviewer',
        '--reviewed-at',
        REVIEWED_AT,
        '--evidence-hash',
        HASH,
        '--output',
        outputPath,
      ],
      workingDirectory: tmpdir(),
    });

    expect(exitCode).toBe(0);
    expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(outputPath, 'utf8'))).toMatchObject({
      schemaVersion: 'paryatech-commercial-cutover-prepared/v1',
    });
  });
});

describe('applyCommercialCutover', () => {
  it.each(['added', 'changed', 'missing'] as const)(
    'blocks an %s active row between the initial and final snapshot',
    async (difference) => {
      const prepared = preparedCutover();
      const rows = prepared.rows.map(({ source }) => source);
      const changedRows =
        difference === 'added'
          ? [...rows, activeRow('added')]
          : difference === 'missing'
            ? rows.filter(({ active }) => !active)
            : rows.map((row) =>
                row.active ? { ...row, grossBooked: row.grossBooked + 1 } : row,
              );

      await expect(
        applyCommercialCutover(
          prepared,
          finalExportFor(prepared, changedRows),
          freezeProofFor(prepared),
          {
            adapter: new MemoryAdapter(),
            checkpointStore: new InMemoryCommercialCutoverCheckpointStore(),
          },
        ),
      ).rejects.toThrowError(/final active snapshot/iu);
    },
  );

  it('allows changed inactive history to remain quarantined', async () => {
    const prepared = preparedCutover();
    const finalRows = prepared.rows.map(({ source }) =>
      source.active
        ? source
        : {
            ...source,
            payment: {
              ...source.payment,
              state: 'Reversed' as const,
            },
          },
    );

    const result = await applyCommercialCutover(
      prepared,
      finalExportFor(prepared, finalRows),
      freezeProofFor(prepared),
      {
        adapter: new MemoryAdapter(),
        checkpointStore: new InMemoryCommercialCutoverCheckpointStore(),
      },
    );

    expect(result.counts).toMatchObject({
      applied: 1,
      quarantinedInactive: 1,
    });
  });

  it('recovers a durable write receipt when interrupted before checkpoint persistence', async () => {
    const prepared = preparedCutover([activeRow()]);
    const finalExport = finalExportFor(prepared);
    const freezeProof = freezeProofFor(prepared);
    const adapter = new MemoryAdapter();
    const checkpointStore = new InterruptingCheckpointStore();

    await expect(
      applyCommercialCutover(prepared, finalExport, freezeProof, {
        adapter,
        checkpointStore,
      }),
    ).rejects.toThrowError('checkpoint interruption');

    const result = await applyCommercialCutover(
      prepared,
      finalExport,
      freezeProof,
      { adapter, checkpointStore },
    );

    expect(adapter.writeAttempts).toEqual(['commercial-one']);
    expect(result.rollbackManifest.operations[0]).toMatchObject({
      action: 'delete-created',
      sourceCommercialId: 'commercial-one',
    });
  });

  it('resumes an interrupted import idempotently without rewriting completed rows', async () => {
    const rows = [activeRow('one'), activeRow('two')];
    const prepared = preparedCutover(rows);
    const adapter = new MemoryAdapter();
    const checkpointStore = new InMemoryCommercialCutoverCheckpointStore();
    adapter.failOnceFor = 'commercial-two';

    await expect(
      applyCommercialCutover(
        prepared,
        finalExportFor(prepared),
        freezeProofFor(prepared),
        {
          adapter,
          checkpointStore,
        },
      ),
    ).rejects.toThrowError('synthetic interruption');

    const result = await applyCommercialCutover(
      prepared,
      finalExportFor(prepared),
      freezeProofFor(prepared),
      { adapter, checkpointStore },
    );

    expect(adapter.writeAttempts).toEqual([
      'commercial-one',
      'commercial-two',
      'commercial-two',
    ]);
    expect(result.counts).toMatchObject({ applied: 2, quarantinedInactive: 0 });
    expect(result.rollbackManifest.operations).toHaveLength(2);
  });

  it('rejects a rehashed artifact whose U1 target diverges from source evidence', async () => {
    const prepared = preparedCutover([activeRow()]);
    prepared.rows[0]!.target.grossBooked += 1;
    prepared.rows[0]!.targetHash = hashCanonical(prepared.rows[0]!.target);
    const { preparedHash: _preparedHash, ...preparedWithoutHash } = prepared;
    prepared.preparedHash = hashCanonical(preparedWithoutHash);

    await expect(
      applyCommercialCutover(
        prepared,
        finalExportFor(prepared),
        freezeProofFor(prepared),
        {
          adapter: new MemoryAdapter(),
          checkpointStore: new InMemoryCommercialCutoverCheckpointStore(),
        },
      ),
    ).rejects.toThrowError(/exact U1 target fields/iu);
  });

  it('never lets a stale source snapshot overwrite newer Twenty evidence', async () => {
    const prepared = preparedCutover([activeRow()]);
    const adapter = new MemoryAdapter();
    adapter.agreements.set('commercial-one', {
      ...prepared.rows[0]!.target,
      evidenceObservedAt: '2026-09-04T08:30:00.000Z',
      evidenceRecordedAt: '2026-09-04T08:31:00.000Z',
      recordId: 'existing-agreement',
    });

    await expect(
      applyCommercialCutover(
        prepared,
        finalExportFor(prepared),
        freezeProofFor(prepared),
        {
          adapter,
          checkpointStore: new InMemoryCommercialCutoverCheckpointStore(),
        },
      ),
    ).rejects.toThrowError(/stale.*Twenty/iu);
    expect(adapter.writeAttempts).toEqual([]);
  });
});

describe('reconcileCommercialCutover', () => {
  it('switches commercial authority only after exact reconciliation and keeps entitlement in ParyatechOS', async () => {
    const prepared = preparedCutover();
    const finalExport = finalExportFor(prepared);
    const freezeProof = freezeProofFor(prepared);
    const adapter = new MemoryAdapter();
    const applyResult = await applyCommercialCutover(
      prepared,
      finalExport,
      freezeProof,
      {
        adapter,
        checkpointStore: new InMemoryCommercialCutoverCheckpointStore(),
      },
    );

    const report = reconcileCommercialCutover({
      activeConflictReferences: [],
      actorReference: 'commercial-data-owner',
      agreements: [...adapter.agreements.values()],
      applyResult,
      entitlementAuthority: 'ParyatechOS',
      entitlementSmokeEvidenceHash: HASH,
      entitlementMutationEnabled: true,
      finalExport,
      freezeProof,
      prepared,
      switchedAt: '2026-09-04T09:20:00.000Z',
    });

    expect(report).toMatchObject({
      activeConflictCount: 0,
      authority: {
        commercial: 'Twenty',
        entitlement: 'ParyatechOS',
      },
      status: 'switched',
    });
    expect(report.rollbackManifest.mode).toBe('restore-and-lift-freeze');
  });

  it('blocks the authority switch while any active conflict remains', async () => {
    const prepared = preparedCutover();
    const adapter = new MemoryAdapter();
    const finalExport = finalExportFor(prepared);
    const freezeProof = freezeProofFor(prepared);
    const applyResult = await applyCommercialCutover(
      prepared,
      finalExport,
      freezeProof,
      {
        adapter,
        checkpointStore: new InMemoryCommercialCutoverCheckpointStore(),
      },
    );

    expect(() =>
      reconcileCommercialCutover({
        activeConflictReferences: ['exception-commercial-1'],
        actorReference: 'commercial-data-owner',
        agreements: [...adapter.agreements.values()],
        applyResult,
        entitlementAuthority: 'ParyatechOS',
        entitlementSmokeEvidenceHash: HASH,
        entitlementMutationEnabled: true,
        finalExport,
        freezeProof,
        prepared,
        switchedAt: '2026-09-04T09:20:00.000Z',
      }),
    ).toThrowError(/zero active conflicts/iu);
  });

  it('allows restore and freeze release only before the first post-switch Twenty write', async () => {
    const prepared = preparedCutover();
    const adapter = new MemoryAdapter();
    const finalExport = finalExportFor(prepared);
    const freezeProof = freezeProofFor(prepared);
    const applyResult = await applyCommercialCutover(
      prepared,
      finalExport,
      freezeProof,
      {
        adapter,
        checkpointStore: new InMemoryCommercialCutoverCheckpointStore(),
      },
    );
    const report = reconcileCommercialCutover({
      activeConflictReferences: [],
      actorReference: 'commercial-data-owner',
      agreements: [...adapter.agreements.values()],
      applyResult,
      entitlementAuthority: 'ParyatechOS',
      entitlementSmokeEvidenceHash: HASH,
      entitlementMutationEnabled: true,
      finalExport,
      freezeProof,
      prepared,
      switchedAt: '2026-09-04T09:20:00.000Z',
    });

    expect(
      decideCommercialRollback(report, {
        firstPostSwitchTwentyWriteAt: null,
        requestedAt: '2026-09-04T09:21:00.000Z',
      }),
    ).toMatchObject({ mode: 'restore-and-lift-freeze' });
    expect(
      decideCommercialRollback(report, {
        firstPostSwitchTwentyWriteAt: '2026-09-04T09:22:00.000Z',
        requestedAt: '2026-09-04T09:23:00.000Z',
        sharedExceptionReference: 'exception-commercial-forward-1',
      }),
    ).toMatchObject({
      mode: 'forward-only',
      sharedExceptionReference: 'exception-commercial-forward-1',
    });
    expect(() =>
      decideCommercialRollback(report, {
        firstPostSwitchTwentyWriteAt: '2026-09-04T09:22:00.000Z',
        requestedAt: '2026-09-04T09:23:00.000Z',
      }),
    ).toThrowError(/Shared Exception/iu);
  });
});

describe('Twenty commercial cutover GraphQL adapter', () => {
  it('executes authenticated server dry-run without exposing the token', async () => {
    const prepared = preparedCutover([activeRow()]);
    const finalExport = finalExportFor(prepared);
    const freezeProof = freezeProofFor(prepared);
    const target = prepared.rows[0]!.target;
    const requests: Array<{
      body: Record<string, unknown>;
      headers: Headers;
      url: string;
    }> = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        operationName: string;
        variables: Record<string, unknown>;
      };
      requests.push({
        body,
        headers: new Headers(init?.headers),
        url: String(input),
      });
      if (body.operationName === 'InspectCommercialCutoverAgreement') {
        return Response.json({
          data: { inspectCommercialCutoverAgreement: null },
        });
      }
      if (body.operationName === 'ApplyCommercialCutoverAgreement') {
        return Response.json({
          data: {
            applyCommercialCutoverAgreement: {
              created: true,
              previous: null,
              recordId: null,
              snapshot: target,
            },
          },
        });
      }
      throw new Error('unexpected operation');
    };
    const adapter = createTwentyCommercialCutoverAdapter({
      baseUrl: 'https://twenty.example.test',
      dryRun: true,
      evidenceHash: freezeProof.evidenceHash,
      fetchImplementation,
      getApiKey: () => 'temporary-secret-token',
    });

    const result = await dryRunCommercialCutover(
      prepared,
      finalExport,
      freezeProof,
      adapter,
    );

    expect(result.counts).toMatchObject({ checked: 1, wouldCreate: 1 });
    expect(requests).toHaveLength(2);
    expect(requests.every(({ url }) => url.endsWith('/graphql'))).toBe(true);
    expect(
      requests.every(
        ({ headers }) =>
          headers.get('authorization') === 'Bearer temporary-secret-token',
      ),
    ).toBe(true);
    expect(JSON.stringify(requests.map(({ body }) => body))).not.toContain(
      'temporary-secret-token',
    );
    const mutation = requests[1]!.body as {
      variables: { input: { dryRun: boolean; evidenceHash: string } };
    };
    expect(mutation.variables.input).toMatchObject({
      dryRun: true,
      evidenceHash: freezeProof.evidenceHash,
    });
  });
});
