import { pathToFileURL } from 'node:url';

import {
  readVerifiedImportRunArtifact,
  validateApprovedImportPlan,
} from './import-approved.js';
import {
  RECONCILIATION_SCHEMA_VERSION,
  REVIEW_DECISIONS,
  canonicalJson,
  hashCanonical,
  parseStrictCliArguments,
  readPrivateJson,
  sha256,
  writeCliFailure,
  writePrivateJsonAtomic,
  type AppliedWorkspaceSnapshot,
  type ApplyImportResult,
  type ApprovedImportPlan,
  type CompanySourceRelationPayload,
  type CliIo,
  type ReconciliationDiscrepancy,
  type ReconciliationDiscrepancyKind,
  type ReconciliationReport,
  type ReconciliationSample,
  type RelationPayload,
  type ReviewDecision,
  type StructuredLogger,
} from './types.js';

type ReconcileInput = {
  applyResult: ApplyImportResult;
  plan: ApprovedImportPlan;
  sampleSize?: number;
  snapshot: AppliedWorkspaceSnapshot;
};

const allowedApplyDecisions: ReviewDecision[] = [
  'Confirm Existing Agency',
  'Create New Agency',
  'Keep Separate Contacts',
];

const normalizedKeys = (keys: string[]): string[] =>
  [...new Set(keys)].sort((left, right) => left.localeCompare(right));

const relationKey = (relation: RelationPayload): string =>
  `${relation.companyExternalKey}:${relation.personExternalKey}`;

const companySourceRelationKey = (
  relation: CompanySourceRelationPayload,
): string => `${relation.companyExternalKey}:${relation.sourceExternalKey}`;

const discrepancy = (
  kind: ReconciliationDiscrepancyKind,
  expected: unknown,
  observed: unknown,
): ReconciliationDiscrepancy => ({
  expectedHash: hashCanonical(expected),
  kind,
  observedHash: hashCanonical(observed),
});

const compareKeySets = (
  kind: Extract<
    ReconciliationDiscrepancyKind,
    | 'company-key'
    | 'company-source-relation-key'
    | 'people-key'
    | 'relation-key'
    | 'source-key'
  >,
  expectedKeys: string[],
  observedKeys: string[],
): ReconciliationDiscrepancy[] => {
  const expected = normalizedKeys(expectedKeys);
  const observed = normalizedKeys(observedKeys);

  if (
    expected.length === observed.length &&
    expected.every((key, index) => key === observed[index])
  ) {
    return [];
  }

  return [discrepancy(kind, expected, observed)];
};

const countDecisions = (
  plan: ApprovedImportPlan,
): Partial<Record<ReviewDecision, number>> => {
  const counts: Partial<Record<ReviewDecision, number>> = {};

  for (const decision of REVIEW_DECISIONS) {
    const count = plan.rows.filter(
      (row) => row.decision.decision === decision,
    ).length;

    if (count > 0) {
      counts[decision] = count;
    }
  }

  return counts;
};

