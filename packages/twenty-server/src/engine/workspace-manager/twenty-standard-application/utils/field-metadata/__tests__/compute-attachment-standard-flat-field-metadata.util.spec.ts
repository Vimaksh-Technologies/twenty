import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import {
  FieldMetadataType,
  RelationOnDeleteAction,
  RelationType,
} from 'twenty-shared/types';

import { buildAttachmentStandardFlatFieldMetadatas } from 'src/engine/workspace-manager/twenty-standard-application/utils/field-metadata/compute-attachment-standard-flat-field-metadata.util';
import { getStandardObjectMetadataRelatedEntityIds } from 'src/engine/workspace-manager/twenty-standard-application/utils/get-standard-object-metadata-related-entity-ids.util';

describe('buildAttachmentStandardFlatFieldMetadatas', () => {
  it('should build provider, storage, safety, and Message relation metadata with stable universals', () => {
    const fields = buildAttachmentStandardFlatFieldMetadatas({
      now: '2026-09-05T00:00:00.000Z',
      objectName: 'attachment',
      workspaceId: 'workspace-id',
      standardObjectMetadataRelatedEntityIds:
        getStandardObjectMetadataRelatedEntityIds(),
      dependencyFlatEntityMaps: {} as never,
      twentyStandardApplicationId: 'standard-application-id',
    });

    expect(fields.fileId).toMatchObject({
      universalIdentifier:
        STANDARD_OBJECTS.attachment.fields.fileId.universalIdentifier,
      type: FieldMetadataType.TEXT,
      isNullable: true,
    });
    expect(fields.providerAttachmentId).toMatchObject({
      universalIdentifier:
        STANDARD_OBJECTS.attachment.fields.providerAttachmentId
          .universalIdentifier,
      type: FieldMetadataType.TEXT,
    });
    expect(fields.mimeType).toMatchObject({
      universalIdentifier:
        STANDARD_OBJECTS.attachment.fields.mimeType.universalIdentifier,
      type: FieldMetadataType.TEXT,
    });
    expect(fields.size).toMatchObject({
      universalIdentifier:
        STANDARD_OBJECTS.attachment.fields.size.universalIdentifier,
      type: FieldMetadataType.NUMBER,
    });
    expect(fields.safetyState).toMatchObject({
      universalIdentifier:
        STANDARD_OBJECTS.attachment.fields.safetyState.universalIdentifier,
      type: FieldMetadataType.TEXT,
    });
    expect(fields.quarantineReason).toMatchObject({
      universalIdentifier:
        STANDARD_OBJECTS.attachment.fields.quarantineReason.universalIdentifier,
      type: FieldMetadataType.TEXT,
      isNullable: true,
    });
    expect(fields.message).toMatchObject({
      name: 'message',
      universalIdentifier:
        STANDARD_OBJECTS.attachment.fields.message.universalIdentifier,
      type: FieldMetadataType.RELATION,
      relationTargetObjectMetadataUniversalIdentifier:
        STANDARD_OBJECTS.message.universalIdentifier,
      relationTargetFieldMetadataUniversalIdentifier:
        STANDARD_OBJECTS.message.fields.attachments.universalIdentifier,
      universalSettings: {
        relationType: RelationType.MANY_TO_ONE,
        onDelete: RelationOnDeleteAction.CASCADE,
        joinColumnName: 'messageId',
      },
    });

    expect(
      new Set([
        fields.fileId.universalIdentifier,
        fields.providerAttachmentId.universalIdentifier,
        fields.mimeType.universalIdentifier,
        fields.size.universalIdentifier,
        fields.safetyState.universalIdentifier,
        fields.quarantineReason.universalIdentifier,
        fields.message.universalIdentifier,
      ]).size,
    ).toBe(7);
  });
});
