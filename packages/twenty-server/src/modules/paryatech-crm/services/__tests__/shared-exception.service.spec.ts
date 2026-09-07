import { ParyatechCrmExceptionCode } from 'src/modules/paryatech-crm/exceptions/paryatech-crm.exception';
import { SharedExceptionService } from 'src/modules/paryatech-crm/services/shared-exception.service';
import { InMemoryParyatechTransitionStore } from 'src/modules/paryatech-crm/services/__tests__/paryatech-transition-test.store';
import { type ResumeSharedExceptionParams } from 'src/modules/paryatech-crm/types/paryatech-transition.type';

const NOW = new Date('2026-09-04T10:00:00.000Z');

const setup = () => {
  const store = new InMemoryParyatechTransitionStore();
  store.roleLabel = 'Paryatech Operator';
  store.records = {
    sharedException: [
      {
        id: 'exception-1',
        exceptionReference: 'EXC-1',
        capability: 'Support',
        affectedObject: 'supportCase',
        affectedRecordId: 'case-1',
        status: 'Resolved',
        lastTrustedState: JSON.stringify({
          status: 'In Progress',
          source: 'Twenty',
        }),
        ownerId: 'member-1',
        evidence: 'Reconciliation evidence passed.',
        resolvedAt: new Date('2026-09-04T09:00:00.000Z'),
        resumeReason: null,
        resumedAt: null,
      },
    ],
  };

  return { store, service: new SharedExceptionService(store) };
};

const input = (): ResumeSharedExceptionParams => ({
  workspaceId: 'workspace-1',
  userWorkspaceId: 'user-workspace-1',
  actorWorkspaceMemberId: 'member-1',
  sharedExceptionId: 'exception-1',
  gatePassed: true,
  reason: 'Affected support gate passed; resume reviewed work.',
  evidence: 'Reconciliation evidence passed.',
  now: NOW,
});

describe('SharedExceptionService', () => {
  it('should resume explicitly only after the gate passes without overwriting trusted state', async () => {
    const { store, service } = setup();
    const trustedState = store.records.sharedException[0].lastTrustedState;

    const result = await service.resume(input());

    expect(result.state).toBe('Resolved');
    expect(store.records.sharedException[0]).toMatchObject({
      lastTrustedState: trustedState,
      evidence: 'Reconciliation evidence passed.',
      resumeReason: 'Affected support gate passed; resume reviewed work.',
      resumedAt: NOW,
    });
    expect(store.guardedActionReceipts).toEqual([
      expect.objectContaining({
        action: 'RESUME_SHARED_EXCEPTION',
        priorState: expect.objectContaining({ resumedAt: null }),
        resultState: expect.objectContaining({ resumedAt: NOW.toISOString() }),
      }),
    ]);
  });

  it.each([
    ['the built-in Admin role', 'Admin', false],
    ['the custom recovery role', 'Paryatech Recovery Administrator', true],
  ])(
    'should authorize %s for Recovery exceptions',
    async (_name, roleLabel, roleIsEditable) => {
      const { store, service } = setup();

      store.roleLabel = roleLabel;
      store.roleIsEditable = roleIsEditable;
      store.records.sharedException[0].capability = 'Recovery';

      await expect(service.resume(input())).resolves.toMatchObject({
        recordId: 'exception-1',
        state: 'Resolved',
      });
    },
  );

  it.each([
    ['an editable role named Admin', 'Admin', true],
    ['an unrelated custom role', 'Paryatech Legal Compliance', true],
  ])(
    'should reject %s for Recovery exceptions',
    async (_name, roleLabel, roleIsEditable) => {
      const { store, service } = setup();

      store.roleLabel = roleLabel;
      store.roleIsEditable = roleIsEditable;
      store.records.sharedException[0].capability = 'Recovery';

      await expect(service.resume(input())).rejects.toMatchObject({
        code: ParyatechCrmExceptionCode.PERMISSION_DENIED,
      });
    },
  );

  it('should not grant built-in Admin access to non-Recovery capabilities', async () => {
    const { store, service } = setup();

    store.roleLabel = 'Admin';
    store.roleIsEditable = false;
    store.records.sharedException[0].capability = 'Policy';

    await expect(service.resume(input())).rejects.toMatchObject({
      code: ParyatechCrmExceptionCode.PERMISSION_DENIED,
    });
  });

  it.each([
    [
      'missing evidence',
      { evidence: '' },
      ParyatechCrmExceptionCode.EVIDENCE_REQUIRED,
    ],
    [
      'failed gate',
      { gatePassed: false },
      ParyatechCrmExceptionCode.EXCEPTION_GATE_NOT_PASSED,
    ],
  ])('should reject %s', async (_name, patch, code) => {
    const { store, service } = setup();

    await expect(
      service.resume({ ...input(), ...patch }),
    ).rejects.toMatchObject({ code });
    expect(store.records.sharedException[0].resumedAt).toBeNull();
  });

  it('should reject unauthorized or unassigned actors', async () => {
    const unauthorized = setup();
    unauthorized.store.roleLabel = 'Paryatech Legal Compliance';
    await expect(unauthorized.service.resume(input())).rejects.toMatchObject({
      code: ParyatechCrmExceptionCode.PERMISSION_DENIED,
    });

    const unassigned = setup();
    unassigned.store.records.sharedException[0].ownerId = 'another-member';
    await expect(unassigned.service.resume(input())).rejects.toMatchObject({
      code: ParyatechCrmExceptionCode.PERMISSION_DENIED,
    });
  });

  it('should reject unresolved or recurrence states without overwriting conflict evidence', async () => {
    for (const status of ['New', 'Investigating', 'Blocked', 'Reopened']) {
      const { store, service } = setup();
      Object.assign(store.records.sharedException[0], {
        status,
        evidence: 'Conflicting source facts remain.',
      });

      await expect(service.resume(input())).rejects.toMatchObject({
        code: ParyatechCrmExceptionCode.TRANSITION_NOT_ALLOWED,
      });
      expect(store.records.sharedException[0].evidence).toBe(
        'Conflicting source facts remain.',
      );
    }
  });

  it('should replay the same explicit resume idempotently', async () => {
    const { store, service } = setup();
    const first = await service.resume(input());
    const replay = await service.resume(input());

    expect(replay).toMatchObject({
      recordId: first.recordId,
      replayed: true,
    });
    expect(store.records.sharedException[0].resumedAt).toBe(NOW);
    expect(store.guardedActionReceipts).toHaveLength(2);
  });
});