export const reconcileImport = (
  input: ReconcileInput,
  logger?: StructuredLogger,
): ReconciliationReport => {
  const plan = validateApprovedImportPlan(input.plan);
  const sampleSize = input.sampleSize ?? 5;

  if (!Number.isInteger(sampleSize) || sampleSize < 0 || sampleSize > 100) {
    throw new Error('sampleSize must be an integer from zero through 100');
  }

  const eligibleRows = plan.rows.filter(
    (row) =>
      row.decision.state === 'decided' &&
      row.decision.decision !== undefined &&
      allowedApplyDecisions.includes(row.decision.decision),
  );
  const expectedSourceKeys = eligibleRows.map(
    (row) => row.payload.source.externalKey,
  );
  const expectedCompanyKeys = eligibleRows.map(
    (row) => row.payload.company.externalKey,
  );
  const expectedPeopleKeys = eligibleRows
    .map((row) => row.payload.person?.externalKey)
    .filter((externalKey): externalKey is string => externalKey !== undefined);
  const expectedCompanySourceRelationKeys = eligibleRows.map((row) =>
    companySourceRelationKey({
      companyExternalKey: row.payload.company.externalKey,
      sourceExternalKey: row.payload.source.externalKey,
    }),
  );
  const expectedRelationKeys = eligibleRows
    .map((row) => row.payload.person)
    .filter((person) => person !== undefined)
    .map((person) =>
      relationKey({
        companyExternalKey: person.companyExternalKey,
        personExternalKey: person.externalKey,
      }),
    );
  const observedRelationKeys = input.snapshot.relations.map(relationKey);
  const observedCompanySourceRelationKeys =
    input.snapshot.companySourceRelations.map(companySourceRelationKey);
  const expectedCounts = {
    companySourceRelations: normalizedKeys(
      expectedCompanySourceRelationKeys,
    ).length,
    companies: normalizedKeys(expectedCompanyKeys).length,
    people: normalizedKeys(expectedPeopleKeys).length,
    relations: normalizedKeys(expectedRelationKeys).length,
    sources: normalizedKeys(expectedSourceKeys).length,
  };
  const discrepancies: ReconciliationDiscrepancy[] = [];

  if (input.snapshot.batchId !== plan.batchId) {
    discrepancies.push(
      discrepancy('batch', plan.batchId, input.snapshot.batchId),
    );
  }
  if (input.snapshot.datasetHash !== plan.preparedDatasetHash) {
    discrepancies.push(
      discrepancy(
        'dataset-hash',
        plan.preparedDatasetHash,
        input.snapshot.datasetHash,
      ),
    );
  }
  if (
    input.snapshot.planHash !== plan.planHash ||
    input.applyResult.planHash !== plan.planHash
  ) {
    discrepancies.push(
      discrepancy('plan-hash', plan.planHash, [
        input.snapshot.planHash,
        input.applyResult.planHash,
      ]),
    );
  }

  const countComparisons: Array<{
    kind: Extract<
      ReconciliationDiscrepancyKind,
      | 'company-count'
      | 'company-source-relation-count'
      | 'people-count'
      | 'relation-count'
      | 'source-count'
    >;
    expected: number;
    observed: [number, number];
  }> = [
    {
      expected: expectedCounts.companySourceRelations,
      kind: 'company-source-relation-count',
      observed: [
        input.applyResult.counts.companySourceRelations,
        normalizedKeys(observedCompanySourceRelationKeys).length,
      ],
    },
    {
      expected: expectedCounts.companies,
      kind: 'company-count',
      observed: [
        input.applyResult.counts.companies,
        normalizedKeys(input.snapshot.companyExternalKeys).length,
      ],
    },
    {
      expected: expectedCounts.people,
      kind: 'people-count',
      observed: [
        input.applyResult.counts.people,
        normalizedKeys(input.snapshot.peopleExternalKeys).length,
      ],
    },
    {
      expected: expectedCounts.relations,
      kind: 'relation-count',
      observed: [
        input.applyResult.counts.relations,
        normalizedKeys(observedRelationKeys).length,
      ],
    },
    {
      expected: expectedCounts.sources,
      kind: 'source-count',
      observed: [
        input.applyResult.counts.sources,
        normalizedKeys(input.snapshot.sourceExternalKeys).length,
      ],
    },
  ];

  for (const comparison of countComparisons) {
    if (
      comparison.observed[0] !== comparison.expected ||
      comparison.observed[1] !== comparison.expected
    ) {
      discrepancies.push(
        discrepancy(comparison.kind, comparison.expected, comparison.observed),
      );
    }
  }

  discrepancies.push(
    ...compareKeySets(
      'company-key',
      expectedCompanyKeys,
      input.snapshot.companyExternalKeys,
    ),
    ...compareKeySets(
      'company-source-relation-key',
      expectedCompanySourceRelationKeys,
      observedCompanySourceRelationKeys,
    ),
    ...compareKeySets(
      'people-key',
      expectedPeopleKeys,
      input.snapshot.peopleExternalKeys,
    ),
    ...compareKeySets(
      'relation-key',
      expectedRelationKeys,
      observedRelationKeys,
    ),
    ...compareKeySets(
      'source-key',
      expectedSourceKeys,
      input.snapshot.sourceExternalKeys,
    ),
  );

  const allSamples: ReconciliationSample[] = [
    ...normalizedKeys(input.snapshot.companyExternalKeys).map(
      (externalKey) => ({
        entity: 'company' as const,
        externalKeyHash: sha256(externalKey),
      }),
    ),
    ...normalizedKeys(observedCompanySourceRelationKeys).map(
      (externalKey) => ({
        entity: 'company-source-relation' as const,
        externalKeyHash: sha256(externalKey),
      }),
    ),
    ...normalizedKeys(input.snapshot.peopleExternalKeys).map((externalKey) => ({
      entity: 'person' as const,
      externalKeyHash: sha256(externalKey),
    })),
    ...normalizedKeys(observedRelationKeys).map((externalKey) => ({
      entity: 'relation' as const,
      externalKeyHash: sha256(externalKey),
    })),
    ...normalizedKeys(input.snapshot.sourceExternalKeys).map((externalKey) => ({
      entity: 'source' as const,
      externalKeyHash: sha256(externalKey),
    })),
  ].sort((left, right) =>
    left.externalKeyHash.localeCompare(right.externalKeyHash),
  );
  const withoutHash = {
    batchId: plan.batchId,
    counts: {
      appliedRows: eligibleRows.length,
      companySourceRelations: normalizedKeys(
        observedCompanySourceRelationKeys,
      ).length,
      companies: normalizedKeys(input.snapshot.companyExternalKeys).length,
      decisions: countDecisions(plan),
      people: normalizedKeys(input.snapshot.peopleExternalKeys).length,
      relations: normalizedKeys(observedRelationKeys).length,
      sources: normalizedKeys(input.snapshot.sourceExternalKeys).length,
    },
    discrepancies,
    samples: allSamples.slice(0, sampleSize),
    schemaVersion: RECONCILIATION_SCHEMA_VERSION,
    status:
      discrepancies.length === 0
        ? ('reconciled' as const)
        : ('mismatch' as const),
  };
  const report: ReconciliationReport = {
    ...withoutHash,
    reportHash: hashCanonical(withoutHash),
  };

  logger?.({
    event: 'reconcile.completed',
    fields: {
      batchIdHash: sha256(plan.batchId),
      discrepancies: discrepancies.length,
      planHash: plan.planHash,
      reportHash: report.reportHash,
      status: report.status,
    },
  });

  return report;
};

