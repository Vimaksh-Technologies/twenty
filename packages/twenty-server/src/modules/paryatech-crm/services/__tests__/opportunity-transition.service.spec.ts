import { ParyatechCrmExceptionCode } from 'src/modules/paryatech-crm/exceptions/paryatech-crm.exception';
import { OpportunityTransitionService } from 'src/modules/paryatech-crm/services/opportunity-transition.service';
import { InMemoryParyatechTransitionStore } from 'src/modules/paryatech-crm/services/__tests__/paryatech-transition-test.store';
import {
  type OpportunityStage,
  type TransitionOpportunityParams,
} from 'src/modules/paryatech-crm/types/paryatech-transition.type';

const NOW = new Date('2026-09-04T10:00:00.000Z');

type MatrixCase = {
  name: string;
  from: OpportunityStage;
  to: OpportunityStage;
  trialState?: string | null;
  input?: Partial<TransitionOpportunityParams>;
};

const MATRIX_CASES: MatrixCase[] = [
  {
    name: 'Qualified to Demo Scheduled',
    from: 'Qualified',
    to: 'Demo Scheduled',
    input: {
      participatingContactIds: ['contact-1'],
      demoScheduledAt: NOW,
    },
  },
  {
    name: 'Demo Scheduled to Demo Completed',
    from: 'Demo Scheduled',
    to: 'Demo Completed',
    input: {
      demoOccurredAt: NOW,
      demoAttendeeIds: ['contact-1'],
      productIds: ['product-1'],
      demoOutcome: 'Agency confirmed the demonstrated workflow fits.',
    },
  },
  {
    name: 'Demo Completed to Proposal / Commercial Decision',
    from: 'Demo Completed',
    to: 'Proposal / Commercial Decision',
    input: {
      participatingContactIds: ['contact-1'],
      productIds: ['product-1'],
      demoOutcome: 'Decision group requested a proposal.',
      commercialDecisionContext: 'Owner and finance will review yearly terms.',
    },
  },
  {
    name: 'Trial to Proposal / Commercial Decision',
    from: 'Demo Completed',
    to: 'Proposal / Commercial Decision',
    trialState: 'Active',
    input: {
      targetTrialState: 'Completed',
      trialOutcome: 'Criteria met; proceed to commercial review.',
    },
  },
  {
    name: 'Trial to Awaiting Payment',
    from: 'Demo Completed',
    to: 'Awaiting Payment',
    trialState: 'Active',
    input: {
      targetTrialState: 'Completed',
      trialOutcome: 'Criteria met and yearly terms accepted.',
      agreementId: 'agreement-1',
      acceptedTermsEvidence: 'Signed agreement reference AGR-1.',
    },
  },
  {
    name: 'Trial to Lost',
    from: 'Demo Completed',
    to: 'Lost',
    trialState: 'Active',
    input: {
      targetTrialState: 'Expired',
      trialOutcome: 'Success criteria were not met.',
      lossReason: 'Product Gap',
      lossDecisionAt: NOW,
    },
  },
  {
    name: 'Proposal / Commercial Decision to Negotiation',
    from: 'Proposal / Commercial Decision',
    to: 'Negotiation',
    input: {
      proposalDeliveredAt: NOW,
      commercialDecisionContext: 'Price term remains open.',
    },
  },
  {
    name: 'Negotiation to Proposal / Commercial Decision',
    from: 'Negotiation',
    to: 'Proposal / Commercial Decision',
    input: {
      commercialDecisionContext: 'Updated proposal accepted for review.',
    },
  },
  {
    name: 'Proposal / Commercial Decision to Awaiting Payment',
    from: 'Proposal / Commercial Decision',
    to: 'Awaiting Payment',
    input: {
      agreementId: 'agreement-1',
      acceptedTermsEvidence: 'Accepted terms recorded against AGR-1.',
    },
  },
  {
    name: 'Negotiation to Awaiting Payment',
    from: 'Negotiation',
    to: 'Awaiting Payment',
    input: {
      agreementId: 'agreement-1',
      acceptedTermsEvidence: 'Final negotiated terms accepted.',
    },
  },
  {
    name: 'Awaiting Payment to Paid / Won',
    from: 'Awaiting Payment',
    to: 'Paid / Won',
    input: { agreementId: 'agreement-1' },
  },
  {
    name: 'active stage to Lost',
    from: 'Qualified',
    to: 'Lost',
    input: { lossReason: 'Timing', lossDecisionAt: NOW },
  },
  {
    name: 'Lost to prior evidenced stage',
    from: 'Lost',
    to: 'Qualified',
  },
];

