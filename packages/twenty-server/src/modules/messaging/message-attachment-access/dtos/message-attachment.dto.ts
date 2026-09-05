import { Field, ObjectType } from '@nestjs/graphql';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@ObjectType('MessageAttachment')
export class MessageAttachmentDTO {
  @Field(() => UUIDScalarType)
  id: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  mimeType: string;

  @Field(() => Number)
  size: number;

  @Field(() => String)
  safetyState: 'ACCEPTED' | 'QUARANTINED';

  @Field(() => String, { nullable: true })
  quarantineReason: string | null;

  @Field(() => Boolean)
  canDownload: boolean;
}
