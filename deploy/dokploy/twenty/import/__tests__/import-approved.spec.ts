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

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApplyImportError,
  InMemoryCheckpointStore,
  RetryableImportError,
  applyApprovedImport,
  createApprovedImportPlan,
  createOpenDecision,
  createTwentyGraphqlAdapter,
  markDecisionApplied,
  recordDecision,
  reopenDecision,
  runApprovedImportCli,
  validateApprovedImportPlan,
} from '../import-approved.js';
import type {
  ApprovedImportRow,
  StructuredLogEvent,
  TwentyApiAdapter,
} from '../types.js';

const createPayload = (suffix: string) => ({
  source: {
    externalKey: 'source-community-2026',
    name: 'Approved Community Source',
    outreachBasis: 'approval-reference',
    sourceBatch: 'batch-approved',
    sourceType: 'Community' as const,
  },
  company: {
    externalKey: `agency-${suffix}`,
    name: `Agency ${suffix}`,
    normalizedDomain: `${suffix}.invalid`,
  },
  person: {
    companyExternalKey: `agency-${suffix}`,
    email: `owner@${suffix}.invalid`,
    externalKey: `contact-${suffix}`,
    name: `Contact ${suffix}`,
    phone: `0${suffix.padStart(9, '1')}`,
  },
});

const createDecidedRow = (
  suffix: string,
  decision: Exclude<ApprovedImportRow['decision']['decision'], undefined>,
  options: { candidateId?: string; reason?: string } = {},
): ApprovedImportRow => {
  const open = createOpenDecision(`row-hash-${suffix}`);
  const decided = recordDecision(open, {
    candidateId: options.candidateId,
    decision,
    reason: options.reason,
    reviewerId: 'reviewer-internal-id',
  });

  return {
    decision: decided,
    payload: createPayload(suffix),
    rowHash: `row-hash-${suffix}`,
  };
};

const createAdapter = (
  calls: string[],
  overrides: Partial<TwentyApiAdapter> = {},
): TwentyApiAdapter => ({
  linkCompanyToSource: async (input) => {
    calls.push(`company-source:${input.companyExternalKey}`);

    return {
      created: true,
      id: `company-source-${input.companyExternalKey}`,
    };
  },
  linkPersonToCompany: async (input) => {
    calls.push(`relation:${input.personExternalKey}`);

    return { created: true, id: `relation-${input.personExternalKey}` };
  },
  upsertCompany: async (input) => {
    calls.push(`company:${input.externalKey}`);

    return { created: true, id: `company-${input.externalKey}` };
  },
  upsertPerson: async (input) => {
    calls.push(`person:${input.externalKey}`);

    return { created: true, id: `person-${input.externalKey}` };
  },
  upsertSource: async (input) => {
    calls.push(`source:${input.externalKey}`);

    return { created: true, id: `source-${input.externalKey}` };
  },
  ...overrides,
});

const temporaryDirectories: string[] = [];

const createCliPath = async (name: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'paryatech-apply-'));

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

