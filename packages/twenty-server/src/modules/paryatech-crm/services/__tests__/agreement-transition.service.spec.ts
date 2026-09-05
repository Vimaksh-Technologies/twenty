import { ParyatechCrmExceptionCode } from 'src/modules/paryatech-crm/exceptions/paryatech-crm.exception';
import { AgreementTransitionService } from 'src/modules/paryatech-crm/services/agreement-transition.service';
import { InMemoryParyatechTransitionStore } from 'src/modules/paryatech-crm/services/__tests__/paryatech-transition-test.store';
import { type TransitionAgreementParams } from 'src/modules/paryatech-crm/types/paryatech-transition.type';

const NOW = new Date('2026-09-04T10:00:00.000Z');

type AgreementCase = {
  name: string;
  transition: TransitionAgreementParams['transition'];
  expectedState: string;
  targetState: string;
  input?: Partial<TransitionAgreementParams>;
};

const AGREEMENT_CASES: AgreementCase[] = [
  {
    name: 'Pending to Part-paid',
    transition: 'PAYMENT',
    expectedState: 'Pending',
    targetState: 'Part-paid',
    input: { amountCollected: 400 },
  },
  {
    name: 'Pending to Paid',
    transition: 'PAYMENT',
    expectedState: 'Pending',
    targetState: 'Paid',
    input: { amountCollected: 1000 },
  },
  {
    name: 'Pending to Overdue',
    transition: 'PAYMENT',
    expectedState: 'Pending',
    targetState: 'Overdue',
  },
  {
    name: 'Pending to Waived',
    transition: 'PAYMENT',
    expectedState: 'Pending',
    targetState: 'Waived',
    input: {
      waivedAmount: 1000,
      authorizationEvidence: 'Approved full waiver.',
    },
  },
  {
    name: 'Part-paid to Paid',
    transition: 'PAYMENT',
    expectedState: 'Part-paid',
    targetState: 'Paid',
    input: { amountCollected: 1000 },
  },
  {
    name: 'Part-paid to Overdue',
    transition: 'PAYMENT',
    expectedState: 'Part-paid',
    targetState: 'Overdue',
  },
  {
    name: 'Part-paid to Waived',
    transition: 'PAYMENT',
    expectedState: 'Part-paid',
    targetState: 'Waived',
    input: {
      waivedAmount: 600,
      authorizationEvidence: 'Approved remaining waiver.',
    },
  },
  {
    name: 'Overdue to Part-paid',
    transition: 'PAYMENT',
    expectedState: 'Overdue',
    targetState: 'Part-paid',
    input: { amountCollected: 400 },
  },
  {
    name: 'Overdue to Paid',
    transition: 'PAYMENT',
    expectedState: 'Overdue',
    targetState: 'Paid',
    input: { amountCollected: 1000 },
  },
  {
    name: 'Overdue to Waived',
    transition: 'PAYMENT',
    expectedState: 'Overdue',
    targetState: 'Waived',
    input: {
      waivedAmount: 1000,
      authorizationEvidence: 'Approved full waiver.',
    },
  },
  {
    name: 'Paid to Refunded',
    transition: 'PAYMENT',
    expectedState: 'Paid',
    targetState: 'Refunded',
    input: { refundedOrReversedAmount: 250 },
  },
  {
    name: 'Paid to Reversed',
    transition: 'PAYMENT',
    expectedState: 'Paid',
    targetState: 'Reversed',
    input: { refundedOrReversedAmount: 300 },
  },
  {
    name: 'Renewing to Renewed',
    transition: 'RENEWAL',
    expectedState: 'Renewing',
    targetState: 'Renewed',
  },
  {
    name: 'Renewing to Changed',
    transition: 'RENEWAL',
    expectedState: 'Renewing',
    targetState: 'Changed',
  },
  {
    name: 'Renewing to Not Renewing',
    transition: 'RENEWAL',
    expectedState: 'Renewing',
    targetState: 'Not Renewing',
  },
  {
    name: 'Renewing to Lapsed',
    transition: 'RENEWAL',
    expectedState: 'Renewing',
    targetState: 'Lapsed',
  },
  {
    name: 'Renewed to Renewing',
    transition: 'RENEWAL',
    expectedState: 'Renewed',
    targetState: 'Renewing',
  },
  {
    name: 'Changed to Renewing',
    transition: 'RENEWAL',
    expectedState: 'Changed',
    targetState: 'Renewing',
  },
  {
    name: 'Lapsed to Renewing',
    transition: 'RENEWAL',
    expectedState: 'Lapsed',
    targetState: 'Renewing',
  },
  {
    name: 'Pending activation to Confirmed',
    transition: 'ACTIVATION',
    expectedState: 'Pending',
    targetState: 'Confirmed',
    input: { activationConfirmedAt: NOW },
  },
  {
    name: 'Pending activation to Review Required',
    transition: 'ACTIVATION',
    expectedState: 'Pending',
    targetState: 'Review Required',
    input: { evidenceState: 'Conflict' },
  },
  {
    name: 'Confirmed activation to Review Required',
    transition: 'ACTIVATION',
    expectedState: 'Confirmed',
    targetState: 'Review Required',
    input: { evidenceState: 'Conflict' },
  },
  {
    name: 'Review Required activation to Confirmed',
    transition: 'ACTIVATION',
    expectedState: 'Review Required',
    targetState: 'Confirmed',
    input: { activationConfirmedAt: NOW },
  },
  {
    name: 'Not Assessed to Evidence Tracking',
    transition: 'ADOPTION',
    expectedState: 'Not Assessed',
    targetState: 'Evidence Tracking',
    input: {
      adoptionEvidence: 'Usage review started.',
      adoptionObservedAt: NOW,
    },
  },
  {
    name: 'Evidence Tracking to Milestone Recorded',
    transition: 'ADOPTION',
    expectedState: 'Evidence Tracking',
    targetState: 'Milestone Recorded',
    input: {
      adoptionEvidence: 'First approved success milestone observed.',
      adoptionObservedAt: NOW,
    },
  },
];