const setup = (matrixCase: MatrixCase) => {
  const store = new InMemoryParyatechTransitionStore();
  store.roleLabel =
    matrixCase.trialState != null ||
    matrixCase.to === 'Paid / Won' ||
    matrixCase.to === 'Awaiting Payment' ||
    matrixCase.to === 'Negotiation'
      ? 'Paryatech Commercial Sensitive'
      : 'Paryatech Operator';
  store.records = {
    opportunity: [
      {
        id: 'opportunity-1',
        companyId: 'agency-1',
        ownerId: 'member-1',
        stage: matrixCase.from,
        trialState: matrixCase.trialState ?? null,
        primarySourceId: 'source-1',
      },
    ],
    company: [
      {
        id: 'agency-1',
        agencyLifecycle: 'Active Prospect',
        agencyDisposition: 'Eligible',
      },
    ],
    commercialAgreement: [
      {
        id: 'agreement-1',
        agencyId: 'agency-1',
        sourceOpportunityId: 'opportunity-1',
        paymentState: matrixCase.to === 'Paid / Won' ? 'Paid' : 'Pending',
        evidenceState: 'Current',
        evidenceVerifierId: 'member-1',
        activationState: 'Pending',
        adoptionState: 'Not Assessed',
      },
    ],
  };

  return { store, service: new OpportunityTransitionService(store) };
};

const validInput = (matrixCase: MatrixCase): TransitionOpportunityParams => ({
  workspaceId: 'workspace-1',
  userWorkspaceId: 'user-workspace-1',
  actorWorkspaceMemberId: 'member-1',
  opportunityId: 'opportunity-1',
  expectedStage: matrixCase.from,
  targetStage: matrixCase.to,
  reason: 'Approved transition reason.',
  evidence: 'Reviewed qualifying evidence.',
  nextAction: 'Complete the next accountable step.',
  nextActionAt: NOW,
  now: NOW,
  ...matrixCase.input,
});

