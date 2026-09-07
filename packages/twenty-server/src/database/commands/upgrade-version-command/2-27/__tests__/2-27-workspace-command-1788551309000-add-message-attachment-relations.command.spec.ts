import { STANDARD_OBJECTS } from 'twenty-shared/metadata';

import { type WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { AddMessageAttachmentRelationsCommand } from 'src/database/commands/upgrade-version-command/2-27/2-27-workspace-command-1788551309000-add-message-attachment-relations.command';
import { type ApplicationService } from 'src/engine/core-modules/application/application.service';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { type WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

const WORKSPACE_ID = '20202020-0000-4000-8000-000000000001';
const STANDARD_APPLICATION_ID = '20202020-0000-4000-8000-000000000002';
const STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER =
  '20202020-0000-4000-8000-000000000003';

const FIELD_UNIVERSAL_IDENTIFIERS = [
  STANDARD_OBJECTS.message.fields.attachments.universalIdentifier,
  STANDARD_OBJECTS.attachment.fields.message.universalIdentifier,
  STANDARD_OBJECTS.attachment.fields.fileId.universalIdentifier,
  STANDARD_OBJECTS.attachment.fields.providerAttachmentId.universalIdentifier,
  STANDARD_OBJECTS.attachment.fields.mimeType.universalIdentifier,
  STANDARD_OBJECTS.attachment.fields.size.universalIdentifier,
  STANDARD_OBJECTS.attachment.fields.safetyState.universalIdentifier,
  STANDARD_OBJECTS.attachment.fields.quarantineReason.universalIdentifier,
];

describe('AddMessageAttachmentRelationsCommand', () => {
  let command: AddMessageAttachmentRelationsCommand;
  let getOrRecompute: jest.Mock;
  let validateBuildAndRun: jest.Mock;

  const cacheWithFields = (fieldUniversalIdentifiers: string[]) => ({
    flatObjectMetadataMaps: {
      byUniversalIdentifier: {
        [STANDARD_OBJECTS.message.universalIdentifier]: {
          id: 'message-object-id',
        },
        [STANDARD_OBJECTS.attachment.universalIdentifier]: {
          id: 'attachment-object-id',
        },
      },
    },
    flatFieldMetadataMaps: {
      byUniversalIdentifier: Object.fromEntries(
        fieldUniversalIdentifiers.map((universalIdentifier) => [
          universalIdentifier,
          { universalIdentifier },
        ]),
      ),
    },
  });

  beforeEach(() => {
    getOrRecompute = jest.fn().mockResolvedValue(cacheWithFields([]));
    validateBuildAndRun = jest.fn().mockResolvedValue({ status: 'success' });

    command = new AddMessageAttachmentRelationsCommand(
      {} as WorkspaceIteratorService,
      {
        findWorkspaceTwentyStandardAndCustomApplicationOrThrow: jest
          .fn()
          .mockResolvedValue({
            twentyStandardFlatApplication: {
              id: STANDARD_APPLICATION_ID,
              universalIdentifier:
                STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER,
            },
          }),
      } as unknown as ApplicationService,
      {
        getOrRecompute,
      } as unknown as WorkspaceCacheService,
      {
        validateBuildAndRunLegacyWorkspaceMigration: validateBuildAndRun,
      } as unknown as WorkspaceMigrationValidateBuildAndRunService,
    );
  });

  const run = (dryRun = false) =>
    command.runOnWorkspace({
      workspaceId: WORKSPACE_ID,
      options: { dryRun },
      index: 0,
      total: 1,
    });

  it('should report the complete change without writing in dry-run mode', async () => {
    await run(true);

    expect(validateBuildAndRun).not.toHaveBeenCalled();
  });

  it('should create both relation sides and attachment storage metadata on first apply', async () => {
    await run();

    expect(validateBuildAndRun).toHaveBeenCalledTimes(1);
    const [payload] = validateBuildAndRun.mock.calls[0];
    const fieldsToCreate =
      payload.allFlatEntityOperationByMetadataName.fieldMetadata
        .flatEntityToCreate;

    expect(
      fieldsToCreate.map(
        (field: { universalIdentifier: string }) => field.universalIdentifier,
      ),
    ).toEqual(expect.arrayContaining(FIELD_UNIVERSAL_IDENTIFIERS));
    expect(fieldsToCreate).toHaveLength(FIELD_UNIVERSAL_IDENTIFIERS.length);
    expect(payload).toMatchObject({
      isSystemBuild: true,
      applicationUniversalIdentifier:
        STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER,
      workspaceId: WORKSPACE_ID,
    });
  });

  it('should no-op when every field already exists', async () => {
    getOrRecompute.mockResolvedValue(
      cacheWithFields(FIELD_UNIVERSAL_IDENTIFIERS),
    );

    await run();

    expect(validateBuildAndRun).not.toHaveBeenCalled();
  });

  it('should reapply after the repository-supported pre-command snapshot is restored', async () => {
    getOrRecompute.mockResolvedValue(cacheWithFields([]));

    await run();
    await run();

    expect(validateBuildAndRun).toHaveBeenCalledTimes(2);
    expect('down' in command).toBe(false);
  });
});