const setup = (agreementCase: AgreementCase) => {
  const store = new InMemoryParyatechTransitionStore();
  store.roleLabel = 'Paryatech Commercial Sensitive';
  store.records = {
    commercialAgreement: [
      {
        id: 'agreement-1',
        agencyId: 'agency-1',
        sourceOpportunityId: 'opportunity-1',
        grossBooked: 1000,
        paymentState:
          agreementCase.transition === 'PAYMENT'
            ? agreementCase.expectedState
            : 'Paid',
        amountCollected:
          agreementCase.transition === 'PAYMENT' &&
          agreementCase.expectedState === 'Paid'
            ? 1000
            : agreementCase.transition === 'PAYMENT' &&
                agreementCase.expectedState === 'Part-paid'
              ? 400
              : 0,
        waivedAmount: 0,
        refundedOrReversedAmount: 0,
        netCollected:
          agreementCase.transition === 'PAYMENT' &&
          agreementCase.expectedState === 'Paid'
            ? 1000
            : 0,
        evidenceState: 'Current',
        renewalState:
          agreementCase.transition === 'RENEWAL'
            ? agreementCase.expectedState
            : 'Renewing',
        renewalAt: NOW,
        renewalOwnerId: 'member-1',
        activationState:
          agreementCase.transition === 'ACTIVATION'
            ? agreementCase.expectedState
            : 'Pending',
        adoptionState:
          agreementCase.transition === 'ADOPTION'
            ? agreementCase.expectedState
            : 'Not Assessed',
      },
    ],
    opportunity: [
      { id: 'opportunity-1', stage: 'Awaiting Payment', companyId: 'agency-1' },
    ],
    sharedException: [],
  };

  return { store, service: new AgreementTransitionService(store) };
};

