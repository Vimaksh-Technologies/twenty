import { useExecuteParyatechCrmAction } from '@/paryatech-crm/hooks/useExecuteParyatechCrmAction';
import { type ParyatechCrmActionExecution } from '@/paryatech-crm/types/ParyatechCrmAction';
import { act, renderHook } from '@testing-library/react';

const mutations = Array.from({ length: 10 }, () => jest.fn());
let mutationIndex = 0;
jest.mock('@apollo/client/react', () => ({
  useMutation: () => [mutations[mutationIndex++], { loading: false }],
}));

const COMMON_INPUT = {
  reason: 'Verified action',
  evidence: 'Retained evidence',
};
const NOW = '2026-09-04T10:00:00.000Z';
const EXECUTIONS: Array<[ParyatechCrmActionExecution, number]> = [
  [
    {
      action: 'CLAIM_AGENCY',
      input: { ...COMMON_INPUT, agencyId: 'agency-1' },
    },
    0,
  ],
  [
    {
      action: 'RELEASE_AGENCY',
      input: { ...COMMON_INPUT, agencyId: 'agency-1' },
    },
    1,
  ],
  [
    {
      action: 'RECORD_OUTREACH_OUTCOME',
      input: {
        ...COMMON_INPUT,
        agencyId: 'agency-1',
        channel: 'Phone',
        outcome: 'ATTEMPTED',
        occurredAt: NOW,
        nextAction: 'Review',
      },
    },
    2,
  ],
  [
    {
      action: 'TRANSITION_OPPORTUNITY',
      input: {
        ...COMMON_INPUT,
        opportunityId: 'opportunity-1',
        expectedStage: 'Qualified',
        targetStage: 'Demo Scheduled',
      },
    },
    3,
  ],
  [
    {
      action: 'TRANSITION_AGREEMENT',
      input: {
        ...COMMON_INPUT,
        agreementId: 'agreement-1',
        transition: 'PAYMENT',
        expectedState: 'Pending',
        targetState: 'Paid',
        evidenceSource: 'Finance record',
        evidenceType: 'Statement',
        evidenceObservedAt: NOW,
        evidenceState: 'Current',
      },
    },
    4,
  ],
  [
    {
      action: 'RECORD_SUPPORT_RECEIPT',
      input: {
        ...COMMON_INPUT,
        receiptKey: 'Email:message-1',
        providerOrSourceId: 'message-1',
        payloadHash: 'sha256:abc',
        channel: 'Email',
        sourceReceivedAt: NOW,
        subject: 'Support request',
        summary: 'Agency needs assistance.',
        priority: 'Normal',
      },
    },
    5,
  ],
  [
    {
      action: 'CLEAR_SUPPRESSION',
      input: {
        ...COMMON_INPUT,
        targetObject: 'company',
        targetId: 'agency-1',
      },
    },
    6,
  ],
  [
    {
      action: 'RECORD_SUBSTANTIVE_RESPONSE',
      input: {
        ...COMMON_INPUT,
        supportCaseId: 'case-1',
        respondedAt: NOW,
        responseSummary: 'Provided a verified workaround.',
      },
    },
    7,
  ],
  [
    {
      action: 'TRANSITION_SUPPORT_CASE',
      input: {
        ...COMMON_INPUT,
        supportCaseId: 'case-1',
        expectedStatus: 'In Progress',
        targetStatus: 'Resolved',
        disposition: 'Resolved',
        resolution: 'Verified workaround.',
      },
    },
    8,
  ],
  [
    {
      action: 'RESUME_SHARED_EXCEPTION',
      input: {
        ...COMMON_INPUT,
        sharedExceptionId: 'exception-1',
        gatePassed: true,
      },
    },
    9,
  ],
];

const compileInvalidActionPairings = () => {
  const invalidExecution: ParyatechCrmActionExecution = {
    action: 'CLAIM_AGENCY',
    input: {
      ...COMMON_INPUT,
      // @ts-expect-error A support-case input cannot be paired with CLAIM_AGENCY.
      supportCaseId: 'case-1',
      respondedAt: NOW,
      responseSummary: 'Wrong action input.',
    },
  };

  return invalidExecution;
};

void compileInvalidActionPairings;

describe('useExecuteParyatechCrmAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mutationIndex = 0;
  });

  it.each(EXECUTIONS)(
    'should route $0.action exactly once through its typed guarded mutation',
    async (execution, expectedMutationIndex) => {
      mutations[expectedMutationIndex].mockResolvedValue({ data: {} });
      const { result } = renderHook(() => useExecuteParyatechCrmAction());

      await act(async () => {
        await result.current.execute(execution);
      });

      expect(mutations[expectedMutationIndex]).toHaveBeenCalledTimes(1);
      expect(mutations[expectedMutationIndex]).toHaveBeenCalledWith({
        variables: { input: execution.input },
      });
      mutations.forEach((mutation, index) => {
        if (index !== expectedMutationIndex) {
          expect(mutation).not.toHaveBeenCalled();
        }
      });
    },
  );
});
