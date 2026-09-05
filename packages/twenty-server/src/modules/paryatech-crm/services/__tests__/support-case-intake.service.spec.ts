import { ParyatechCrmExceptionCode } from 'src/modules/paryatech-crm/exceptions/paryatech-crm.exception';
import { SupportCaseIntakeService } from 'src/modules/paryatech-crm/services/support-case-intake.service';
import { InMemoryParyatechTransitionStore } from 'src/modules/paryatech-crm/services/__tests__/paryatech-transition-test.store';
import {
  type RecordSubstantiveResponseParams,
  type RecordSupportReceiptParams,
  type TransitionSupportCaseParams,
} from 'src/modules/paryatech-crm/types/paryatech-transition.type';

const RECEIVED_AT = new Date('2026-09-04T10:00:00.000Z');

const setup = () => {
  const store = new InMemoryParyatechTransitionStore();
  store.roleLabel = 'Paryatech Operator';
  store.records = {
    supportCase: [
      {
        id: 'case-open',
        caseReference: 'CASE-OPEN',
        status: 'In Progress',
        ownerId: 'member-1',
        sourceReceivedAt: RECEIVED_AT,
        firstSubstantiveResponseAt: null,
        disposition: 'Support',
      },
    ],
    supportReceipt: [],
    crmOperatingPolicy: [
      {
        id: 'policy-1',
        active: true,
        businessCalendar: JSON.stringify({
          timezone: 'UTC',
          workdays: [1, 2, 3, 4, 5],
          holidays: [],
          hours: { start: '09:00', end: '17:00' },
        }),
      },
    ],
  };

  return { store, service: new SupportCaseIntakeService(store) };
};

const receiptInput = (): RecordSupportReceiptParams => ({
  workspaceId: 'workspace-1',
  userWorkspaceId: 'user-workspace-1',
  actorWorkspaceMemberId: 'member-1',
  receiptKey: 'Phone:source-1',
  providerOrSourceId: 'source-1',
  payloadHash: 'sha256:abc',
  channel: 'Phone',
  sourceReceivedAt: RECEIVED_AT,
  subject: 'Unable to complete proposal',
  summary: 'Agency reports a proposal workflow issue.',
  priority: 'High',
  ownerId: 'member-1',
  reason: 'Observable support receipt.',
  evidence: 'Manual phone log reference.',
  now: RECEIVED_AT,
});

const responseInput = (): RecordSubstantiveResponseParams => ({
  workspaceId: 'workspace-1',
  userWorkspaceId: 'user-workspace-1',
  actorWorkspaceMemberId: 'member-1',
  supportCaseId: 'case-open',
  respondedAt: new Date('2026-09-04T12:00:00.000Z'),
  responseSummary:
    'Operator explained the workaround and confirmed next steps.',
  reason: 'First substantive human response.',
  evidence: 'Call note reference.',
});

const transitionInput = (): TransitionSupportCaseParams => ({
  workspaceId: 'workspace-1',
  userWorkspaceId: 'user-workspace-1',
  actorWorkspaceMemberId: 'member-1',
  supportCaseId: 'case-open',
  expectedStatus: 'In Progress',
  targetStatus: 'Resolved',
  disposition: 'Resolved',
  resolution: 'Workaround confirmed with the Agency.',
  reason: 'Issue resolved.',
  evidence: 'Operator call note reference.',
  now: RECEIVED_AT,
});