const validateWorkspaceSnapshot = (
  value: unknown,
): AppliedWorkspaceSnapshot => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Workspace snapshot must be an object');
  }

  const snapshot = value as Record<string, unknown>;
  const allowedKeys = [
    'batchId',
    'companyExternalKeys',
    'companySourceRelations',
    'datasetHash',
    'peopleExternalKeys',
    'planHash',
    'relations',
    'sourceExternalKeys',
  ];

  if (Object.keys(snapshot).some((key) => !allowedKeys.includes(key))) {
    throw new Error('Workspace snapshot contains unsupported fields');
  }

  const stringArrays = [
    snapshot.companyExternalKeys,
    snapshot.peopleExternalKeys,
    snapshot.sourceExternalKeys,
  ];

  if (
    typeof snapshot.batchId !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(String(snapshot.datasetHash)) ||
    !/^[a-f0-9]{64}$/u.test(String(snapshot.planHash)) ||
    stringArrays.some(
      (items) =>
        !Array.isArray(items) ||
        items.some((item) => typeof item !== 'string' || item.length === 0),
    ) ||
    !Array.isArray(snapshot.companySourceRelations) ||
    !Array.isArray(snapshot.relations)
  ) {
    throw new Error('Workspace snapshot fields are invalid');
  }

  for (const relationValue of snapshot.companySourceRelations) {
    if (
      relationValue === null ||
      typeof relationValue !== 'object' ||
      Array.isArray(relationValue)
    ) {
      throw new Error('Workspace Company-source relation is invalid');
    }

    const relation = relationValue as Record<string, unknown>;

    if (
      Object.keys(relation).some(
        (key) => key !== 'companyExternalKey' && key !== 'sourceExternalKey',
      ) ||
      typeof relation.companyExternalKey !== 'string' ||
      typeof relation.sourceExternalKey !== 'string'
    ) {
      throw new Error(
        'Workspace Company-source relation fields are invalid',
      );
    }
  }

  for (const relationValue of snapshot.relations) {
    if (
      relationValue === null ||
      typeof relationValue !== 'object' ||
      Array.isArray(relationValue)
    ) {
      throw new Error('Workspace snapshot relation is invalid');
    }

    const relation = relationValue as Record<string, unknown>;

    if (
      Object.keys(relation).some(
        (key) => key !== 'companyExternalKey' && key !== 'personExternalKey',
      ) ||
      typeof relation.companyExternalKey !== 'string' ||
      typeof relation.personExternalKey !== 'string'
    ) {
      throw new Error('Workspace snapshot relation fields are invalid');
    }
  }

  return value as AppliedWorkspaceSnapshot;
};

type ReconcileCliOptions = CliIo & {
  argv: string[];
};

export const runReconcileImportCli = async (
  options: ReconcileCliOptions,
): Promise<number> => {
  try {
    const argumentsByName = parseStrictCliArguments(
      options.argv,
      ['--apply-result', '--approved', '--output', '--snapshot'],
      ['--apply-result', '--approved', '--output', '--snapshot'],
    );
    const plan = validateApprovedImportPlan(
      await readPrivateJson(argumentsByName['--approved']!),
    );
    const runArtifact = await readVerifiedImportRunArtifact(
      argumentsByName['--apply-result']!,
    );
    const snapshot = validateWorkspaceSnapshot(
      await readPrivateJson(argumentsByName['--snapshot']!),
    );
    const logger: StructuredLogger = (event) =>
      options.writeStderr?.(canonicalJson(event));
    const report = reconcileImport(
      {
        applyResult: runArtifact.applyResult,
        plan,
        snapshot,
      },
      logger,
    );

    await writePrivateJsonAtomic(argumentsByName['--output']!, report);
    options.writeStdout?.(
      canonicalJson({
        event: 'reconcile.completed',
        reportHash: report.reportHash,
        status: report.status,
      }),
    );

    return report.status === 'reconciled' ? 0 : 2;
  } catch (error) {
    writeCliFailure(error, options.writeStderr);

    return 1;
  }
};

const isReconcileCliMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isReconcileCliMain) {
  process.exitCode = await runReconcileImportCli({
    argv: process.argv.slice(2),
    writeStderr: (line) => process.stderr.write(`${line}\n`),
    writeStdout: (line) => process.stdout.write(`${line}\n`),
  });
}
