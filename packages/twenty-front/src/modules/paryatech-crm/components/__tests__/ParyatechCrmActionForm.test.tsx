import { ParyatechCrmActionForm } from '@/paryatech-crm/components/ParyatechCrmActionForm';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const execute = jest.fn();
let loading = false;

jest.mock('@/paryatech-crm/hooks/useExecuteParyatechCrmAction', () => ({
  useExecuteParyatechCrmAction: () => ({ execute, loading }),
}));

jest.mock('@/paryatech-crm/hooks/useAgencyContactOptions', () => ({
  useAgencyContactOptions: () => ({
    options: [
      {
        value: 'contact-1',
        label: 'Ada Lovelace · ada@example.com',
      },
    ],
    loading: false,
  }),
}));

jest.mock('@/ui/input/components/TextArea', () => ({
  TextArea: ({
    label,
    value,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <label>
      {label}
      <textarea
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  ),
}));

jest.mock('@/ui/input/components/TextInput', () => ({
  TextInput: ({
    label,
    value,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  ),
}));

jest.mock('@/ui/input/components/Select', () => ({
  Select: ({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: string;
    options: { label: string; value: string }[];
    onChange: (value: string) => void;
  }) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="" />
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  ),
}));

jest.mock(
  'twenty-ui/input',
  () => ({
    Button: ({
      title,
      disabled,
      type,
    }: {
      title: string;
      disabled?: boolean;
      type?: 'submit';
    }) => (
      <button type={type} disabled={disabled}>
        {title}
      </button>
    ),
  }),
  { virtual: true },
);

jest.mock(
  'twenty-ui/theme-constants',
  () => ({
    themeCssVariables: {
      spacing: { 3: '12px' },
      font: { size: { sm: '12px' } },
      color: { red: 'red', green: 'green' },
    },
  }),
  { virtual: true },
);

const fillRequiredEvidence = () => {
  fireEvent.change(screen.getByLabelText('Reason'), {
    target: { value: 'Prospecting' },
  });
  fireEvent.change(screen.getByLabelText('Evidence'), {
    target: { value: 'Reviewed source' },
  });
};

describe('ParyatechCrmActionForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loading = false;
  });

  it('should submit a claim only once on a double click', async () => {
    let resolveMutation = () => undefined;
    execute.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveMutation = resolve;
      }),
    );
    const onSuccess = jest.fn();
    render(
      <ParyatechCrmActionForm
        action="CLAIM_AGENCY"
        agencyId="agency-1"
        onSuccess={onSuccess}
      />,
    );
    const button = screen.getByRole('button', { name: 'Confirm action' });

    expect(button).toBeDisabled();
    fillRequiredEvidence();
    fireEvent.click(button);
    fireEvent.click(button);

    expect(execute).toHaveBeenCalledTimes(1);
    resolveMutation();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it('should expose exact U1 channels and serialize Pending / Unknown evidence', async () => {
    execute.mockResolvedValue(undefined);
    render(
      <ParyatechCrmActionForm
        action="RECORD_OUTREACH_OUTCOME"
        agencyId="agency-1"
        onSuccess={jest.fn()}
      />,
    );

    expect(screen.getByRole('option', { name: 'Phone' })).toHaveValue('Phone');
    expect(
      screen.queryByRole('option', { name: 'Call' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Inbound' }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Channel'), {
      target: { value: 'Official WhatsApp' },
    });
    fireEvent.change(screen.getByLabelText('Outcome'), {
      target: { value: 'PENDING_UNKNOWN' },
    });
    fillRequiredEvidence();
    expect(
      screen.getByRole('option', {
        name: 'Ada Lovelace · ada@example.com',
      }),
    ).toHaveValue('contact-1');

    const button = screen.getByRole('button', { name: 'Confirm action' });
    expect(button).toBeDisabled();
    fireEvent.change(
      screen.getByLabelText('Provider evidence key (required)'),
      { target: { value: 'provider-message-1' } },
    );
    fireEvent.click(button);

    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(execute).toHaveBeenCalledWith(
      'RECORD_OUTREACH_OUTCOME',
      expect.objectContaining({
        channel: 'Official WhatsApp',
        outcome: 'PENDING_UNKNOWN',
        providerEvidenceKey: 'provider-message-1',
      }),
    );
    expect(execute.mock.calls[0][1]).not.toHaveProperty('contactId');
  });

  it('should require a Contact for person-reached outcomes', () => {
    render(
      <ParyatechCrmActionForm
        action="RECORD_OUTREACH_OUTCOME"
        agencyId="agency-1"
        onSuccess={jest.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Channel'), {
      target: { value: 'Phone' },
    });
    fireEvent.change(screen.getByLabelText('Outcome'), {
      target: { value: 'REACHED_CALL' },
    });
    fillRequiredEvidence();

    const button = screen.getByRole('button', { name: 'Confirm action' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Contact (required)'), {
      target: { value: 'contact-1' },
    });
    expect(button).toBeEnabled();
  });

  it('should preserve entered evidence and focus after a stale server error', async () => {
    execute.mockRejectedValue(
      new Error('Reservation is stale. Refresh and claim again.'),
    );
    render(
      <ParyatechCrmActionForm
        action="RELEASE_AGENCY"
        agencyId="agency-1"
        onSuccess={jest.fn()}
      />,
    );
    fillRequiredEvidence();
    const button = screen.getByRole('button', { name: 'Confirm action' });
    button.focus();
    fireEvent.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Reservation is stale',
    );
    expect(screen.getByLabelText('Evidence')).toHaveValue('Reviewed source');
    expect(button).toHaveFocus();
  });
});
