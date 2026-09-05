import { useExecuteParyatechCrmAction } from '@/paryatech-crm/hooks/useExecuteParyatechCrmAction';
import { act, renderHook } from '@testing-library/react';

const mutations = [jest.fn(), jest.fn(), jest.fn()];
let mutationIndex = 0;
jest.mock('@apollo/client/react', () => ({
  useMutation: () => [mutations[mutationIndex++], { loading: false }],
}));

describe('useExecuteParyatechCrmAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mutationIndex = 0;
  });

  it('should route a claim through the guarded mutation with evidence and reason', async () => {
    mutations[0].mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useExecuteParyatechCrmAction());
    await act(() =>
      result.current.execute('CLAIM_AGENCY', {
        agencyId: 'agency-1',
        reason: 'Prospecting',
        evidence: 'Reviewed source',
      }),
    );
    expect(mutations[0]).toHaveBeenCalledWith({
      variables: {
        input: {
          agencyId: 'agency-1',
          reason: 'Prospecting',
          evidence: 'Reviewed source',
        },
      },
    });
  });
});