describe('OpportunityTransitionService', () => {
  it.each(MATRIX_CASES)(
    'should pass $name with qualifying evidence',
    async (matrixCase) => {
      const { store, service } = setup(matrixCase);

      const result = await service.transition(validInput(matrixCase));

      expect(result.state).toBe(matrixCase.to);
      expect(store.records.opportunity[0].stage).toBe(matrixCase.to);
      expect(store.guardedActionReceipts).toEqual([
        expect.objectContaining({
          action: 'TRANSITION_OPPORTUNITY',
          actorId: 'member-1',
          priorState: expect.objectContaining({
            stage: matrixCase.from,
          }),
          resultState: expect.objectContaining({
            stage: matrixCase.to,
          }),
        }),
      ]);
    },
  );

  it.each(MATRIX_CASES)(
    'should reject $name without evidence',
    async (matrixCase) => {
      const { service } = setup(matrixCase);

      await expect(
        service.transition({ ...validInput(matrixCase), evidence: '' }),
      ).rejects.toMatchObject({
        code: ParyatechCrmExceptionCode.EVIDENCE_REQUIRED,
      });
    },
  );

  it.each(MATRIX_CASES)(
    'should reject $name for an unauthorized actor',
    async (matrixCase) => {
      const { store, service } = setup(matrixCase);
      store.roleLabel = 'Paryatech Legal Compliance';

      await expect(
        service.transition(validInput(matrixCase)),
      ).rejects.toMatchObject({
        code: ParyatechCrmExceptionCode.PERMISSION_DENIED,
      });
    },
  );

  it('should approve an exceptional Trial only with complete controls', async () => {
    const matrixCase: MatrixCase = {
      name: 'approve Trial',
      from: 'Demo Completed',
      to: 'Demo Completed',
    };
    const { store, service } = setup(matrixCase);
    store.roleLabel = 'Paryatech Commercial Sensitive';

    await service.transition({
      ...validInput(matrixCase),
      targetTrialState: 'Approved',
      trialApprovalEvidence: 'Authorized approver reference TA-1.',
      trialReason: 'A bounded exception is required to prove fit.',
      trialOwnerId: 'member-1',
      trialStartsAt: NOW,
      trialEndsAt: new Date('2026-09-11T10:00:00.000Z'),
      trialSuccessCriteria: 'Agency completes one approved proposal workflow.',
      trialExpectedDecision: 'Proceed to yearly commercial decision.',
      productIds: ['product-1'],
    });

    expect(store.records.opportunity[0]).toMatchObject({
      stage: 'Demo Completed',
      trialState: 'Approved',
    });
  });

  it('should require a commercial-sensitive approver for Trial controls', async () => {
    const matrixCase: MatrixCase = {
      name: 'approve Trial',
      from: 'Demo Completed',
      to: 'Demo Completed',
    };
    const { store, service } = setup(matrixCase);
    store.roleLabel = 'Paryatech Operator';

    await expect(
      service.transition({
        ...validInput(matrixCase),
        targetTrialState: 'Approved',
        trialApprovalEvidence: 'Authorized approver reference TA-1.',
        trialReason: 'A bounded exception is required to prove fit.',
        trialOwnerId: 'member-1',
        trialStartsAt: NOW,
        trialEndsAt: new Date('2026-09-11T10:00:00.000Z'),
        trialSuccessCriteria:
          'Agency completes one approved proposal workflow.',
        trialExpectedDecision: 'Proceed to yearly commercial decision.',
        productIds: ['product-1'],
      }),
    ).rejects.toMatchObject({
      code: ParyatechCrmExceptionCode.PERMISSION_DENIED,
    });
  });

  it('should explicitly activate an approved Trial without changing stage', async () => {
    const matrixCase: MatrixCase = {
      name: 'activate Trial',
      from: 'Demo Completed',
      to: 'Demo Completed',
      trialState: 'Approved',
    };
    const { store, service } = setup(matrixCase);

    const result = await service.transition({
      ...validInput(matrixCase),
      targetTrialState: 'Active',
    });

    expect(result.state).toBe('Demo Completed');
    expect(store.records.opportunity[0]).toMatchObject({
      stage: 'Demo Completed',
      trialState: 'Active',
    });
  });

  it('should reject Agreement linkage without one Opportunity Primary Source', async () => {
    const matrixCase: MatrixCase = {
      name: 'await payment',
      from: 'Proposal / Commercial Decision',
      to: 'Awaiting Payment',
      input: {
        agreementId: 'agreement-1',
        acceptedTermsEvidence: 'Accepted terms.',
      },
    };
    const { store, service } = setup(matrixCase);
    store.records.opportunity[0].primarySourceId = null;

    await expect(
      service.transition(validInput(matrixCase)),
    ).rejects.toMatchObject({
      code: ParyatechCrmExceptionCode.EVIDENCE_REQUIRED,
    });
    expect(store.records.opportunity[0].stage).toBe(
      'Proposal / Commercial Decision',
    );
  });

  it('should reject exceptional Trial approval for an unauthorized actor', async () => {
    const matrixCase: MatrixCase = {
      name: 'approve Trial',
      from: 'Demo Completed',
      to: 'Demo Completed',
    };
    const { store, service } = setup(matrixCase);
    store.roleLabel = 'Paryatech Legal Compliance';

    await expect(
      service.transition({
        ...validInput(matrixCase),
        targetTrialState: 'Approved',
        trialApprovalEvidence: 'Authorized approver reference TA-1.',
        trialReason: 'A bounded exception is required to prove fit.',
        trialOwnerId: 'member-1',
        trialStartsAt: NOW,
        trialEndsAt: new Date('2026-09-11T10:00:00.000Z'),
        trialSuccessCriteria:
          'Agency completes one approved proposal workflow.',
        trialExpectedDecision: 'Proceed to yearly commercial decision.',
        productIds: ['product-1'],
      }),
    ).rejects.toMatchObject({
      code: ParyatechCrmExceptionCode.PERMISSION_DENIED,
    });
  });

  it('should make Trial unavailable when its exceptional evidence is incomplete', async () => {
    const matrixCase: MatrixCase = {
      name: 'approve Trial',
      from: 'Demo Completed',
      to: 'Demo Completed',
    };
    const { store, service } = setup(matrixCase);
    store.roleLabel = 'Paryatech Commercial Sensitive';

    await expect(
      service.transition({
        ...validInput(matrixCase),
        targetTrialState: 'Approved',
      }),
    ).rejects.toMatchObject({
      code: ParyatechCrmExceptionCode.EVIDENCE_REQUIRED,
    });
  });

  it('should reject Demo Scheduled directly to Paid / Won and preserve the stage', async () => {
    const matrixCase: MatrixCase = {
      name: 'forged direct win',
      from: 'Demo Scheduled',
      to: 'Paid / Won',
      input: { agreementId: 'agreement-1' },
    };
    const { store, service } = setup(matrixCase);
    store.roleLabel = 'Paryatech Commercial Sensitive';

    await expect(
      service.transition(validInput(matrixCase)),
    ).rejects.toMatchObject({
      code: ParyatechCrmExceptionCode.TRANSITION_NOT_ALLOWED,
    });
    expect(store.records.opportunity[0].stage).toBe('Demo Scheduled');
  });

  it.each(['Pending', 'Part-paid', 'Overdue'])(
    'should reject Paid / Won from %s payment evidence',
    async (paymentState) => {
      const matrixCase: MatrixCase = {
        name: 'win',
        from: 'Awaiting Payment',
        to: 'Paid / Won',
        input: { agreementId: 'agreement-1' },
      };
      const { store, service } = setup(matrixCase);
      store.records.commercialAgreement[0].paymentState = paymentState;

      await expect(
        service.transition(validInput(matrixCase)),
      ).rejects.toMatchObject({
        code: ParyatechCrmExceptionCode.COMMERCIAL_EVIDENCE_INVALID,
      });
    },
  );

  it('should permit an authorized current Waived agreement without activating access', async () => {
    const matrixCase: MatrixCase = {
      name: 'waived win',
      from: 'Awaiting Payment',
      to: 'Paid / Won',
      input: { agreementId: 'agreement-1' },
    };
    const { store, service } = setup(matrixCase);
    Object.assign(store.records.commercialAgreement[0], {
      paymentState: 'Waived',
      commercialException: 'Authorized waiver by commercial owner.',
    });

    await service.transition(validInput(matrixCase));

    expect(store.records.commercialAgreement[0]).toMatchObject({
      activationState: 'Pending',
      adoptionState: 'Not Assessed',
    });
    expect(store.records.company[0].agencyLifecycle).toBe('Customer');
  });
});
