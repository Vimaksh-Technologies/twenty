import { AgencyContactControlService } from 'src/modules/paryatech-crm/services/agency-contact-control.service';
import { ParyatechCrmActionAvailabilityService } from 'src/modules/paryatech-crm/services/paryatech-crm-action-availability.service';
import { InMemoryParyatechTransitionStore } from 'src/modules/paryatech-crm/services/__tests__/paryatech-transition-test.store';

const context = {
  workspaceId: 'workspace-1',
  userWorkspaceId: 'user-workspace-1',
  actorWorkspaceMemberId: 'member-1',
  recordId: 'record-1',
};

const setup = () => {
  const store = new InMemoryParyatechTransitionStore();
  const agencyService = {
    getAvailableActions: jest
      .fn()
      .mockResolvedValue(['CLAIM_AGENCY', 'RECORD_OUTREACH_OUTCOME']),
  } as unknown as AgencyContactControlService;
  const service = new ParyatechCrmActionAvailabilityService(
    store,
    agencyService,
  );

  return { store, service, agencyService };
};

describe('ParyatechCrmActionAvailabilityService', () => {
  it('should preserve Company U5 actions and expose suppression clearance only to Legal', async () => {
    const { store, service } = setup();
    store.roleLabel = 'Paryatech Legal Compliance';
    store.records.company = [
      {
        id: 'record-1',
        isSuppressed: true,
        suppressionReason: 'Retained opt-out evidence.',
        suppressedAt: new Date('2026-09-04T10:00:00.000Z'),
      },
    ];

    await expect(
      service.getAvailableActions({ ...context, objectName: 'company' }),
    ).resolves.toEqual([
      'CLAIM_AGENCY',
      'RECORD_OUTREACH_OUTCOME',
      'CLEAR_SUPPRESSION',
    ]);
  });

  it('should expose support intake from an Agency so a new Case can be created', async () => {
    const { store, service } = setup();
    store.roleLabel = 'Paryatech Operator';
    store.records.company = [{ id: 'record-1', isSuppressed: false }];

    await expect(
      service.getAvailableActions({ ...context, objectName: 'company' }),
    ).resolves.toEqual([
      'CLAIM_AGENCY',
      'RECORD_OUTREACH_OUTCOME',
      'RECORD_SUPPORT_RECEIPT',
    ]);
  });

  it.each([
    ['opportunity', 'Paryatech Operator', ['TRANSITION_OPPORTUNITY']],
    [
      'commercialAgreement',
      'Paryatech Commercial Sensitive',
      ['TRANSITION_AGREEMENT'],
    ],
    [
      'supportCase',
      'Paryatech Operator',
      [
        'RECORD_SUPPORT_RECEIPT',
        'RECORD_SUBSTANTIVE_RESPONSE',
        'TRANSITION_SUPPORT_CASE',
      ],
    ],
    [
      'sharedException',
      'Paryatech Recovery Administrator',
      ['RESUME_SHARED_EXCEPTION'],
    ],
  ] as const)(
    'should expose server-authorized actions for %s',
    async (objectName, roleLabel, expectedActions) => {
      const { store, service } = setup();
      store.roleLabel = roleLabel;
      store.records[objectName] = [
        {
          id: 'record-1',
          status: objectName === 'supportCase' ? 'In Progress' : 'Resolved',
          capability: 'Recovery',
          ownerId: 'member-1',
        },
      ];

      await expect(
        service.getAvailableActions({ ...context, objectName }),
      ).resolves.toEqual(expectedActions);
    },
  );

  it('should hide owner-only actions for unassigned records', async () => {
    const { store, service } = setup();
    store.roleLabel = 'Paryatech Operator';
    store.records.opportunity = [
      { id: 'record-1', ownerId: 'another-member', stage: 'Qualified' },
    ];
    store.records.supportCase = [
      { id: 'record-1', ownerId: 'another-member', status: 'In Progress' },
    ];

    await expect(
      service.getAvailableActions({ ...context, objectName: 'opportunity' }),
    ).resolves.toEqual([]);
    await expect(
      service.getAvailableActions({ ...context, objectName: 'supportCase' }),
    ).resolves.toEqual(['RECORD_SUPPORT_RECEIPT']);
  });

  it('should hide suppression clearance without retained suppression evidence', async () => {
    const { store, service } = setup();
    store.roleLabel = 'Paryatech Legal Compliance';
    store.records.person = [{ id: 'record-1', isSuppressed: true }];

    await expect(
      service.getAvailableActions({ ...context, objectName: 'person' }),
    ).resolves.toEqual([]);
  });

  it('should hide a forged commercial action from an operator', async () => {
    const { store, service } = setup();
    store.roleLabel = 'Paryatech Operator';
    store.records.commercialAgreement = [{ id: 'record-1' }];

    await expect(
      service.getAvailableActions({
        ...context,
        objectName: 'commercialAgreement',
      }),
    ).resolves.toEqual([]);
  });
});
