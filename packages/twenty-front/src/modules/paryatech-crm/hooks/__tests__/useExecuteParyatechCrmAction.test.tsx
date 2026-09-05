import { useExecuteParyatechCrmAction } from '@/paryatech-crm/hooks/useExecuteParyatechCrmAction';
import { act, renderHook } from '@testing-library/react';

const mutations = Array.from({ length: 10 }, () => jest.fn());
let mutationIndex = 0;
jest.mock('@apollo/client/react', () => ({
  useMutation: () => [mutations[mutationIndex++], { loading: false }],
}));

describe('useExecuteParyatechCrmAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mutationIndex = 0;
  });

  it.each([
    ['CLAIM_AGENCY', 0, { agencyId: 'agency-1' }],
    ['RELEASE_AGENCY', 1, { agencyId: 'agency-1' }],
    [
      'RECORD_OUTREACH_OUTCOME',
      2,
      { agencyId: 'agency-1', outcome: 'ATTEMPTED' },
    ],
    [
      'TRANSITION_OPPORTUNITY',
      3,
      { opportunityId: 'opportunity-1', targetStage: 'Demo Scheduled' },
    ],
    [
      'TRANSITION_AGREEMENT',
      4,
      { agreementId: 'agreement-1', transition: 'PAYMENT' },
    ],
    ['RECORD_SUPPORT_RECEIPT', 5, { receiptKey: 'Email:message-1' }],
    ['CLEAR_SUPPRESSION', 6, { targetObject: 'company', targetId: 'agency-1' }],
    ['RECORD_SUBSTANTIVE_RESPONSE', 7, { supportCaseId: 'case-1' }],
    [
      'TRANSITION_SUPPORT_CASE',
      8,
      { supportCaseId: 'case-1', targetStatus: 'Resolved' },
    ],
    [
      'RESUME_SHARED_EXCEPTION',
      9,
      { sharedExceptionId: 'exception-1', gatePassed: true },
    ],
  ] as const)(
    'should route %s exactly once through its guarded mutation',
    async (action, expectedMutationIndex, actionInput) => {
      mutations[expectedMutationIndex].mockResolvedValue({ data: {} });
      const { result } = renderHook(() => useExecuteParyatechCrmAction());
      const input = {
        ...actionInput,
        reason: 'Verified action',
        evidence: 'Retained evidence',
      };

      await act(() => result.current.execute(action, input as never));

      expect(mutations[expectedMutationIndex]).toHaveBeenCalledTimes(1);
      expect(mutations[expectedMutationIndex]).toHaveBeenCalledWith({
        variables: { input },
      });
      mutations.forEach((mutation, index) => {
        if (index !== expectedMutationIndex) {
          expect(mutation).not.toHaveBeenCalled();
        }
      });
    },
  );
});
