import { useMutation, useQuery } from '@apollo/client/react';
import { useLingui } from '@lingui/react/macro';
import { styled } from '@linaria/react';
import { useState } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { IconDownload } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { OverflowingTextWithTooltip } from 'twenty-ui/surfaces';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { CREATE_MESSAGE_ATTACHMENT_DOWNLOAD_GRANT } from '@/activities/emails/graphql/mutations/createMessageAttachmentDownloadGrant';
import { GET_AUTHORIZED_MESSAGE_ATTACHMENTS } from '@/activities/emails/graphql/metadata-queries/getAuthorizedMessageAttachments';
import { downloadFile } from '@/activities/files/utils/downloadFile';
import { getFileType } from '@/activities/files/utils/getFileType';
import { useSnackBarOnQueryError } from '@/apollo/hooks/useSnackBarOnQueryError';
import { tokenPairState } from '@/auth/states/tokenPairState';
import { FileIcon } from '@/file/components/FileIcon';
import { formatFileSize } from '@/file/utils/formatFileSize';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import {
  type CreateMessageAttachmentDownloadGrantMutation,
  type CreateMessageAttachmentDownloadGrantMutationVariables,
  type GetAuthorizedMessageAttachmentsQuery,
  type GetAuthorizedMessageAttachmentsQueryVariables,
} from '~/generated-metadata/graphql';

const StyledList = styled.ul`
  border-top: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  list-style: none;
  margin: ${themeCssVariables.spacing[3]} 0 0;
  padding: ${themeCssVariables.spacing[3]} 0 0;
`;

const StyledRow = styled.li`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  min-width: 0;
`;

const StyledMetadata = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
`;

const StyledDetails = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

export type EmailThreadMessageAttachmentsProps = {
  messageId: string;
};

const formatQuarantineReason = (reason: string) =>
  reason.replaceAll('_', ' ').toLowerCase();

export const EmailThreadMessageAttachments = ({
  messageId,
}: EmailThreadMessageAttachmentsProps) => {
  const { t } = useLingui();
  const { enqueueErrorSnackBar } = useSnackBar();
  const tokenPair = useAtomStateValue(tokenPairState);
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState<
    string | null
  >(null);
  const { data, error } = useQuery<
    GetAuthorizedMessageAttachmentsQuery,
    GetAuthorizedMessageAttachmentsQueryVariables
  >(GET_AUTHORIZED_MESSAGE_ATTACHMENTS, {
    variables: { messageId },
    fetchPolicy: 'no-cache',
  });
  const [createDownloadGrant] = useMutation<
    CreateMessageAttachmentDownloadGrantMutation,
    CreateMessageAttachmentDownloadGrantMutationVariables
  >(CREATE_MESSAGE_ATTACHMENT_DOWNLOAD_GRANT, { fetchPolicy: 'no-cache' });

  useSnackBarOnQueryError(error, t`Unable to load email attachments`);

  const attachments = data?.getAuthorizedMessageAttachments ?? [];

  if (attachments.length === 0) {
    return null;
  }

  const handleDownload = async (
    attachment: GetAuthorizedMessageAttachmentsQuery['getAuthorizedMessageAttachments'][number],
  ) => {
    setDownloadingAttachmentId(attachment.id);

    try {
      const result = await createDownloadGrant({
        variables: {
          messageId,
          attachmentId: attachment.id,
        },
      });
      const grant = result.data?.createMessageAttachmentDownloadGrant;

      if (!isDefined(grant)) {
        throw new Error('Message attachment download was not authorized');
      }

      const accessToken =
        tokenPair?.accessOrWorkspaceAgnosticToken?.token ?? undefined;

      await downloadFile(grant.url, attachment.name, {
        cache: 'no-store',
        credentials: 'include',
        headers: {
          'X-Message-Attachment-Grant': grant.token,
          ...(isDefined(accessToken)
            ? { Authorization: `Bearer ${accessToken}` }
            : {}),
        },
        referrerPolicy: 'no-referrer',
      });
    } catch {
      enqueueErrorSnackBar({
        message: t`Unable to download attachment. Retry or contact an administrator if your access changed.`,
      });
    } finally {
      setDownloadingAttachmentId(null);
    }
  };

  return (
    <StyledList aria-label={t`Attachments`}>
      {attachments.map((attachment) => {
        const isDownloading = downloadingAttachmentId === attachment.id;

        return (
          <StyledRow key={attachment.id}>
            <FileIcon
              fileCategory={getFileType(attachment.name)}
              size="small"
            />
            <StyledMetadata>
              <OverflowingTextWithTooltip text={attachment.name} />
              <StyledDetails>
                {formatFileSize(attachment.size)}
                {attachment.safetyState === 'QUARANTINED' && (
                  <>
                    {' · '}
                    <span>{t`Quarantined`}</span>
                    {isDefined(attachment.quarantineReason) && (
                      <>
                        {' · '}
                        <span>
                          {formatQuarantineReason(attachment.quarantineReason)}
                        </span>
                      </>
                    )}
                    {' · '}
                    <span>
                      {t`Contact an administrator if you need this attachment.`}
                    </span>
                  </>
                )}
              </StyledDetails>
            </StyledMetadata>
            {attachment.canDownload && (
              <Button
                ariaLabel={t`Download ${attachment.name}`}
                title={t`Download ${attachment.name}`}
                Icon={IconDownload}
                size="small"
                variant="secondary"
                disabled={isDefined(downloadingAttachmentId)}
                isLoading={isDownloading}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleDownload(attachment);
                }}
              />
            )}
          </StyledRow>
        );
      })}
    </StyledList>
  );
};
