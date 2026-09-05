import { GET_PARYATECH_CRM_AVAILABLE_ACTIONS } from '@/paryatech-crm/graphql/queries/getParyatechCrmAvailableActions';
import { type ParyatechCrmAvailableAction } from '@/paryatech-crm/types/ParyatechCrmAction';
import { useQuery } from '@apollo/client/react';

export const useParyatechCrmActionAvailability = (agencyId: string) => {
  const { data, loading, error, refetch } = useQuery<
    { getParyatechCrmAvailableActions: ParyatechCrmAvailableAction[] },
    { agencyId: string }
  >(GET_PARYATECH_CRM_AVAILABLE_ACTIONS, {
    variables: { agencyId },
    skip: agencyId.length === 0,
    fetchPolicy: 'network-only',
  });

  return {
    actions: data?.getParyatechCrmAvailableActions ?? [],
    loading,
    error,
    refetch,
  };
};
