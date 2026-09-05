import { HeadlessEngineCommandWrapperEffect } from '@/command-menu-item/engine-command/components/HeadlessEngineCommandWrapperEffect';
import { useHeadlessCommandContextApi } from '@/command-menu-item/engine-command/hooks/useHeadlessCommandContextApi';
import { ParyatechCrmActionForm } from '@/paryatech-crm/components/ParyatechCrmActionForm';
import { useParyatechCrmActionAvailability } from '@/paryatech-crm/hooks/useParyatechCrmActionAvailability';
import { type ParyatechCrmAction } from '@/paryatech-crm/types/ParyatechCrmAction';
import { Select } from '@/ui/input/components/Select';
import { ModalStatefulWrapper } from '@/ui/layout/modal/components/ModalStatefulWrapper';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import { useApolloClient } from '@apollo/client/react';
import { styled } from '@linaria/react';
import { useState } from 'react';
import { type SelectOption } from 'twenty-ui/input';
import { ModalContent, ModalHeader } from 'twenty-ui/surfaces';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const MODAL_ID = 'paryatech-crm-record-action-modal';

const StyledContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
`;

const LABELS: Record<ParyatechCrmAction, string> = {
  CLAIM_AGENCY: 'Claim Agency',
  RELEASE_AGENCY: 'Release Agency',
  RECORD_OUTREACH_OUTCOME: 'Record outreach outcome',
};

export const ParyatechCrmSingleRecordCommand = () => {
  const { selectedRecords, objectMetadataItem } =
    useHeadlessCommandContextApi();
  const agencyId = selectedRecords[0]?.id ?? '';
  const { actions, loading } = useParyatechCrmActionAvailability(agencyId);
  const [selectedAction, setSelectedAction] = useState<ParyatechCrmAction | ''>(
    '',
  );
  const { openModal, closeModal } = useModal();
  const apolloClient = useApolloClient();
  const actionOptions: SelectOption<string>[] = actions.map(({ action }) => ({
    value: action,
    label: LABELS[action],
  }));
  const ready =
    objectMetadataItem?.nameSingular === 'company' &&
    selectedRecords[0] !== undefined &&
    !loading &&
    actions.length > 0;

  const handleSuccess = async () => {
    await apolloClient.refetchQueries({ include: 'active' });
    closeModal(MODAL_ID);
  };

  return (
    <>
      <HeadlessEngineCommandWrapperEffect
        execute={() => openModal(MODAL_ID)}
        ready={ready}
      />
      <ModalStatefulWrapper
        modalInstanceId={MODAL_ID}
        isClosable
        size="medium"
        padding="large"
        renderInDocumentBody
        autoHeight
      >
        <ModalHeader>Agency action</ModalHeader>
        <ModalContent>
          <StyledContent>
            <Select
              dropdownId="paryatech-action"
              label="Action"
              fullWidth
              value={selectedAction}
              options={actionOptions}
              emptyOption={{
                label: 'Select an available action',
                value: '',
              }}
              onChange={(value) =>
                setSelectedAction(value as ParyatechCrmAction | '')
              }
            />
            {selectedAction !== '' && (
              <ParyatechCrmActionForm
                action={selectedAction}
                agencyId={agencyId}
                onSuccess={handleSuccess}
              />
            )}
          </StyledContent>
        </ModalContent>
      </ModalStatefulWrapper>
    </>
  );
};
