import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { FieldMetadataType, RelationType } from 'twenty-shared/types';

import { buildMessageStandardFlatFieldMetadatas } from 'src/engine/workspace-manager/twenty-standard-application/utils/field-metadata/compute-message-standard-flat-field-metadata.util';
import { getStandardObjectMetadataRelatedEntityIds } from 'src/engine/workspace-manager/twenty-standard-application/utils/get-standard-object-metadata-related-entity-ids.util';

describe('buildMessageStandardFlatFieldMetadatas', () => {
  it('should build the universal Message to Attachment relation field', () => {
    const fields = buildMessageStandardFlatFieldMetadatas({
      now: '2026-09-05T00:00:00.000Z',
      objectName: 'message',
      workspaceId: 'workspace-id',
      standardObjectMetadataRelatedEntityIds:
        getStandardObjectMetadataRelatedEntityIds(),
      dependencyFlatEntityMaps: {} as never,
      twentyStandardApplicationId: 'standard-application-id',
    });

    expect(fields.attachments).toMatchObject({
      name: 'attachments',
      universalIdentifier:
        STANDARD_OBJECTS.message.fields.attachments.universalIdentifier,
      type: FieldMetadataType.RELATION,
      relationTargetObjectMetadataUniversalIdentifier:
        STANDARD_OBJECTS.attachment.universalIdentifier,
      relationTargetFieldMetadataUniversalIdentifier:
        STANDARD_OBJECTS.attachment.fields.message.universalIdentifier,
      universalSettings: {
        relationType: RelationType.ONE_TO_MANY,
      },
    });
  });
});
