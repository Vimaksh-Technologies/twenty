import { ParyatechCrmSingleRecordCommand } from '@/command-menu-item/engine-command/record/single-record/paryatech-crm/components/ParyatechCrmSingleRecordCommand';
import { render, screen } from '@testing-library/react';

let objectName = 'company';
let actions: {
  action: 'CLAIM_AGENCY' | 'TRANSITION_OPPORTUNITY';
  requiresReason: true;
  requiresEvidence: true;
}[] = [];
const availability = jest.fn(() => ({ actions, loading: false }));
jest.mock(
  '@/command-menu-item/engine-command/hooks/useHeadlessCommandContextApi',
  () => ({
    useHeadlessCommandContextApi: () => ({
      selectedRecords: [{ id: 'agency-1' }],
      objectMetadataItem: { nameSingular: objectName },
    }),
  }),
);
jest.mock('@/paryatech-crm/hooks/useParyatechCrmActionAvailability', () => ({
  useParyatechCrmActionAvailability: (...arguments_: unknown[]) =>
    availability(...arguments_),
}));
jest.mock(
  '@/command-menu-item/engine-command/components/HeadlessEngineCommandWrapperEffect',
  () => ({
    HeadlessEngineCommandWrapperEffect: ({ ready }: { ready: boolean }) => (
      <div data-testid="command-ready">{String(ready)}</div>
    ),
  }),
);
jest.mock('@/ui/layout/modal/components/ModalStatefulWrapper', () => ({
  ModalStatefulWrapper: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
jest.mock('@/ui/layout/modal/hooks/useModal', () => ({
  useModal: () => ({ openModal: jest.fn(), closeModal: jest.fn() }),
}));
jest.mock('@apollo/client/react', () => ({
  useApolloClient: () => ({ refetchQueries: jest.fn() }),
}));
jest.mock('@/paryatech-crm/components/ParyatechCrmActionForm', () => ({
  ParyatechCrmActionForm: () => <div>Action form</div>,
}));
jest.mock('@/ui/input/components/Select', () => ({
  Select: ({ options }: { options: { label: string; value: string }[] }) => (
    <div>
      {options.map((option) => (
        <span key={option.value}>{option.label}</span>
      ))}
    </div>
  ),
}));
jest.mock(
  'twenty-ui/surfaces',
  () => ({
    ModalHeader: ({ children }: { children: React.ReactNode }) => (
      <h1>{children}</h1>
    ),
    ModalContent: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
  }),
  { virtual: true },
);
jest.mock(
  'twenty-ui/theme-constants',
  () => ({ themeCssVariables: { spacing: { 3: '12px' } } }),
  { virtual: true },
);

describe('ParyatechCrmSingleRecordCommand', () => {
  beforeEach(() => {
    objectName = 'company';
    jest.clearAllMocks();
  });

  it('should not make the command available when the server returns no actions', () => {
    actions = [];
    render(<ParyatechCrmSingleRecordCommand />);
    expect(screen.getByTestId('command-ready')).toHaveTextContent('false');
    expect(screen.queryByText('Claim Agency')).not.toBeInTheDocument();
  });

  it('should render only actions returned by the server', () => {
    actions = [
      { action: 'CLAIM_AGENCY', requiresReason: true, requiresEvidence: true },
    ];
    render(<ParyatechCrmSingleRecordCommand />);
    expect(screen.getByTestId('command-ready')).toHaveTextContent('true');
    expect(screen.getByText('Claim Agency')).toBeInTheDocument();
    expect(screen.queryByText('Release Agency')).not.toBeInTheDocument();
  });

  it('should enable a U6 action for its selected record object', () => {
    objectName = 'opportunity';
    actions = [
      {
        action: 'TRANSITION_OPPORTUNITY',
        requiresReason: true,
        requiresEvidence: true,
      },
    ];

    render(<ParyatechCrmSingleRecordCommand />);

    expect(screen.getByTestId('command-ready')).toHaveTextContent('true');
    expect(screen.getByText('Transition Opportunity')).toBeInTheDocument();
    expect(availability).toHaveBeenCalledWith('opportunity', 'agency-1');
  });
});