describe('SupportCaseIntakeService', () => {
  it('should create an owned Case at source time with nullable relations for unknown identity', async () => {
    const { store, service } = setup();

    const result = await service.recordReceipt(receiptInput());

    expect(result.replayed).toBe(false);
    expect(result.state).toBe('New');
    const createdCase = store.records.supportCase.find(
      (record) => record.id === result.recordId,
    );
    expect(createdCase).toMatchObject({
      agencyId: null,
      contactId: null,
      productId: null,
      agreementId: null,
      sourceReceivedAt: RECEIVED_AT,
      ownerId: 'member-1',
      responseTargetAt: new Date('2026-09-04T14:00:00.000Z'),
    });
  });

  it('should attach only to a caller-verified matching open Case', async () => {
    const { store, service } = setup();

    const result = await service.recordReceipt({
      ...receiptInput(),
      verifiedOpenCaseId: 'case-open',
      verifiedMatchEvidence: 'Exact case reference confirmed by operator.',
    });

    expect(result.recordId).toBe('case-open');
    expect(store.records.supportCase).toHaveLength(1);
    expect(store.records.supportReceipt[0].caseId).toBe('case-open');
  });

  it('should reject an unverified or closed Case attachment', async () => {
    const { store, service } = setup();
    store.records.supportCase[0].status = 'Closed';

    await expect(
      service.recordReceipt({
        ...receiptInput(),
        verifiedOpenCaseId: 'case-open',
        verifiedMatchEvidence: 'Claimed match.',
      }),
    ).rejects.toMatchObject({
      code: ParyatechCrmExceptionCode.SUPPORT_MATCH_INVALID,
    });
  });

  it('should replay a receipt key by returning the existing Case without another receipt', async () => {
    const { store, service } = setup();
    const first = await service.recordReceipt(receiptInput());
    const replay = await service.recordReceipt(receiptInput());

    expect(replay).toMatchObject({ recordId: first.recordId, replayed: true });
    expect(store.records.supportReceipt).toHaveLength(1);
  });

  it('should reject a receipt key that does not match its channel and source', async () => {
    const { service } = setup();

    await expect(
      service.recordReceipt({
        ...receiptInput(),
        receiptKey: 'Phone:different-source',
      }),
    ).rejects.toMatchObject({ code: 'RECEIPT_CONFLICT' });
  });

  it('should reject a conflicting payload instead of treating it as a replay', async () => {
    const { store, service } = setup();
    await service.recordReceipt(receiptInput());

    await expect(
      service.recordReceipt({
        ...receiptInput(),
        payloadHash: 'sha256:different',
      }),
    ).rejects.toMatchObject({ code: 'RECEIPT_CONFLICT' });
    expect(store.records.supportReceipt).toHaveLength(1);
  });

  it.each(['Duplicate', 'Non-support'])(
    'should retain receipt history when closing as %s',
    async (disposition) => {
      const { store, service } = setup();
      const created = await service.recordReceipt(receiptInput());

      await service.transitionCase({
        ...transitionInput(),
        supportCaseId: created.recordId,
        expectedStatus: 'New',
        targetStatus: 'Closed',
        disposition,
        resolution: `${disposition} disposition retained.`,
      });

      expect(store.records.supportReceipt).toHaveLength(1);
      expect(
        store.records.supportCase.find(
          (record) => record.id === created.recordId,
        ),
      ).toMatchObject({
        status: 'Closed',
        disposition,
        sourceReceivedAt: RECEIVED_AT,
      });
    },
  );

  it('should not count assignment or acknowledgement as substantive response', async () => {
    const { store, service } = setup();

    await service.transitionCase({
      ...transitionInput(),
      expectedStatus: 'In Progress',
      targetStatus: 'Assigned',
      disposition: 'Support',
      resolution: undefined,
    });

    expect(store.records.supportCase[0].firstSubstantiveResponseAt).toBeNull();
  });

  it('should set first substantive response once from source-time accounting', async () => {
    const { store, service } = setup();

    await service.recordSubstantiveResponse(responseInput());
    await service.recordSubstantiveResponse({
      ...responseInput(),
      respondedAt: new Date('2026-09-04T13:00:00.000Z'),
    });

    expect(store.records.supportCase[0].firstSubstantiveResponseAt).toEqual(
      new Date('2026-09-04T12:00:00.000Z'),
    );
  });

  it('should reject a substantive response timestamp before source receipt', async () => {
    const { store, service } = setup();

    await expect(
      service.recordSubstantiveResponse({
        ...responseInput(),
        respondedAt: new Date('2026-09-04T09:59:59.999Z'),
      }),
    ).rejects.toMatchObject({
      code: ParyatechCrmExceptionCode.EVIDENCE_REQUIRED,
    });
    expect(store.records.supportCase[0].firstSubstantiveResponseAt).toBeNull();
  });

  it('should reopen the same resolved Case to In Progress', async () => {
    const { store, service } = setup();
    Object.assign(store.records.supportCase[0], {
      status: 'Resolved',
      resolution: 'Resolved once.',
    });

    const result = await service.transitionCase({
      ...transitionInput(),
      expectedStatus: 'Resolved',
      targetStatus: 'In Progress',
      disposition: 'Support',
      resolution: 'New evidence requires reopening.',
    });

    expect(result.recordId).toBe('case-open');
    expect(store.records.supportCase).toHaveLength(1);
    expect(store.records.supportCase[0].status).toBe('In Progress');
  });

  it.each([
    ['record receipt', () => receiptInput(), 'recordReceipt'],
    ['record response', () => responseInput(), 'recordSubstantiveResponse'],
    ['transition Case', () => transitionInput(), 'transitionCase'],
  ] as const)(
    'should reject %s without evidence and for an unauthorized actor',
    async (_name, inputFactory, method) => {
      const missing = setup();
      await expect(
        missing.service[method]({ ...inputFactory(), evidence: '' } as never),
      ).rejects.toMatchObject({
        code: ParyatechCrmExceptionCode.EVIDENCE_REQUIRED,
      });

      const unauthorized = setup();
      unauthorized.store.roleLabel = 'Paryatech Legal Compliance';
      await expect(
        unauthorized.service[method](inputFactory() as never),
      ).rejects.toMatchObject({
        code: ParyatechCrmExceptionCode.PERMISSION_DENIED,
      });
    },
  );
});
