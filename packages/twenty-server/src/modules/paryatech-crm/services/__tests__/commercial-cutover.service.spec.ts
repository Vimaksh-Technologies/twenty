import { CommercialCutoverService } from 'src/modules/paryatech-crm/services/commercial-cutover.service';
import {
  type CommercialCutoverAgreement,
  type CommercialCutoverReceipt,
  ParyatechCommercialCutoverStore,
  type ParyatechCommercialCutoverTransaction,
} from 'src/modules/paryatech-crm/types/commercial-cutover.type';
import { hashCommercialCutoverValue } from 'src/modules/paryatech-crm/utils/hash-commercial-cutover-value.util';

const HASH = 'a'.repeat(64);

const target = (): CommercialCutoverAgreement => ({
  activationConfirmedAt: null,
  activationConfirmer: null,
  activationState: 'Pending',
  adoptionEvidence: null,
  adoptionObservedAt: null,
  adoptionState: 'Not Assessed',
  agency: '11111111-1111-4111-8111-111111111111',
  agreementReference: 'AGR-one',
  amountCollected: 120_000,
  commercialException: null,
  currency: 'INR',
  endsAt: '2027-09-04',
  evidenceObservedAt: '2026-09-04T07:55:00.000Z',
  evidenceRecordedAt: '2026-09-04T07:57:00.000Z',
  evidenceSource: 'finance-export-one',
  evidenceState: 'Current',
  evidenceType: 'Verified statement',
  evidenceVerifier: '33333333-3333-4333-8333-333333333333',
  grossBooked: 120_000,
  netCollected: 120_000,
  paryatechOsCommercialReference: 'commercial-one',
  paymentState: 'Paid',
  products: ['22222222-2222-4222-8222-222222222222'],
  refundedOrReversedAmount: 0,
  renewalAt: '2027-09-04',
  renewalNextAction: 'Review renewal evidence.',
  renewalNextActionAt: '2027-08-04T10:00:00.000Z',
  renewalOwner: '33333333-3333-4333-8333-444444444444',
  renewalState: 'Renewing',
  restrictedNotes: null,
  sourceOpportunity: null,
  startsAt: '2026-09-04',
  term: 'Yearly',
  waivedAmount: 0,
});

class InMemoryCommercialCutoverStore extends ParyatechCommercialCutoverStore {
  roleLabel = 'Paryatech Commercial Cutover';
  agreements = new Map<string, CommercialCutoverAgreement & { id: string }>();
  receipts = new Map<string, CommercialCutoverReceipt>();
  writes = 0;

  async getApiKeyRoleLabel() {
    return this.roleLabel;
  }

  async transact<TData>(
    _options: {
      apiKeyId: string;
      idempotencyKey: string;
      sourceCommercialId: string;
      workspaceId: string;
    },
    operation: (
      transaction: ParyatechCommercialCutoverTransaction,
    ) => Promise<TData>,
  ): Promise<TData> {
    return operation({
      createAgreement: async (agreement) => {
        this.writes += 1;
        const record = { ...agreement, id: 'agreement-created' };
        this.agreements.set(agreement.paryatechOsCommercialReference, record);
        return record;
      },
      findAgreementForUpdate: async (sourceCommercialId) =>
        this.agreements.get(sourceCommercialId) ?? null,
      findReceiptForUpdate: async (idempotencyKey) =>
        this.receipts.get(idempotencyKey) ?? null,
      insertReceipt: async (receipt) => {
        if (this.receipts.has(receipt.idempotencyKey)) {
          throw new Error('duplicate receipt');
        }
        this.receipts.set(receipt.idempotencyKey, receipt);
      },
      updateAgreement: async (recordId, agreement) => {
        this.writes += 1;
        const record = { ...agreement, id: recordId };
        this.agreements.set(agreement.paryatechOsCommercialReference, record);
        return record;
      },
    });
  }
}

const request = (targetValue = target()) => ({
  apiKeyId: 'api-key-1',
  dryRun: false,
  evidenceHash: HASH,
  expectedSnapshotHash: null,
  idempotencyKey: 'b'.repeat(64),
  target: targetValue,
  targetHash: hashCommercialCutoverValue(targetValue),
  workspaceId: 'workspace-1',
});

