import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { MockedProvider } from '@apollo/client/testing/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from 'twenty-ui/theme-constants';

import { EmailThreadMessageAttachments } from '@/activities/emails/components/EmailThreadMessageAttachments';
import { CREATE_MESSAGE_ATTACHMENT_DOWNLOAD_GRANT } from '@/activities/emails/graphql/mutations/createMessageAttachmentDownloadGrant';
import { GET_AUTHORIZED_MESSAGE_ATTACHMENTS } from '@/activities/emails/graphql/metadata-queries/getAuthorizedMessageAttachments';
import { downloadFile } from '@/activities/files/utils/downloadFile';

const enqueueErrorSnackBar = jest.fn();

jest.mock('@/activities/files/utils/downloadFile', () => ({
  downloadFile: jest.fn(),
}));
jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: () => ({ enqueueErrorSnackBar }),
}));

jest.mock('@/ui/utilities/state/jotai/hooks/useAtomStateValue', () => ({
  useAtomStateValue: () => ({
    accessOrWorkspaceAgnosticToken: { token: 'access-token' },
  }),
}));

jest.mock('@/file/components/FileIcon', () => ({
  FileIcon: () => <span aria-hidden="true">file</span>,
}));

const metadataMock = {
  request: {
    query: GET_AUTHORIZED_MESSAGE_ATTACHMENTS,
    variables: { messageId: 'message-id' },
  },
  result: {
    data: {
      getAuthorizedMessageAttachments: [
        {
          __typename: 'MessageAttachment',
          id: 'accepted-id',
          name: 'invoice.pdf',
          mimeType: 'application/pdf',
          size: 2048,
          safetyState: 'ACCEPTED',
          quarantineReason: null,
          canDownload: true,
        },
        {
          __typename: 'MessageAttachment',
          id: 'quarantined-id',
          name: 'unsafe.html',
          mimeType: 'text/html',
          size: 42,
          safetyState: 'QUARANTINED',
          quarantineReason: 'ACTIVE_CONTENT',
          canDownload: false,
        },
      ],
    },
  },
};

const grantMock = {
  request: {
    query: CREATE_MESSAGE_ATTACHMENT_DOWNLOAD_GRANT,
    variables: {
      messageId: 'message-id',
      attachmentId: 'accepted-id',
    },
  },
  result: {
    data: {
      createMessageAttachmentDownloadGrant: {
        __typename: 'MessageAttachmentDownloadGrant',
        url: 'https://server.example.com/message-attachments/accepted-id/download',
        token: 'one-time-token',
        expiresAt: '2026-09-04T00:01:00.000Z',
      },
    },
  },
};

const renderAttachments = (mocks: readonly unknown[]) =>
  render(
    <MockedProvider mocks={mocks as never}>
      <I18nProvider i18n={i18n}>
        <ThemeProvider colorScheme="light">
          <EmailThreadMessageAttachments messageId="message-id" />
        </ThemeProvider>
      </I18nProvider>
    </MockedProvider>,
  );

describe('EmailThreadMessageAttachments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders accepted and quarantined metadata without exposing a file URL', async () => {
    renderAttachments([metadataMock]);

    expect(await screen.findByText('invoice.pdf')).toBeVisible();
    expect(screen.getByText('2.0 KB')).toBeVisible();
    expect(screen.getByText('unsafe.html')).toBeVisible();
    expect(screen.getByText('Quarantined')).toBeVisible();
    expect(screen.getByRole('list', { name: 'Attachments' })).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('active content')).toBeVisible();
    expect(
      screen.getByText('Contact an administrator if you need this attachment.'),
    ).toBeVisible();
    expect(
      screen.getAllByRole('button', { name: 'Download invoice.pdf' }),
    ).toHaveLength(1);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders nothing when metadata authorization is denied', async () => {
    const { container } = renderAttachments([
      {
        ...metadataMock,
        result: { data: { getAuthorizedMessageAttachments: [] } },
      },
    ]);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('mints a fresh grant and downloads once with current actor authentication', async () => {
    const user = userEvent.setup();

    renderAttachments([metadataMock, grantMock]);

    await user.click(
      await screen.findByRole('button', { name: 'Download invoice.pdf' }),
    );

    await waitFor(() =>
      expect(downloadFile).toHaveBeenCalledWith(
        'https://server.example.com/message-attachments/accepted-id/download',
        'invoice.pdf',
        {
          cache: 'no-store',
          credentials: 'include',
          headers: {
            Authorization: 'Bearer access-token',
            'X-Message-Attachment-Grant': 'one-time-token',
          },
          referrerPolicy: 'no-referrer',
        },
      ),
    );
    expect(downloadFile).toHaveBeenCalledTimes(1);
  });

  it('shows one generic error when grant creation is denied', async () => {
    const user = userEvent.setup();

    renderAttachments([
      metadataMock,
      {
        ...grantMock,
        result: { data: { createMessageAttachmentDownloadGrant: null } },
      },
    ]);

    await user.click(
      await screen.findByRole('button', { name: 'Download invoice.pdf' }),
    );

    await waitFor(() => expect(enqueueErrorSnackBar).toHaveBeenCalledTimes(1));
    expect(downloadFile).not.toHaveBeenCalled();
  });
});
