import { ParyatechCrmResolver } from 'src/modules/paryatech-crm/resolvers/paryatech-crm.resolver';
import { AgencyContactControlService } from 'src/modules/paryatech-crm/services/agency-contact-control.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';

describe('ParyatechCrmResolver integration boundary', () => {
  it('should resolve the authenticated workspace member and pass actor/workspace identity to claim', async () => {
    const claimAgency = jest
      .fn()
      .mockResolvedValue({ agencyId: 'agency-1', status: 'Claimed' });
    const service = { claimAgency } as unknown as AgencyContactControlService;
    const repository = {
      findOne: jest.fn().mockResolvedValue({ id: 'member-1' }),
    };
    const manager = {
      executeInWorkspaceContext: (operation: () => unknown) => operation(),
      getRepository: jest.fn().mockResolvedValue(repository),
    } as unknown as GlobalWorkspaceOrmManager;
    const resolver = new ParyatechCrmResolver(service, manager);

    await resolver.claimAgency(
      {
        agencyId: 'agency-1',
        reason: 'Prospecting',
        evidence: 'Reviewed source',
      },
      { id: 'workspace-1' } as never,
      'user-workspace-1',
      { id: 'user-1' } as never,
    );

    expect(claimAgency).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        userWorkspaceId: 'user-workspace-1',
        actorWorkspaceMemberId: 'member-1',
      }),
    );
  });
});
