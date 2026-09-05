import { useParyatechCrmActionAvailability } from '@/paryatech-crm/hooks/useParyatechCrmActionAvailability';
import { renderHook } from '@testing-library/react';

const useQueryMock = jest.fn();
jest.mock('@apollo/client/react', () => ({
  useQuery: (...arguments_: unknown[]) => useQueryMock(...arguments_),
}));

describe('useParyatechCrmActionAvailability', () => {
  it('should expose only server-authorized actions', () => {
    useQueryMock.mockReturnValue({
      data: {
        getParyatechCrmAvailableActions: [
          {
            action: 'CLAIM_AGENCY',
            requiresReason: true,
            requiresEvidence: true,
          },
        ],
      },
      loading: false,
      error: undefined,
      refetch: jest.fn(),
    });
    const { result } = renderHook(() =>
      useParyatechCrmActionAvailability('agency-1'),
    );
    expect(result.current.actions.map(({ action }) => action)).toEqual([
      'CLAIM_AGENCY',
    ]);
  });

  it('should expose no actions while the server returns none', () => {
    useQueryMock.mockReturnValue({
      data: { getParyatechCrmAvailableActions: [] },
      loading: false,
      error: undefined,
      refetch: jest.fn(),
    });
    const { result } = renderHook(() =>
      useParyatechCrmActionAvailability('agency-1'),
    );
    expect(result.current.actions).toEqual([]);
  });
});
