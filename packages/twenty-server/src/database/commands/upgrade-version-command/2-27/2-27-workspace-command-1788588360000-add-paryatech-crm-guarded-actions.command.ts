import { Command } from 'nest-commander';
import { isDefined } from 'twenty-shared/utils';
import { v4, v5 } from 'uuid';

import { ProvisionedWorkspaceCommandRunner } from 'src/database/commands/command-runners/provisioned-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { CommandMenuItemAvailabilityType } from 'src/engine/metadata-modules/command-menu-item/enums/command-menu-item-availability-type.enum';
import { EngineComponentKey } from 'src/engine/metadata-modules/command-menu-item/enums/engine-component-key.enum';
import { type FlatCommandMenuItem } from 'src/engine/metadata-modules/flat-command-menu-item/types/flat-command-menu-item.type';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

const GUARDED_ACTION_OBJECT_NAMES = [
  'company',
  'person',
  'opportunity',
  'commercialAgreement',
  'supportCase',
  'sharedException',
] as const;
const PARYATECH_U1_ANCHOR_OBJECT_NAMES = [
  'commercialAgreement',
  'supportCase',
  'sharedException',
] as const;
const GUARDED_ACTION_COMMAND_NAMESPACE = 'bb4dcf55-729b-4d42-aab7-e0a84144e969';

@RegisteredWorkspaceCommand('2.27.0', 1788588360000)
@Command({
  name: 'upgrade:2-27:add-paryatech-crm-guarded-actions',
  description:
    'Register the Paryatech CRM guarded record action on its approved objects',
})
export class AddParyatechCrmGuardedActionsCommand extends ProvisionedWorkspaceCommandRunner {
  constructor(
    protected readonly workspaceIteratorService: WorkspaceIteratorService,
    private readonly applicationService: ApplicationService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly workspaceMigrationValidateBuildAndRunService: WorkspaceMigrationValidateBuildAndRunService,
  ) {
    super(workspaceIteratorService);
  }

  override async runOnWorkspace({
    workspaceId,
    options,
  }: RunOnWorkspaceArgs): Promise<void> {
    const isDryRun = options.dryRun ?? false;
    const { flatObjectMetadataMaps, flatCommandMenuItemMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatObjectMetadataMaps',
        'flatCommandMenuItemMaps',
      ]);
    const findActiveObject = (nameSingular: string) =>
      Object.values(flatObjectMetadataMaps.byUniversalIdentifier).find(
        (metadata) =>
          isDefined(metadata) &&
          metadata.isActive &&
          metadata.nameSingular === nameSingular,
      );
    const presentParyatechAnchorCount = PARYATECH_U1_ANCHOR_OBJECT_NAMES.filter(
      (nameSingular) => isDefined(findActiveObject(nameSingular)),
    ).length;

    if (presentParyatechAnchorCount === 0) {
      this.logger.log(
        `Paryatech U1 schema does not exist for workspace ${workspaceId}, skipping guarded actions`,
      );
      return;
    }

    const objects = GUARDED_ACTION_OBJECT_NAMES.map((nameSingular) => {
      const object = findActiveObject(nameSingular);
      if (!isDefined(object)) {
        throw new Error(`Required U1 object ${nameSingular} is missing`);
      }
      return object;
    });
    const existingItems = Object.values(
      flatCommandMenuItemMaps.byUniversalIdentifier,
    ).filter(isDefined);
    const now = new Date().toISOString();
    let nextPosition =
      existingItems.reduce(
        (maximumPosition, item) => Math.max(maximumPosition, item.position),
        -1,
      ) + 1;
    const missingObjects = objects.filter(
      (object) =>
        !isDefined(
          flatCommandMenuItemMaps.byUniversalIdentifier[
            v5(object.universalIdentifier, GUARDED_ACTION_COMMAND_NAMESPACE)
          ],
        ),
    );

    if (missingObjects.length === 0) {
      this.logger.log(
        `Paryatech CRM guarded actions already exist for workspace ${workspaceId}`,
      );
      return;
    }
    if (isDryRun) {
      this.logger.log(
        `[DRY RUN] Would register ${missingObjects.length} Paryatech CRM guarded actions for workspace ${workspaceId}`,
      );
      return;
    }

    const { workspaceCustomFlatApplication } =
      await this.applicationService.findWorkspaceTwentyStandardAndCustomApplicationOrThrow(
        { workspaceId },
      );
    const itemsToCreate: FlatCommandMenuItem[] = missingObjects.map(
      (object) => ({
        id: v4(),
        universalIdentifier: v5(
          object.universalIdentifier,
          GUARDED_ACTION_COMMAND_NAMESPACE,
        ),
        applicationId: workspaceCustomFlatApplication.id,
        applicationUniversalIdentifier:
          workspaceCustomFlatApplication.universalIdentifier,
        workspaceId,
        isSystemSideEffect: false,
        label: 'CRM Record Action',
        shortLabel: 'CRM Action',
        icon: 'IconShieldLock',
        position: nextPosition++,
        isPinned: false,
        availabilityType: CommandMenuItemAvailabilityType.RECORD_SELECTION,
        conditionalAvailabilityExpression:
          'numberOfSelectedRecords == 1 and objectPermissions.canUpdateObjectRecords and noneDefined(selectedRecords, "deletedAt")',
        frontComponentId: null,
        frontComponentUniversalIdentifier: null,
        engineComponentKey: EngineComponentKey.PARYATECH_CRM_RECORD_ACTION,
        payload: null,
        hotKeys: null,
        workflowVersionId: null,
        availabilityObjectMetadataId: object.id,
        availabilityObjectMetadataUniversalIdentifier:
          object.universalIdentifier,
        pageLayoutId: null,
        pageLayoutUniversalIdentifier: null,
        isActive: true,
        overrides: null,
        universalOverrides: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
    const result =
      await this.workspaceMigrationValidateBuildAndRunService.validateBuildAndRunLegacyWorkspaceMigration(
        {
          isSystemBuild: true,
          workspaceId,
          applicationUniversalIdentifier:
            workspaceCustomFlatApplication.universalIdentifier,
          allFlatEntityOperationByMetadataName: {
            commandMenuItem: {
              flatEntityToCreate: itemsToCreate,
              flatEntityToDelete: [],
              flatEntityToUpdate: [],
            },
          },
        },
      );
    if (result.status === 'fail') {
      throw new Error(
        `Failed to register Paryatech CRM guarded actions for workspace ${workspaceId}`,
      );
    }
  }
}