const validInput = (
  agreementCase: AgreementCase,
): TransitionAgreementParams => ({
  workspaceId: 'workspace-1',
  userWorkspaceId: 'user-workspace-1',
  actorWorkspaceMemberId: 'member-1',
  agreementId: 'agreement-1',
  transition: agreementCase.transition,
  expectedState: agreementCase.expectedState,
  targetState: agreementCase.targetState,
  reason: 'Approved commercial transition reason.',
  evidence: 'Reviewed source evidence.',
  evidenceSource: 'Approved finance record AGR-1.',
  evidenceType: 'Verified statement',
  evidenceVerifierId: 'member-1',
  evidenceObservedAt: NOW,
  evidenceState: 'Current',
  renewalNextAction: 'Review the renewal with the owner.',
  renewalNextActionAt: NOW,
  activationConfirmerId: 'member-1',
  now: NOW,
  ...agreementCase.input,
});

describe('AgreementTransitionService', () => {
  it.each(AGREEMENT_CASES)(
    'should pass $name with current evidence',
    async (agreementCase) => {
      const { store, service } = setup(agreementCase);

      const result = await service.transition(validInput(agreementCase));

      expect(result.state).toBe(agreementCase.targetState);
      expect(store.guardedActionReceipts).toEqual([
        expect.objectContaining({
          action: 'TRANSITION_AGREEMENT',
          actorId: 'member-1',
          evidenceReference: 'Reviewed source evidence.',
          resultState: expect.objectContaining({
            [agreementCase.transition === 'PAYMENT'
              ? 'paymentState'
              : agreementCase.transition === 'RENEWAL'
                ? 'renewalState'
                : agreementCase.transition === 'ACTIVATION'
                  ? 'activationState'
                  : 'adoptionState']: agreementCase.targetState,
          }),
        }),
      ]);
    },
  );

  it.each(AGREEMENT_CASES)(
    'should reject $name without evidence',
    async (agreementCase) => {
      const { service } = setup(agreementCase);

      await expect(
        service.transition({ ...validInput(agreementCase), evidence: '' }),
      ).rejects.toMatchObject({
        code: ParyatechCrmExceptionCode.EVIDENCE_REQUIRED,
      });
    },
  );

  it.each(AGREEMENT_CASES)(
    'should reject $name for an unauthorized actor',
    async (agreementCase) => {
      const { store, service } = setup(agreementCase);
      store.roleLabel = 'Paryatech Operator';

      await expect(
        service.transition(validInput(agreementCase)),
      ).rejects.toMatchObject({
        code: ParyatechCrmExceptionCode.PERMISSION_DENIED,
      });
    },
  );

  it.each([
    ['Part-paid', { amountCollected: 300 }],
    ['Overdue', {}],
    ['Paid', { amountCollected: 1000 }],
  ] as const)(
    'should never move or activate the Opportunity when payment becomes %s',
    async (targetState, patch) => {
      const agreementCase: AgreementCase = {
        name: targetState,
        transition: 'PAYMENT',
        expectedState: 'Pending',
        targetState,
        input: patch,
      };
      const { store, service } = setup(agreementCase);

      await service.transition(validInput(agreementCase));

      expect(store.records.opportunity[0].stage).toBe('Awaiting Payment');
      expect(store.records.commercialAgreement[0].activationState).toBe(
        'Pending',
      );
    },
  );
  it.each(['Refunded', 'Reversed'])(
    'should preserve gross and win history while reducing net for %s',
    async (targetState) => {
      const agreementCase: AgreementCase = {
        name: targetState,
        transition: 'PAYMENT',
        expectedState: 'Paid',
        targetState,
        input: { refundedOrReversedAmount: 250 },
      };
      const { store, service } = setup(agreementCase);
      store.records.opportunity[0].stage = 'Paid / Won';

      await service.transition(validInput(agreementCase));

      expect(store.records.commercialAgreement[0]).toMatchObject({
        grossBooked: 1000,
        amountCollected: 1000,
        refundedOrReversedAmount: 250,
        netCollected: 750,
        activationState: 'Review Required',
      });
      expect(store.records.opportunity[0].stage).toBe('Paid / Won');
      expect(store.createdRecords).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ objectName: 'sharedException' }),
        ]),
      );
    },
  );

  it('should preserve zero net collected for a fully waived agreement', async () => {
    const agreementCase: AgreementCase = {
      name: 'waived',
      transition: 'PAYMENT',
      expectedState: 'Pending',
      targetState: 'Waived',
      input: { waivedAmount: 1000, authorizationEvidence: 'Approved waiver.' },
    };
    const { store, service } = setup(agreementCase);

    await service.transition(validInput(agreementCase));

    expect(store.records.commercialAgreement[0]).toMatchObject({
      grossBooked: 1000,
      waivedAmount: 1000,
      netCollected: 0,
      activationState: 'Pending',
    });
  });

  it('should reject a waiver that leaves an unpaid and unwaived balance', async () => {
    const agreementCase: AgreementCase = {
      name: 'partial waiver',
      transition: 'PAYMENT',
      expectedState: 'Pending',
      targetState: 'Waived',
      input: { waivedAmount: 400, authorizationEvidence: 'Approved waiver.' },
    };
    const { service } = setup(agreementCase);

    await expect(
      service.transition(validInput(agreementCase)),
    ).rejects.toMatchObject({
      code: ParyatechCrmExceptionCode.COMMERCIAL_EVIDENCE_INVALID,
    });
  });

  it('should require the authenticated actor as activation confirmer', async () => {
    const agreementCase: AgreementCase = {
      name: 'activation',
      transition: 'ACTIVATION',
      expectedState: 'Pending',
      targetState: 'Confirmed',
      input: { activationConfirmedAt: NOW },
    };
    const { service } = setup(agreementCase);

    await expect(
      service.transition({
        ...validInput(agreementCase),
        activationConfirmerId: 'another-member',
      }),
    ).rejects.toMatchObject({
      code: ParyatechCrmExceptionCode.PERMISSION_DENIED,
    });
  });

  it('should require Current evidence before activation confirmation', async () => {
    const agreementCase: AgreementCase = {
      name: 'activation',
      transition: 'ACTIVATION',
      expectedState: 'Pending',
      targetState: 'Confirmed',
      input: { activationConfirmedAt: NOW },
    };
    const { service } = setup(agreementCase);

    await expect(
      service.transition({
        ...validInput(agreementCase),
        evidenceState: 'Stale',
      }),
    ).rejects.toMatchObject({
      code: ParyatechCrmExceptionCode.COMMERCIAL_EVIDENCE_INVALID,
    });
  });

  it('should require the assigned renewal owner', async () => {
    const agreementCase: AgreementCase = {
      name: 'renewal',
      transition: 'RENEWAL',
      expectedState: 'Renewing',
      targetState: 'Renewed',
    };
    const { store, service } = setup(agreementCase);
    store.records.commercialAgreement[0].renewalOwnerId = 'another-member';

    await expect(
      service.transition(validInput(agreementCase)),
    ).rejects.toMatchObject({
      code: ParyatechCrmExceptionCode.PERMISSION_DENIED,
    });
  });

  it('should preserve trusted state and idempotently open an exception for conflicting authority facts', async () => {
    const agreementCase: AgreementCase = {
      name: 'renewal conflict',
      transition: 'RENEWAL',
      expectedState: 'Renewing',
      targetState: 'Renewed',
    };
    const { store, service } = setup(agreementCase);
    const conflictInput = {
      ...validInput(agreementCase),
      evidence: 'ParyatechOS reports Lapsed while Twenty reports Renewing.',
      evidenceState: 'Conflict' as const,
    };

    const first = await service.transition(conflictInput);
    const replay = await service.transition(conflictInput);

    expect(first).toMatchObject({
      state: 'Renewing',
      correction: expect.stringContaining('Conflict'),
    });
    expect(replay.state).toBe('Renewing');
    expect(store.records.commercialAgreement[0].renewalState).toBe('Renewing');
    expect(store.records.sharedException).toHaveLength(1);
    expect(store.records.sharedException[0]).toMatchObject({
      status: 'New',
      lastTrustedState: expect.stringContaining('"renewalState":"Renewing"'),
      evidence: conflictInput.evidence,
    });
    expect(store.guardedActionReceipts).toHaveLength(2);
  });
});