describe('CommercialCutoverService', () => {
  it('should admit only the dedicated API-key role', async () => {
    const store = new InMemoryCommercialCutoverStore();
    store.roleLabel = 'Paryatech Import';

    await expect(
      new CommercialCutoverService(store).applyAgreement(request()),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(store.writes).toBe(0);
  });

  it('should deny agreement inspection to every non-cutover API-key role', async () => {
    const store = new InMemoryCommercialCutoverStore();
    store.roleLabel = 'Paryatech Communication Intake';

    await expect(
      new CommercialCutoverService(store).inspectAgreement({
        apiKeyId: 'wrong-role-key',
        sourceCommercialId: 'commercial-1',
        workspaceId: 'workspace-1',
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(store.writes).toBe(0);
  });

  it('should validate a dry run under locks without writing an Agreement or receipt', async () => {
    const store = new InMemoryCommercialCutoverStore();

    const result = await new CommercialCutoverService(store).applyAgreement({
      ...request(),
      dryRun: true,
    });

    expect(result).toMatchObject({
      created: true,
      recordId: null,
      replayed: false,
      snapshot: target(),
      status: 'DRY_RUN',
    });
    expect(store.writes).toBe(0);
    expect(store.receipts.size).toBe(0);
  });

  it('should create one Agreement and replay its immutable receipt', async () => {
    const store = new InMemoryCommercialCutoverStore();
    const service = new CommercialCutoverService(store);

    const first = await service.applyAgreement(request());
    const replay = await service.applyAgreement(request());

    expect(first).toMatchObject({
      created: true,
      previous: null,
      recordId: 'agreement-created',
      replayed: false,
      snapshot: target(),
      status: 'APPLIED',
    });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(store.writes).toBe(1);
    expect(store.receipts.size).toBe(1);
    expect(first.receiptHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('should reject a stored receipt whose immutable evidence was tampered', async () => {
    const store = new InMemoryCommercialCutoverStore();
    const service = new CommercialCutoverService(store);
    await service.applyAgreement(request());
    const receipt = store.receipts.get('b'.repeat(64))!;
    store.receipts.set('b'.repeat(64), {
      ...receipt,
      evidenceHash: 'c'.repeat(64),
    });

    await expect(service.applyAgreement(request())).rejects.toMatchObject({
      code: 'RECEIPT_CONFLICT',
    });
    expect(store.writes).toBe(1);
  });

  it('should reject a reused idempotency key for different immutable evidence', async () => {
    const store = new InMemoryCommercialCutoverStore();
    const service = new CommercialCutoverService(store);
    await service.applyAgreement(request());
    const changed = { ...target(), grossBooked: 120_001 };

    await expect(
      service.applyAgreement({
        ...request(changed),
        idempotencyKey: 'b'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'RECEIPT_CONFLICT' });
    expect(store.writes).toBe(1);
  });

  it('should compare-and-set an existing Agreement and retain its rollback snapshot', async () => {
    const store = new InMemoryCommercialCutoverStore();
    const previous = { ...target(), grossBooked: 100_000 };
    store.agreements.set('commercial-one', {
      ...previous,
      id: 'agreement-existing',
    });
    const service = new CommercialCutoverService(store);

    const result = await service.applyAgreement({
      ...request(),
      expectedSnapshotHash: hashCommercialCutoverValue(previous),
    });

    expect(result).toMatchObject({
      created: false,
      previous,
      recordId: 'agreement-existing',
      snapshot: target(),
    });
    expect(store.writes).toBe(1);
  });

  it('should reject a stale expected snapshot before mutation', async () => {
    const store = new InMemoryCommercialCutoverStore();
    store.agreements.set('commercial-one', {
      ...target(),
      evidenceRecordedAt: '2026-09-04T08:30:00.000Z',
      id: 'agreement-existing',
    });

    await expect(
      new CommercialCutoverService(store).applyAgreement({
        ...request(),
        expectedSnapshotHash: hashCommercialCutoverValue(target()),
      }),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_CUTOVER_CAS_MISMATCH' });
    expect(store.writes).toBe(0);
  });
});
