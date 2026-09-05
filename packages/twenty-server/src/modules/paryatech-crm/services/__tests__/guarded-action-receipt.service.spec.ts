import {
  buildGuardedActionReceipt,
  reconstructGuardedActionState,
  snapshotGuardedActionState,
} from 'src/modules/paryatech-crm/services/guarded-action-receipt.service';

const OCCURRED_AT = new Date('2026-09-04T10:00:00.000Z');

const buildReceipt = () =>
  buildGuardedActionReceipt('workspace-1', {
    action: 'TRANSITION_SUPPORT_CASE',
    actor: {
      userWorkspaceId: 'user-workspace-1',
      actorWorkspaceMemberId: 'member-1',
    },
    reason: 'Verified resolution transition.',
    evidenceReference: 'Support call note CASE-1.',
    occurredAt: OCCURRED_AT,
    objectName: 'supportCase',
    recordId: 'case-1',
    ownerId: 'member-1',
    priorState: snapshotGuardedActionState({
      status: 'In Progress',
      changedAt: OCCURRED_AT,
    }),
    resultState: snapshotGuardedActionState({
      status: 'Resolved',
      changedAt: OCCURRED_AT,
    }),
  });

describe('guarded action receipt reconstruction', () => {
  it('should reconstruct the exact prior and result states after integrity verification', () => {
    const receipt = buildReceipt();

    expect(reconstructGuardedActionState(receipt)).toEqual({
      priorState: {
        changedAt: OCCURRED_AT.toISOString(),
        status: 'In Progress',
      },
      resultState: {
        changedAt: OCCURRED_AT.toISOString(),
        status: 'Resolved',
      },
    });
    expect(receipt.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.receiptHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should reject a receipt whose reconstructable state was changed', () => {
    const receipt = buildReceipt();

    expect(() =>
      reconstructGuardedActionState({
        ...receipt,
        resultState: { status: 'Closed' },
      }),
    ).toThrow('Guarded action receipt integrity check failed');
  });
});
