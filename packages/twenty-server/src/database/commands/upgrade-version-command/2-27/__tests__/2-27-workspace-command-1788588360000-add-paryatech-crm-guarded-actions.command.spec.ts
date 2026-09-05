import { type WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { AddParyatechCrmGuardedActionsCommand } from 'src/database/commands/upgrade-version-command/2-27/2-27-workspace-command-1788588360000-add-paryatech-crm-guarded-actions.command';
import { type ApplicationService } from 'src/engine/core-modules/application/application.service';
import { EngineComponentKey } from 'src/engine/metadata-modules/command-menu-item/enums/engine-component-key.enum';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { type WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

const OBJECT_NAMES = [
  'company',
  'person',
  'opportunity',
  'commercialAgreement',
  'supportCase',
  'sharedException',
];

const objectMaps = Object.fromEntries(
  OBJECT_NAMES.map((nameSingular) => [
    `${nameSingular}-universal-id`,
    {
      id: `${nameSingular}-id`,
      universalIdentifier: `${nameSingular}-universal-id`,
      nameSingular,
      isActive: true,
    },
  ]),
);

describe('AddParyatechCrmGuardedActionsCommand', () => {
  const validateBuildAndRun = jest.fn().mockResolvedValue({ status: 'success' });
  const getOrRecompute = jest.fn().mockResolvedValue({
    flatObjectMetadataMaps: { byUniversalIdentifier: objectMaps },
    flatCommandMenuItemMaps: { byUniversalIdentifier: {} },
  });
  const command = new AddParyatechCrmGuardedActionsCommand(
    {} as WorkspaceIteratorService,
    {
      findWorkspaceTwentyStandardAndCustomApplicationOrThrow: jest
        .fn()
        .mockResolvedValue({
          workspaceCustomFlatApplication: {
            id: 'custom-application-id',
            universalIdentifier: 'custom-application-universal-id',
          },
        }),
    } as unknown as ApplicationService,
    { getOrRecompute } as unknown as WorkspaceCacheService,
    {
      validateBuildAndRunLegacyWorkspaceMigration: validateBuildAndRun,
    } as unknown as WorkspaceMigrationValidateBuildAndRunService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    getOrRecompute.mockResolvedValue({
      flatObjectMetadataMaps: { byUniversalIdentifier: objectMaps },
      flatCommandMenuItemMaps: { byUniversalIdentifier: {} },
    });
    validateBuildAndRun.mockResolvedValue({ status: 'success' });
  });

  const run = (dryRun = false) =>
    command.runOnWorkspace({
      workspaceId: 'workspace-1',
      options: { dryRun },
      index: 0,
      total: 1,
    });

  it('should seed one permission-aware guarded command against every U1 object identifier', async () => {
    await run();

    const [payload] = validateBuildAndRun.mock.calls[0];
    const items =
      payload.allFlatEntityOperationByMetadataName.commandMenuItem
        .flatEntityToCreate;
    expect(items).toHaveLength(OBJECT_NAMES.length);
    expect(
      items.map(
        (item: { availabilityObjectMetadataUniversalIdentifier: string }) =>
          item.availabilityObjectMetadataUniversalIdentifier,
      ),
    ).toEqual(OBJECT_NAMES.map((name) => `${name}-universal-id`));
    expect(
      items.every(
        (item: { engineComponentKey: EngineComponentKey }) =>
          item.engineComponentKey ===
          EngineComponentKey.PARYATECH_CRM_RECORD_ACTION,
      ),
    ).toBe(true);
  });

  it('should be idempotent and avoid writes in dry-run mode', async () => {
    await run(true);
    expect(validateBuildAndRun).not.toHaveBeenCalled();
  });

  it('should fail closed when any required U1 object is missing', async () => {
    getOrRecompute.mockResolvedValue({
      flatObjectMetadataMaps: {
        byUniversalIdentifier: Object.fromEntries(Object.entries(objectMaps).slice(1)),
      },
      flatCommandMenuItemMaps: { byUniversalIdentifier: {} },
    });

    await expect(run()).rejects.toThrow('Required U1 object company is missing');
    expect(validateBuildAndRun).not.toHaveBeenCalled();
  });
});
