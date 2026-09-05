import { GET_PARYATECH_CRM_AVAILABLE_ACTIONS } from '@/paryatech-crm/graphql/queries/getParyatechCrmAvailableActions';
import {
  type ParyatechCrmAvailableAction,
  type ParyatechCrmObjectName,
} from '@/paryatech-crm/types/ParyatechCrmAction';
import { useQuery } from '@apollo/client/react';

export const useParyatechCrmActionAvailability = (
  objectName: ParyatechCrmObjectName,
  recordId: string,
) => {
  const { data, loading, error, refetch } = useQuery<
    { getParyatechCrmAvailableActions: ParyatechCrmAvailableAction[] },
    { objectName: ParyatechCrmObjectName; recordId: string }
  >(GET_PARYATECH_CRM_AVAILABLE_ACTIONS, {
    variables: { objectName, recordId },
    skip: recordId.length === 0,
    fetchPolicy: 'network-only',
  });

  return {
    actions: data?.getParyatechCrmAvailableActions ?? [],
    loading,
    error,
    refetch,
  };
};
