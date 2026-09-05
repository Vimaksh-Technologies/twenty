import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { ParyatechCrmResolver } from 'src/modules/paryatech-crm/resolvers/paryatech-crm.resolver';
import { AgencyContactControlService } from 'src/modules/paryatech-crm/services/agency-contact-control.service';
import { AgreementTransitionService } from 'src/modules/paryatech-crm/services/agreement-transition.service';
import { OpportunityTransitionService } from 'src/modules/paryatech-crm/services/opportunity-transition.service';
import { ParyatechCrmActionAvailabilityService } from 'src/modules/paryatech-crm/services/paryatech-crm-action-availability.service';
import { SharedExceptionService } from 'src/modules/paryatech-crm/services/shared-exception.service';
import { SupportCaseIntakeService } from 'src/modules/paryatech-crm/services/support-case-intake.service';
import { SuppressionClearanceService } from 'src/modules/paryatech-crm/services/suppression-clearance.service';

const setup = () => {
  const agencyService = {
    claimAgency: jest
      .fn()
      .mockResolvedValue({ agencyId: 'agency-1', status: 'Claimed' }),
  } as unknown as AgencyContactControlService;
  const availabilityService = {
    getAvailableActions: jest
      .fn()
      .mockResolvedValue(['TRANSITION_OPPORTUNITY']),
  } as unknown as ParyatechCrmActionAvailabilityService;
  const opportunityService = {
    transition: jest.fn().mockResolvedValue({ recordId: 'opportunity-1' }),
  } as unknown as OpportunityTransitionService;
  const agreementService = {
    transition: jest.fn().mockResolvedValue({ recordId: 'agreement-1' }),
  } as unknown as AgreementTransitionService;
  const supportService = {
    recordReceipt: jest.fn().mockResolvedValue({ recordId: 'case-1' }),
    recordSubstantiveResponse: jest
      .fn()
      .mockResolvedValue({ recordId: 'case-1' }),
    transitionCase: jest.fn().mockResolvedValue({ recordId: 'case-1' }),
  } as unknown as SupportCaseIntakeService;
  const suppressionService = {
    clear: jest.fn().mockResolvedValue({ recordId: 'agency-1' }),
  } as unknown as SuppressionClearanceService;
  const exceptionService = {
    resume: jest.fn().mockResolvedValue({ recordId: 'exception-1' }),
  } as unknown as SharedExceptionService;
  const repository = {
    findOne: jest.fn().mockResolvedValue({ id: 'member-1' }),
  };
  const manager = {
    executeInWorkspaceContext: (operation: () => unknown) => operation(),
    getRepository: jest.fn().mockResolvedValue(repository),
  } as unknown as GlobalWorkspaceOrmManager;
  const resolver = new ParyatechCrmResolver(
    agencyService,
    opportunityService,
    agreementService,
    supportService,
    suppressionService,
    exceptionService,
    availabilityService,
    manager,
  );

  return {
    resolver,
    availabilityService,
    agencyService,
    opportunityService,
    agreementService,
    supportService,
    suppressionService,
    exceptionService,
  };
};

const workspace = { id: 'workspace-1' } as never;
const user = { id: 'user-1' } as never;

describe('ParyatechCrmResolver integration boundary', () => {
  it('should resolve the authenticated workspace member and pass actor/workspace identity to claim', async () => {
    const { resolver, agencyService } = setup();

    await resolver.claimAgency(
      {
        agencyId: 'agency-1',
        reason: 'Prospecting',
        evidence: 'Reviewed source',
      },
      workspace,
      'user-workspace-1',
      user,
    );

    expect(agencyService.claimAgency).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        userWorkspaceId: 'user-workspace-1',
        actorWorkspaceMemberId: 'member-1',
      }),
    );
  });

  it('should resolve record-aware actions at the server boundary', async () => {
    const { resolver, availabilityService } = setup();

    await expect(
      resolver.getParyatechCrmAvailableActions(
        'opportunity',
        'opportunity-1',
        workspace,
        'user-workspace-1',
        user,
      ),
    ).resolves.toEqual([
      {
        action: 'TRANSITION_OPPORTUNITY',
        requiresReason: true,
        requiresEvidence: true,
      },
    ]);
    expect(availabilityService.getAvailableActions).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      userWorkspaceId: 'user-workspace-1',
      actorWorkspaceMemberId: 'member-1',
      objectName: 'opportunity',
      recordId: 'opportunity-1',
    });
  });

  it.each([
    [
      'transitionOpportunity',
      'opportunityService',
      'transition',
      { opportunityId: 'opportunity-1' },
    ],
    [
      'transitionAgreement',
      'agreementService',
      'transition',
      { agreementId: 'agreement-1' },
    ],
    [
      'recordSupportReceipt',
      'supportService',
      'recordReceipt',
      { receiptKey: 'Phone:1' },
    ],
    [
      'clearSuppression',
      'suppressionService',
      'clear',
      { targetId: 'agency-1' },
    ],
    [
      'recordSubstantiveResponse',
      'supportService',
      'recordSubstantiveResponse',
      { supportCaseId: 'case-1' },
    ],
    [
      'transitionSupportCase',
      'supportService',
      'transitionCase',
      { supportCaseId: 'case-1' },
    ],
    [
      'resumeSharedException',
      'exceptionService',
      'resume',
      { sharedExceptionId: 'exception-1' },
    ],
  ] as const)(
    'should enforce the authenticated actor boundary for %s',
    async (resolverMethod, serviceName, serviceMethod, input) => {
      const services = setup();
      await services.resolver[resolverMethod](
        input as never,
        workspace,
        'user-workspace-1',
        user,
      );

      expect(services[serviceName][serviceMethod]).toHaveBeenCalledWith(
        expect.objectContaining({
          ...input,
          workspaceId: 'workspace-1',
          userWorkspaceId: 'user-workspace-1',
          actorWorkspaceMemberId: 'member-1',
        }),
      );
    },
  );

  it('should derive trial, commercial evidence, activation, and Case owners from the authenticated actor', async () => {
    const services = setup();

    await services.resolver.transitionOpportunity(
      {
        opportunityId: 'opportunity-1',
        trialOwnerId: 'forged-member',
      } as never,
      workspace,
      'user-workspace-1',
      user,
    );
    await services.resolver.transitionAgreement(
      {
        agreementId: 'agreement-1',
        evidenceVerifierId: 'forged-member',
        activationConfirmerId: 'forged-member',
      } as never,
      workspace,
      'user-workspace-1',
      user,
    );
    await services.resolver.recordSupportReceipt(
      {
        receiptKey: 'Phone:1',
        ownerId: 'forged-member',
      } as never,
      workspace,
      'user-workspace-1',
      user,
    );

    expect(services.opportunityService.transition).toHaveBeenCalledWith(
      expect.objectContaining({ trialOwnerId: 'member-1' }),
    );
    expect(services.agreementService.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        evidenceVerifierId: 'member-1',
        activationConfirmerId: 'member-1',
      }),
    );
    expect(services.supportService.recordReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'member-1' }),
    );
  });
});
