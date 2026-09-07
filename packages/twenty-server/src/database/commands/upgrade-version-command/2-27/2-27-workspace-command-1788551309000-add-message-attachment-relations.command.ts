import { Command } from 'nest-commander';

import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { isDefined } from 'twenty-shared/utils';

import { ProvisionedWorkspaceCommandRunner } from 'src/database/commands/command-runners/provisioned-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { getStandardFlatEntitiesToCreateOrThrow } from 'src/database/commands/upgrade-version-command/2-10/utils/get-standard-flat-entities-to-create-or-throw.util';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

const MESSAGE_ATTACHMENT_FIELD_UNIVERSAL_IDENTIFIERS = [
  STANDARD_OBJECTS.message.fields.attachments.universalIdentifier,
  STANDARD_OBJECTS.attachment.fields.message.universalIdentifier,
  STANDARD_OBJECTS.attachment.fields.fileId.universalIdentifier,
  STANDARD_OBJECTS.attachment.fields.providerAttachmentId.universalIdentifier,
  STANDARD_OBJECTS.attachment.fields.mimeType.universalIdentifier,
  STANDARD_OBJECTS.attachment.fields.size.universalIdentifier,
  STANDARD_OBJECTS.attachment.fields.safetyState.universalIdentifier,
  STANDARD_OBJECTS.attachment.fields.quarantineReason.universalIdentifier,
];

@RegisteredWorkspaceCommand('2.27.0', 1788551309000)
@Command({
  name: 'upgrade:2-27:add-message-attachment-relations',
  description:
    'Create Message attachment relations and provider-backed attachment metadata fields',
})
export class AddMessageAttachmentRelationsCommand extends ProvisionedWorkspaceCommandRunner {
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
    const { flatObjectMetadataMaps, flatFieldMetadataMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatObjectMetadataMaps',
        'flatFieldMetadataMaps',
      ]);
    const messageObject =
      flatObjectMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.message.universalIdentifier
      ];
    const attachmentObject =
      flatObjectMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.attachment.universalIdentifier
      ];

    if (!isDefined(messageObject) || !isDefined(attachmentObject)) {
      this.logger.log(
        `Message or Attachment object metadata does not exist for workspace ${workspaceId}, skipping`,
      );

      return;
    }

    if (
      MESSAGE_ATTACHMENT_FIELD_UNIVERSAL_IDENTIFIERS.every(
        (universalIdentifier) =>
          isDefined(
            flatFieldMetadataMaps.byUniversalIdentifier[universalIdentifier],
          ),
      )
    ) {
      this.logger.log(
        `Message attachment fields already exist for workspace ${workspaceId}, skipping`,
      );

      return;
    }

    const { twentyStandardFlatApplication } =
      await this.applicationService.findWorkspaceTwentyStandardAndCustomApplicationOrThrow(
        { workspaceId },
      );
    const { allFlatEntityMaps: standardAllFlatEntityMaps } =
      computeTwentyStandardApplicationAllFlatEntityMaps({
        now: new Date().toISOString(),
        workspaceId,
        twentyStandardApplicationId: twentyStandardFlatApplication.id,
      });
    const fieldsToCreate =
      getStandardFlatEntitiesToCreateOrThrow<FlatFieldMetadata>({
        standardFlatEntityMaps: standardAllFlatEntityMaps.flatFieldMetadataMaps,
        existingFlatEntityMaps: flatFieldMetadataMaps,
        universalIdentifiers: MESSAGE_ATTACHMENT_FIELD_UNIVERSAL_IDENTIFIERS,
      });

    if (fieldsToCreate.length === 0) {
      return;
    }

    this.logger.log(
      `${isDryRun ? '[DRY RUN] ' : ''}Creating ${fieldsToCreate.length} Message attachment field(s) for workspace ${workspaceId}`,
    );

    if (isDryRun) {
      return;
    }

    const result =
      await this.workspaceMigrationValidateBuildAndRunService.validateBuildAndRunLegacyWorkspaceMigration(
        {
          isSystemBuild: true,
          applicationUniversalIdentifier:
            twentyStandardFlatApplication.universalIdentifier,
          workspaceId,
          allFlatEntityOperationByMetadataName: {
            fieldMetadata: {
              flatEntityToCreate: fieldsToCreate,
              flatEntityToDelete: [],
              flatEntityToUpdate: [],
            },
          },
        },
      );

    if (result.status === 'fail') {
      this.logger.error(
        `Failed to create Message attachment fields:\n${JSON.stringify(result, null, 2)}`,
      );

      throw new Error(
        `Failed to create Message attachment fields for workspace ${workspaceId}`,
      );
    }
  }
}
