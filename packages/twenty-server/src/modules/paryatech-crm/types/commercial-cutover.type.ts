export type CommercialCutoverAgreement = {
  activationConfirmedAt: null;
  activationConfirmer: null;
  activationState: 'Pending';
  adoptionEvidence: null;
  adoptionObservedAt: null;
  adoptionState: 'Not Assessed';
  agency: string;
  agreementReference: string;
  amountCollected: number;
  commercialException: string | null;
  currency: string;
  endsAt: string;
  evidenceObservedAt: string;
  evidenceRecordedAt: string;
  evidenceSource: string;
  evidenceState: 'Current' | 'Stale' | 'Conflict';
  evidenceType: string;
  evidenceVerifier: string;
  grossBooked: number;
  netCollected: number;
  paryatechOsCommercialReference: string;
  paymentState:
    | 'Pending'
    | 'Part-paid'
    | 'Paid'
    | 'Overdue'
    | 'Waived'
    | 'Refunded'
    | 'Reversed';
  products: string[];
  refundedOrReversedAmount: number;
  renewalAt: string;
  renewalNextAction: string;
  renewalNextActionAt: string;
  renewalOwner: string;
  renewalState: 'Renewing' | 'Renewed' | 'Changed' | 'Not Renewing' | 'Lapsed';
  restrictedNotes: null;
  sourceOpportunity: null;
  startsAt: string;
  term: 'Quarterly' | 'Half-yearly' | 'Yearly';
  waivedAmount: number;
};

export type CommercialCutoverStoredAgreement = CommercialCutoverAgreement & {
  id: string;
};

export type CommercialCutoverReceipt = {
  actorApiKeyIdHash: string;
  created: boolean;
  evidenceHash: string;
  idempotencyKey: string;
  previous: CommercialCutoverAgreement | null;
  receiptHash: string;
  recordId: string;
  requestHash: string;
  schemaVersion: 'paryatech-commercial-cutover-receipt/v1';
  snapshot: CommercialCutoverAgreement;
  targetHash: string;
};

export type CommercialCutoverApplyResult = {
  actorApiKeyIdHash: string;
  created: boolean;
  evidenceHash: string;
  idempotencyKey: string;
  previous: CommercialCutoverAgreement | null;
  receiptHash: string | null;
  recordId: string | null;
  replayed: boolean;
  requestHash: string;
  snapshot: CommercialCutoverAgreement;
  status: 'APPLIED' | 'DRY_RUN';
  targetHash: string;
};

export type ApplyCommercialCutoverAgreementParams = {
  apiKeyId: string;
  dryRun: boolean;
  evidenceHash: string;
  expectedSnapshotHash: string | null;
  idempotencyKey: string;
  target: unknown;
  targetHash: string;
  workspaceId: string;
};

export type ParyatechCommercialCutoverTransaction = {
  createAgreement: (
    agreement: CommercialCutoverAgreement,
  ) => Promise<CommercialCutoverStoredAgreement>;
  findAgreementForUpdate: (
    sourceCommercialId: string,
  ) => Promise<CommercialCutoverStoredAgreement | null>;
  findReceiptForUpdate: (
    idempotencyKey: string,
  ) => Promise<CommercialCutoverReceipt | null>;
  insertReceipt: (receipt: CommercialCutoverReceipt) => Promise<void>;
  updateAgreement: (
    recordId: string,
    agreement: CommercialCutoverAgreement,
  ) => Promise<CommercialCutoverStoredAgreement>;
};

export abstract class ParyatechCommercialCutoverStore {
  abstract getApiKeyRoleLabel(params: {
    apiKeyId: string;
    workspaceId: string;
  }): Promise<string>;

  abstract transact<TData>(
    options: {
      apiKeyId: string;
      idempotencyKey: string;
      sourceCommercialId: string;
      workspaceId: string;
    },
    operation: (
      transaction: ParyatechCommercialCutoverTransaction,
    ) => Promise<TData>,
  ): Promise<TData>;
}