const successfulGraphqlResponse = (operationName: string): Response => {
  const dataByOperation: Record<string, unknown> = {
    CreateAcquisitionSource: { createAcquisitionSource: { id: 'source-id' } },
    CreateCompany: { createCompany: { id: 'company-id' } },
    CreatePerson: { createPerson: { id: 'person-id' } },
    FindAcquisitionSourceByExternalKey: {
      acquisitionSources: { edges: [] },
    },
    FindCompanyByExternalKey: { companies: { edges: [] } },
    FindPersonByExternalKey: { people: { edges: [] } },
    GetCompanyOriginalAcquisitionSource: {
      companies: {
        edges: [
          { node: { id: 'company-id', originalAcquisitionSource: null } },
        ],
      },
    },
    LinkCompanyToSource: { updateCompany: { id: 'company-id' } },
    LinkPersonToCompany: { updatePerson: { id: 'person-id' } },
  };

  return new Response(
    JSON.stringify({ data: dataByOperation[operationName] ?? null }),
    {
      headers: { 'content-type': 'application/json' },
      status: 200,
    },
  );
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('decision state machine', () => {
  it.each([
    ['Confirm Existing Agency', 'agency-existing', 'confirmed evidence'],
    ['Create New Agency', undefined, 'new agency evidence'],
    ['Reject Match', 'agency-rejected', 'signals conflict'],
    ['Keep Separate Contacts', 'agency-existing', 'distinct people'],
    ['Quarantine with Reason', undefined, 'identity unresolved'],
  ] as const)(
    'records the exact %s decision',
    (decision, candidateId, reason) => {
      const open = createOpenDecision('row-hash');
      const result = recordDecision(open, {
        candidateId,
        decision,
        reason,
        reviewerId: 'reviewer-id',
      });

      expect(result.decision).toBe(decision);
      expect(result.state).toBe(
        decision === 'Quarantine with Reason' ? 'quarantined' : 'decided',
      );
      expect(result.history).toHaveLength(1);
    },
  );

  it('reopens a decision before apply and rejects reopening after apply', () => {
    const decided = recordDecision(createOpenDecision('row-hash'), {
      candidateId: 'agency-rejected',
      decision: 'Reject Match',
      reason: 'wrong domain',
      reviewerId: 'reviewer-id',
    });
    const reopened = reopenDecision(decided, {
      reason: 'new approved evidence',
      reviewerId: 'reviewer-2',
    });
    const replacement = recordDecision(reopened, {
      decision: 'Create New Agency',
      reason: 'confirmed distinct',
      reviewerId: 'reviewer-2',
    });
    const applied = markDecisionApplied(replacement, 'apply-hash');

    expect(reopened.state).toBe('reopened');
    expect(replacement.decision).toBe('Create New Agency');
    expect(replacement.revision).toBe(3);
    expect(() =>
      reopenDecision(applied, {
        reason: 'too late',
        reviewerId: 'reviewer-3',
      }),
    ).toThrow(ApplyImportError);
  });

  it('requires candidate and reason evidence for the decisions that need them', () => {
    const open = createOpenDecision('row-hash');

    expect(() =>
      recordDecision(open, {
        decision: 'Confirm Existing Agency',
        reviewerId: 'reviewer-id',
      }),
    ).toThrow(ApplyImportError);
    expect(() =>
      recordDecision(open, {
        decision: 'Quarantine with Reason',
        reviewerId: 'reviewer-id',
      }),
    ).toThrow(ApplyImportError);
  });
});

describe('createApprovedImportPlan', () => {
  it('creates strict deterministic plan hashes', () => {
    const rows = [
      createDecidedRow('one', 'Create New Agency', { reason: 'new' }),
    ];
    const input = {
      batchId: 'batch-approved',
      preparedDatasetHash: 'a'.repeat(64),
      rows,
    };

    const first = createApprovedImportPlan(input);
    const second = createApprovedImportPlan({ ...input, rows: [...rows] });

    expect(second).toEqual(first);
    expect(first.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(validateApprovedImportPlan(first)).toEqual(first);
  });

  it('rejects unknown fields that could bypass the import authority boundary', () => {
    const plan = createApprovedImportPlan({
      batchId: 'batch-approved',
      preparedDatasetHash: 'a'.repeat(64),
      rows: [createDecidedRow('one', 'Create New Agency', { reason: 'new' })],
    });
    const unsafe = {
      ...plan,
      rows: [
        {
          ...plan.rows[0],
          payload: {
            ...plan.rows[0]?.payload,
            opportunity: { stage: 'Paid / Won' },
            reservationStatus: 'Claimed',
          },
        },
      ],
    };

    expect(() => validateApprovedImportPlan(unsafe)).toThrow(ApplyImportError);
  });

  it('rejects decision records whose state or candidate contradicts the decision', () => {
    const confirmed = createDecidedRow('confirmed', 'Confirm Existing Agency', {
      candidateId: 'agency-existing',
      reason: 'confirmed match',
    });
    const { candidateId: _candidateId, ...withoutCandidate } =
      confirmed.decision;

    expect(() =>
      createApprovedImportPlan({
        batchId: 'batch-approved',
        preparedDatasetHash: 'a'.repeat(64),
        rows: [{ ...confirmed, decision: withoutCandidate }],
      }),
    ).toThrow(ApplyImportError);

    const created = createDecidedRow('new', 'Create New Agency', {
      reason: 'new agency',
    });

    expect(() =>
      createApprovedImportPlan({
        batchId: 'batch-approved',
        preparedDatasetHash: 'a'.repeat(64),
        rows: [
          {
            ...created,
            decision: { ...created.decision, state: 'quarantined' },
          },
        ],
      }),
    ).toThrow(ApplyImportError);
  });
});

describe('applyApprovedImport', () => {
  it('applies globally in Source then Company then Person then Company-source and Person-company relation order', async () => {
    const calls: string[] = [];
    const plan = createApprovedImportPlan({
      batchId: 'batch-approved',
      preparedDatasetHash: 'a'.repeat(64),
      rows: [
        createDecidedRow('one', 'Create New Agency', { reason: 'new' }),
        createDecidedRow('two', 'Keep Separate Contacts', {
          candidateId: 'agency-existing',
          reason: 'separate contacts',
        }),
      ],
    });

    const result = await applyApprovedImport(plan, {
      adapter: createAdapter(calls),
      checkpointStore: new InMemoryCheckpointStore(),
      revokeTemporaryKey: vi.fn().mockResolvedValue(undefined),
    });

    expect(calls).toEqual([
      'source:source-community-2026',
      'company:agency-one',
      'company:agency-two',
      'person:contact-one',
      'person:contact-two',
      'company-source:agency-one',
      'company-source:agency-two',
      'relation:contact-one',
      'relation:contact-two',
    ]);
    expect(result.counts).toMatchObject({
      appliedRows: 2,
      companySourceRelations: 2,
      companies: 2,
      people: 2,
      relations: 2,
      sources: 1,
    });
    expect(result.rollbackManifest.operations).toHaveLength(9);
  });

  it.each(['Confirm Existing Agency', 'Keep Separate Contacts'] as const)(
    'targets the reviewed candidate for %s',
    async (decision) => {
      const existingRecordIds: unknown[] = [];
      const plan = createApprovedImportPlan({
        batchId: 'batch-approved',
        preparedDatasetHash: 'a'.repeat(64),
        rows: [
          createDecidedRow('existing', decision, {
            candidateId: 'agency-existing-record-id',
            reason: 'reviewed candidate',
          }),
        ],
      });

      await applyApprovedImport(plan, {
        adapter: createAdapter([], {
          upsertCompany: async (_input, context) => {
            existingRecordIds.push(
              Reflect.get(context, 'existingRecordId') as unknown,
            );

            return { created: false, id: 'agency-existing-record-id' };
          },
        }),
        checkpointStore: new InMemoryCheckpointStore(),
        revokeTemporaryKey: vi.fn().mockResolvedValue(undefined),
      });

      expect(existingRecordIds).toEqual(['agency-existing-record-id']);
    },
  );

  it('excludes Reject Match and Quarantine rows from every API operation', async () => {
    const calls: string[] = [];
    const plan = createApprovedImportPlan({
      batchId: 'batch-approved',
      preparedDatasetHash: 'a'.repeat(64),
      rows: [
        createDecidedRow('rejected', 'Reject Match', {
          candidateId: 'agency-existing',
          reason: 'not the same agency',
        }),
        createDecidedRow('quarantine', 'Quarantine with Reason', {
          reason: 'identity unresolved',
        }),
      ],
    });

    const result = await applyApprovedImport(plan, {
      adapter: createAdapter(calls),
      checkpointStore: new InMemoryCheckpointStore(),
      revokeTemporaryKey: vi.fn().mockResolvedValue(undefined),
    });

    expect(calls).toEqual([]);
    expect(result.counts).toMatchObject({
      appliedRows: 0,
      quarantinedRows: 1,
      rejectedRows: 1,
    });
  });

  it('retries retryable operations with the same idempotency key', async () => {
    const calls: string[] = [];
    let attempts = 0;
    const adapter = createAdapter(calls, {
      upsertCompany: async (input, context) => {
        attempts += 1;
        calls.push(`company:${input.externalKey}:${context.idempotencyKey}`);
        if (attempts < 3) {
          throw new RetryableImportError('temporary failure');
        }

        return { created: true, id: `company-${input.externalKey}` };
      },
    });
    const plan = createApprovedImportPlan({
      batchId: 'batch-approved',
      preparedDatasetHash: 'a'.repeat(64),
      rows: [createDecidedRow('retry', 'Create New Agency', { reason: 'new' })],
    });

    await applyApprovedImport(plan, {
      adapter,
      checkpointStore: new InMemoryCheckpointStore(),
      maxAttempts: 3,
      revokeTemporaryKey: vi.fn().mockResolvedValue(undefined),
    });

    const companyCalls = calls.filter((call) => call.startsWith('company:'));

    expect(companyCalls).toHaveLength(3);
    expect(
      new Set(companyCalls.map((call) => call.split(':').at(-1))).size,
    ).toBe(1);
  });

  it('retries and checkpoints Company-source relations with one stable idempotency key', async () => {
    const relationCalls: string[] = [];
    let attempts = 0;
    const adapter = createAdapter([], {
      linkCompanyToSource: async (input, context) => {
        attempts += 1;
        relationCalls.push(
          `${input.companyExternalKey}:${context.idempotencyKey}`,
        );
        if (attempts === 1) {
          throw new RetryableImportError('temporary relation failure');
        }

        return { created: true, id: 'company-source-relation-id' };
      },
    });
    const plan = createApprovedImportPlan({
      batchId: 'batch-company-source-retry',
      preparedDatasetHash: 'a'.repeat(64),
      rows: [
        createDecidedRow('source-retry', 'Create New Agency', {
          reason: 'new',
        }),
      ],
    });
    const result = await applyApprovedImport(plan, {
      adapter,
      checkpointStore: new InMemoryCheckpointStore(),
      maxAttempts: 2,
      revokeTemporaryKey: vi.fn().mockResolvedValue(undefined),
    });

    expect(relationCalls).toHaveLength(2);
    expect(
      new Set(relationCalls.map((call) => call.split(':').at(-1))).size,
    ).toBe(1);
    expect(result.counts.companySourceRelations).toBe(1);
  });

  it('resumes a partial apply from idempotent checkpoints and revokes each temporary key', async () => {
    const firstCalls: string[] = [];
    const secondCalls: string[] = [];
    const checkpointStore = new InMemoryCheckpointStore();
    const firstRevoke = vi.fn().mockResolvedValue(undefined);
    const secondRevoke = vi.fn().mockResolvedValue(undefined);
    const plan = createApprovedImportPlan({
      batchId: 'batch-approved',
      preparedDatasetHash: 'a'.repeat(64),
      rows: [
        createDecidedRow('partial', 'Create New Agency', { reason: 'new' }),
      ],
    });
    const firstAdapter = createAdapter(firstCalls, {
      upsertPerson: async () => {
        firstCalls.push('person:failed');
        throw new Error('permanent failure');
      },
    });

    await expect(
      applyApprovedImport(plan, {
        adapter: firstAdapter,
        checkpointStore,
        revokeTemporaryKey: firstRevoke,
      }),
    ).rejects.toThrow('permanent failure');

    const result = await applyApprovedImport(plan, {
      adapter: createAdapter(secondCalls),
      checkpointStore,
      revokeTemporaryKey: secondRevoke,
    });

    expect(firstCalls).toEqual([
      'source:source-community-2026',
      'company:agency-partial',
      'person:failed',
    ]);
    expect(secondCalls).toEqual([
      'person:contact-partial',
      'company-source:agency-partial',
      'relation:contact-partial',
    ]);
    expect(firstRevoke).toHaveBeenCalledOnce();
    expect(secondRevoke).toHaveBeenCalledOnce();
    expect(result.counts.skippedCheckpointOperations).toBe(2);
  });

  it('redacts structured logs and revokes the key when apply fails', async () => {
    const rawEmail = 'owner@private.invalid';
    const rawName = 'Private Agency';
    const events: StructuredLogEvent[] = [];
    const revoke = vi.fn().mockResolvedValue(undefined);
    const row = createDecidedRow('private', 'Create New Agency', {
      reason: 'new',
    });

    row.payload.company.name = rawName;
    if (row.payload.person) {
      row.payload.person.email = rawEmail;
    }
    const plan = createApprovedImportPlan({
      batchId: 'batch-approved',
      preparedDatasetHash: 'a'.repeat(64),
      rows: [row],
    });
    const adapter = createAdapter([], {
      upsertSource: async () => {
        throw new Error(`provider rejected ${rawEmail}`);
      },
    });

    await expect(
      applyApprovedImport(plan, {
        adapter,
        checkpointStore: new InMemoryCheckpointStore(),
        logger: (event) => events.push(event),
        revokeTemporaryKey: revoke,
      }),
    ).rejects.toThrow();

    const serialized = JSON.stringify(events);

    expect(serialized).not.toContain(rawEmail);
    expect(serialized).not.toContain(rawName);
    expect(serialized).not.toContain('provider rejected');
    expect(revoke).toHaveBeenCalledOnce();
  });
});

it('seals a private reviewed decision artifact into a validated approved plan', async () => {
  const decisionInputPath = await createCliPath('decision-input.json');
  const approvedPath = await createCliPath('approved.json');

  await writePrivateJson(decisionInputPath, {
    batchId: 'batch-seal',
    preparedDatasetHash: 'a'.repeat(64),
    rows: [
      {
        decision: 'Create New Agency',
        payload: createPayload('sealed'),
        reason: 'reviewed as a new agency',
        reviewerId: 'reviewer-internal-id',
        rowHash: 'row-hash-sealed',
      },
    ],
  });
  const exitCode = await runApprovedImportCli({
    argv: [
      'seal',
      '--decision-input',
      decisionInputPath,
      '--approved',
      approvedPath,
    ],
    environment: {},
    writeStderr: () => undefined,
    writeStdout: () => undefined,
  });
  const approved = JSON.parse(await readFile(approvedPath, 'utf8')) as unknown;

  expect(exitCode).toBe(0);
  expect(validateApprovedImportPlan(approved).planHash).toMatch(
    /^[a-f0-9]{64}$/,
  );
  expect((await stat(approvedPath)).mode & 0o777).toBe(0o600);
});

describe('Twenty GraphQL adapter and apply CLI', () => {
  it('retries retryable HTTP responses but not permanent responses and redacts errors', async () => {
    const token = 'temporary-secret-token';
    const retryOperations: string[] = [];
    const retryIdempotencyKeys: Array<string | null> = [];
    let firstRequest = true;
    const retryFetch = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          operationName: string;
        };
        retryIdempotencyKeys.push(
          new Headers(init?.headers).get('idempotency-key'),
        );

        retryOperations.push(body.operationName);
        if (firstRequest) {
          firstRequest = false;

          return new Response(
            JSON.stringify({ errors: [{ message: `temporary ${token}` }] }),
            { status: 503 },
          );
        }

        return successfulGraphqlResponse(body.operationName);
      },
    );
    const retryPlan = createApprovedImportPlan({
      batchId: 'batch-http-retry',
      preparedDatasetHash: 'a'.repeat(64),
      rows: [
        createDecidedRow('http-retry', 'Create New Agency', { reason: 'new' }),
      ],
    });

    await applyApprovedImport(retryPlan, {
      adapter: createTwentyGraphqlAdapter({
        baseUrl: 'https://crm.example.invalid',
        fetchImplementation: retryFetch as typeof fetch,
        getApiKey: () => token,
      }),
      checkpointStore: new InMemoryCheckpointStore(),
      maxAttempts: 2,
      revokeTemporaryKey: vi.fn().mockResolvedValue(undefined),
    });

    expect(
      retryOperations.filter(
        (operation) => operation === 'FindAcquisitionSourceByExternalKey',
      ),
    ).toHaveLength(2);

    const permanentFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ errors: [{ message: `permanent ${token}` }] }),
          { status: 400 },
        ),
    );
    expect(new Set(retryIdempotencyKeys.slice(0, 2)).size).toBe(1);
    const permanentAdapter = createTwentyGraphqlAdapter({
      baseUrl: 'https://crm.example.invalid',
      fetchImplementation: permanentFetch as typeof fetch,
      getApiKey: () => token,
    });

    await expect(
      applyApprovedImport(retryPlan, {
        adapter: permanentAdapter,
        checkpointStore: new InMemoryCheckpointStore(),
        maxAttempts: 3,
        revokeTemporaryKey: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.not.toBeInstanceOf(RetryableImportError);
    await expect(
      permanentAdapter.upsertSource(retryPlan.rows[0]!.payload.source, {
        idempotencyKey: 'idempotency-key',
      }),
    ).rejects.not.toThrow(token);
    expect(permanentFetch).toHaveBeenCalledTimes(2);
  });

  it('reuses a reviewed existing Agency without overwriting identity fields', async () => {
    const fetchImplementation = vi.fn();
    const adapter = createTwentyGraphqlAdapter({
      baseUrl: 'https://crm.example.invalid',
      fetchImplementation: fetchImplementation as typeof fetch,
      getApiKey: () => 'temporary-key',
    });
    const result = await adapter.upsertCompany(
      {
        externalKey: 'source-row-key',
        name: 'Unreviewed replacement name',
        normalizedDomain: 'replacement.invalid',
      },
      {
        existingRecordId: 'reviewed-agency-id',
        idempotencyKey: 'stable-idempotency-key',
      },
    );

    expect(result).toEqual({ created: false, id: 'reviewed-agency-id' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('fails closed when original Acquisition Source conflicts', async () => {
    const operationNames: string[] = [];
    const adapter = createTwentyGraphqlAdapter({
      baseUrl: 'https://crm.example.invalid',
      fetchImplementation: vi.fn(
        async (_input: string | URL | Request, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body)) as {
            operationName: string;
          };

          operationNames.push(body.operationName);
          return new Response(
            JSON.stringify({
              data: {
                companies: {
                  edges: [
                    {
                      node: {
                        id: 'company-id',
                        originalAcquisitionSource: {
                          id: 'different-source-id',
                        },
                      },
                    },
                  ],
                },
              },
            }),
            { status: 200 },
          );
        },
      ) as typeof fetch,
      getApiKey: () => 'temporary-key',
    });

    await expect(
      adapter.linkCompanyToSource(
        {
          companyExternalKey: 'agency-one',
          sourceExternalKey: 'source-one',
        },
        {
          companyRecordId: 'company-id',
          idempotencyKey: 'stable-relation-key',
          sourceRecordId: 'source-id',
        },
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_RELATION_CONFLICT' });
    expect(operationNames).toEqual([
      'GetCompanyOriginalAcquisitionSource',
    ]);
  });

  it('preserves an already matching original Acquisition Source without update', async () => {
    const operationNames: string[] = [];
    const adapter = createTwentyGraphqlAdapter({
      baseUrl: 'https://crm.example.invalid',
      fetchImplementation: vi.fn(
        async (_input: string | URL | Request, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body)) as {
            operationName: string;
          };

          operationNames.push(body.operationName);

          return new Response(
            JSON.stringify({
              data: {
                companies: {
                  edges: [
                    {
                      node: {
                        id: 'company-id',
                        originalAcquisitionSource: { id: 'source-id' },
                      },
                    },
                  ],
                },
              },
            }),
            { status: 200 },
          );
        },
      ) as typeof fetch,
      getApiKey: () => 'temporary-key',
    });

    await expect(
      adapter.linkCompanyToSource(
        {
          companyExternalKey: 'agency-one',
          sourceExternalKey: 'source-one',
        },
        {
          companyRecordId: 'company-id',
          idempotencyKey: 'stable-relation-key',
          sourceRecordId: 'source-id',
        },
      ),
    ).resolves.toEqual({ created: false, id: 'company-id' });
    expect(operationNames).toEqual([
      'GetCompanyOriginalAcquisitionSource',
    ]);
  });

  it('runs ordered GraphQL apply, writes private artifacts, scrubs auth, and requires revocation attestation', async () => {
    const approvedPath = await createCliPath('approved.json');
    const checkpointPath = await createCliPath('checkpoint.json');
    const resultPath = await createCliPath('result.json');
    const rollbackPath = await createCliPath('rollback.json');
    const attestationPath = await createCliPath('attestation.json');
    const plan = createApprovedImportPlan({
      batchId: 'batch-cli-apply',
      preparedDatasetHash: 'a'.repeat(64),
      rows: [createDecidedRow('cli', 'Create New Agency', { reason: 'new' })],
    });
    const requests: Array<{
      authorization: string | null;
      idempotencyKey: string | null;
      operationName: string;
    }> = [];
    const token = 'temporary-api-key-never-log';
    const environment: NodeJS.ProcessEnv = {
      TWENTY_API_KEY: token,
      TWENTY_BASE_URL: 'https://crm.example.invalid',
    };
    const stderr: string[] = [];

    await writePrivateJson(approvedPath, plan);
    const fetchImplementation = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          operationName: string;
        };
        const headers = new Headers(init?.headers);

        requests.push({
          authorization: headers.get('authorization'),
          idempotencyKey: headers.get('idempotency-key'),
          operationName: body.operationName,
        });

        return successfulGraphqlResponse(body.operationName);
      },
    );
    const exitCode = await runApprovedImportCli({
      argv: [
        'apply',
        '--approved',
        approvedPath,
        '--checkpoint',
        checkpointPath,
        '--result',
        resultPath,
        '--rollback',
        rollbackPath,
      ],
      environment,
      fetchImplementation: fetchImplementation as typeof fetch,
      writeStderr: (line) => stderr.push(line),
      writeStdout: () => undefined,
    });
    const operationNames = requests.map((request) => request.operationName);
    const pendingResult = JSON.parse(await readFile(resultPath, 'utf8')) as {
      apiKeyFingerprint: string;
      planHash: string;
      revocationStatus: string;
    };

    expect(exitCode).toBe(2);
    expect(operationNames).toEqual([
      'FindAcquisitionSourceByExternalKey',
      'CreateAcquisitionSource',
      'FindCompanyByExternalKey',
      'CreateCompany',
      'FindPersonByExternalKey',
      'CreatePerson',
      'GetCompanyOriginalAcquisitionSource',
      'LinkCompanyToSource',
      'LinkPersonToCompany',
    ]);
    expect(
      requests.every(
        (request) =>
          request.authorization === `Bearer ${token}` &&
          request.idempotencyKey !== null,
      ),
    ).toBe(true);
    expect(environment.TWENTY_API_KEY).toBeUndefined();
    expect(JSON.stringify(stderr)).not.toContain(token);
    expect(pendingResult.revocationStatus).toBe('pending');

    for (const filePath of [checkpointPath, resultPath, rollbackPath]) {
      expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    }

    await writePrivateJson(attestationPath, {
      administratorEvidenceHash: 'e'.repeat(64),
      apiKeyFingerprint: pendingResult.apiKeyFingerprint,
      planHash: pendingResult.planHash,
      revokedAt: '2026-08-06T12:00:00.000Z',
      schemaVersion: 'paryatech-import-revocation-attestation/v1',
    });
    const attestExitCode = await runApprovedImportCli({
      argv: [
        'attest',
        '--result',
        resultPath,
        '--attestation',
        attestationPath,
      ],
      environment: {},
      writeStderr: (line) => stderr.push(line),
      writeStdout: () => undefined,
    });
    const verifiedResult = JSON.parse(await readFile(resultPath, 'utf8')) as {
      revocationStatus: string;
    };

    expect(attestExitCode).toBe(0);
    expect(verifiedResult.revocationStatus).toBe('verified');
  });

  it('resumes a CLI apply from its atomic filesystem checkpoint', async () => {
    const approvedPath = await createCliPath('approved.json');
    const checkpointPath = await createCliPath('checkpoint.json');
    const resultPath = await createCliPath('result.json');
    const rollbackPath = await createCliPath('rollback.json');
    const plan = createApprovedImportPlan({
      batchId: 'batch-cli-resume',
      preparedDatasetHash: 'a'.repeat(64),
      rows: [
        createDecidedRow('resume', 'Create New Agency', { reason: 'new' }),
      ],
    });

    await writePrivateJson(approvedPath, plan);
    const firstOperations: string[] = [];
    const firstExitCode = await runApprovedImportCli({
      argv: [
        'apply',
        '--approved',
        approvedPath,
        '--checkpoint',
        checkpointPath,
        '--result',
        resultPath,
        '--rollback',
        rollbackPath,
      ],
      environment: {
        TWENTY_API_KEY: 'first-temporary-key',
        TWENTY_BASE_URL: 'https://crm.example.invalid',
      },
      fetchImplementation: vi.fn(
        async (_input: string | URL | Request, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body)) as {
            operationName: string;
          };

          firstOperations.push(body.operationName);
          if (body.operationName === 'FindPersonByExternalKey') {
            return new Response(
              JSON.stringify({ errors: [{ code: 'BAD_INPUT' }] }),
              {
                status: 400,
              },
            );
          }

          return successfulGraphqlResponse(body.operationName);
        },
      ) as typeof fetch,
      writeStderr: () => undefined,
      writeStdout: () => undefined,
    });

    expect(firstExitCode).toBe(1);
    expect(firstOperations).toContain('CreateCompany');

    const resumedOperations: string[] = [];
    const secondExitCode = await runApprovedImportCli({
      argv: [
        'apply',
        '--approved',
        approvedPath,
        '--checkpoint',
        checkpointPath,
        '--result',
        resultPath,
        '--rollback',
        rollbackPath,
      ],
      environment: {
        TWENTY_API_KEY: 'second-temporary-key',
        TWENTY_BASE_URL: 'https://crm.example.invalid',
      },
      fetchImplementation: vi.fn(
        async (_input: string | URL | Request, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body)) as {
            operationName: string;
          };

          resumedOperations.push(body.operationName);

          return successfulGraphqlResponse(body.operationName);
        },
      ) as typeof fetch,
      writeStderr: () => undefined,
      writeStdout: () => undefined,
    });

    expect(secondExitCode).toBe(2);
    expect(resumedOperations).toEqual([
      'FindPersonByExternalKey',
      'CreatePerson',
      'GetCompanyOriginalAcquisitionSource',
      'LinkCompanyToSource',
      'LinkPersonToCompany',
    ]);
  });

  it('scrubs the environment key when strict apply environment validation fails', async () => {
    const environment: NodeJS.ProcessEnv = {
      TWENTY_API_KEY: 'temporary-key-on-invalid-run',
    };
    const exitCode = await runApprovedImportCli({
      argv: [
        'apply',
        '--approved',
        '/private/approved.json',
        '--checkpoint',
        '/private/checkpoint.json',
        '--result',
        '/private/result.json',
        '--rollback',
        '/private/rollback.json',
      ],
      environment,
      writeStderr: () => undefined,
      writeStdout: () => undefined,
    });

    expect(exitCode).toBe(1);
    expect(environment.TWENTY_API_KEY).toBeUndefined();
  });
});
