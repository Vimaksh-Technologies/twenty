import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { FIELD_RESTRICTED_ADDITIONAL_PERMISSIONS_REQUIRED } from 'twenty-shared/constants';
import { MessageParticipantRole } from 'twenty-shared/types';

import { EmailThreadMessage } from '@/activities/emails/components/EmailThreadMessage';

jest.mock(
  '@/activities/emails/components/EmailThreadMessageAttachments',
  () => ({
    EmailThreadMessageAttachments: ({ messageId }: { messageId: string }) => (
      <div>attachments-{messageId}</div>
    ),
  }),
);

jest.mock('@/activities/emails/components/EmailThreadMessageBody', () => ({
  EmailThreadMessageBody: () => <div>body</div>,
}));

jest.mock(
  '@/activities/emails/components/EmailThreadMessageBodyPreview',
  () => ({
    EmailThreadMessageBodyPreview: () => <div>preview</div>,
  }),
);

jest.mock('@/activities/emails/components/EmailThreadMessageLayout', () => ({
  EmailThreadMessageLayout: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

jest.mock('@/activities/emails/components/EmailThreadNotShared', () => ({
  EmailThreadNotShared: () => <div>restricted</div>,
}));

jest.mock('@/activities/emails/components/EmailThreadMessageReceivers', () => ({
  EmailThreadMessageReceivers: () => null,
}));

jest.mock('@/activities/emails/components/EmailThreadMessageSender', () => ({
  EmailThreadMessageSender: () => null,
}));

const message = {
  id: 'message-id',
  text: 'Visible email body',
  isDraft: false,
  sender: { handle: 'sender@example.com' },
  receivedAt: new Date(),
  messageParticipants: [
    {
      id: 'recipient-id',
      role: MessageParticipantRole.TO,
      handle: 'recipient@example.com',
      displayName: 'Recipient',
    },
  ],
};

describe('EmailThreadMessage attachment access', () => {
  it('mounts authorized attachment querying only for an expanded message', () => {
    const { unmount } = render(
      <EmailThreadMessage
        message={message as never}
        onDraftClick={jest.fn()}
      />,
    );

    expect(
      screen.queryByText('attachments-message-id'),
    ).not.toBeInTheDocument();

    unmount();
    render(
      <EmailThreadMessage
        message={message as never}
        isExpanded
        onDraftClick={jest.fn()}
      />,
    );

    expect(screen.getByText('attachments-message-id')).toBeVisible();
  });

  it('never mounts attachment querying for restricted content', () => {
    render(
      <EmailThreadMessage
        message={
          {
            ...message,
            text: FIELD_RESTRICTED_ADDITIONAL_PERMISSIONS_REQUIRED,
          } as never
        }
        isExpanded
        onDraftClick={jest.fn()}
      />,
    );

    expect(
      screen.queryByText('attachments-message-id'),
    ).not.toBeInTheDocument();
  });
});
